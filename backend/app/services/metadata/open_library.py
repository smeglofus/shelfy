from __future__ import annotations

from typing import Any

import httpx


async def fetch_open_library_metadata(client: httpx.AsyncClient, isbn: str) -> dict[str, Any] | None:
    bib_key = f"ISBN:{isbn}"
    response = await client.get(
        "https://openlibrary.org/api/books",
        params={"bibkeys": bib_key, "format": "json", "jscmd": "data"},
        timeout=10.0,
    )
    response.raise_for_status()
    payload = response.json()
    entry = payload.get(bib_key)
    if not entry:
        return None

    publish_date = str(entry.get("publish_date", ""))
    year: int | None = None
    for token in publish_date.split():
        if len(token) == 4 and token.isdigit():
            year = int(token)
            break

    cover = entry.get("cover") or {}

    return {
        "title": entry.get("title"),
        "author": (entry.get("authors") or [{}])[0].get("name"),
        "isbn": isbn,
        "publisher": (entry.get("publishers") or [{}])[0].get("name"),
        "language": ((entry.get("languages") or [{}])[0].get("key") or "").split("/")[-1] or None,
        "description": (entry.get("description") or {}).get("value") if isinstance(entry.get("description"), dict) else entry.get("description"),
        "publication_year": year,
        "cover_image_url": cover.get("large") or cover.get("medium") or cover.get("small"),
        "provider": "open_library",
    }
