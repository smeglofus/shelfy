from __future__ import annotations

from typing import Any

import httpx


async def fetch_open_library_metadata(
    client: httpx.AsyncClient,
    isbn: str | None,
    title: str | None = None,
    author: str | None = None,
) -> dict[str, Any] | None:
    if isbn:
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
    elif title:
        response = await client.get(
            "https://openlibrary.org/search.json",
            params={"title": title, "author": author or "", "limit": 1},
            timeout=10.0,
        )
        response.raise_for_status()
        payload = response.json()
        docs = payload.get("docs") or []
        if not docs:
            return None
        doc = docs[0]
        entry = {
            "title": doc.get("title"),
            "authors": [{"name": (doc.get("author_name") or [None])[0]}],
            "publishers": [{"name": (doc.get("publisher") or [None])[0]}],
            "publish_date": str(doc.get("first_publish_year") or ""),
            "languages": [{"key": f"/languages/{(doc.get('language') or [None])[0]}"}] if doc.get("language") else [],
            "description": None,
            "cover": {
                "large": f"https://covers.openlibrary.org/b/id/{doc.get('cover_i')}-L.jpg" if doc.get("cover_i") else None,
                "medium": None,
                "small": None,
            },
        }
    else:
        return None

    publish_date = str(entry.get("publish_date", ""))
    year: int | None = None
    for token in publish_date.replace(",", " ").split():
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
