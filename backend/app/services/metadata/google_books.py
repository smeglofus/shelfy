from __future__ import annotations

from typing import Any

import httpx


async def fetch_google_books_metadata(
    client: httpx.AsyncClient,
    isbn: str | None,
    title: str | None = None,
    author: str | None = None,
    api_key: str | None = None,
) -> dict[str, Any] | None:
    if isbn:
        query = f"isbn:{isbn}"
    elif title:
        query_parts = [f"intitle:{title}"]
        if author:
            query_parts.append(f"inauthor:{author}")
        query = "+".join(query_parts)
    else:
        return None

    params: dict[str, Any] = {"q": query, "maxResults": 1}
    if api_key:
        params["key"] = api_key

    response = await client.get(
        "https://www.googleapis.com/books/v1/volumes",
        params=params,
        timeout=10.0,
    )
    response.raise_for_status()
    payload = response.json()

    items = payload.get("items")
    if not items:
        return None

    volume_info = items[0].get("volumeInfo", {})
    published_date = str(volume_info.get("publishedDate", ""))
    year: int | None = None
    if len(published_date) >= 4 and published_date[:4].isdigit():
        year = int(published_date[:4])

    image_links = volume_info.get("imageLinks") or {}

    found_isbn = isbn
    if not found_isbn:
        for ident in volume_info.get("industryIdentifiers") or []:
            value = ident.get("identifier") if isinstance(ident, dict) else None
            if isinstance(value, str) and value:
                found_isbn = value
                break

    return {
        "title": volume_info.get("title"),
        "author": (volume_info.get("authors") or [None])[0],
        "isbn": found_isbn,
        "publisher": volume_info.get("publisher"),
        "language": volume_info.get("language"),
        "description": volume_info.get("description"),
        "publication_year": year,
        "cover_image_url": image_links.get("thumbnail") or image_links.get("smallThumbnail"),
        "provider": "google_books",
    }
