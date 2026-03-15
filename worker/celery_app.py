import asyncio
import os
import time
import uuid

import sqlalchemy as sa
from celery import Celery, Task
from celery.signals import worker_process_init, worker_process_shutdown
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine


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

    processing_jobs = sa.table(
        "processing_jobs",
        sa.column("id"),
        sa.column("status"),
        sa.column("attempts"),
        sa.column("error_message"),
        sa.column("updated_at"),
    )
    stmt = sa.update(processing_jobs).where(processing_jobs.c.id == uuid.UUID(job_id)).values(
        status=status,
        updated_at=sa.func.now(),
    )
    if attempts_increment:
        stmt = stmt.values(attempts=processing_jobs.c.attempts + 1)
    if error_message is not None:
        stmt = stmt.values(error_message=error_message[:5000])

    async with _session_factory() as session:
        await session.execute(stmt)
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
        if self.request.retries < self.max_retries or not args:
            return

        job_id = str(args[0])
        asyncio.run(_update_job_status(job_id, "failed", error_message=str(exc), attempts_increment=True))


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
    asyncio.run(_update_job_status(job_id, "processing", attempts_increment=True))
    time.sleep(2)
    asyncio.run(_update_job_status(job_id, "done"))
