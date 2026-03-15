import asyncio
import os
import time
import uuid

import asyncpg
from celery import Celery


def get_celery_app() -> Celery:
    broker_url = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/0")
    backend_url = os.getenv("CELERY_RESULT_BACKEND", "redis://redis:6379/1")

    app = Celery("shelfy_worker", broker=broker_url, backend=backend_url)
    app.conf.update(task_default_queue="default")
    return app


celery_app = get_celery_app()


async def _update_job_status(job_id: str, status: str, *, attempts_increment: bool = False) -> None:
    database_url = os.getenv("DATABASE_URL", "postgresql://shelfy:shelfy@postgres:5432/shelfy")
    conn = await asyncpg.connect(database_url)
    try:
        attempts_sql = ", attempts = attempts + 1" if attempts_increment else ""
        await conn.execute(
            f"UPDATE processing_jobs SET status = $1, updated_at = NOW(){attempts_sql} WHERE id = $2::uuid",
            status,
            uuid.UUID(job_id),
        )
    finally:
        await conn.close()


@celery_app.task(
    bind=True,
    name="worker.process_image_job",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=30,
    max_retries=3,
)
def process_image_job(self, job_id: str) -> None:  # noqa: ANN001
    asyncio.run(_update_job_status(job_id, "processing", attempts_increment=True))
    time.sleep(2)
    asyncio.run(_update_job_status(job_id, "done"))
