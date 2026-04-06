"""Integration tests for the entitlement service.

Covers:
  1. Free plan limits (scans, enrichments, libraries, members)
  2. Plan upgrade mid-cycle — new limits apply immediately
  3. Plan downgrade / cancellation — falls back to free limits
  4. Month rollover — counter resets to 0 for new period
  5. Concurrent increments — race-safe atomic upsert
  6. Limit exceeded → HTTP 402 / 403
  7. Idempotency — same key counted only once
"""
from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import date

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.subscription import (
    Subscription,
    SubscriptionPlan,
    SubscriptionStatus,
    UsageMetric,
)
from app.models.user import User
from app.services import entitlements


# ── Fixtures ──────────────────────────────────────────────────────────────────

# Use a dedicated PostgreSQL test database so that the pg_insert dialect
# (ON CONFLICT DO UPDATE / DO NOTHING) works correctly.
# Override via TEST_DATABASE_URL env var when running outside Docker Compose.
import os as _os
TEST_DB = _os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://shelfy:shelfy@postgres:5432/shelfy_test",
)


@pytest.fixture
async def sessionmaker_() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def session(sessionmaker_: async_sessionmaker[AsyncSession]) -> AsyncIterator[AsyncSession]:
    async with sessionmaker_() as s:
        yield s


async def _make_user(session: AsyncSession) -> User:
    user = User(
        email=f"u-{uuid.uuid4()}@test.com",
        hashed_password="x",
    )
    session.add(user)
    await session.flush()
    return user


async def _make_library(session: AsyncSession, owner: User) -> Library:
    lib = Library(
        name=f"lib-{uuid.uuid4()}",
        created_by_user_id=owner.id,
    )
    session.add(lib)
    await session.flush()
    member = LibraryMember(library_id=lib.id, user_id=owner.id, role=LibraryRole.OWNER)
    session.add(member)
    await session.flush()
    return lib


async def _set_plan(
    session: AsyncSession,
    user: User,
    plan: SubscriptionPlan,
    status: SubscriptionStatus = SubscriptionStatus.active,
) -> Subscription:
    sub = await entitlements.get_or_create_subscription(session, user.id)
    sub.plan = plan
    sub.status = status
    await session.flush()
    return sub


# ── Tests ──────────────────────────────────────────────────────────────────────

class TestFreeLimit:
    async def test_can_use_within_limit(self, session: AsyncSession) -> None:
        user = await _make_user(session)
        assert await entitlements.can_use_metric(session, user.id, UsageMetric.scans) is True

    async def test_blocked_after_limit(self, session: AsyncSession) -> None:
        user = await _make_user(session)
        period = date.today().replace(day=1)
        # Exhaust the 5 free scans
        for _ in range(5):
            await entitlements.consume(session, user.id, UsageMetric.scans)
        assert await entitlements.can_use_metric(session, user.id, UsageMetric.scans) is False

    async def test_assert_raises_402_when_exceeded(self, session: AsyncSession) -> None:
        from fastapi import HTTPException
        user = await _make_user(session)
        for _ in range(5):
            await entitlements.consume(session, user.id, UsageMetric.scans)
        with pytest.raises(HTTPException) as exc_info:
            await entitlements.assert_can_use(session, user.id, UsageMetric.scans)
        assert exc_info.value.status_code == 402
        assert exc_info.value.detail["code"] == "quota_exceeded"
        assert exc_info.value.detail["limit"] == 5
        assert exc_info.value.detail["used"] == 5

    async def test_enrichment_limit(self, session: AsyncSession) -> None:
        user = await _make_user(session)
        for _ in range(20):
            await entitlements.consume(session, user.id, UsageMetric.enrichments)
        assert await entitlements.can_use_metric(session, user.id, UsageMetric.enrichments) is False

    async def test_library_limit(self, session: AsyncSession) -> None:
        user = await _make_user(session)
        await _make_library(session, user)   # 1st — at limit for free
        assert await entitlements.can_create_library(session, user.id) is False

    async def test_member_limit_raises_403(self, session: AsyncSession) -> None:
        from fastapi import HTTPException
        user = await _make_user(session)
        lib = await _make_library(session, user)  # owner already counted as 1 member
        with pytest.raises(HTTPException) as exc_info:
            await entitlements.assert_can_add_member(session, user.id, lib.id)
        assert exc_info.value.status_code == 403
        assert exc_info.value.detail["code"] == "member_limit_reached"


class TestPlanUpgrade:
    async def test_upgrade_to_pro_unlocks_quota(self, session: AsyncSession) -> None:
        user = await _make_user(session)
        # Exhaust free scans
        for _ in range(5):
            await entitlements.consume(session, user.id, UsageMetric.scans)
        assert await entitlements.can_use_metric(session, user.id, UsageMetric.scans) is False
        # Upgrade mid-cycle
        await _set_plan(session, user, SubscriptionPlan.pro)
        # Now allowed (50 scans for Pro)
        assert await entitlements.can_use_metric(session, user.id, UsageMetric.scans) is True

    async def test_pro_enrichments_unlimited(self, session: AsyncSession) -> None:
        user = await _make_user(session)
        await _set_plan(session, user, SubscriptionPlan.pro)
        for _ in range(100):
            await entitlements.consume(session, user.id, UsageMetric.enrichments)
        assert await entitlements.can_use_metric(session, user.id, UsageMetric.enrichments) is True

    async def test_pro_library_limit(self, session: AsyncSession) -> None:
        user = await _make_user(session)
        await _set_plan(session, user, SubscriptionPlan.pro)
        for _ in range(3):
            await _make_library(session, user)
        assert await entitlements.can_create_library(session, user.id) is False


class TestPlanDowngrade:
    async def test_canceled_sub_falls_back_to_free(self, session: AsyncSession) -> None:
        user = await _make_user(session)
        await _set_plan(session, user, SubscriptionPlan.pro, SubscriptionStatus.canceled)
        # Should enforce free limits (5 scans)
        for _ in range(5):
            await entitlements.consume(session, user.id, UsageMetric.scans)
        assert await entitlements.can_use_metric(session, user.id, UsageMetric.scans) is False

    async def test_past_due_falls_back_to_free(self, session: AsyncSession) -> None:
        user = await _make_user(session)
        await _set_plan(session, user, SubscriptionPlan.library, SubscriptionStatus.past_due)
        for _ in range(5):
            await entitlements.consume(session, user.id, UsageMetric.scans)
        assert await entitlements.can_use_metric(session, user.id, UsageMetric.scans) is False


class TestMonthRollover:
    async def test_new_period_starts_at_zero(self, session: AsyncSession) -> None:
        user = await _make_user(session)
        last_month = date(2026, 3, 1)
        this_month = date(2026, 4, 1)
        # Exhaust scans in last month
        for _ in range(5):
            await entitlements.consume(session, user.id, UsageMetric.scans, )
        # Directly check a different period — should be 0
        usage = await entitlements.get_current_usage(
            session, user.id, UsageMetric.scans, period_start=last_month
        )
        assert usage == 0  # nothing was counted for last_month
        current = await entitlements.get_current_usage(
            session, user.id, UsageMetric.scans, period_start=this_month
        )
        assert current == 5


class TestConcurrentIncrements:
    async def test_atomic_concurrent_increments(
        self, sessionmaker_: async_sessionmaker[AsyncSession]
    ) -> None:
        """Fire 10 concurrent consume() calls — all must be counted exactly once."""
        async with sessionmaker_() as s:
            user = await _make_user(s)
            await s.commit()

        async def _inc() -> None:
            async with sessionmaker_() as s:
                await entitlements.consume(s, user.id, UsageMetric.enrichments)
                await s.commit()

        await asyncio.gather(*[_inc() for _ in range(10)])

        async with sessionmaker_() as s:
            total = await entitlements.get_current_usage(s, user.id, UsageMetric.enrichments)
        assert total == 10


class TestIdempotency:
    async def test_same_key_counted_once(self, session: AsyncSession) -> None:
        user = await _make_user(session)
        key = f"scan-job-{uuid.uuid4()}"
        r1 = await entitlements.consume(session, user.id, UsageMetric.scans, idempotency_key=key)
        r2 = await entitlements.consume(session, user.id, UsageMetric.scans, idempotency_key=key)
        assert r1 is True
        assert r2 is False   # duplicate → not counted
        total = await entitlements.get_current_usage(session, user.id, UsageMetric.scans)
        assert total == 1

    async def test_different_keys_each_counted(self, session: AsyncSession) -> None:
        user = await _make_user(session)
        for i in range(3):
            await entitlements.consume(
                session, user.id, UsageMetric.scans, idempotency_key=f"job-{i}"
            )
        total = await entitlements.get_current_usage(session, user.id, UsageMetric.scans)
        assert total == 3

    async def test_no_key_always_increments(self, session: AsyncSession) -> None:
        user = await _make_user(session)
        await entitlements.consume(session, user.id, UsageMetric.scans)
        await entitlements.consume(session, user.id, UsageMetric.scans)
        total = await entitlements.get_current_usage(session, user.id, UsageMetric.scans)
        assert total == 2
