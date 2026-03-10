from fastapi import APIRouter, Depends, HTTPException

from app.config import Settings, get_settings
from app.dependencies import check_database, check_redis

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready")
async def readiness(settings: Settings = Depends(get_settings)) -> dict[str, str]:
    try:
        await check_database(settings)
        await check_redis(settings)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Service dependencies are not ready") from exc

    return {"status": "ok"}
