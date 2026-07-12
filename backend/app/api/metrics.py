from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Response
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.metrics import (
    ACTIVE_LOANS_TOTAL,
    ACTIVE_USERS,
    BOOK_PROCESSING_JOBS_GAUGE,
    BOOKS_TOTAL,
    LIBRARIES_TOTAL,
    USERS_BY_PLAN,
    USERS_TOTAL,
    WISHLIST_ITEMS_TOTAL,
    render_metrics,
)
from app.db.session import get_db_session
from app.models.book import Book, BookProcessingStatus
from app.models.library import Library
from app.models.loan import Loan
from app.models.subscription import Subscription, SubscriptionPlan, SubscriptionStatus
from app.models.user import User
from app.models.wishlist_item import WishlistItem

router = APIRouter(tags=["metrics"])

# Effective-plan rule mirrors services.entitlements._effective_plan:
# canceled / past_due enforce free limits, so they report as free too.
_INACTIVE_STATUSES = {SubscriptionStatus.canceled.value, SubscriptionStatus.past_due.value}

ACTIVE_USER_WINDOWS: dict[str, timedelta] = {
    "1d": timedelta(days=1),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
}


async def _count(session: AsyncSession, stmt: Select[tuple[int]]) -> int:
    return int((await session.execute(stmt)).scalar_one())


async def refresh_business_gauges(session: AsyncSession) -> None:
    """Recompute the shelfy_* gauges from the database.

    Runs on every scrape — a handful of COUNT queries, all cheap at the
    scrape intervals Prometheus uses (>= 15 s). Every label combination
    is set explicitly each time so stale series can't linger after e.g.
    the last pro user downgrades.
    """
    USERS_TOTAL.set(await _count(session, select(func.count()).select_from(User)))

    # Users by effective plan: LEFT JOIN so users without a subscription
    # row (created before the billing epic) count as free.
    plan_rows = (
        await session.execute(
            select(Subscription.plan, Subscription.status, func.count(User.id))
            .select_from(User)
            .join(Subscription, Subscription.user_id == User.id, isouter=True)
            .group_by(Subscription.plan, Subscription.status)
        )
    ).all()
    by_plan = {plan.value: 0 for plan in SubscriptionPlan}
    for plan, subscription_status, count in plan_rows:
        if plan is None or subscription_status in _INACTIVE_STATUSES:
            effective = SubscriptionPlan.free.value
        else:
            effective = SubscriptionPlan(plan).value
        by_plan[effective] += int(count)
    for plan_value, count in by_plan.items():
        USERS_BY_PLAN.labels(plan=plan_value).set(count)

    now = datetime.now(timezone.utc)
    for window, delta in ACTIVE_USER_WINDOWS.items():
        ACTIVE_USERS.labels(window=window).set(
            await _count(
                session,
                select(func.count()).select_from(User).where(User.last_seen_at >= now - delta),
            )
        )

    LIBRARIES_TOTAL.set(await _count(session, select(func.count()).select_from(Library)))
    BOOKS_TOTAL.set(await _count(session, select(func.count()).select_from(Book)))
    ACTIVE_LOANS_TOTAL.set(
        await _count(
            session,
            select(func.count()).select_from(Loan).where(Loan.returned_date.is_(None)),
        )
    )
    WISHLIST_ITEMS_TOTAL.set(
        await _count(session, select(func.count()).select_from(WishlistItem))
    )


@router.get("/metrics", include_in_schema=False)
async def metrics(session: AsyncSession = Depends(get_db_session)) -> Response:
    statuses = [
        BookProcessingStatus.DONE.value,
        BookProcessingStatus.FAILED.value,
        BookProcessingStatus.PARTIAL.value,
    ]

    for status in statuses:
        result = await session.execute(select(func.count()).select_from(Book).where(Book.processing_status == status))
        count = int(result.scalar_one())
        BOOK_PROCESSING_JOBS_GAUGE.labels(status=status).set(count)

    await refresh_business_gauges(session)

    payload, content_type = render_metrics()
    return Response(content=payload, media_type=content_type)
