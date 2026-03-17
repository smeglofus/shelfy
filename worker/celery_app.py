from __future__ import annotations

from datetime import datetime
import os
import uuid

from celery import Celery
from sqlalchemy import DateTime, Enum as SAEnum, Integer, Text, Uuid, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    status: Mapped[str] = mapped_column(
        SAEnum(
            "pending",
            "processing",
            "done",
            "failed",
            name="processing_job_status",
            create_type=False,
        ),
        nullable=False,
    )
    error_message: Mapped[str | None] = mapped_column(Text(), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer(), nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


def on_failure(job: ProcessingJob, error_message: str) -> None:
    _update_job_status(job, "failed", error_message=error_message, attempts_increment=False)


def _update_job_status(
    job: ProcessingJob,
    status: str,
    *,
    error_message: str | None = None,
    attempts_increment: bool = False,
) -> None:
    job.status = status
    job.error_message = error_message
    if attempts_increment:
        job.attempts += 1


def get_celery_app() -> Celery:
    broker_url = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/0")
    backend_url = os.getenv("CELERY_RESULT_BACKEND", "redis://redis:6379/1")

    app = Celery("shelfy_worker", broker=broker_url, backend=backend_url)
    app.conf.update(task_default_queue="default")
    return app


celery_app = get_celery_app()
