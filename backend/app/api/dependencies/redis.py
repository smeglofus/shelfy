"""Async Redis client dependency for FastAPI endpoints.

One client instance is created per-request and closed after the response.
``redis.asyncio.from_url`` internally manages a connection pool so repeated
creation is cheap and connections are reused within the pool.

Override ``get_redis`` in ``app.dependency_overrides`` in tests:

    async def _fake_redis() -> AsyncIterator[FakeRedis]:
        yield FakeRedis()
    app.dependency_overrides[get_redis] = _fake_redis
"""
from collections.abc import AsyncIterator

import redis.asyncio as aioredis
from fastapi import Depends

from app.core.config import Settings, get_settings


async def get_redis(
    settings: Settings = Depends(get_settings),
) -> AsyncIterator[aioredis.Redis]:
    """Yield a connected async Redis client for the lifetime of the request."""
    client: aioredis.Redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    try:
        yield client
    finally:
        await client.aclose()
