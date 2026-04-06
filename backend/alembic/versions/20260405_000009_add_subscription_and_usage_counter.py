"""add subscription, usage_counter and usage_event tables

Revision ID: 20260405_000009
Revises: 20260403_000013
Create Date: 2026-04-05

Design notes:
  - Subscription is per-user (owner pays; covers all libraries they own).
    Future: add LibrarySubscription for workspace-level billing.
  - period_start DATE (always 1st of month) — better than VARCHAR for
    range queries and partial indexes.
  - usage_events provides idempotency: one row per (user, metric, idempotency_key).
    The consume service layer does INSERT ... ON CONFLICT DO NOTHING on this
    table before incrementing the counter, preventing double-counting.
  - usage_counters uses atomic upsert (INSERT ... ON CONFLICT DO UPDATE)
    for race-safe increments under concurrent requests.
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260405_000009"
down_revision: str | None = "20260403_000013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── subscriptions ──────────────────────────────────────────────────────────
    op.create_table(
        "subscriptions",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("plan", sa.String(20), nullable=False, server_default="free"),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("stripe_customer_id", sa.String(64), nullable=True),
        sa.Column("stripe_subscription_id", sa.String(64), nullable=True),
        sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_subscriptions_user_id", "subscriptions", ["user_id"], unique=True)
    op.create_index("ix_subscriptions_stripe_customer_id", "subscriptions", ["stripe_customer_id"], unique=True)
    op.create_index("ix_subscriptions_stripe_sub_id", "subscriptions", ["stripe_subscription_id"], unique=True)

    # ── usage_counters ─────────────────────────────────────────────────────────
    # period_start is always the 1st day of the month (e.g. 2026-04-01)
    op.create_table(
        "usage_counters",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("metric", sa.String(30), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_usage_counters_user_id", "usage_counters", ["user_id"])
    op.create_unique_constraint(
        "uq_usage_user_metric_period",
        "usage_counters",
        ["user_id", "metric", "period_start"],
    )

    # ── usage_events (idempotency log) ─────────────────────────────────────────
    # One row per (user, idempotency_key). The key is set by the caller
    # (e.g. scan job ID). INSERT ... ON CONFLICT DO NOTHING before incrementing
    # the counter prevents the same event from being counted twice.
    op.create_table(
        "usage_events",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("metric", sa.String(30), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_usage_events_user_id", "usage_events", ["user_id"])
    op.create_unique_constraint(
        "uq_usage_event_idempotency_key",
        "usage_events",
        ["idempotency_key"],
    )


def downgrade() -> None:
    op.drop_table("usage_events")
    op.drop_table("usage_counters")
    op.drop_table("subscriptions")
