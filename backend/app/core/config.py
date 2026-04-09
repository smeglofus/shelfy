from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Shelfy API"
    environment: str = "development"
    database_url: str = "postgresql+asyncpg://shelfy:shelfy@localhost:5432/shelfy"
    redis_url: str = "redis://localhost:6379/0"
    cors_allowed_origins: list[str] = ["http://localhost:5173"]

    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/1"

    minio_endpoint: str = "http://localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "shelfy-images"
    minio_region: str = "us-east-1"


    jwt_secret_key: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    admin_email: str | None = None
    admin_password: str | None = None
    seed_admin_on_startup: bool = False

    google_books_api_key: str | None = None

    # Observability / error tracking
    # Set SENTRY_DSN in .env to enable Sentry error reporting.
    sentry_dsn: str | None = None

    # Transactional email (Resend)
    # Set RESEND_API_KEY in .env to enable email notifications.
    resend_api_key: str | None = None
    email_from_address: str = "Shelfy <noreply@shelfy.app>"

    # Billing / Stripe
    # Set these in .env once you create products in the Stripe dashboard.
    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None
    stripe_price_id_pro: str | None = None
    stripe_price_id_library: str | None = None
    # Public URL of the frontend — used as base for Stripe success/cancel redirect URLs.
    app_url: str = "http://localhost:5173"

    # Rate limiting
    rate_limit_default: str = "200/minute"
    rate_limit_register: str = "10/minute"
    rate_limit_login: str = "20/minute"
    rate_limit_refresh: str = "30/minute"
    rate_limit_telemetry_frontend_error: str = "15/minute"

    # Trust proxy headers (X-Forwarded-For / CF-Connecting-IP) for real client IP
    # Keep False for local deployments without a trusted reverse proxy.
    trust_proxy_headers: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("jwt_secret_key")
    @classmethod
    def validate_jwt_secret_key(cls, value: str, info: object) -> str:
        env_value = getattr(info, "data", {}).get("environment")
        if value == "change-me" and env_value != "development":
            raise ValueError("JWT_SECRET_KEY must not use default value outside development")
        return value


    @field_validator("minio_access_key", "minio_secret_key")
    @classmethod
    def validate_minio_defaults(cls, value: str, info: object) -> str:
        env_value = getattr(info, "data", {}).get("environment")
        if value == "minioadmin" and env_value != "development":
            raise ValueError("MinIO credentials must not use default values outside development")
        return value

    @field_validator("admin_password")
    @classmethod
    def validate_admin_password(cls, value: str | None, info: object) -> str | None:
        env_value = getattr(info, "data", {}).get("environment")
        if env_value == "production" and value is not None and len(value) < 12:
            raise ValueError("ADMIN_PASSWORD must be at least 12 characters in production")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
