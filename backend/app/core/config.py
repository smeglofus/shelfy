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

    # Book metadata providers.
    # Open Library is the primary (and by default the only) source: the
    # Google Books API ToS forbids charging users for an application that
    # uses it without a separate agreement with Google, and Shelfy is a
    # paid product. Only flip ``enable_google_books`` on if such an
    # agreement exists; ``google_books_api_key`` stays unused until then.
    enable_google_books: bool = False
    google_books_api_key: str | None = None
    # Identifying User-Agent sent with Open Library requests — required
    # etiquette and lifts the anonymous 1 req/s rate limit to 3 req/s.
    open_library_user_agent: str = "Shelfy (https://shelfy.cz; support@shelfy.cz)"

    # Observability / error tracking
    # Set SENTRY_DSN in .env to enable Sentry error reporting.
    sentry_dsn: str | None = None

    # Transactional email (Resend)
    # Set RESEND_API_KEY in .env to enable email notifications.
    # The from address must be a verified sender on the Resend account, and the
    # sending domain must have SPF/DKIM/DMARC records pointing at Resend before
    # mail will deliver.
    resend_api_key: str | None = None
    email_from_address: str = "Shelfy <noreply@shelfy.cz>"
    # Reply-To header: where users land when they hit "Reply" on a transactional
    # email.  Set to a monitored mailbox (we forward shelfy.cz support to a real
    # inbox).  Set to ``None`` to omit the header entirely.
    email_reply_to_address: str | None = "support@shelfy.cz"

    # Billing / Stripe
    # Set these in .env once you create products in the Stripe dashboard.
    # The secret key controls which Stripe mode the whole integration runs in
    # — sk_test_… for test mode, sk_live_… for production. Always roll keys
    # after they leak; check Developers → API keys in the dashboard.
    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None

    # Price IDs per plan × billing interval. Each env var points at a Stripe
    # Price object; we look up the plan from the price the checkout was
    # created against. Unknown price IDs fall back to SubscriptionPlan.free.
    stripe_price_id_home_monthly: str | None = None
    stripe_price_id_home_yearly: str | None = None
    stripe_price_id_pro_monthly: str | None = None
    stripe_price_id_pro_yearly: str | None = None
    stripe_price_id_library_monthly: str | None = None
    stripe_price_id_library_yearly: str | None = None

    # URL the Stripe Customer Portal redirects back to after changes.
    # Falls back to ``<app_url>/settings#billing`` when unset.
    stripe_portal_return_url: str | None = None

    # Public URL of the frontend — used as base for Stripe success/cancel redirect URLs.
    app_url: str = "http://localhost:5173"

    # Rate limiting
    rate_limit_default: str = "200/minute"
    rate_limit_register: str = "10/minute"
    rate_limit_login: str = "20/minute"
    rate_limit_refresh: str = "30/minute"
    rate_limit_password_reset: str = "5/15minutes"
    rate_limit_telemetry_frontend_error: str = "15/minute"

    # Password-reset TTLs — split on purpose.
    # ``password_reset_token_ttl_minutes`` controls how long an issued reset
    # token remains valid.
    # ``password_reset_email_ratelimit_window_minutes`` controls the TTL of
    # the Redis per-email rate-limit key (N requests per window per email).
    # Previously one overloaded ``PASSWORD_RESET_TTL_MINUTES`` was used for
    # both — split so token lifetime can be tightened independently of the
    # anti-abuse window.
    password_reset_token_ttl_minutes: int = 60
    password_reset_email_ratelimit_window_minutes: int = 60

    # Trust proxy headers (X-Forwarded-For / CF-Connecting-IP) for real client IP
    # Keep False for local deployments without a trusted reverse proxy.
    trust_proxy_headers: bool = False

    # Google OAuth 2.0 / OpenID Connect
    # Obtain credentials at https://console.cloud.google.com/ → APIs & Services → Credentials
    google_client_id: str | None = None
    google_client_secret: str | None = None
    # Must match the redirect URI registered in the Google Cloud Console.
    google_redirect_uri: str = "http://localhost:5173/auth/callback"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("jwt_secret_key")
    @classmethod
    def validate_jwt_secret_key(cls, value: str, info: object) -> str:
        env_value = getattr(info, "data", {}).get("environment")
        if value == "change-me" and env_value != "development":
            raise ValueError("JWT_SECRET_KEY must not use default value outside development")
        return value

    @field_validator("cors_allowed_origins")
    @classmethod
    def validate_cors_origins(cls, value: list[str], info: object) -> list[str]:
        # The app sends cookies via allow_credentials=True; pairing this with a
        # wildcard origin would be both insecure (credentialed CSRF) and rejected
        # by browsers. Reject "*" explicitly so misconfiguration fails fast.
        for origin in value:
            if origin.strip() == "*":
                raise ValueError(
                    "CORS_ALLOWED_ORIGINS must not include '*' — wildcard "
                    "origins are incompatible with credentialed requests"
                )
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
