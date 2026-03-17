from datetime import datetime
import os
import time
import uuid
from enum import Enum

from celery import Celery
from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Integer, String, Uuid, create_engine, exc, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column


class Base(DeclarativeBase):
    pass


class ProcessingJobStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"
    # Keep this schema aligned with backend/app/models/processing_job.py.

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    status: Mapped[ProcessingJobStatus] = mapped_column(
        SAEnum(
            ProcessingJobStatus,
            values_callable=lambda e: [member.value for member in e],
            validate_strings=True,
            name="processing_job_status",
            create_type=False,
        ),
        nullable=False,
        default=ProcessingJobStatus.PENDING,
    )
    book_image_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("book_images.id", ondelete="CASCADE"), nullable=False, index=True
    )
    result_json: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


def get_celery_app() -> Celery:
    broker_url = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/0")
    backend_url = os.getenv("CELERY_RESULT_BACKEND", "redis://redis:6379/1")

    app = Celery("shelfy_worker", broker=broker_url, backend=backend_url)
    app.conf.update(task_default_queue="default")
    return app


celery_app = get_celery_app()


def _get_engine():
    database_url = os.getenv("DATABASE_URL", "postgresql+asyncpg://shelfy:shelfy@postgres:5432/shelfy")
    sync_database_url = database_url.replace("+asyncpg", "+psycopg2")
    return create_engine(sync_database_url)


@celery_app.task(
    name="worker.celery_app.process_book_image",
    bind=True,
    autoretry_for=(exc.OperationalError, exc.InterfaceError),
    retry_backoff=True,
    retry_backoff_max=60,
    max_retries=3,
)
def process_book_image(self, job_id: str) -> None:
    engine = _get_engine()
    try:
        with Session(engine) as session:
            job = session.get(ProcessingJob, uuid.UUID(job_id))
            if job is None:
                return

            job.status = ProcessingJobStatus.PROCESSING
            job.attempts += 1
            session.commit()
    except (exc.OperationalError, exc.InterfaceError):
        raise
    except Exception as error:
        with Session(engine) as session:
            job = session.get(ProcessingJob, uuid.UUID(job_id))
            if job is not None:
                job.status = ProcessingJobStatus.FAILED
                job.error_message = str(error)[:1000]
                session.commit()
        raise

    try:
        time.sleep(2)

        with Session(engine) as session:
            job = session.get(ProcessingJob, uuid.UUID(job_id))
            if job is None:
                return
            job.status = ProcessingJobStatus.DONE
            job.error_message = None
            session.commit()
    except (exc.OperationalError, exc.InterfaceError):
        raise
    except Exception as error:
        with Session(engine) as session:
            job = session.get(ProcessingJob, uuid.UUID(job_id))
            if job is not None:
                job.status = ProcessingJobStatus.FAILED
                job.error_message = str(error)[:1000]
                session.commit()
        raise
