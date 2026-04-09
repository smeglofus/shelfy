from __future__ import annotations

from fastapi import APIRouter, Request
import re
import structlog
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.limiter import limiter
from app.core.metrics import record_frontend_runtime_error

router = APIRouter(prefix="/api/v1/telemetry", tags=["telemetry"])
logger = structlog.get_logger()
SETTINGS = get_settings()

_SECRET_PATTERN = re.compile(
    r"(AIza[0-9A-Za-z_-]{35}|sk_(?:live|test)_[0-9A-Za-z]+|rk_(?:live|test)_[0-9A-Za-z]+|"
    r"whsec_[0-9A-Za-z]+|Bearer\s+[A-Za-z0-9._-]+|BEGIN\s+PRIVATE\s+KEY)",
    re.IGNORECASE,
)


def _sanitize_text(value: str | None, *, max_len: int) -> str | None:
    if not value:
        return None
    compact = " ".join(value.splitlines())
    redacted = _SECRET_PATTERN.sub("[redacted]", compact)
    return redacted[:max_len]


def _sanitize_url(value: str | None) -> str | None:
    if not value:
        return None
    # Keep only origin + path to avoid query string data leakage
    safe = value.split("?", 1)[0].split("#", 1)[0]
    return safe[:400]


class FrontendErrorEvent(BaseModel):
    kind: str = Field(default="unknown", max_length=64)
    message: str = Field(default="", max_length=2000)
    source: str | None = Field(default=None, max_length=500)
    stack: str | None = Field(default=None, max_length=6000)
    url: str | None = Field(default=None, max_length=1000)


@router.post('/frontend-error', status_code=202)
@limiter.limit(SETTINGS.rate_limit_telemetry_frontend_error)
async def frontend_error(request: Request, payload: FrontendErrorEvent) -> dict[str, bool]:
    _ = request
    kind = (payload.kind or "unknown")[:64]
    record_frontend_runtime_error(kind)
    logger.warning(
        "frontend_runtime_error",
        kind=kind,
        message=_sanitize_text(payload.message, max_len=300),
        source=_sanitize_text(payload.source, max_len=200),
        # Never log full stack traces from untrusted clients.
        stack="[present]" if payload.stack else None,
        url=_sanitize_url(payload.url),
    )
    return {"ok": True}
