from fastapi import APIRouter, Depends, HTTPException
import redis.asyncio as redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import Settings, get_settings
from app.schemas.health import HealthResponse

router = APIRouter(tags=["health"])


async def check_database(settings: Settings) -> None:
    engine = create_async_engine(settings.database_url, future=True)
    try:
        async with engine.connect() as connection:
            await connection.execute(select(1))
    finally:
        await engine.dispose()


async def check_redis(settings: Settings) -> None:
    client = redis.from_url(settings.redis_url, decode_responses=True)
    try:
        await client.ping()
    finally:
        await client.aclose()


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/health/ready", response_model=HealthResponse)
async def readiness(settings: Settings = Depends(get_settings)) -> HealthResponse:
    try:
        await check_database(settings)
        await check_redis(settings)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Service dependencies are not ready") from exc

    return HealthResponse(status="ok")
