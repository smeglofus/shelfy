from datetime import datetime
from enum import Enum
import uuid

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


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
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True, index=True
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
