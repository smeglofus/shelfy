"""add pending_anonymization_until to borrowers

Revision ID: 20260518_000023
Revises: 20260512_000022
Create Date: 2026-05-18

Introduces a *pending* state for borrower anonymization (#244). When a
librarian clicks "Anonymize", the column is set to ``now() + 30d`` and
the row keeps its PII intact for the configured TTL — restore is just
nulling the column. A periodic worker
(``finalize_pending_anonymizations``) finalizes pending rows past the
deadline by clearing PII and stamping ``anonymized_at``, matching the
current immediate-anonymize contract.

The DSAR bypass (``?immediate=true`` on the anonymize endpoint) skips
the pending state and performs the legacy immediate wipe — so the new
column stays NULL for those rows.

The index makes the worker scan cheap: ``WHERE
pending_anonymization_until < now() AND anonymized_at IS NULL`` becomes
an index range scan + tiny filter. No backfill needed — all existing
rows are either active (NULL stays correct) or already-anonymized
(``anonymized_at`` set, NULL stays correct).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260518_000023"
down_revision = "20260512_000022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "borrowers",
        sa.Column(
            "pending_anonymization_until",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_borrowers_pending_anonymization_until",
        "borrowers",
        ["pending_anonymization_until"],
    )


def downgrade() -> None:
    op.drop_index("ix_borrowers_pending_anonymization_until", table_name="borrowers")
    op.drop_column("borrowers", "pending_anonymization_until")
