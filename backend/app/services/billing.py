"""Stripe integration service.

All Stripe API calls are synchronous (stripe-python SDK) and are executed
in a worker thread via anyio.to_thread.run_sync to avoid blocking the event loop.

Webhook handling flow:
  1. Validate Stripe-Signature header
  2. Dispatch to event-specific handler
  3. Update local Subscription record in Postgres

Supported events:
  checkout.session.completed    → link stripe_subscription_id after purchase
  customer.subscription.created
  customer.subscription.updated → update plan / status / period
  customer.subscription.deleted → mark as canceled
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, TypeVar

import stripe as _stripe
from anyio import to_thread
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models.subscription import (
    Subscription,
    SubscriptionPlan,
    SubscriptionStatus,
    StripeEvent,
)
from app.models.user import User


# ── Helpers ────────────────────────────────────────────────────────────────────

_T = TypeVar("_T")


def _stripe_call(fn: Callable[[], _T], *, retries: int = 3, backoff: float = 0.5) -> _T:
    """Execute a synchronous Stripe SDK call with exponential-backoff retries.

    Only retries on transient network errors (APIConnectionError, Timeout).
    Authentication and invalid-request errors are not retried.

    Intended to be used inside anyio.to_thread.run_sync:
        result = await to_thread.run_sync(lambda: _stripe_call(lambda: _stripe.Customer.create(...)))
    """
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            return fn()
        except (_stripe.error.APIConnectionError, _stripe.error.Timeout) as exc:
            last_exc = exc
            if attempt < retries - 1:
                time.sleep(backoff * (2 ** attempt))  # 0.5 s, 1 s, …
    assert last_exc is not None
    raise last_exc


def _plan_from_price_id(price_id: str, settings: Settings) -> SubscriptionPlan:
    if price_id and price_id == settings.stripe_price_id_pro:
        return SubscriptionPlan.pro
    if price_id and price_id == settings.stripe_price_id_library:
        return SubscriptionPlan.library
    return SubscriptionPlan.free


_STATUS_MAP: dict[str, SubscriptionStatus] = {
    "active":             SubscriptionStatus.active,
    "trialing":           SubscriptionStatus.trialing,
    "canceled":           SubscriptionStatus.canceled,
    "past_due":           SubscriptionStatus.past_due,
    "unpaid":             SubscriptionStatus.past_due,
    "incomplete":         SubscriptionStatus.past_due,
    "incomplete_expired": SubscriptionStatus.canceled,
    "paused":             SubscriptionStatus.past_due,
}


# ── Customer management ────────────────────────────────────────────────────────

async def get_or_create_stripe_customer(
    session: AsyncSession,
    user: User,
    settings: Settings,
) -> str:
    """Return existing Stripe customer ID or create a new one.

    Persists the customer ID to the subscription row so subsequent calls are fast.
    """
    from app.services.entitlements import get_or_create_subscription

    sub = await get_or_create_subscription(session, user.id)
    if sub.stripe_customer_id:
        return sub.stripe_customer_id

    _stripe.api_key = settings.stripe_secret_key
    customer = await to_thread.run_sync(
        lambda: _stripe_call(lambda: _stripe.Customer.create(
            email=user.email,
            metadata={"user_id": str(user.id)},
        ))
    )

    sub.stripe_customer_id = customer["id"]
    await session.commit()
    return customer["id"]


# ── Checkout ──────────────────────────────────────────────────────────────────

_TRIAL_DAYS = 14  # Free trial for first-time Pro / Library subscribers


async def create_checkout_session(
    session: AsyncSession,
    user: User,
    plan: str,
    settings: Settings,
) -> str:
    """Create a Stripe Checkout Session and return the hosted URL.

    The user is redirected to Stripe's hosted checkout page. On success they
    return to /settings?billing_success=1; on cancel to /settings#billing.

    First-time subscribers (no previous stripe_subscription_id) automatically
    receive a 14-day free trial. Returning subscribers go straight to billing.
    """
    if plan == "pro":
        price_id = settings.stripe_price_id_pro
    elif plan == "library":
        price_id = settings.stripe_price_id_library
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid plan")

    if not price_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Billing is not configured on this server",
        )

    from app.services.entitlements import get_or_create_subscription

    sub = await get_or_create_subscription(session, user.id)
    customer_id = await get_or_create_stripe_customer(session, user, settings)

    # Offer a trial only on the very first subscription (no previous Stripe sub ID)
    is_first_time = sub.stripe_subscription_id is None
    subscription_data: dict = {"metadata": {"user_id": str(user.id)}}
    if is_first_time:
        subscription_data["trial_period_days"] = _TRIAL_DAYS

    _stripe.api_key = settings.stripe_secret_key
    checkout = await to_thread.run_sync(
        lambda: _stripe_call(lambda: _stripe.checkout.Session.create(
            customer=customer_id,
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=f"{settings.app_url}/settings?billing_success=1",
            cancel_url=f"{settings.app_url}/settings#billing",
            metadata={"user_id": str(user.id)},
            subscription_data=subscription_data,
        ))
    )
    return checkout["url"]


# ── Customer Portal ────────────────────────────────────────────────────────────

async def create_portal_session(
    session: AsyncSession,
    user: User,
    settings: Settings,
) -> str:
    """Create a Stripe Billing Portal Session for an existing subscriber.

    Raises 400 if the user has no Stripe customer (i.e. is on the free plan).
    """
    from app.services.entitlements import get_or_create_subscription

    sub = await get_or_create_subscription(session, user.id)
    if not sub.stripe_customer_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active subscription to manage",
        )

    _stripe.api_key = settings.stripe_secret_key
    portal = await to_thread.run_sync(
        lambda: _stripe_call(lambda: _stripe.billing_portal.Session.create(
            customer=sub.stripe_customer_id,
            return_url=f"{settings.app_url}/settings#billing",
        ))
    )
    return portal["url"]


# ── Webhook ────────────────────────────────────────────────────────────────────

async def handle_webhook_event(
    session: AsyncSession,
    payload: bytes,
    sig_header: str,
    settings: Settings,
) -> None:
    """Validate Stripe webhook signature, deduplicate, and dispatch to handler.

    Stripe delivers webhooks at-least-once (and sometimes out-of-order).
    We guard against duplicate processing by recording each event.id in the
    stripe_events table before dispatching. A second delivery of the same
    event_id is a no-op.
    """
    _stripe.api_key = settings.stripe_secret_key

    try:
        event = _stripe.Webhook.construct_event(
            payload, sig_header, settings.stripe_webhook_secret
        )
    except _stripe.error.SignatureVerificationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Stripe signature",
        ) from exc

    event_id: str = event["id"]
    event_type: str = event["type"]

    # ── Idempotency check ─────────────────────────────────────────────────────
    # If this event_id was already processed (duplicate delivery) skip silently.
    existing = await session.get(StripeEvent, event_id)
    if existing is not None:
        return

    session.add(StripeEvent(
        event_id=event_id,
        event_type=event_type,
        processed_at=datetime.now(timezone.utc),
    ))
    await session.flush()  # lock the row before we do any side-effects

    # ── Dispatch ──────────────────────────────────────────────────────────────
    data: Any = event["data"]["object"]

    if event_type == "checkout.session.completed":
        await _handle_checkout_completed(session, data)
    elif event_type in (
        "customer.subscription.created",
        "customer.subscription.updated",
    ):
        await _handle_subscription_updated(session, data, settings)
    elif event_type == "customer.subscription.deleted":
        await _handle_subscription_deleted(session, data)
    # All other events (invoice.*, payment_intent.*, etc.) are silently ignored.


async def _handle_checkout_completed(
    session: AsyncSession,
    checkout_session: Any,
) -> None:
    """Link stripe_subscription_id to our local subscription after a successful checkout."""
    user_id_str: str | None = (checkout_session.get("metadata") or {}).get("user_id")
    stripe_sub_id: str | None = checkout_session.get("subscription")

    if not user_id_str or not stripe_sub_id:
        return

    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError:
        return

    result = await session.execute(
        select(Subscription).where(Subscription.user_id == user_id)
    )
    sub = result.scalar_one_or_none()
    if sub:
        sub.stripe_subscription_id = stripe_sub_id
        await session.commit()


async def _handle_subscription_updated(
    session: AsyncSession,
    stripe_sub: Any,
    settings: Settings,
) -> None:
    """Sync plan, status, and period from a Stripe subscription object."""
    # Locate our local subscription via stripe_customer_id (most reliable)
    customer_id: str = stripe_sub["customer"]
    result = await session.execute(
        select(Subscription).where(Subscription.stripe_customer_id == customer_id)
    )
    sub = result.scalar_one_or_none()

    # Fallback: try user_id from subscription metadata (set at checkout)
    if sub is None:
        user_id_str = (stripe_sub.get("metadata") or {}).get("user_id")
        if user_id_str:
            try:
                user_id = uuid.UUID(user_id_str)
                result = await session.execute(
                    select(Subscription).where(Subscription.user_id == user_id)
                )
                sub = result.scalar_one_or_none()
            except ValueError:
                pass

    if sub is None:
        return

    # Status
    sub.status = _STATUS_MAP.get(stripe_sub["status"], SubscriptionStatus.active)

    # Plan — derive from the first line item's price ID
    items = (stripe_sub.get("items") or {}).get("data") or []
    if items:
        price_id: str = (items[0].get("price") or {}).get("id", "")
        sub.plan = _plan_from_price_id(price_id, settings)

    # Period timestamps
    def _ts(val: int | None) -> datetime | None:
        return datetime.fromtimestamp(val, tz=timezone.utc) if val else None

    sub.current_period_start = _ts(stripe_sub.get("current_period_start"))
    sub.current_period_end = _ts(stripe_sub.get("current_period_end"))
    sub.trial_ends_at = _ts(stripe_sub.get("trial_end"))
    sub.stripe_subscription_id = stripe_sub["id"]
    sub.stripe_customer_id = customer_id

    await session.commit()


async def cancel_stripe_subscription(
    session: AsyncSession,
    user_id: uuid.UUID,
    settings: Settings,
) -> None:
    """Cancel active Stripe subscription for a user.

    Called on account deletion. Best-effort — Stripe errors are swallowed so
    they never block the deletion of the local user row.
    """
    if not settings.stripe_secret_key:
        return  # Stripe not configured — nothing to cancel

    result = await session.execute(
        select(Subscription).where(Subscription.user_id == user_id)
    )
    sub = result.scalar_one_or_none()
    if not sub or not sub.stripe_subscription_id:
        return  # No Stripe subscription to cancel

    _stripe.api_key = settings.stripe_secret_key
    stripe_sub_id = sub.stripe_subscription_id  # capture before potential invalidation
    try:
        await to_thread.run_sync(
            lambda: _stripe_call(lambda: _stripe.Subscription.cancel(stripe_sub_id))
        )
    except _stripe.error.StripeError:
        pass  # Best-effort; do not block account deletion


async def _handle_subscription_deleted(
    session: AsyncSession,
    stripe_sub: Any,
) -> None:
    """Mark our local subscription as canceled when Stripe deletes it."""
    customer_id: str = stripe_sub["customer"]
    result = await session.execute(
        select(Subscription).where(Subscription.stripe_customer_id == customer_id)
    )
    sub = result.scalar_one_or_none()
    if sub:
        sub.status = SubscriptionStatus.canceled
        await session.commit()
