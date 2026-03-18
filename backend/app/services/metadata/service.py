from __future__ import annotations

import json
from time import perf_counter

import httpx
from redis import asyncio as redis_async
import structlog

from app.core.config import get_settings
from app.core.metrics import EXTERNAL_API_CALLS_TOTAL, observe_external_api_latency
from app.services.metadata.google_books import fetch_google_books_metadata
from app.services.metadata.open_library import fetch_open_library_metadata

CACHE_TTL_SECONDS = 24 * 60 * 60
logger = structlog.get_logger()


async def enrich_metadata_with_fallback(isbn: str) -> dict[str, object] | None:
    settings = get_settings()
    cache_key = f"book-metadata:{isbn}"
    redis_client = redis_async.from_url(settings.redis_url, decode_responses=True)

    try:
        cached = await redis_client.get(cache_key)
        if cached:
            result: dict[str, object] = json.loads(cached)
            return result

        metadata: dict[str, object] | None = None
        async with httpx.AsyncClient() as client:
            google_start = perf_counter()
            try:
                EXTERNAL_API_CALLS_TOTAL.labels(provider="google_books").inc()
                metadata = await fetch_google_books_metadata(client, isbn)
            except Exception as exc:
                logger.warning("google_books_lookup_failed", isbn=isbn, error=str(exc))
                metadata = None
            finally:
                observe_external_api_latency("google_books", google_start)

            if metadata is None:
                open_library_start = perf_counter()
                try:
                    EXTERNAL_API_CALLS_TOTAL.labels(provider="open_library").inc()
                    metadata = await fetch_open_library_metadata(client, isbn)
                except Exception as exc:
                    logger.warning("open_library_lookup_failed", isbn=isbn, error=str(exc))
                    metadata = None
                finally:
                    observe_external_api_latency("open_library", open_library_start)

        if metadata is None:
            return None

        await redis_client.set(cache_key, json.dumps(metadata), ex=CACHE_TTL_SECONDS)
        return metadata
    finally:
        await redis_client.aclose()
