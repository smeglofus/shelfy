from __future__ import annotations

from typing import Any

import httpx

from app.core.config import get_settings

# Fields requested from search.json. ``editions`` gives the best-matching
# edition (ranked by the ``lang`` param), which carries the edition-level
# ISBN — the work-level ``isbn`` list mixes all editions together.
_SEARCH_FIELDS = ",".join([
    "key",
    "title",
    "author_name",
    "publisher",
    "first_publish_year",
    "language",
    "cover_i",
    "isbn",
    "editions",
    "editions.key",
    "editions.isbn_13",
    "editions.isbn_10",
    "editions.publish_date",
    "editions.publishers",
    "editions.languages",
    "editions.cover_i",
])


def _headers() -> dict[str, str]:
    return {"User-Agent": get_settings().open_library_user_agent}


def _parse_year(publish_date: str) -> int | None:
    for token in publish_date.replace(",", " ").split():
        if len(token) == 4 and token.isdigit():
            return int(token)
    return None


def _pick_isbn(edition: dict[str, Any], doc: dict[str, Any]) -> str | None:
    """Prefer the matched edition's ISBN-13, then its ISBN-10, then any
    ISBN-13 from the work-level list (which spans all editions)."""
    for field in ("isbn_13", "isbn_10"):
        values = edition.get(field)
        first = values[0] if isinstance(values, list) and values else None
        if isinstance(first, str):
            return first
    isbns = [i for i in (doc.get("isbn") or []) if isinstance(i, str)]
    isbn_13s = [i for i in isbns if len(i) == 13 and i.startswith(("978", "979"))]
    if isbn_13s:
        return isbn_13s[0]
    return isbns[0] if isbns else None


async def _fetch_work_description(client: httpx.AsyncClient, work_key: str | None) -> str | None:
    """Descriptions live on the work record, not in search results or the
    books API — fetched separately and best-effort (never fails the lookup)."""
    if not work_key or not work_key.startswith("/works/"):
        return None
    try:
        response = await client.get(
            f"https://openlibrary.org{work_key}.json",
            headers=_headers(),
            timeout=10.0,
        )
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    description = data.get("description")
    if isinstance(description, dict):
        description = description.get("value")
    if isinstance(description, str) and description.strip():
        return description.strip()
    return None


async def _find_work_key_by_isbn(client: httpx.AsyncClient, isbn: str) -> str | None:
    try:
        response = await client.get(
            "https://openlibrary.org/search.json",
            params={"q": f"isbn:{isbn}", "fields": "key", "limit": 1},
            headers=_headers(),
            timeout=10.0,
        )
        response.raise_for_status()
        docs = response.json().get("docs") or []
    except (httpx.HTTPError, ValueError):
        return None
    if not docs:
        return None
    key = docs[0].get("key")
    return key if isinstance(key, str) else None


async def fetch_open_library_metadata(
    client: httpx.AsyncClient,
    isbn: str | None,
    title: str | None = None,
    author: str | None = None,
) -> dict[str, Any] | None:
    resolved_isbn = isbn
    work_key: str | None = None
    if isbn:
        bib_key = f"ISBN:{isbn}"
        response = await client.get(
            "https://openlibrary.org/api/books",
            params={"bibkeys": bib_key, "format": "json", "jscmd": "data"},
            headers=_headers(),
            timeout=10.0,
        )
        response.raise_for_status()
        payload = response.json()
        entry = payload.get(bib_key)
        if not entry:
            return None
    elif title:
        response = await client.get(
            "https://openlibrary.org/search.json",
            params={
                "title": title,
                "author": author or "",
                "limit": 1,
                "fields": _SEARCH_FIELDS,
                # Prefer Czech editions when the work has one; harmless otherwise.
                "lang": "cs",
            },
            headers=_headers(),
            timeout=10.0,
        )
        response.raise_for_status()
        payload = response.json()
        docs = payload.get("docs") or []
        if not docs:
            return None
        doc = docs[0]
        editions = (doc.get("editions") or {}).get("docs") or []
        edition = editions[0] if editions and isinstance(editions[0], dict) else {}
        resolved_isbn = _pick_isbn(edition, doc)
        work_key = doc.get("key") if isinstance(doc.get("key"), str) else None
        edition_language = (edition.get("languages") or [None])[0]
        doc_language = (doc.get("language") or [None])[0]
        language = edition_language or doc_language
        cover_i = edition.get("cover_i") or doc.get("cover_i")
        entry = {
            "title": doc.get("title"),
            "authors": [{"name": (doc.get("author_name") or [None])[0]}],
            "publishers": [
                {"name": (edition.get("publishers") or doc.get("publisher") or [None])[0]}
            ],
            "publish_date": str(
                edition.get("publish_date") or doc.get("first_publish_year") or ""
            ),
            "languages": [{"key": f"/languages/{language}"}] if language else [],
            "description": None,
            "cover": {
                "large": f"https://covers.openlibrary.org/b/id/{cover_i}-L.jpg" if cover_i else None,
                "medium": None,
                "small": None,
            },
        }
    else:
        return None

    publish_date = str(entry.get("publish_date", ""))
    year = _parse_year(publish_date)

    cover = entry.get("cover") or {}

    description = (
        (entry.get("description") or {}).get("value")
        if isinstance(entry.get("description"), dict)
        else entry.get("description")
    )
    if not description:
        # The books API (ISBN path) never returns descriptions and the search
        # path sets none — resolve the work record and pull it from there.
        if work_key is None and isbn:
            work_key = await _find_work_key_by_isbn(client, isbn)
        description = await _fetch_work_description(client, work_key)

    # ``cover_image_url`` deliberately points at covers.openlibrary.org —
    # covers are hotlinked at display time, never copied into our storage.
    return {
        "title": entry.get("title"),
        "author": (entry.get("authors") or [{}])[0].get("name"),
        "isbn": resolved_isbn,
        "publisher": (entry.get("publishers") or [{}])[0].get("name"),
        "language": ((entry.get("languages") or [{}])[0].get("key") or "").split("/")[-1] or None,
        "description": description,
        "publication_year": year,
        "cover_image_url": cover.get("large") or cover.get("medium") or cover.get("small"),
        "provider": "open_library",
    }
