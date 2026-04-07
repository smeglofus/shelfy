"""Subscription and usage tracking models for SaaS billing.

Billing model: per-user (owner pays, plan covers all libraries they own).
Future: add LibrarySubscription for workspace-level billing.
"""
from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SubscriptionPlan(str, enum.Enum):
    free = "free"
    pro = "pro"
    library = "library"


class SubscriptionStatus(str, enum.Enum):
    active = "active"
    trialing = "trialing"
    canceled = "canceled"
    past_due = "past_due"


class UsageMetric(str, enum.Enum):
    scans = "scans"
    enrichments = "enrichments"


class Subscription(Base):
    """One row per user. Created with plan=free/status=active on registration."""

    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    plan: Mapped[SubscriptionPlan] = mapped_column(
        String(20), nullable=False, default=SubscriptionPlan.free
    )
    status: Mapped[SubscriptionStatus] = mapped_column(
        String(20), nullable=False, default=SubscriptionStatus.active
    )
    stripe_customer_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True)
    stripe_subscription_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True)
    trial_ends_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    current_period_start: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    current_period_end: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class UsageCounter(Base):
    """Aggregated per-user, per-metric monthly counter.

    period_start is always the 1st day of the month (e.g. date(2026, 4, 1)).
    Incremented atomically via INSERT ... ON CONFLICT DO UPDATE to avoid
    race conditions under concurrent requests.
    """

    __tablename__ = "usage_counters"
    __table_args__ = (
        UniqueConstraint("user_id", "metric", "period_start", name="uq_usage_user_metric_period"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    metric: Mapped[UsageMetric] = mapped_column(String(30), nullable=False)
    period_start: Mapped[date] = mapped_column(Date(), nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class StripeEvent(Base):
    """Idempotency log for Stripe webhooks — one row per event.id.

    Stripe delivers webhooks at-least-once and occasionally out-of-order.
    Before processing any event we INSERT here; if the INSERT conflicts the
    event has already been handled and we skip it.
    """

    __tablename__ = "stripe_events"

    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    processed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class UsageEvent(Base):
    """Idempotency log — one row per (user, idempotency_key).

    Before incrementing UsageCounter, the service does:
        INSERT INTO usage_events ... ON CONFLICT DO NOTHING
    If 0 rows inserted → duplicate event → skip increment.
    If 1 row inserted → new event → proceed with counter upsert.
    """

    __tablename__ = "usage_events"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_usage_event_idempotency_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    metric: Mapped[UsageMetric] = mapped_column(String(30), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    period_start: Mapped[date] = mapped_column(Date(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
