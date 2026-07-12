"""add users.last_seen_at for activity telemetry

Revision ID: 20260712_000027
Revises: 20260711_000025
Create Date: 2026-07-12

Stamped (throttled to one write per 15 minutes per user, enforced in the
UPDATE's WHERE clause) by ``services.user_activity.touch_last_seen`` on
every authenticated request. Powers the ``shelfy_active_users{window}``
gauges on /metrics — DAU/WAU/MAU in Grafana. Nullable, no backfill:
NULL simply means "not seen since this feature shipped", which is the
honest answer.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260712_000027"
down_revision = "20260711_000025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_users_last_seen_at", "users", ["last_seen_at"])


def downgrade() -> None:
    op.drop_index("ix_users_last_seen_at", table_name="users")
    op.drop_column("users", "last_seen_at")
