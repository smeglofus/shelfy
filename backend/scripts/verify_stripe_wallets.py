"""Verify Apple Pay / Google Pay readiness for Stripe Checkout.

Runs the same probe as ``GET /api/v1/billing/wallet-readiness`` against the
live Stripe account configured in your environment.

Usage
-----
From a shell with Stripe creds in the environment (or in ``.env``)::

    cd backend
    python -m scripts.verify_stripe_wallets

Exit codes:
    0 — Apple Pay domain registered + verified for the configured ``APP_URL``
        host. Google Pay does not need server-side registration on Checkout
        but is reported in the summary.
    1 — Misconfiguration found (missing/invalid domain, HTTP scheme in prod).
        Specific warnings printed to stdout.
    2 — Stripe credentials missing or unrecoverable API error.

What this checks
----------------
* ``settings.app_url`` parses cleanly to a ``host`` we can register.
* The host appears in ``stripe.PaymentMethodDomain.list()``.
* That domain's ``apple_pay.status`` is ``"active"`` (Stripe re-checks the
  well-known file every ~24h; status flips to inactive if the file goes
  missing or is moved).

What this does NOT check
------------------------
* Dashboard payment-method toggles (we deliberately let the Dashboard be the
  source of truth — see comment block in ``app/services/billing.py``).
* Browser/device support — that's user-side.

Pair this with ``verify_stripe_prices.py`` for the full pre-deploy gate.
"""
from __future__ import annotations

import asyncio
import sys

import stripe

from app.core.config import get_settings
from app.services import billing as billing_svc


async def _run() -> int:
    settings = get_settings()

    if not settings.stripe_secret_key:
        print(
            "STRIPE_SECRET_KEY is not configured — cannot verify wallet readiness.",
            file=sys.stderr,
        )
        return 2

    is_test = settings.stripe_secret_key.startswith("sk_test_")
    mode = "TEST" if is_test else "LIVE"
    tail = settings.stripe_secret_key[-4:]
    print(f"Using Stripe {mode} key …{tail}\n")

    try:
        readiness = await billing_svc.assess_wallet_readiness(settings)
    except stripe.error.AuthenticationError as exc:
        print(
            "Stripe authentication failed — check STRIPE_SECRET_KEY: "
            f"{exc.user_message or exc.code}",
            file=sys.stderr,
        )
        return 2
    except stripe.error.StripeError as exc:
        print(
            f"Stripe API error: {exc.user_message or type(exc).__name__}",
            file=sys.stderr,
        )
        return 2

    # ── Render report ────────────────────────────────────────────────────────
    print(f"APP_URL host       : {readiness.app_url_host or '(none)'}")
    print(f"APP_URL is HTTPS   : {readiness.app_url_https}")
    print(f"Apple Pay domain   : "
          f"registered={readiness.apple_pay_domain_registered} "
          f"verified={readiness.apple_pay_domain_verified}")
    # Google Pay is implicitly enabled with `card` — surfacing it for clarity.
    print("Google Pay         : "
          "enabled-with-card (no server registration required)")

    if readiness.warnings:
        print("\nWARNINGS:")
        for w in readiness.warnings:
            print(f"  - {w}")
        print(
            "\nFix the warnings above before relying on Apple Pay / Google Pay."
        )
        return 1

    print("\nAll wallet-readiness checks passed.")
    return 0


def main() -> int:
    return asyncio.run(_run())


if __name__ == "__main__":
    sys.exit(main())
