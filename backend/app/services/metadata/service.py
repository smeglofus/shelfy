from __future__ import annotations

import json
from time import perf_counter

import httpx
from redis import asyncio as redis_async
import structlog

from app.core.config import get_settings
from app.core.metrics import EXTERNAL_API_CALLS_TOTAL, observe_external_api_latency
from app.services.metadata.google_books import fetch_google_books_metadata
from app.services.metadata.knihovny import fetch_knihovny_metadata, looks_czech
from app.services.metadata.match import title_lookup_result_is_trustworthy
from app.services.metadata.open_library import fetch_open_library_metadata

# Open Library allows commercial reuse of its data, so hits can be cached
# aggressively; the long TTL also keeps us well inside its rate limits.
CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
# Definitive misses (the catalogue answered but has no record) are cached
# as JSON ``null`` so unknown ISBNs don't hammer Open Library on every
# retry. Kept shorter than hits — the catalogue grows.
NEGATIVE_CACHE_TTL_SECONDS = 24 * 60 * 60
logger = structlog.get_logger()


def _cache_key(isbn: str | None, title: str | None) -> str | None:
    if isbn:
        return f"book-metadata:{isbn}"
    if title and title.strip():
        return f"book-metadata:title:{title.lower().strip()}"
    return None


async def _google_books_lookup(
    client: httpx.AsyncClient,
    isbn: str | None,
    title: str | None,
    author: str | None,
) -> tuple[dict[str, object] | None, bool]:
    """Returns ``(metadata, errored)``."""
    settings = get_settings()
    start = perf_counter()
    try:
        EXTERNAL_API_CALLS_TOTAL.labels(provider="google_books").inc()
        return (
            await fetch_google_books_metadata(
                client, isbn, title=title, author=author, api_key=settings.google_books_api_key
            ),
            False,
        )
    except Exception as exc:
        logger.warning("google_books_lookup_failed", isbn=isbn, title=title, author=author, error=str(exc))
        return None, True
    finally:
        observe_external_api_latency("google_books", start)


async def _open_library_lookup(
    client: httpx.AsyncClient,
    isbn: str | None,
    title: str | None,
    author: str | None,
) -> tuple[dict[str, object] | None, bool]:
    """Returns ``(metadata, errored)``."""
    start = perf_counter()
    try:
        EXTERNAL_API_CALLS_TOTAL.labels(provider="open_library").inc()
        return await fetch_open_library_metadata(client, isbn, title=title, author=author), False
    except Exception as exc:
        logger.warning("open_library_lookup_failed", isbn=isbn, title=title, author=author, error=str(exc))
        return None, True
    finally:
        observe_external_api_latency("open_library", start)


async def _knihovny_lookup(
    client: httpx.AsyncClient,
    isbn: str | None,
    title: str | None,
    author: str | None,
) -> tuple[dict[str, object] | None, bool]:
    """Returns ``(metadata, errored)``."""
    start = perf_counter()
    try:
        EXTERNAL_API_CALLS_TOTAL.labels(provider="knihovny_cz").inc()
        return await fetch_knihovny_metadata(client, isbn, title=title, author=author), False
    except Exception as exc:
        logger.warning("knihovny_lookup_failed", isbn=isbn, title=title, author=author, error=str(exc))
        return None, True
    finally:
        observe_external_api_latency("knihovny_cz", start)


# Fields worth backfilling from a secondary provider when the primary hit
# lacks them (knihovny.cz never returns covers; Open Library often lacks
# Czech annotations).
_GAP_FILL_FIELDS = ("cover_image_url", "description")


async def enrich_metadata_with_fallback(
    isbn: str | None,
    title: str | None,
    author: str | None,
) -> dict[str, object] | None:
    settings = get_settings()
    cache_key = _cache_key(isbn, title)
    if cache_key is None:
        return None
    redis_client = redis_async.from_url(settings.redis_url, decode_responses=True)

    try:
        cached = await redis_client.get(cache_key)
        if cached:
            # ``"null"`` is a cached negative result and decodes to ``None``.
            result: dict[str, object] | None = json.loads(cached)
            return result

        # Provider order (ADR 012): Czech-looking lookups (diacritics or a
        # 978-80/80 ISBN prefix) hit knihovny.cz first — its coverage of
        # Czech titles and annotations beats Open Library. Everything else
        # keeps Open Library first with knihovny.cz as the fallback. Google
        # Books ToS forbids paid applications, so it only runs behind the
        # explicit ``enable_google_books`` opt-in, keeping its legacy
        # primary-with-fallback position.
        if settings.enable_knihovny_cz:
            czech = looks_czech(isbn, title, author)
            providers = (
                [_knihovny_lookup, _open_library_lookup]
                if czech
                else [_open_library_lookup, _knihovny_lookup]
            )
        else:
            providers = [_open_library_lookup]

        metadata: dict[str, object] | None = None
        errored = False
        rejected = False

        def _vet(candidate: dict[str, object] | None) -> dict[str, object] | None:
            """Reject a title-only hit that is a different book sharing the
            title. ISBN hits are authoritative and pass through untouched."""
            nonlocal rejected
            if candidate is None or isbn is not None or not title:
                return candidate
            raw_title = candidate.get("title")
            raw_author = candidate.get("author")
            cand_title = raw_title if isinstance(raw_title, str) else None
            cand_author = raw_author if isinstance(raw_author, str) else None
            if title_lookup_result_is_trustworthy(title, author, cand_title, cand_author):
                return candidate
            rejected = True
            logger.info(
                "enrichment_title_match_rejected",
                query_title=title,
                query_author=author,
                candidate_title=cand_title,
                candidate_author=cand_author,
                provider=candidate.get("provider"),
            )
            return None

        async with httpx.AsyncClient() as client:
            if settings.enable_google_books:
                metadata, errored = await _google_books_lookup(client, isbn, title, author)
                metadata = _vet(metadata)
            remaining = list(providers)
            while metadata is None and remaining:
                lookup = remaining.pop(0)
                metadata, lookup_errored = await lookup(client, isbn, title, author)
                metadata = _vet(metadata)
                errored = errored or lookup_errored

            # Gap-fill: the winning record may lack a cover (knihovny.cz
            # never has one) or an annotation (Open Library rarely has
            # Czech ones) — backfill just those fields from the next
            # provider in line. Best-effort, never fails the lookup.
            # Skipped for Google results to preserve its legacy standalone
            # behaviour.
            if (
                metadata is not None
                and metadata.get("provider") in ("open_library", "knihovny_cz")
                and remaining
                and any(not metadata.get(field) for field in _GAP_FILL_FIELDS)
            ):
                # Not vetted: the secondary is a deliberately loose match used
                # only to backfill non-identifying fields (cover/description).
                # It is often a different-language edition of the same work
                # ("Válka s mloky" ↔ "War with the Newts"), which the title
                # guard would wrongly reject. Identity is set by the primary.
                secondary, _ = await remaining[0](client, isbn, title, author)
                if secondary:
                    for field in _GAP_FILL_FIELDS:
                        if not metadata.get(field) and secondary.get(field):
                            metadata[field] = secondary[field]

        if metadata is None:
            # Only cache a miss when the provider actually answered *and* we
            # didn't reject a mismatched hit — a rejected title-only match is
            # not a definitive miss, so a later ISBN-based retry must stay able
            # to find the right record.
            if not errored and not rejected:
                await redis_client.set(cache_key, json.dumps(None), ex=NEGATIVE_CACHE_TTL_SECONDS)
            return None

        await redis_client.set(cache_key, json.dumps(metadata), ex=CACHE_TTL_SECONDS)
        return metadata
    finally:
        await redis_client.aclose()
