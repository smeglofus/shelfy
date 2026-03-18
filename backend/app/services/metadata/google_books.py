from __future__ import annotations

from typing import Any

import httpx


async def fetch_google_books_metadata(client: httpx.AsyncClient, isbn: str) -> dict[str, Any] | None:
    response = await client.get(
        "https://www.googleapis.com/books/v1/volumes",
        params={"q": f"isbn:{isbn}", "maxResults": 1},
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

    return {
        "title": volume_info.get("title"),
        "author": (volume_info.get("authors") or [None])[0],
        "isbn": isbn,
        "publisher": volume_info.get("publisher"),
        "language": volume_info.get("language"),
        "description": volume_info.get("description"),
        "publication_year": year,
        "cover_image_url": image_links.get("thumbnail") or image_links.get("smallThumbnail"),
        "provider": "google_books",
    }
