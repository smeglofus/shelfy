"""add actor-audit columns to borrowers

Revision ID: 20260512_000022
Revises: 20260507_000021
Create Date: 2026-05-12

Adds three nullable user FKs to ``borrowers`` so identity-touching
mutations record *who* performed them, not just *when*. Existing rows
stay NULL — no backfill, no data loss on downgrade.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260512_000022"
down_revision = "20260507_000021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "borrowers",
        sa.Column("created_by_user_id", sa.Uuid(as_uuid=True), nullable=True),
    )
    op.add_column(
        "borrowers",
        sa.Column("anonymized_by_user_id", sa.Uuid(as_uuid=True), nullable=True),
    )
    op.add_column(
        "borrowers",
        sa.Column("merged_into_by_user_id", sa.Uuid(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_borrowers_created_by_user_id",
        "borrowers",
        "users",
        ["created_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_borrowers_anonymized_by_user_id",
        "borrowers",
        "users",
        ["anonymized_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_borrowers_merged_into_by_user_id",
        "borrowers",
        "users",
        ["merged_into_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_borrowers_merged_into_by_user_id", "borrowers", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_borrowers_anonymized_by_user_id", "borrowers", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_borrowers_created_by_user_id", "borrowers", type_="foreignkey"
    )
    op.drop_column("borrowers", "merged_into_by_user_id")
    op.drop_column("borrowers", "anonymized_by_user_id")
    op.drop_column("borrowers", "created_by_user_id")
