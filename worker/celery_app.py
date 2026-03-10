import os

from celery import Celery


def get_celery_app() -> Celery:
    broker_url = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/0")
    backend_url = os.getenv("CELERY_RESULT_BACKEND", "redis://redis:6379/1")

    app = Celery("shelfy_worker", broker=broker_url, backend=backend_url)
    app.conf.update(task_default_queue="default")
    return app


celery_app = get_celery_app()
