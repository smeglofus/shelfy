from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.loan import Loan
    from app.models.user import User


class Borrower(Base):
    __tablename__ = "borrowers"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    library_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("libraries.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    contact: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    anonymized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Pending-anonymization timestamp (#244). When set, the borrower is in
    # the "scheduled for anonymization" state — PII stays intact and a
    # periodic worker finalizes the row once ``now() > pending_anonymization_until``.
    # Mutually exclusive with ``anonymized_at`` (active → pending → anonymized).
    # NULL on rows that are either active or already finalized.
    pending_anonymization_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    # Audit trail (#245): who performed identity-touching mutations. All
    # nullable — old rows from before this migration stay NULL, as do rows
    # whose actor was deleted (FK ondelete=SET NULL).
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    anonymized_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    merged_into_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    loans: Mapped[list[Loan]] = relationship(back_populates="borrower")

    # ── Audit-trail relationships (read-only) ────────────────────────────────
    # ``selectinload``-able resolvers for ``BorrowerDetailResponse`` (#261).
    # ``viewonly=True`` because writes go through the *_user_id columns
    # directly in services.borrower; ``lazy="raise"`` keeps the list view
    # cheap by failing loud if anyone tries to lazy-load these without
    # eager-loading them first.
    created_by: Mapped[User | None] = relationship(
        "User",
        foreign_keys=[created_by_user_id],
        viewonly=True,
        lazy="raise",
    )
    anonymized_by: Mapped[User | None] = relationship(
        "User",
        foreign_keys=[anonymized_by_user_id],
        viewonly=True,
        lazy="raise",
    )
    merged_into_by: Mapped[User | None] = relationship(
        "User",
        foreign_keys=[merged_into_by_user_id],
        viewonly=True,
        lazy="raise",
    )
