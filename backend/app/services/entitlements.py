"""Entitlement service — single entry point for all quota checks and usage tracking.

Usage pattern in endpoints / FastAPI dependencies:
    await entitlements.assert_can_use(session, user.id, UsageMetric.scans)
    # ... do the scan ...
    await entitlements.consume(session, user.id, UsageMetric.scans, idempotency_key=job_id)

All assert_* functions raise HTTP 402 / 403 when a limit is exceeded,
so callers don't need to check return values.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.plan_limits import get_limit, is_unlimited
from app.models.library import Library, LibraryMember
from app.models.subscription import (
    Subscription,
    SubscriptionPlan,
    SubscriptionStatus,
    UsageCounter,
    UsageEvent,
    UsageMetric,
)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _current_period_start() -> date:
    """Return the first day of the current month (UTC)."""
    today = datetime.now(timezone.utc).date()
    return today.replace(day=1)


# ── Subscription bootstrap ─────────────────────────────────────────────────────

async def get_or_create_subscription(session: AsyncSession, user_id: uuid.UUID) -> Subscription:
    """Return the user's subscription, creating a free-tier one if it doesn't exist yet."""
    result = await session.execute(
        select(Subscription).where(Subscription.user_id == user_id)
    )
    sub = result.scalar_one_or_none()
    if sub is None:
        sub = Subscription(
            user_id=user_id,
            plan=SubscriptionPlan.free,
            status=SubscriptionStatus.active,
        )
        session.add(sub)
        await session.flush()
    return sub


def _effective_plan(sub: Subscription) -> SubscriptionPlan:
    """Return the plan that should be enforced right now.

    Canceled or past-due subscription falls back to free limits.
    Trialing subscription gets the subscribed plan.

    Note: SQLAlchemy returns String columns as plain str from the DB, so we
    coerce both status and plan to their enum types before comparing.
    """
    status = SubscriptionStatus(sub.status)
    if status in (SubscriptionStatus.canceled, SubscriptionStatus.past_due):
        return SubscriptionPlan.free
    return SubscriptionPlan(sub.plan)


# ── Usage reading ──────────────────────────────────────────────────────────────

async def get_current_usage(
    session: AsyncSession,
    user_id: uuid.UUID,
    metric: UsageMetric,
    period_start: Optional[date] = None,
) -> int:
    """Return the current month's usage count for a given metric."""
    if period_start is None:
        period_start = _current_period_start()
    result = await session.execute(
        select(UsageCounter.count).where(
            UsageCounter.user_id == user_id,
            UsageCounter.metric == metric,
            UsageCounter.period_start == period_start,
        )
    )
    return result.scalar_one_or_none() or 0


# ── Soft checks (return bool, no exception) ────────────────────────────────────

async def can_use_metric(
    session: AsyncSession,
    user_id: uuid.UUID,
    metric: UsageMetric,
) -> bool:
    """Return True if the user has remaining quota for the metric this month."""
    sub = await get_or_create_subscription(session, user_id)
    plan = _effective_plan(sub)
    key = f"{metric.value}_per_month"
    if is_unlimited(plan, key):
        return True
    limit = get_limit(plan, key)
    used = await get_current_usage(session, user_id, metric)
    return used < limit


async def can_use_metric_n(
    session: AsyncSession,
    user_id: uuid.UUID,
    metric: UsageMetric,
    count: int,
) -> bool:
    """Return True if the user has at least *count* remaining credits this month."""
    sub = await get_or_create_subscription(session, user_id)
    plan = _effective_plan(sub)
    key = f"{metric.value}_per_month"
    if is_unlimited(plan, key):
        return True
    limit = get_limit(plan, key)
    used = await get_current_usage(session, user_id, metric)
    return used + count <= limit


async def can_create_library(session: AsyncSession, user_id: uuid.UUID) -> bool:
    """Return True if the user can create another library under their current plan."""
    sub = await get_or_create_subscription(session, user_id)
    plan = _effective_plan(sub)
    limit = get_limit(plan, "libraries")
    count_result = await session.execute(
        select(func.count()).select_from(Library).where(
            Library.created_by_user_id == user_id
        )
    )
    current = count_result.scalar_one()
    return current < limit


async def can_add_member(
    session: AsyncSession,
    user_id: uuid.UUID,
    library_id: uuid.UUID,
) -> bool:
    """Return True if the library owner can add another member."""
    sub = await get_or_create_subscription(session, user_id)
    plan = _effective_plan(sub)
    limit = get_limit(plan, "members_per_library")
    count_result = await session.execute(
        select(func.count()).select_from(LibraryMember).where(
            LibraryMember.library_id == library_id
        )
    )
    current = count_result.scalar_one()
    return current < limit


# ── Hard checks (raise HTTP exception) ────────────────────────────────────────

async def assert_can_use(
    session: AsyncSession,
    user_id: uuid.UUID,
    metric: UsageMetric,
) -> None:
    """Raise HTTP 402 if the user has exhausted their quota for this metric."""
    if not await can_use_metric(session, user_id, metric):
        sub = await get_or_create_subscription(session, user_id)
        plan = _effective_plan(sub)
        key = f"{metric.value}_per_month"
        limit = get_limit(plan, key)
        used = await get_current_usage(session, user_id, metric)
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "code": "quota_exceeded",
                "metric": metric.value,
                "plan": plan.value,
                "limit": limit,
                "used": used,
                "upgrade_url": "/settings#billing",
            },
        )


async def assert_can_use_n(
    session: AsyncSession,
    user_id: uuid.UUID,
    metric: UsageMetric,
    count: int,
) -> None:
    """Raise HTTP 402 if the user doesn't have *count* remaining credits for this metric.

    Used for batch operations (enrich location, enrich all) where multiple credits
    are consumed in one request.
    """
    if not await can_use_metric_n(session, user_id, metric, count):
        sub = await get_or_create_subscription(session, user_id)
        plan = _effective_plan(sub)
        key = f"{metric.value}_per_month"
        limit = get_limit(plan, key)
        used = await get_current_usage(session, user_id, metric)
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "code": "quota_exceeded",
                "metric": metric.value,
                "plan": plan.value,
                "limit": limit,
                "used": used,
                "requested": count,
                "upgrade_url": "/settings#billing",
            },
        )


async def assert_can_create_library(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Raise HTTP 403 if the user has reached their library limit."""
    if not await can_create_library(session, user_id):
        sub = await get_or_create_subscription(session, user_id)
        plan = _effective_plan(sub)
        limit = get_limit(plan, "libraries")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "library_limit_reached",
                "plan": plan.value,
                "limit": limit,
                "upgrade_url": "/settings#billing",
            },
        )


async def assert_can_add_member(
    session: AsyncSession,
    user_id: uuid.UUID,
    library_id: uuid.UUID,
) -> None:
    """Raise HTTP 403 if the library has reached its member limit."""
    if not await can_add_member(session, user_id, library_id):
        sub = await get_or_create_subscription(session, user_id)
        plan = _effective_plan(sub)
        limit = get_limit(plan, "members_per_library")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "member_limit_reached",
                "plan": plan.value,
                "limit": limit,
                "upgrade_url": "/settings#billing",
            },
        )


# ── Consumption (atomic + idempotent, PostgreSQL) ─────────────────────────────

async def consume(
    session: AsyncSession,
    user_id: uuid.UUID,
    metric: UsageMetric,
    idempotency_key: Optional[str] = None,
) -> bool:
    """Atomically increment the usage counter.

    Uses PostgreSQL dialect INSERT ... ON CONFLICT DO UPDATE for
    race-safe atomic increment. Idempotency via UsageEvent table:
    same key can never be counted twice.

    Returns True if incremented, False if duplicate (idempotency_key already seen).
    """
    period_start = _current_period_start()
    now = datetime.now(timezone.utc)

    if idempotency_key is not None:
        # INSERT ... ON CONFLICT DO NOTHING — returns 0 rows if key already exists
        event_stmt = (
            pg_insert(UsageEvent)
            .values(
                id=uuid.uuid4(),
                user_id=user_id,
                metric=metric,
                idempotency_key=idempotency_key,
                period_start=period_start,
                created_at=now,
            )
            .on_conflict_do_nothing(constraint="uq_usage_event_idempotency_key")
        )
        result = await session.execute(event_stmt)
        if result.rowcount == 0:
            return False  # Duplicate — do not increment

    # Atomic upsert: insert with count=1 or increment existing
    counter_stmt = (
        pg_insert(UsageCounter)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            metric=metric,
            period_start=period_start,
            count=1,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            constraint="uq_usage_user_metric_period",
            set_={"count": UsageCounter.count + 1, "updated_at": now},
        )
    )
    await session.execute(counter_stmt)
    await session.flush()
    return True


async def consume_n(
    session: AsyncSession,
    user_id: uuid.UUID,
    metric: UsageMetric,
    count: int,
) -> None:
    """Atomically increment the usage counter by *count* (for batch operations).

    No idempotency key support — batch callers must ensure they don't call twice
    for the same set of work (e.g. gate with assert_can_use_n first).
    """
    period_start = _current_period_start()
    now = datetime.now(timezone.utc)
    counter_stmt = (
        pg_insert(UsageCounter)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            metric=metric,
            period_start=period_start,
            count=count,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            constraint="uq_usage_user_metric_period",
            set_={"count": UsageCounter.count + count, "updated_at": now},
        )
    )
    await session.execute(counter_stmt)
    await session.flush()
