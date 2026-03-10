from celery import Celery

celery_app = Celery(
    "shelfy_worker",
    broker="redis://redis:6379/0",
    backend="redis://redis:6379/1",
)

celery_app.conf.update(task_default_queue="default")
