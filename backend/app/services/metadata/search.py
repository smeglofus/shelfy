"""Multi-candidate book search against Open Library (#308).

Backs the ``GET /api/v1/books/suggest`` autocomplete endpoint. Unlike
``enrich_metadata_with_fallback`` (single best hit for a known book), this
returns several lightweight candidates for a partial title/author query.
Open Library only — Google Books is ToS-gated, see ADR 009 / #310.
"""
from __future__ import annotations

import json
from time import perf_counter
from typing import Any

import httpx
import redis.asyncio as aioredis
import structlog

from app.core.config import get_settings
from app.core.metrics import EXTERNAL_API_CALLS_TOTAL, observe_external_api_latency

MIN_QUERY_LENGTH = 3
# Suggest queries are keystroke-shaped and repeat heavily across users; a
# few hours of staleness is invisible for catalogue data while the cache
# (with the client-side debounce) keeps us inside Open Library rate limits.
SUGGEST_CACHE_TTL_SECONDS = 6 * 60 * 60

# Trim the search payload to what BookSuggestion needs — Open Library docs
# otherwise carry hundreds of edition keys per hit.
_SEARCH_FIELDS = "title,author_name,isbn,publisher,first_publish_year,language,cover_i"

logger = structlog.get_logger()


def _cache_key(query: str, limit: int) -> str:
    return f"book-suggest:{limit}:{query.lower()}"


def _pick_isbn(values: Any) -> str | None:
    if not isinstance(values, list):
        return None
    isbns = [v for v in values if isinstance(v, str) and v]
    for value in isbns:
        if len(value) == 13:
            return value
    return isbns[0] if isbns else None


async def search_open_library_books(
    client: httpx.AsyncClient, query: str, limit: int
) -> list[dict[str, Any]]:
    """Fetch and normalize up to ``limit`` candidates from Open Library search."""
    settings = get_settings()
    response = await client.get(
        "https://openlibrary.org/search.json",
        params={"q": query, "limit": limit, "fields": _SEARCH_FIELDS},
        headers={"User-Agent": settings.open_library_user_agent},
        timeout=10.0,
    )
    response.raise_for_status()
    payload = response.json()
    docs = payload.get("docs") or []

    suggestions: list[dict[str, Any]] = []
    for doc in docs[:limit]:
        title = doc.get("title")
        if not isinstance(title, str) or not title.strip():
            continue
        cover_id = doc.get("cover_i")
        # Covers are hotlinked from covers.openlibrary.org, never rehosted.
        suggestions.append(
            {
                "title": title,
                "author": (doc.get("author_name") or [None])[0],
                "isbn": _pick_isbn(doc.get("isbn")),
                "publisher": (doc.get("publisher") or [None])[0],
                "language": (doc.get("language") or [None])[0],
                "publication_year": doc.get("first_publish_year"),
                "cover_image_url": f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg" if cover_id else None,
                "provider": "open_library",
            }
        )
    return suggestions


async def suggest_books(
    query: str, limit: int, redis_client: aioredis.Redis
) -> list[dict[str, Any]]:
    """Return autocomplete candidates, Redis-cached per (query, limit).

    Queries shorter than ``MIN_QUERY_LENGTH`` return ``[]`` without any
    external call. Provider failures also return ``[]`` (an autocomplete
    must never break the form) and are not cached, so transient outages
    stay retryable. Empty result sets from a healthy provider *are*
    cached — they are definitive for the TTL window.
    """
    normalized = query.strip()
    if len(normalized) < MIN_QUERY_LENGTH:
        return []

    cache_key = _cache_key(normalized, limit)
    cached = await redis_client.get(cache_key)
    if cached:
        result: list[dict[str, Any]] = json.loads(cached)
        return result

    start = perf_counter()
    try:
        EXTERNAL_API_CALLS_TOTAL.labels(provider="open_library").inc()
        async with httpx.AsyncClient() as client:
            suggestions = await search_open_library_books(client, normalized, limit)
    except Exception as exc:
        logger.warning("open_library_suggest_failed", query=normalized, error=str(exc))
        return []
    finally:
        observe_external_api_latency("open_library", start)

    await redis_client.set(cache_key, json.dumps(suggestions), ex=SUGGEST_CACHE_TTL_SECONDS)
    return suggestions
