from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerSettings(BaseSettings):
    database_url: str = "postgresql+asyncpg://shelfy:shelfy@postgres:5432/shelfy"
    redis_url: str = "redis://redis:6379/0"

    minio_endpoint: str = "http://minio:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "shelfy-images"
    minio_region: str = "us-east-1"

    celery_broker_url: str = "redis://redis:6379/0"
    celery_result_backend: str = "redis://redis:6379/1"
    gemini_api_key: str | None = None

    # Sentry. ``SENTRY_DSN`` was already being passed to the worker
    # container in infra/docker-compose.prod.yml, but the worker had no
    # ``sentry-sdk`` dependency and never called ``sentry_sdk.init`` —
    # task exceptions silently vanished into the journal. Adding the
    # field here so pydantic stops silently dropping it on ``extra=ignore``.
    sentry_dsn: str | None = None
    environment: str = "production"

    # Enrichment rate limiting (SaaS-friendly defaults)
    enrichment_delay_seconds: float = 1.5         # delay between API calls per book
    enrichment_max_per_minute: int = 30           # max enrichment API calls per minute
    enrichment_max_per_day: int = 900             # max enrichment API calls per day (Google Books free = 1000)
    google_books_api_key: str | None = None       # optional: increases Google Books quota

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


worker_settings = WorkerSettings()
