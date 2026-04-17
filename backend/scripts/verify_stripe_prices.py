"""Verify that Stripe price IDs configured in ``Settings`` exist in Stripe and
map to the plan we think they map to.

Usage
-----
From a shell with Stripe creds in the environment (or in ``.env``)::

    cd backend
    python -m scripts.verify_stripe_prices

Exit codes:
    0 — every configured price_id exists, is active, and has metadata/nickname
        consistent with the expected plan (Home/Pro/Library).
    1 — mismatch or missing price; diff printed to stdout.
    2 — Stripe credentials missing or API error.

What "consistent" means
-----------------------
For each of ``STRIPE_PRICE_ID_PRO`` and ``STRIPE_PRICE_ID_LIBRARY``, we call
``stripe.Price.retrieve(id, expand=["product"])`` and assert:
  * ``price.active is True``
  * ``price.recurring.interval`` is one of {"month", "year"}
  * ``price.product.name`` OR ``price.nickname`` matches the expected plan
    token (case-insensitive substring), e.g. ``"Pro"`` / ``"Library"``.

If either price is blank in the config we report it as "not configured" —
that's valid in self-hosted / dev installs but flagged so a prod deploy
doesn't accidentally ship with missing billing.

The script NEVER logs the Stripe secret key or price IDs in full — only the
last 4 chars of IDs to make diagnostic output safe to paste.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass

import stripe

from app.core.config import get_settings


@dataclass
class PriceCheck:
    config_key: str
    expected_plan: str  # "pro" or "library"
    price_id: str | None
    ok: bool
    message: str

    def render(self) -> str:
        tail = f"…{self.price_id[-4:]}" if self.price_id and len(self.price_id) >= 4 else "(empty)"
        icon = "OK " if self.ok else "FAIL"
        return f"[{icon}] {self.config_key}={tail} plan={self.expected_plan}: {self.message}"


def _fetch_price(stripe_price_id: str) -> dict:
    return stripe.Price.retrieve(stripe_price_id, expand=["product"])


def _check_price(config_key: str, expected_plan: str, price_id: str | None) -> PriceCheck:
    if not price_id:
        return PriceCheck(
            config_key=config_key,
            expected_plan=expected_plan,
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
            price_id=price_id,
            ok=False,
            message="price is archived/inactive in Stripe",
        )

    recurring = price.get("recurring") or {}
    interval = recurring.get("interval")
    if interval not in ("month", "year"):
        return PriceCheck(
            config_key=config_key,
            expected_plan=expected_plan,
            price_id=price_id,
            ok=False,
            message=f"expected recurring price, got interval={interval!r}",
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
            price_id=price_id,
            ok=False,
            message=(
                f"product/nickname does not mention '{expected_plan}' "
                f"(product.name={product_name!r}, nickname={nickname!r})"
            ),
        )

    return PriceCheck(
        config_key=config_key,
        expected_plan=expected_plan,
        price_id=price_id,
        ok=True,
        message=(
            f"active, {interval}ly, matches '{expected_plan}' "
            f"(product={product_name!r}, nickname={nickname!r})"
        ),
    )


def main() -> int:
    settings = get_settings()

    if not settings.stripe_secret_key:
        print("STRIPE_SECRET_KEY is not configured — cannot verify prices.", file=sys.stderr)
        return 2

    stripe.api_key = settings.stripe_secret_key

    checks = [
        _check_price("STRIPE_PRICE_ID_PRO", "pro", settings.stripe_price_id_pro),
        _check_price("STRIPE_PRICE_ID_LIBRARY", "library", settings.stripe_price_id_library),
    ]

    for c in checks:
        print(c.render())

    failed = [c for c in checks if not c.ok]
    if failed:
        print()
        print(f"{len(failed)} of {len(checks)} price mappings failed verification.")
        print("Recommended corrections:")
        for c in failed:
            if c.price_id is None:
                print(f"  - Set {c.config_key} to the Stripe price ID for the {c.expected_plan} plan.")
            else:
                print(
                    f"  - Verify {c.config_key}=…{c.price_id[-4:]} points at the right Stripe price "
                    f"for the {c.expected_plan} plan (dashboard → Products)."
                )
        return 1

    print()
    print(f"All {len(checks)} Stripe price mappings verified.")
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
