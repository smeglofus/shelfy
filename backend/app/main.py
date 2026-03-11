from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.auth import router as auth_router
from app.api.health import router as health_router
from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services.user_seed import seed_admin_user


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    if settings.seed_admin_on_startup and settings.admin_email and settings.admin_password:
        async with SessionLocal() as session:
            await seed_admin_user(session, settings.admin_email, settings.admin_password)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    app.include_router(health_router)
    app.include_router(auth_router)
    return app


app = create_app()
