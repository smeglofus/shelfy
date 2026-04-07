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
    plan: str                              # 'free' | 'pro' | 'library'
    status: str                            # 'active' | 'trialing' | 'canceled' | 'past_due'
    has_payment_method: bool               # True when stripe_customer_id is set
    trial_ends_at: Optional[datetime]
    current_period_end: Optional[datetime]
    usage: UsageSummary


class CheckoutRequest(BaseModel):
    plan: Literal["pro", "library"]


class CheckoutResponse(BaseModel):
    url: str


class PortalResponse(BaseModel):
    url: str
