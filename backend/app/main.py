from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
import structlog

from app.api.auth import router as auth_router
from app.api.health import router as health_router
from app.api.locations import router as locations_router
from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services.user_seed import seed_admin_user

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
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
    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(locations_router)
    return app


app = create_app()
