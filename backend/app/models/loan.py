from __future__ import annotations

from datetime import date, datetime, timezone
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.book import Book
    from app.models.borrower import Borrower


class Loan(Base):
    __tablename__ = "loans"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    library_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("libraries.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    book_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("books.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    borrower_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("borrowers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Denormalized snapshot of the borrower's identity at lend time.
    # See docs/adr/008-keep-legacy-loan-borrower-fields.md — these columns are
    # deliberately kept (not deprecated). Display code should prefer the
    # nested ``borrower`` relationship and fall back to these only when
    # ``borrower_id`` is NULL.
    borrower_name: Mapped[str] = mapped_column(String(255), nullable=False)
    borrower_contact: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lent_date: Mapped[date] = mapped_column(Date(), nullable=False, default=date.today)
    due_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    returned_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    return_condition: Mapped[str | None] = mapped_column(String(50), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        onupdate=func.now(),
    )

    book: Mapped[Book] = relationship(back_populates="loans")
    borrower: Mapped[Borrower | None] = relationship(back_populates="loans")
