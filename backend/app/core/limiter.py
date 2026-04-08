"""Shared rate-limiter instance.

Defined here (not in main.py) to avoid circular imports when routers
import the limiter for per-endpoint @limiter.limit() decorators.

The limiter is automatically disabled when the TESTING environment variable
is set to "true" so that unit/integration tests are not affected by rate limits.
"""
import os

from slowapi import Limiter

from app.core.config import get_settings


def _client_ip_from_headers(request) -> str:  # type: ignore[no-untyped-def]
    settings = get_settings()

    if settings.trust_proxy_headers:
        cf_ip = request.headers.get("cf-connecting-ip")
        if cf_ip:
            return cf_ip.strip()

        xff = request.headers.get("x-forwarded-for")
        if xff:
            return xff.split(",")[0].strip()

    # Fallback: direct client host as seen by app server
    return request.client.host if request.client else "unknown"


_testing = os.environ.get("TESTING", "false").lower() == "true"
_settings = get_settings()


def _rate_limit_storage_uri(redis_url: str) -> str:
    """Use dedicated Redis DB (/2) for rate limits to isolate keys from Celery/cache.

    Safely handles any password content by only modifying the last path segment.
    """
    # Split on the last '/' — the right part is the DB number (or empty)
    base, _, last = redis_url.rpartition("/")
    if last.isdigit():
        return f"{base}/2"
    # No DB number in URL — append /2
    return f"{redis_url.rstrip('/')}/2"


limiter = Limiter(
    key_func=_client_ip_from_headers,
    default_limits=[_settings.rate_limit_default],
    enabled=not _testing,
    storage_uri=_rate_limit_storage_uri(_settings.redis_url),
)
