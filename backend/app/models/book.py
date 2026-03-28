from __future__ import annotations

from datetime import datetime
from enum import Enum
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.loan import Loan


class ReadingStatus(str, Enum):
    UNREAD = "unread"
    READING = "reading"
    READ = "read"
    LENT = "lent"


class BookProcessingStatus(str, Enum):
    MANUAL = "manual"
    PENDING = "pending"
    DONE = "done"
    FAILED = "failed"
    PARTIAL = "partial"


class Book(Base):
    __tablename__ = "books"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    author: Mapped[str | None] = mapped_column(String(500), nullable=True)
    isbn: Mapped[str | None] = mapped_column(String(20), nullable=True, unique=True, index=True)
    publisher: Mapped[str | None] = mapped_column(String(300), nullable=True)
    language: Mapped[str | None] = mapped_column(String(10), nullable=True)
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)
    publication_year: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    cover_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    shelf_position: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("locations.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    reading_status: Mapped[ReadingStatus | None] = mapped_column(
        SAEnum(
            ReadingStatus,
            values_callable=lambda e: [member.value for member in e],
            validate_strings=True,
            name="reading_status",
            create_type=False,
        ),
        nullable=True,
        default=ReadingStatus.UNREAD,
        server_default=ReadingStatus.UNREAD.value,
    )
    processing_status: Mapped[BookProcessingStatus] = mapped_column(
        SAEnum(
            BookProcessingStatus,
            values_callable=lambda e: [member.value for member in e],
            validate_strings=True,
            name="book_processing_status",
            create_type=False,
        ),
        nullable=False,
        default=BookProcessingStatus.MANUAL,
        server_default=BookProcessingStatus.MANUAL.value,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    loans: Mapped[list[Loan]] = relationship(
        back_populates="book",
        cascade="all, delete-orphan",
        order_by="Loan.lent_date.desc()",
    )

    @property
    def active_loan(self) -> Loan | None:
        for loan in self.loans:
            if loan.returned_date is None:
                return loan
        return None

    @property
    def is_currently_lent(self) -> bool:
        return self.active_loan is not None
