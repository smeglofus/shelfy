from __future__ import annotations

import json

import httpx
from redis import asyncio as redis_async

from app.core.config import get_settings
from app.services.metadata.google_books import fetch_google_books_metadata
from app.services.metadata.open_library import fetch_open_library_metadata

CACHE_TTL_SECONDS = 24 * 60 * 60


async def enrich_metadata_with_fallback(isbn: str) -> dict[str, object] | None:
    settings = get_settings()
    cache_key = f"book-metadata:{isbn}"
    redis_client = redis_async.from_url(settings.redis_url, decode_responses=True)

    try:
        cached = await redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

        async with httpx.AsyncClient() as client:
            metadata = await fetch_google_books_metadata(client, isbn)
            if metadata is None:
                metadata = await fetch_open_library_metadata(client, isbn)

        if metadata is None:
            return None

        await redis_client.set(cache_key, json.dumps(metadata), ex=CACHE_TTL_SECONDS)
        return metadata
    finally:
        await redis_client.aclose()
