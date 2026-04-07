"""Entry point for the Celery beat scheduler.

Usage (in docker-compose beat service):
    celery -A celery_beat beat --loglevel=info

Importing each task module registers its tasks and beat_schedule entries on celery_app.
"""
from celery_app import celery_app  # noqa: F401 — re-export for Celery CLI
import backup_tasks   # noqa: F401 — pg_dump, verify_restore, stripe_events cleanup
import email_tasks    # noqa: F401 — trial reminders, limit-approaching notifications
