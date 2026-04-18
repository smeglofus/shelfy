"""Stripe integration service.

All Stripe API calls are synchronous (stripe-python SDK) and are executed
in a worker thread via anyio.to_thread.run_sync to avoid blocking the event loop.

Webhook handling flow:
  1. Validate Stripe-Signature header (HMAC via ``stripe.Webhook.construct_event``).
  2. Claim the event by inserting into ``stripe_events`` (idempotency key).
     The insert + dispatch share ONE transaction — if dispatch raises, both
     the claim row and any partial side-effect are rolled back, so Stripe's
     retry lands on a clean slate.
  3. Dispatch to event-specific handler. Handlers mutate the local row in
     place and rely on the outer transaction to commit.

Out-of-order protection:
  Stripe does not guarantee event ordering. For events that mutate the
  ``Subscription`` row we compare ``event.created`` against
  ``Subscription.last_stripe_event_at`` and skip older side-effects.

Supported events:
  checkout.session.completed      → link stripe_subscription_id after purchase
  customer.subscription.created   → sync plan / status / period
  customer.subscription.updated   → sync plan / status / period
  customer.subscription.deleted   → mark as canceled
  invoice.payment_succeeded       → recover past_due → active, extend period
  invoice.payment_failed          → flip to past_due (entitlements fall back to free)

Unknown event types are recorded in ``stripe_events`` (so Stripe stops
retrying) but otherwise ignored — safe default per Stripe guidance:
https://stripe.com/docs/webhooks/best-practices#event-handling
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, TypeVar

import stripe as _stripe
import structlog
from anyio import to_thread
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models.subscription import (
    Subscription,
    SubscriptionPlan,
    SubscriptionStatus,
    StripeEvent,
)
from app.models.user import User


logger = structlog.get_logger()


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


def _price_id_for(
    plan: str, interval: str, settings: Settings
) -> str | None:
    """Resolve the Stripe price ID for a (plan, interval) pair.

    Returns None when the plan/interval combination is not configured —
    callers raise 503 so missing config surfaces as a server error rather
    than silently falling back to a default plan.
    """
    table: dict[tuple[str, str], str | None] = {
        ("home",    "monthly"): settings.stripe_price_id_home_monthly,
        ("home",    "yearly"):  settings.stripe_price_id_home_yearly,
        ("pro",     "monthly"): settings.stripe_price_id_pro_monthly,
        ("pro",     "yearly"):  settings.stripe_price_id_pro_yearly,
        ("library", "monthly"): settings.stripe_price_id_library_monthly,
        ("library", "yearly"):  settings.stripe_price_id_library_yearly,
    }
    return table.get((plan, interval))


def _plan_from_price_id(price_id: str, settings: Settings) -> SubscriptionPlan:
    """Reverse-lookup: Stripe price ID → SubscriptionPlan.

    Built by inverting the configured price-id-per-plan map. Unknown or
    empty price IDs fall back to ``SubscriptionPlan.free`` — this is the
    safe default for webhook handling: if an admin reconfigured prices
    mid-flight, users stay on the free tier until we see a price we
    recognise, rather than getting silently promoted.
    """
    if not price_id:
        return SubscriptionPlan.free

    # Yearly and monthly map to the same plan — we only care about the plan
    # the customer bought, not the billing cadence (that's stored separately
    # on ``current_period_end``).
    reverse: dict[str | None, SubscriptionPlan] = {
        settings.stripe_price_id_home_monthly:    SubscriptionPlan.home,
        settings.stripe_price_id_home_yearly:     SubscriptionPlan.home,
        settings.stripe_price_id_pro_monthly:     SubscriptionPlan.pro,
        settings.stripe_price_id_pro_yearly:      SubscriptionPlan.pro,
        settings.stripe_price_id_library_monthly: SubscriptionPlan.library,
        settings.stripe_price_id_library_yearly:  SubscriptionPlan.library,
    }
    # Drop the None key so an unconfigured slot doesn't accidentally match
    # an incoming empty price_id (already short-circuited above, but belt +
    # braces).
    reverse.pop(None, None)
    return reverse.get(price_id, SubscriptionPlan.free)


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


def _ts(val: int | None) -> datetime | None:
    """Convert a Unix timestamp (seconds) from Stripe to an aware datetime."""
    return datetime.fromtimestamp(val, tz=timezone.utc) if val else None


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
    interval: str = "monthly",
) -> str:
    """Create a Stripe Checkout Session and return the hosted URL.

    The user is redirected to Stripe's hosted checkout page. On success they
    return to /settings?billing_success=1; on cancel to /settings#billing.

    First-time subscribers (no previous stripe_subscription_id) automatically
    receive a 14-day free trial. Returning subscribers go straight to billing.

    ``plan`` is one of ``home``/``pro``/``library``. ``interval`` is
    ``monthly`` or ``yearly``. Unknown combinations → 400.
    """
    if plan not in ("home", "pro", "library"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid plan"
        )
    if interval not in ("monthly", "yearly"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid billing interval"
        )

    price_id = _price_id_for(plan, interval, settings)
    if not price_id:
        # Either this plan/interval is not configured in env (admin hasn't
        # created the Stripe price yet), or the server is self-hosted.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Billing is not configured for plan={plan} interval={interval}",
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
    return_url = settings.stripe_portal_return_url or f"{settings.app_url}/settings#billing"
    portal = await to_thread.run_sync(
        lambda: _stripe_call(lambda: _stripe.billing_portal.Session.create(
            customer=sub.stripe_customer_id,
            return_url=return_url,
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

    Contract with the caller:
      * The caller hands us a session that has NOT yet been committed. We own
        the transaction: on success we commit; on failure we rollback and
        re-raise. This is the key fix for issue #120 — previously the sub-
        handlers each did their own ``session.commit()``, so a failure after
        the ``StripeEvent`` row was flushed could leave a stale claim with no
        side-effect, permanently losing the update on the next delivery.

    Security:
      * ``settings.stripe_webhook_secret`` must be set; otherwise 503.
      * Missing ``Stripe-Signature`` header → 400 before touching the SDK.
      * ``stripe.Webhook.construct_event`` is used for HMAC verification —
        it compares timestamps and signature in constant time internally.

    Idempotency:
      * Claim the event by inserting ``StripeEvent(event_id=...)``. Relies on
        the PRIMARY KEY constraint. If ``IntegrityError`` is raised we treat
        it as "another delivery already processed this one" and return 200
        after rolling back — never re-applies side-effects.

    Out-of-order:
      * ``event.created`` is threaded into each subscription-mutating handler.
        The handler compares it against ``Subscription.last_stripe_event_at``
        and skips the side effect (but keeps the event recorded) when older.
    """
    if not settings.stripe_webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Stripe webhook is not configured",
        )

    # Reject missing signature before we call the SDK (faster, clearer error).
    if not sig_header:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing Stripe signature",
        )

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
    except ValueError as exc:
        # construct_event raises ValueError for malformed JSON payloads.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Stripe webhook payload",
        ) from exc

    event_id: str = event["id"]
    event_type: str = event["type"]
    # Stripe objects support subscript but not dict.get() in all SDK versions.
    try:
        _created_raw = event["created"]
    except (KeyError, AttributeError):
        _created_raw = None
    event_created_at: datetime = _ts(_created_raw) or datetime.now(timezone.utc)

    # ── Atomic claim-and-apply ────────────────────────────────────────────────
    # Insert the StripeEvent row as our idempotency claim. The PRIMARY KEY on
    # event_id makes this race-safe: if a concurrent delivery already claimed
    # the event, either our SELECT finds it (fast path) or the INSERT raises
    # IntegrityError (slow path) — both short-circuit to 200 with no side
    # effect.
    existing = await session.get(StripeEvent, event_id)
    if existing is not None:
        logger.info("stripe_webhook_duplicate", event_id=event_id, event_type=event_type)
        return

    session.add(
        StripeEvent(
            event_id=event_id,
            event_type=event_type,
            processed_at=datetime.now(timezone.utc),
        )
    )

    try:
        # Flush the claim so a concurrent delivery racing in here hits the PK
        # constraint now (before we've done any work). If the flush raises
        # IntegrityError, another worker beat us — roll back and 200.
        try:
            await session.flush()
        except IntegrityError:
            await session.rollback()
            logger.info(
                "stripe_webhook_duplicate_race", event_id=event_id, event_type=event_type
            )
            return

        # Normalise the event data to a plain nested dict. ``StripeObject``
        # in stripe-python 15+ does NOT expose a ``.get()`` method (attribute
        # lookup routes through ``__getattr__`` → KeyError → AttributeError),
        # which makes handlers that tolerate missing keys awkward. Converting
        # once at dispatch time keeps handlers simple and lets tests pass in
        # plain dicts directly.
        raw_obj = event["data"]["object"]
        if hasattr(raw_obj, "to_dict"):
            data: dict[str, Any] = raw_obj.to_dict()
        else:
            data = dict(raw_obj)

        if event_type == "checkout.session.completed":
            await _handle_checkout_completed(session, data)
        elif event_type in (
            "customer.subscription.created",
            "customer.subscription.updated",
        ):
            await _handle_subscription_updated(session, data, event_created_at, settings)
        elif event_type == "customer.subscription.deleted":
            await _handle_subscription_deleted(session, data, event_created_at)
        elif event_type == "invoice.payment_succeeded":
            await _handle_invoice_payment_succeeded(session, data, event_created_at)
        elif event_type == "invoice.payment_failed":
            await _handle_invoice_payment_failed(session, data, event_created_at)
        else:
            # Unknown / unsubscribed event type: claim is kept, no side-effect.
            # This prevents Stripe from retrying forever for events we
            # explicitly don't care about (payment_intent.*, charge.*, …).
            logger.info(
                "stripe_webhook_ignored_event", event_id=event_id, event_type=event_type
            )

        # Single commit for BOTH the claim row and any sub-handler mutation.
        await session.commit()

    except Exception:
        # Rollback cancels the StripeEvent claim AND any partial side-effect
        # — Stripe's retry (within ~3 days) lands on a clean slate.
        await session.rollback()
        raise


# ── Event handlers ─────────────────────────────────────────────────────────────

async def _handle_checkout_completed(
    session: AsyncSession,
    checkout_session: Any,
) -> None:
    """Link stripe_subscription_id to our local subscription after a successful checkout.

    Idempotent: overwriting the same value is a no-op.
    """
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
        # NB: no commit here — the outer handle_webhook_event owns the tx.


def _subscription_is_stale(sub: Subscription, event_created_at: datetime) -> bool:
    """True when an incoming event.created is older than the last one applied.

    Protects against out-of-order delivery: if an older event arrives after
    a newer one we've already applied, its side-effect would silently undo
    the newer state. We keep the dedup row (so Stripe stops retrying) but
    skip the mutation.

    Normalises both sides to tz-aware UTC — SQLite (used in tests) strips
    tzinfo when it round-trips ``TIMESTAMP WITH TIME ZONE`` columns.
    """
    if sub.last_stripe_event_at is None:
        return False
    stored = sub.last_stripe_event_at
    if stored.tzinfo is None:
        stored = stored.replace(tzinfo=timezone.utc)
    incoming = event_created_at
    if incoming.tzinfo is None:
        incoming = incoming.replace(tzinfo=timezone.utc)
    return incoming < stored


async def _handle_subscription_updated(
    session: AsyncSession,
    stripe_sub: Any,
    event_created_at: datetime,
    settings: Settings,
) -> None:
    """Sync plan, status, and period from a Stripe subscription object.

    Idempotent + out-of-order safe: older events are recorded but skip the
    mutation so newer state isn't clobbered.
    """
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

    if _subscription_is_stale(sub, event_created_at):
        logger.info(
            "stripe_webhook_out_of_order_skipped",
            customer_id=customer_id,
            event_created_at=event_created_at.isoformat(),
            last_event_at=(
                sub.last_stripe_event_at.isoformat() if sub.last_stripe_event_at else None
            ),
        )
        return

    # Status
    sub.status = _STATUS_MAP.get(stripe_sub["status"], SubscriptionStatus.active)

    # Plan — derive from the first line item's price ID
    items = (stripe_sub.get("items") or {}).get("data") or []
    if items:
        price_id: str = (items[0].get("price") or {}).get("id", "")
        sub.plan = _plan_from_price_id(price_id, settings)

    # Period timestamps
    sub.current_period_start = _ts(stripe_sub.get("current_period_start"))
    sub.current_period_end = _ts(stripe_sub.get("current_period_end"))
    sub.trial_ends_at = _ts(stripe_sub.get("trial_end"))
    sub.stripe_subscription_id = stripe_sub["id"]
    sub.stripe_customer_id = customer_id
    sub.last_stripe_event_at = event_created_at


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
    event_created_at: datetime,
) -> None:
    """Mark our local subscription as canceled when Stripe deletes it."""
    customer_id: str = stripe_sub["customer"]
    result = await session.execute(
        select(Subscription).where(Subscription.stripe_customer_id == customer_id)
    )
    sub = result.scalar_one_or_none()
    if sub is None:
        return

    if _subscription_is_stale(sub, event_created_at):
        logger.info(
            "stripe_webhook_out_of_order_skipped",
            customer_id=customer_id,
            event_type="customer.subscription.deleted",
        )
        return

    sub.status = SubscriptionStatus.canceled
    sub.last_stripe_event_at = event_created_at


async def _handle_invoice_payment_succeeded(
    session: AsyncSession,
    invoice: Any,
    event_created_at: datetime,
) -> None:
    """Recover a past_due subscription when a retried charge finally clears.

    Stripe typically retries failed charges for up to ~3 weeks (smart retries).
    When a retry succeeds we want to flip the local status back to ``active``
    so entitlements stop falling back to the free tier immediately.

    Idempotent: running this twice for the same invoice leaves the row at
    ``active`` with the same period_end.
    """
    customer_id: str | None = invoice.get("customer")
    if not customer_id:
        return

    result = await session.execute(
        select(Subscription).where(Subscription.stripe_customer_id == customer_id)
    )
    sub = result.scalar_one_or_none()
    if sub is None:
        return

    if _subscription_is_stale(sub, event_created_at):
        logger.info(
            "stripe_webhook_out_of_order_skipped",
            customer_id=customer_id,
            event_type="invoice.payment_succeeded",
        )
        return

    # Only recover to active from a degraded state. We never *downgrade* a
    # trialing / canceled subscription here — Stripe's subscription.updated
    # is the canonical source for plan/status transitions.
    current = SubscriptionStatus(sub.status)
    if current in (SubscriptionStatus.past_due,):
        sub.status = SubscriptionStatus.active

    # Extend the local period_end if the invoice advances it (keeps UI
    # consistent between subscription.updated and invoice events).
    period_end = _ts(invoice.get("period_end"))
    if period_end is not None:
        if sub.current_period_end is None or period_end > sub.current_period_end:
            sub.current_period_end = period_end

    sub.last_stripe_event_at = event_created_at


async def _handle_invoice_payment_failed(
    session: AsyncSession,
    invoice: Any,
    event_created_at: datetime,
) -> None:
    """Flip the local subscription to past_due when a recurring charge fails.

    This is what causes entitlements to fall back to the free tier
    (``_effective_plan`` maps past_due → free). A later
    ``invoice.payment_succeeded`` (smart retry) flips it back.
    """
    customer_id: str | None = invoice.get("customer")
    if not customer_id:
        return

    result = await session.execute(
        select(Subscription).where(Subscription.stripe_customer_id == customer_id)
    )
    sub = result.scalar_one_or_none()
    if sub is None:
        return

    if _subscription_is_stale(sub, event_created_at):
        logger.info(
            "stripe_webhook_out_of_order_skipped",
            customer_id=customer_id,
            event_type="invoice.payment_failed",
        )
        return

    # Only degrade from healthy states — don't clobber a canceled row.
    current = SubscriptionStatus(sub.status)
    if current in (SubscriptionStatus.active, SubscriptionStatus.trialing):
        sub.status = SubscriptionStatus.past_due

    sub.last_stripe_event_at = event_created_at
