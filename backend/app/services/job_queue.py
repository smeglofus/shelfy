from functools import lru_cache

from celery import Celery

from app.core.config import get_settings


@lru_cache
def get_celery_client() -> Celery:
    settings = get_settings()
    return Celery(
        "shelfy_backend",
        broker=settings.celery_broker_url,
        backend=settings.celery_result_backend,
    )
