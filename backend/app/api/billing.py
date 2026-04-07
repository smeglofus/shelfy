"""Billing endpoints — Stripe Checkout, Customer Portal, Webhook, Status."""
from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.core.config import Settings, get_settings
from app.core.limiter import limiter
from app.core.plan_limits import get_limit, is_unlimited
from app.db.session import get_db_session
from app.models.subscription import SubscriptionStatus, UsageMetric
from app.models.user import User
from app.schemas.billing import (
    BillingStatusResponse,
    CheckoutRequest,
    CheckoutResponse,
    PortalResponse,
    UsageSummary,
)
from app.services import billing as billing_svc
from app.services.entitlements import (
    _effective_plan,
    get_current_usage,
    get_or_create_subscription,
)

logger = structlog.get_logger()

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])


def _require_stripe(settings: Settings) -> None:
    """Raise 503 when Stripe keys are not configured (dev / self-hosted)."""
    if not settings.stripe_secret_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Billing is not configured on this server",
        )


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status", response_model=BillingStatusResponse)
async def get_billing_status(
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> BillingStatusResponse:
    """Return the current user's plan, subscription status, and monthly usage."""
    sub = await get_or_create_subscription(session, current_user.id)
    plan = _effective_plan(sub)

    scans_used = await get_current_usage(session, current_user.id, UsageMetric.scans)
    enrichments_used = await get_current_usage(session, current_user.id, UsageMetric.enrichments)

    scans_limit = -1 if is_unlimited(plan, "scans_per_month") else get_limit(plan, "scans_per_month")
    enrichments_limit = -1 if is_unlimited(plan, "enrichments_per_month") else get_limit(plan, "enrichments_per_month")

    return BillingStatusResponse(
        plan=plan.value,
        status=SubscriptionStatus(sub.status).value,
        has_payment_method=bool(sub.stripe_customer_id),
        trial_ends_at=sub.trial_ends_at,
        current_period_end=sub.current_period_end,
        usage=UsageSummary(
            scans_used=scans_used,
            scans_limit=scans_limit,
            enrichments_used=enrichments_used,
            enrichments_limit=enrichments_limit,
        ),
    )


# ── Checkout ──────────────────────────────────────────────────────────────────

@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout(
    payload: CheckoutRequest,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> CheckoutResponse:
    """Create a Stripe Checkout Session. The response contains a redirect URL."""
    _require_stripe(settings)
    url = await billing_svc.create_checkout_session(
        session, current_user, payload.plan, settings
    )
    logger.info("checkout_session_created", user_id=str(current_user.id), plan=payload.plan)
    return CheckoutResponse(url=url)


# ── Customer Portal ────────────────────────────────────────────────────────────

@router.post("/portal", response_model=PortalResponse)
async def create_portal(
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> PortalResponse:
    """Create a Stripe Billing Portal Session for managing an existing subscription."""
    _require_stripe(settings)
    url = await billing_svc.create_portal_session(session, current_user, settings)
    logger.info("portal_session_created", user_id=str(current_user.id))
    return PortalResponse(url=url)


# ── Webhook ────────────────────────────────────────────────────────────────────

@router.post("/webhook", status_code=200)
@limiter.limit("120/minute")   # Stripe sends at most ~60 events/min in bursts
async def stripe_webhook(
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:
    """Receive and process Stripe webhook events.

    Security layers:
      1. Stripe-Signature HMAC validation (primary — in billing service)
      2. Rate limiting (120/min — well above Stripe's realistic burst)
      3. Production hardening: restrict source IPs to Stripe's published CIDR
         ranges in your reverse proxy / firewall.
         See https://stripe.com/docs/ips for the current IP list.
    """
    _require_stripe(settings)

    # Must read raw bytes *before* any JSON parsing to preserve the signature.
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    await billing_svc.handle_webhook_event(session, payload, sig_header, settings)
    return {"status": "ok"}
