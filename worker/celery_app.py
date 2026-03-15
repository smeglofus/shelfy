import asyncio
from datetime import datetime
import os
import time
import uuid

from celery import Celery, Task
from celery.signals import worker_process_init, worker_process_shutdown
import structlog
from sqlalchemy import DateTime, Enum as SAEnum, Integer, Text, Uuid, func
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

logger = structlog.get_logger()


class Base(DeclarativeBase):
    pass


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    status: Mapped[str] = mapped_column(
        SAEnum("pending", "processing", "done", "failed", name="processing_job_status", create_type=False),
        nullable=False,
    )
    error_message: Mapped[str | None] = mapped_column(Text(), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
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
_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def _normalize_database_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


@worker_process_init.connect
def _init_worker_db(*_args: object, **_kwargs: object) -> None:
    global _engine, _session_factory
    database_url = os.getenv("DATABASE_URL", "postgresql://shelfy:shelfy@postgres:5432/shelfy")
    _engine = create_async_engine(_normalize_database_url(database_url))
    _session_factory = async_sessionmaker(bind=_engine, class_=AsyncSession, expire_on_commit=False)


@worker_process_shutdown.connect
def _shutdown_worker_db(*_args: object, **_kwargs: object) -> None:
    global _engine, _session_factory
    if _engine is not None:
        asyncio.run(_engine.dispose())
    _engine = None
    _session_factory = None


async def _update_job_status(
    job_id: str,
    status: str,
    *,
    attempts_increment: bool = False,
    error_message: str | None = None,
) -> None:
    if _session_factory is None:
        raise RuntimeError("Worker DB session factory has not been initialized")

    async with _session_factory() as session:
        job = await session.get(ProcessingJob, uuid.UUID(job_id))
        if job is None:
            raise RuntimeError(f"ProcessingJob not found: {job_id}")

        job.status = status
        if attempts_increment:
            job.attempts += 1
        if error_message is not None:
            job.error_message = error_message[:5000]

        await session.commit()


class ProcessImageJobTask(Task):
    def on_failure(  # type: ignore[override]
        self,
        exc: BaseException,
        task_id: str,
        args: tuple[object, ...],
        kwargs: dict[str, object],
        einfo: object,
    ) -> None:
        super().on_failure(exc, task_id, args, kwargs, einfo)
        logger.exception("process_image_job_failed", task_id=task_id, error=str(exc), retries=self.request.retries)
        if self.request.retries < self.max_retries or not args:
            return

        job_id = str(args[0])
        asyncio.run(_update_job_status(job_id, "failed", error_message=str(exc), attempts_increment=False))


@celery_app.task(
    bind=True,
    base=ProcessImageJobTask,
    name="worker.process_image_job",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=30,
    max_retries=3,
)
def process_image_job(self: ProcessImageJobTask, job_id: str) -> None:
    logger.info("process_image_job_started", job_id=job_id)
    try:
        asyncio.run(_update_job_status(job_id, "processing", attempts_increment=True))
        time.sleep(2)
        asyncio.run(_update_job_status(job_id, "done"))
        logger.info("process_image_job_completed", job_id=job_id)
    except Exception:
        logger.exception("process_image_job_error", job_id=job_id)
        raise
