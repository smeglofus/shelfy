"""Verify that Stripe price IDs configured in ``Settings`` exist in Stripe and
map to the plan we think they map to, and that the webhook endpoint is wired.

Usage
-----
From a shell with Stripe creds in the environment (or in ``.env``)::

    cd backend
    python -m scripts.verify_stripe_prices

Exit codes:
    0 — every configured price_id exists, is active, recurring with the
        expected interval, and its product/nickname mentions the expected
        plan name. Webhook endpoint (if a URL is passed via
        --webhook-url / env var) exists and is subscribed to all six
        events we handle.
    1 — mismatch or missing price / webhook; diff printed to stdout.
    2 — Stripe credentials missing or API error.

What "consistent" means
-----------------------
For each of the six ``STRIPE_PRICE_ID_*`` slots we call
``stripe.Price.retrieve(id, expand=["product"])`` and assert:
  * ``price.active is True``
  * ``price.recurring.interval`` matches the expected interval
    (``month`` for ``*_MONTHLY``, ``year`` for ``*_YEARLY``)
  * ``price.product.name`` OR ``price.nickname`` mentions the expected
    plan token (case-insensitive substring), e.g. ``"Home"`` / ``"Pro"``.

If any slot is blank in the config we report it as "not configured" — that's
valid in self-hosted / dev installs but flagged so a prod deploy doesn't
accidentally ship with missing billing for one of the plans.

The script NEVER logs the Stripe secret key or price IDs in full — only the
last 4 chars of IDs to make diagnostic output safe to paste.

Webhook check
-------------
If the environment variable ``SHELFY_WEBHOOK_URL`` is set (or the URL is
passed via ``--webhook-url``), we also check that:
  * A ``WebhookEndpoint`` with that exact URL exists and is ``enabled``.
  * Its ``enabled_events`` is a superset of the six events we handle.
"""
from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass

import stripe

from app.core.config import get_settings


# ── Price checks ──────────────────────────────────────────────────────────────

_REQUIRED_WEBHOOK_EVENTS = frozenset({
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.payment_succeeded",
    "invoice.payment_failed",
})


@dataclass
class PriceCheck:
    config_key: str
    expected_plan: str      # "home" | "pro" | "library"
    expected_interval: str  # "month" | "year"
    price_id: str | None
    ok: bool
    message: str

    def render(self) -> str:
        tail = f"…{self.price_id[-4:]}" if self.price_id and len(self.price_id) >= 4 else "(empty)"
        icon = "OK " if self.ok else "FAIL"
        return (
            f"[{icon}] {self.config_key}={tail} "
            f"plan={self.expected_plan} interval={self.expected_interval}: {self.message}"
        )


def _fetch_price(stripe_price_id: str) -> dict:
    """Retrieve a price + product and normalise to a plain dict.

    stripe-python >=15 returns a ``StripeObject`` without a ``.get()`` method
    (attribute access routes through ``__getattr__`` → KeyError). Normalising
    to a dict once keeps the rest of the verifier readable and decoupled from
    SDK internals.
    """
    price = stripe.Price.retrieve(stripe_price_id, expand=["product"])
    return price.to_dict() if hasattr(price, "to_dict") else dict(price)


def _check_price(
    config_key: str,
    expected_plan: str,
    expected_interval: str,
    price_id: str | None,
) -> PriceCheck:
    if not price_id:
        return PriceCheck(
            config_key=config_key,
            expected_plan=expected_plan,
            expected_interval=expected_interval,
            price_id=None,
            ok=False,
            message="not configured (empty in .env)",
        )

    try:
        price = _fetch_price(price_id)
    except stripe.error.InvalidRequestError as exc:
        return PriceCheck(
            config_key=config_key,
            expected_plan=expected_plan,
            expected_interval=expected_interval,
            price_id=price_id,
            ok=False,
            message=f"price not found in Stripe ({exc.user_message or exc.code})",
        )
    except stripe.error.AuthenticationError:
        # Surface auth errors to caller — we exit 2.
        raise

    if not price.get("active"):
        return PriceCheck(
            config_key=config_key,
            expected_plan=expected_plan,
            expected_interval=expected_interval,
            price_id=price_id,
            ok=False,
            message="price is archived/inactive in Stripe",
        )

    recurring = price.get("recurring") or {}
    interval = recurring.get("interval")
    if interval != expected_interval:
        return PriceCheck(
            config_key=config_key,
            expected_plan=expected_plan,
            expected_interval=expected_interval,
            price_id=price_id,
            ok=False,
            message=(
                f"expected recurring interval={expected_interval!r}, "
                f"got interval={interval!r}"
            ),
        )

    product = price.get("product") or {}
    product_name = (product.get("name") or "").lower() if isinstance(product, dict) else ""
    nickname = (price.get("nickname") or "").lower()
    hay = f"{product_name} {nickname}"
    needle = expected_plan.lower()

    if needle not in hay:
        return PriceCheck(
            config_key=config_key,
            expected_plan=expected_plan,
            expected_interval=expected_interval,
            price_id=price_id,
            ok=False,
            message=(
                f"product/nickname does not mention {expected_plan!r} "
                f"(product.name={product_name!r}, nickname={nickname!r})"
            ),
        )

    return PriceCheck(
        config_key=config_key,
        expected_plan=expected_plan,
        expected_interval=expected_interval,
        price_id=price_id,
        ok=True,
        message=(
            f"active, {interval}ly, matches {expected_plan!r} "
            f"(product={product_name!r}, nickname={nickname!r})"
        ),
    )


# ── Webhook check ─────────────────────────────────────────────────────────────


@dataclass
class WebhookCheck:
    url: str | None
    ok: bool
    message: str

    def render(self) -> str:
        icon = "OK " if self.ok else "FAIL"
        target = self.url or "(none)"
        return f"[{icon}] webhook endpoint {target}: {self.message}"


def _check_webhook(url: str | None) -> WebhookCheck | None:
    if not url:
        return None

    endpoints = stripe.WebhookEndpoint.list(limit=100)
    # Normalise to dicts so ``.get()`` / comparisons work regardless of SDK
    # StripeObject quirks.
    match = None
    for we in endpoints.auto_paging_iter():
        d = we.to_dict() if hasattr(we, "to_dict") else dict(we)
        if d.get("url") == url:
            match = d
            break
    if match is None:
        return WebhookCheck(url=url, ok=False, message="no endpoint with that URL exists in Stripe")
    if match.get("status") != "enabled":
        return WebhookCheck(
            url=url, ok=False,
            message=f"endpoint found (id=…{match['id'][-4:]}) but status={match.get('status')!r}",
        )

    enabled = set(match.get("enabled_events") or [])
    missing = _REQUIRED_WEBHOOK_EVENTS - enabled
    if missing:
        return WebhookCheck(
            url=url, ok=False,
            message=(
                f"endpoint enabled but missing events: {sorted(missing)}; "
                f"subscribed to {sorted(enabled)}"
            ),
        )
    return WebhookCheck(
        url=url, ok=True,
        message=(
            f"enabled (id=…{match['id'][-4:]}) with all 6 required events "
            f"({len(enabled)} total subscribed)"
        ),
    )


# ── Main ──────────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--webhook-url",
        default=os.environ.get("SHELFY_WEBHOOK_URL"),
        help="Also check that a webhook endpoint with this URL exists in Stripe "
             "and subscribes to the 6 events we handle. Defaults to $SHELFY_WEBHOOK_URL.",
    )
    args = parser.parse_args(argv)

    settings = get_settings()

    if not settings.stripe_secret_key:
        print("STRIPE_SECRET_KEY is not configured — cannot verify prices.", file=sys.stderr)
        return 2

    stripe.api_key = settings.stripe_secret_key
    key_tail = settings.stripe_secret_key[-4:]
    is_test = settings.stripe_secret_key.startswith("sk_test_")
    mode = "TEST" if is_test else "LIVE"
    print(f"Using Stripe {mode} key …{key_tail}\n")

    checks = [
        _check_price("STRIPE_PRICE_ID_HOME_MONTHLY",    "home",    "month",
                     settings.stripe_price_id_home_monthly),
        _check_price("STRIPE_PRICE_ID_HOME_YEARLY",     "home",    "year",
                     settings.stripe_price_id_home_yearly),
        _check_price("STRIPE_PRICE_ID_PRO_MONTHLY",     "pro",     "month",
                     settings.stripe_price_id_pro_monthly),
        _check_price("STRIPE_PRICE_ID_PRO_YEARLY",      "pro",     "year",
                     settings.stripe_price_id_pro_yearly),
        _check_price("STRIPE_PRICE_ID_LIBRARY_MONTHLY", "library", "month",
                     settings.stripe_price_id_library_monthly),
        _check_price("STRIPE_PRICE_ID_LIBRARY_YEARLY",  "library", "year",
                     settings.stripe_price_id_library_yearly),
    ]

    for c in checks:
        print(c.render())

    webhook = _check_webhook(args.webhook_url)
    if webhook is not None:
        print(webhook.render())

    failed_prices = [c for c in checks if not c.ok]
    webhook_failed = webhook is not None and not webhook.ok

    if failed_prices or webhook_failed:
        print()
        if failed_prices:
            print(f"{len(failed_prices)} of {len(checks)} price mappings failed verification.")
            print("Recommended corrections:")
            for c in failed_prices:
                if c.price_id is None:
                    print(
                        f"  - Set {c.config_key} to the Stripe price ID for the "
                        f"{c.expected_plan} plan ({c.expected_interval}ly)."
                    )
                else:
                    print(
                        f"  - Verify {c.config_key}=…{c.price_id[-4:]} points at the right "
                        f"Stripe price for the {c.expected_plan} plan "
                        f"({c.expected_interval}ly) — dashboard → Products."
                    )
        if webhook_failed:
            print(f"\nWebhook endpoint check failed: {webhook.message}")
        return 1

    print()
    summary = f"All {len(checks)} Stripe price mappings verified"
    if webhook is not None:
        summary += " and webhook endpoint is wired"
    print(summary + ".")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except stripe.error.AuthenticationError as exc:
        print(
            "Stripe authentication failed — check STRIPE_SECRET_KEY: "
            f"{exc.user_message or exc.code}",
            file=sys.stderr,
        )
        sys.exit(2)
    except stripe.error.StripeError as exc:
        print(f"Stripe API error: {exc.user_message or type(exc).__name__}", file=sys.stderr)
        sys.exit(2)
