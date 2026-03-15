from datetime import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class BookImage(Base):
    __tablename__ = "book_images"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    book_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("books.id", ondelete="SET NULL"), nullable=True, index=True
    )
    minio_path: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    processing_jobs = relationship("ProcessingJob", back_populates="book_image")
