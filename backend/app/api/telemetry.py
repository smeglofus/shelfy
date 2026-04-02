from __future__ import annotations

from fastapi import APIRouter
import structlog
from pydantic import BaseModel, Field

from app.core.metrics import record_frontend_runtime_error

router = APIRouter(prefix="/api/v1/telemetry", tags=["telemetry"])
logger = structlog.get_logger()


class FrontendErrorEvent(BaseModel):
    kind: str = Field(default="unknown", max_length=64)
    message: str = Field(default="", max_length=2000)
    source: str | None = Field(default=None, max_length=500)
    stack: str | None = Field(default=None, max_length=6000)
    url: str | None = Field(default=None, max_length=1000)


@router.post('/frontend-error', status_code=202)
async def frontend_error(payload: FrontendErrorEvent) -> dict[str, bool]:
    record_frontend_runtime_error(payload.kind or 'unknown')
    logger.warning(
        'frontend_runtime_error',
        kind=payload.kind,
        message=payload.message[:400],
        source=payload.source,
        url=payload.url,
    )
    return {"ok": True}
