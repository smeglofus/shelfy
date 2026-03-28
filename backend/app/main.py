from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import cast

from anyio import to_thread
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import Response
import structlog

from app.api.auth import router as auth_router
from app.api.books import router as books_router
from app.api.health import router as health_router
from app.api.jobs import router as jobs_router
from app.api.locations import router as locations_router
from app.routers.loans import router as loans_router
from app.api.metrics import router as metrics_router
from app.core.config import get_settings
from app.core.logging import configure_structlog
from app.core.metrics import record_http_request
from app.db.session import SessionLocal
from app.services.storage import ensure_bucket_exists
from app.services.user_seed import seed_admin_user

configure_structlog(service="backend")
logger = structlog.get_logger()


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

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health_router)
    app.include_router(metrics_router)
    app.include_router(auth_router)
    app.include_router(locations_router)
    app.include_router(books_router)
    app.include_router(loans_router)
    app.include_router(jobs_router)
    return app


app = create_app()
