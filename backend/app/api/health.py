from fastapi import APIRouter, Depends, HTTPException

from app.core.config import Settings, get_settings
from app.schemas.health import HealthResponse
from app.services.health_service import check_database, check_redis

router = APIRouter(tags=["health"])


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
