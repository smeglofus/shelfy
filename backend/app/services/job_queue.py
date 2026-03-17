from celery import Celery

from app.core.config import get_settings


def get_celery_client() -> Celery:
    settings = get_settings()
    app = Celery(
        "shelfy_backend",
        broker=settings.celery_broker_url,
        backend=settings.celery_result_backend,
    )
    return app
