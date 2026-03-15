from celery import Celery

from app.core.config import Settings


def get_celery_client(settings: Settings) -> Celery:
    return Celery(
        "shelfy_api",
        broker=settings.celery_broker_url,
        backend=settings.celery_result_backend,
    )
