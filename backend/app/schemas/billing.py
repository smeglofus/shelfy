"""Pydantic schemas for the billing / Stripe endpoints."""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel


class UsageSummary(BaseModel):
    scans_used: int
    scans_limit: int          # -1 = unlimited
    enrichments_used: int
    enrichments_limit: int    # -1 = unlimited


class BillingStatusResponse(BaseModel):
    plan: str                              # 'free' | 'home' | 'pro' | 'library'
    status: str                            # 'active' | 'trialing' | 'canceled' | 'past_due'
    has_payment_method: bool               # True when stripe_customer_id is set
    trial_ends_at: Optional[datetime]
    current_period_end: Optional[datetime]
    usage: UsageSummary


class CheckoutRequest(BaseModel):
    """Payload for POST /api/v1/billing/checkout.

    ``interval`` defaults to ``monthly`` for backwards compatibility with
    older clients that don't know about yearly pricing. The backend maps
    the (plan, interval) pair to a concrete Stripe price ID.
    """

    plan: Literal["home", "pro", "library"]
    interval: Literal["monthly", "yearly"] = "monthly"


class CheckoutResponse(BaseModel):
    url: str


class PortalResponse(BaseModel):
    url: str


class WalletReadinessResponse(BaseModel):
    """Diagnostic response for ``GET /api/v1/billing/wallet-readiness``.

    Mirrors :class:`app.services.billing.WalletReadiness`. Surfaces every
    server-side check that determines whether Stripe will render the Apple
    Pay / Google Pay button on hosted Checkout. ``ok`` is True iff
    ``warnings`` is empty.
    """

    ok: bool
    app_url_host: Optional[str]
    app_url_https: bool
    apple_pay_domain_registered: bool
    apple_pay_domain_verified: bool
    warnings: list[str]
