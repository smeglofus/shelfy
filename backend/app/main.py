from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import cast

from anyio import to_thread
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.responses import Response
import structlog

from app.api.auth import router as auth_router
from app.api.billing import router as billing_router
from app.api.books import router as books_router
from app.api.borrowers import router as borrowers_router
from app.api.health import router as health_router
from app.api.jobs import router as jobs_router
from app.api.libraries import router as libraries_router
from app.api.loans import router as loans_router
from app.api.locations import router as locations_router
from app.api.enrich import router as enrich_router
from app.api.metrics import router as metrics_router
from app.api.scan import router as scan_router
from app.api.settings import router as settings_router
from app.api.telemetry import router as telemetry_router
from app.api.wishlist import router as wishlist_router
from app.core.config import get_settings
from app.core.csrf import CSRFMiddleware
from app.core.limiter import limiter
from app.core.logging import configure_structlog
from app.core.metrics import record_http_request
from app.db.session import SessionLocal
from app.services.storage import ensure_bucket_exists
from app.services.user_seed import seed_admin_user

configure_structlog(service="backend")
logger = structlog.get_logger()


def _init_sentry() -> None:
    """Initialize Sentry SDK when SENTRY_DSN is configured.

    Imports are lazy so the overhead is zero when Sentry is disabled.
    """
    settings = get_settings()
    if not settings.sentry_dsn:
        return
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        integrations=[FastApiIntegration(), SqlalchemyIntegration()],
        traces_sample_rate=0.1,
        send_default_pii=False,
    )
    logger.info("sentry_initialized", environment=settings.environment)


_init_sentry()

@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    try:
        await to_thread.run_sync(ensure_bucket_exists)
    except Exception as exc:
        logger.exception("minio_bucket_setup_failed", error=str(exc), bucket=settings.minio_bucket)
        raise

    if settings.seed_admin_on_startup and settings.admin_email and settings.admin_password:
        try:
            async with SessionLocal() as session:
                created = await seed_admin_user(session, settings.admin_email, settings.admin_password)
                logger.info("admin_seed_on_startup", created=created, email=settings.admin_email)
        except Exception as exc:
            logger.exception("admin_seed_failed_on_startup", error=str(exc), email=settings.admin_email)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, lifespan=lifespan)

    # ── Rate limiting ──────────────────────────────────────────────────────────
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.add_middleware(SlowAPIMiddleware)

    # ── Observability middleware ───────────────────────────────────────────────
    @app.middleware("http")
    async def observability_middleware(request: Request, call_next) -> Response:  # type: ignore[no-untyped-def]
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())

        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id, user_id=None, service="backend")

        status_code = 500
        try:
            response = cast(Response, await call_next(request))
        except Exception:
            raise
        else:
            status_code = response.status_code
            user_id = getattr(request.state, "user_id", None)
            structlog.contextvars.bind_contextvars(user_id=user_id)
            response.headers["x-request-id"] = request_id
            return response
        finally:
            record_http_request(request, status_code=status_code)
            logger.info(
                "http_request",
                method=request.method,
                endpoint=request.url.path,
                status=status_code,
            )
            structlog.contextvars.clear_contextvars()

    # ── Security headers middleware ────────────────────────────────────────────
    @app.middleware("http")
    async def security_headers_middleware(request: Request, call_next) -> Response:  # type: ignore[no-untyped-def]
        response = cast(Response, await call_next(request))
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        # API responses are JSON-only; lock down what a browser can do with
        # them in case anything is ever rendered. Frontend serves its own
        # bundle from a separate origin and sets its own CSP.
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        )
        # HSTS only in production (Traefik handles TLS termination)
        if get_settings().environment == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    # ── CSRF protection ────────────────────────────────────────────────────────
    # Double-submit cookie pattern. Enforced on all state-changing methods
    # except a small whitelist (login / register / refresh / OAuth / Stripe
    # webhook / telemetry). Bearer-authenticated requests are exempt. See
    # app/core/csrf.py for the full contract.
    app.add_middleware(CSRFMiddleware)

    # ── CORS ──────────────────────────────────────────────────────────────────
    # ``allow_credentials=True`` is what lets the browser send the HttpOnly
    # auth cookies on cross-origin XHR; the wildcard-origin config validator
    # in app/core/config.py refuses to pair it with "*".
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["x-request-id"],
    )

    app.include_router(health_router)
    app.include_router(metrics_router)
    app.include_router(auth_router)
    app.include_router(locations_router)
    app.include_router(books_router)
    app.include_router(borrowers_router)
    app.include_router(wishlist_router)
    app.include_router(loans_router)
    app.include_router(enrich_router)
    app.include_router(scan_router)
    app.include_router(settings_router)
    app.include_router(telemetry_router)
    app.include_router(jobs_router)
    app.include_router(libraries_router)
    app.include_router(billing_router)
    return app


app = create_app()
