"""Add Google OAuth fields to users table.

Adds:
  • google_sub   – Google account subject identifier (unique, indexed)
  • auth_provider – 'local' | 'google'  (server default: 'local')
  • avatar_url   – profile photo URL from OAuth provider
  • oauth_linked_at – timestamp when OAuth was first linked

Revision ID: 20260410_000014
Revises: 20260406_000010
Create Date: 2026-04-10
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260410_000014"
down_revision = "20260406_000010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("google_sub", sa.String(255), nullable=True),
    )
    op.create_unique_constraint("uq_users_google_sub", "users", ["google_sub"])
    op.create_index("ix_users_google_sub", "users", ["google_sub"], unique=True)

    op.add_column(
        "users",
        sa.Column(
            "auth_provider",
            sa.String(32),
            nullable=False,
            server_default="local",
        ),
    )

    op.add_column(
        "users",
        sa.Column("avatar_url", sa.String(2048), nullable=True),
    )

    op.add_column(
        "users",
        sa.Column("oauth_linked_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "oauth_linked_at")
    op.drop_column("users", "avatar_url")
    op.drop_column("users", "auth_provider")
    op.drop_index("ix_users_google_sub", table_name="users")
    op.drop_constraint("uq_users_google_sub", "users", type_="unique")
    op.drop_column("users", "google_sub")
