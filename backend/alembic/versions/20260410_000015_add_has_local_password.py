"""Add has_local_password flag to users table.

Tracks whether the account has a real (user-known) password, independent of
which OAuth provider is currently the primary sign-in method.

* Existing users all get TRUE — they registered with email+password before
  OAuth was introduced.
* New OAuth-only accounts are created with FALSE.
* Accounts that linked Google later keep TRUE (their original password is still
  valid).

This flag is the authoritative gate for "require password confirmation on
account deletion", replacing the previous check on auth_provider.

Revision ID: 20260410_000015
Revises: 20260410_000014
Create Date: 2026-04-10
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260410_000015"
down_revision = "20260410_000014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "has_local_password",
            sa.Boolean(),
            nullable=False,
            server_default="true",
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "has_local_password")
