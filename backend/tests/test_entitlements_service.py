"""Service-level tests for app/services/entitlements.py (SQLite-compatible paths only).

Note: consume() and consume_n() use PostgreSQL-specific INSERT ON CONFLICT syntax
and are excluded; they are covered by test_entitlements.py in CI with Postgres.
"""
import uuid
from collections.abc import AsyncIterator
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.subscription import (
    Subscription,
    SubscriptionPlan,
    SubscriptionStatus,
    UsageCounter,
    UsageMetric,
)
from app.models.user import User
from app.services import entitlements


@pytest.fixture
async def test_session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _make_user(session: AsyncSession) -> User:
    user = User(email=f"u{uuid.uuid4().hex[:6]}@x.com", hashed_password="h")
    session.add(user)
    await session.flush()
    return user


async def _make_subscription(
    session: AsyncSession,
    user_id: uuid.UUID,
    plan: SubscriptionPlan = SubscriptionPlan.free,
    status: SubscriptionStatus = SubscriptionStatus.active,
) -> Subscription:
    sub = Subscription(user_id=user_id, plan=plan, status=status)
    session.add(sub)
    await session.flush()
    return sub


async def _make_library_with_owner(session: AsyncSession, user: User) -> Library:
    lib = Library(name="L", created_by_user_id=user.id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=user.id, role=LibraryRole.OWNER))
    await session.commit()
    await session.refresh(lib)
    return lib


async def _set_usage(
    session: AsyncSession,
    user_id: uuid.UUID,
    metric: UsageMetric,
    count: int,
    period_start: date | None = None,
) -> None:
    """Directly insert a UsageCounter row to simulate accumulated usage."""
    if period_start is None:
        period_start = entitlements.current_period_start()
    session.add(UsageCounter(
        user_id=user_id,
        metric=metric,
        period_start=period_start,
        count=count,
    ))
    await session.commit()


# ── get_or_create_subscription ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_or_create_subscription_creates_new(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await test_session.commit()

    sub = await entitlements.get_or_create_subscription(test_session, user.id)
    assert sub.user_id == user.id
    assert sub.plan == SubscriptionPlan.free
    assert sub.status == SubscriptionStatus.active


@pytest.mark.asyncio
async def test_get_or_create_subscription_returns_existing(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    existing = await _make_subscription(test_session, user.id, SubscriptionPlan.pro)
    await test_session.commit()

    sub = await entitlements.get_or_create_subscription(test_session, user.id)
    assert sub.id == existing.id
    assert sub.plan == SubscriptionPlan.pro


# ── _effective_plan ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_effective_plan_active(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    sub = await _make_subscription(test_session, user.id, SubscriptionPlan.pro, SubscriptionStatus.active)
    await test_session.commit()
    plan = entitlements._effective_plan(sub)
    assert plan == SubscriptionPlan.pro


@pytest.mark.asyncio
async def test_effective_plan_canceled_falls_back_to_free(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    sub = await _make_subscription(test_session, user.id, SubscriptionPlan.pro, SubscriptionStatus.canceled)
    await test_session.commit()
    plan = entitlements._effective_plan(sub)
    assert plan == SubscriptionPlan.free


@pytest.mark.asyncio
async def test_effective_plan_past_due_falls_back_to_free(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    sub = await _make_subscription(test_session, user.id, SubscriptionPlan.pro, SubscriptionStatus.past_due)
    await test_session.commit()
    plan = entitlements._effective_plan(sub)
    assert plan == SubscriptionPlan.free


# ── get_current_usage ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_current_usage_zero_when_no_usage(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await test_session.commit()
    usage = await entitlements.get_current_usage(test_session, user.id, UsageMetric.scans)
    assert usage == 0


@pytest.mark.asyncio
async def test_get_current_usage_returns_count(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await test_session.commit()
    await _set_usage(test_session, user.id, UsageMetric.scans, 3)
    usage = await entitlements.get_current_usage(test_session, user.id, UsageMetric.scans)
    assert usage == 3


# ── can_use_metric ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_can_use_metric_true_under_limit(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await _make_subscription(test_session, user.id)
    await test_session.commit()
    # Free plan: 5 scans/month. With 0 used, should be True.
    result = await entitlements.can_use_metric(test_session, user.id, UsageMetric.scans)
    assert result is True


@pytest.mark.asyncio
async def test_can_use_metric_false_at_limit(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await _make_subscription(test_session, user.id)  # free: 5 scans
    await test_session.commit()
    await _set_usage(test_session, user.id, UsageMetric.scans, 5)
    result = await entitlements.can_use_metric(test_session, user.id, UsageMetric.scans)
    assert result is False


@pytest.mark.asyncio
async def test_can_use_metric_unlimited_plan(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await _make_subscription(test_session, user.id, SubscriptionPlan.pro)  # pro: unlimited enrichments
    await test_session.commit()
    result = await entitlements.can_use_metric(test_session, user.id, UsageMetric.enrichments)
    assert result is True


# ── can_use_metric_n ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_can_use_metric_n_true_fits(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await _make_subscription(test_session, user.id)  # free: 5 scans
    await test_session.commit()
    await _set_usage(test_session, user.id, UsageMetric.scans, 3)
    result = await entitlements.can_use_metric_n(test_session, user.id, UsageMetric.scans, 2)
    assert result is True  # 3 used + 2 needed = 5 = limit


@pytest.mark.asyncio
async def test_can_use_metric_n_false_exceeds(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await _make_subscription(test_session, user.id)  # free: 5 scans
    await test_session.commit()
    await _set_usage(test_session, user.id, UsageMetric.scans, 4)
    result = await entitlements.can_use_metric_n(test_session, user.id, UsageMetric.scans, 2)
    assert result is False  # 4 used + 2 needed > 5


@pytest.mark.asyncio
async def test_can_use_metric_n_unlimited(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await _make_subscription(test_session, user.id, SubscriptionPlan.pro)
    await test_session.commit()
    result = await entitlements.can_use_metric_n(test_session, user.id, UsageMetric.enrichments, 999)
    assert result is True


# ── can_create_library ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_can_create_library_true_under_limit(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await _make_subscription(test_session, user.id)  # free: 1 library
    await test_session.commit()
    # User has 0 libraries → can create 1
    result = await entitlements.can_create_library(test_session, user.id)
    assert result is True


@pytest.mark.asyncio
async def test_can_create_library_false_at_limit(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await _make_subscription(test_session, user.id)  # free: 1 library
    await _make_library_with_owner(test_session, user)  # already has 1 library
    result = await entitlements.can_create_library(test_session, user.id)
    assert result is False


# ── can_add_member ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_can_add_member_true_under_limit(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await _make_subscription(test_session, user.id, SubscriptionPlan.pro)  # pro: 3 members
    lib = await _make_library_with_owner(test_session, user)
    # Only owner (1 member) → can add 2 more
    result = await entitlements.can_add_member(test_session, user.id, lib.id)
    assert result is True


@pytest.mark.asyncio
async def test_can_add_member_false_at_limit(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await _make_subscription(test_session, user.id)  # free: 1 member
    lib = await _make_library_with_owner(test_session, user)
    # Owner is the 1 member, limit is 1 → False
    result = await entitlements.can_add_member(test_session, user.id, lib.id)
    assert result is False


# ── can_add_books_to_library ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_can_add_books_zero_count_always_true(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    lib = await _make_library_with_owner(test_session, user)
    result = await entitlements.can_add_books_to_library(test_session, lib.id, 0)
    assert result is True


@pytest.mark.asyncio
async def test_can_add_books_library_not_found_raises_404(test_session: AsyncSession) -> None:
    with pytest.raises(HTTPException) as exc:
        await entitlements.can_add_books_to_library(test_session, uuid.uuid4(), 1)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_can_add_books_true_unlimited_plan(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await _make_subscription(test_session, user.id, SubscriptionPlan.pro)  # books_per_library=5000
    lib = await _make_library_with_owner(test_session, user)
    result = await entitlements.can_add_books_to_library(test_session, lib.id, 1)
    assert result is True


# ── assert_can_use ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_assert_can_use_success(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await _make_subscription(test_session, user.id)
    await test_session.commit()
    # Should not raise
    await entitlements.assert_can_use(test_session, user.id, UsageMetric.scans)


@pytest.mark.asyncio
async def test_assert_can_use_raises_402(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await _make_subscription(test_session, user.id)  # free: 5 scans
    await test_session.commit()
    await _set_usage(test_session, user.id, UsageMetric.scans, 5)
    with pytest.raises(HTTPException) as exc:
        await entitlements.assert_can_use(test_session, user.id, UsageMetric.scans)
    assert exc.value.status_code == 402


# ── assert_can_use_n ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_assert_can_use_n_success(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await _make_subscription(test_session, user.id)
    await test_session.commit()
    await entitlements.assert_can_use_n(test_session, user.id, UsageMetric.scans, 3)


@pytest.mark.asyncio
async def test_assert_can_use_n_raises_402(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await _make_subscription(test_session, user.id)  # free: 5 scans
    await test_session.commit()
    await _set_usage(test_session, user.id, UsageMetric.scans, 4)
    with pytest.raises(HTTPException) as exc:
        await entitlements.assert_can_use_n(test_session, user.id, UsageMetric.scans, 2)
    assert exc.value.status_code == 402


# ── assert_can_create_library ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_assert_can_create_library_success(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await _make_subscription(test_session, user.id)
    await test_session.commit()
    await entitlements.assert_can_create_library(test_session, user.id)


@pytest.mark.asyncio
async def test_assert_can_create_library_raises_403(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await _make_subscription(test_session, user.id)
    await _make_library_with_owner(test_session, user)
    with pytest.raises(HTTPException) as exc:
        await entitlements.assert_can_create_library(test_session, user.id)
    assert exc.value.status_code == 403


# ── assert_can_add_member ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_assert_can_add_member_success(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await _make_subscription(test_session, user.id, SubscriptionPlan.pro)
    lib = await _make_library_with_owner(test_session, user)
    await entitlements.assert_can_add_member(test_session, user.id, lib.id)


@pytest.mark.asyncio
async def test_assert_can_add_member_raises_403(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await _make_subscription(test_session, user.id)  # free: 1 member
    lib = await _make_library_with_owner(test_session, user)
    with pytest.raises(HTTPException) as exc:
        await entitlements.assert_can_add_member(test_session, user.id, lib.id)
    assert exc.value.status_code == 403


# ── assert_can_add_books_to_library ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_assert_can_add_books_to_library_success(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await _make_subscription(test_session, user.id)
    lib = await _make_library_with_owner(test_session, user)
    await entitlements.assert_can_add_books_to_library(test_session, lib.id, 1)


@pytest.mark.asyncio
async def test_assert_can_add_books_library_not_found_raises_404(test_session: AsyncSession) -> None:
    with pytest.raises(HTTPException) as exc:
        await entitlements.assert_can_add_books_to_library(test_session, uuid.uuid4(), 1)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_assert_can_add_books_zero_count_noop(test_session: AsyncSession) -> None:
    """count <= 0 returns early without checking anything (line 352-353)."""
    user = await _make_user(test_session)
    lib = await _make_library_with_owner(test_session, user)
    # Should not raise even though there's no subscription
    await entitlements.assert_can_add_books_to_library(test_session, lib.id, 0)
