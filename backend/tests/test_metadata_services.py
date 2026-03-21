from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app.services.metadata.google_books import fetch_google_books_metadata
from app.services.metadata.open_library import fetch_open_library_metadata
from app.services.metadata.service import enrich_metadata_with_fallback


def test_google_books_client_returns_normalized_metadata() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/books/v1/volumes"
        return httpx.Response(
            200,
            json={
                "items": [
                    {
                        "volumeInfo": {
                            "title": "Clean Code",
                            "authors": ["Robert C. Martin"],
                            "publisher": "Prentice Hall",
                            "publishedDate": "2008-08-01",
                            "language": "en",
                            "description": "A handbook of agile software craftsmanship.",
                            "imageLinks": {"thumbnail": "https://example.com/cover.jpg"},
                        }
                    }
                ]
            },
        )

    async def _run() -> dict[str, object] | None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await fetch_google_books_metadata(client, "9780132350884", title=None, author=None)

    metadata = asyncio.run(_run())

    assert metadata is not None
    assert metadata["isbn"] == "9780132350884"
    assert metadata["title"] == "Clean Code"
    assert metadata["publication_year"] == 2008
    assert metadata["provider"] == "google_books"


def test_open_library_fallback_called_when_google_books_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _google(_client: httpx.AsyncClient, _isbn: str | None, title: str | None = None, author: str | None = None, api_key: str | None = None) -> None:
        return None

    async def _open_library(_client: httpx.AsyncClient, isbn: str | None, title: str | None = None, author: str | None = None) -> dict[str, object]:
        return {
            "title": "Refactoring",
            "author": "Martin Fowler",
            "isbn": isbn or "9780201485677",
            "publisher": "Addison-Wesley",
            "language": "eng",
            "description": "Improving existing code.",
            "publication_year": 1999,
            "cover_image_url": "https://example.com/refactoring.jpg",
            "provider": "open_library",
        }

    class FakeRedis:
        def __init__(self) -> None:
            self.storage: dict[str, str] = {}

        async def get(self, key: str) -> str | None:
            return self.storage.get(key)

        async def set(self, key: str, value: str, ex: int) -> None:
            assert ex == 24 * 60 * 60
            self.storage[key] = value

        async def aclose(self) -> None:
            return None

    fake_redis = FakeRedis()

    monkeypatch.setattr("app.services.metadata.service.fetch_google_books_metadata", _google)
    monkeypatch.setattr("app.services.metadata.service.fetch_open_library_metadata", _open_library)
    monkeypatch.setattr("app.services.metadata.service.redis_async.from_url", lambda *_args, **_kwargs: fake_redis)

    metadata = asyncio.run(enrich_metadata_with_fallback("9780201485677", title=None, author=None))

    assert metadata is not None
    assert metadata["provider"] == "open_library"
    assert json.loads(fake_redis.storage["book-metadata:9780201485677"])["title"] == "Refactoring"


def test_cache_hit_skips_external_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    cached_payload = {"title": "Cached Book", "provider": "google_books", "isbn": "9780134494166"}

    class FakeRedis:
        async def get(self, key: str) -> str | None:
            if key == "book-metadata:9780134494166":
                return json.dumps(cached_payload)
            return None

        async def set(self, _key: str, _value: str, ex: int) -> None:
            raise AssertionError(f"cache set should not be called, got TTL {ex}")

        async def aclose(self) -> None:
            return None

    async def _raise_if_called(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("external client should not be called on cache hit")

    monkeypatch.setattr("app.services.metadata.service.redis_async.from_url", lambda *_args, **_kwargs: FakeRedis())
    monkeypatch.setattr("app.services.metadata.service.fetch_google_books_metadata", _raise_if_called)
    monkeypatch.setattr("app.services.metadata.service.fetch_open_library_metadata", _raise_if_called)

    metadata = asyncio.run(enrich_metadata_with_fallback("9780134494166", title=None, author=None))

    assert metadata == cached_payload


def test_open_library_client_normalizes_response() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "ISBN:9780134494166": {
                    "title": "Clean Architecture",
                    "authors": [{"name": "Robert C. Martin"}],
                    "publishers": [{"name": "Prentice Hall"}],
                    "publish_date": "2017",
                    "languages": [{"key": "/languages/eng"}],
                    "description": {"value": "Software architecture patterns."},
                    "cover": {"large": "https://example.com/clean-architecture.jpg"},
                }
            },
        )

    async def _run() -> dict[str, object] | None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await fetch_open_library_metadata(client, "9780134494166", title=None, author=None)

    metadata = asyncio.run(_run())

    assert metadata is not None
    assert metadata["provider"] == "open_library"
    assert metadata["publication_year"] == 2017


def test_title_author_fallback_without_isbn_calls_google_then_openlibrary(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, object, object]] = []

    async def _google(_client: httpx.AsyncClient, isbn: str | None, title: str | None = None, author: str | None = None, api_key: str | None = None) -> None:
        calls.append(("google", title, author))
        return None

    async def _open_library(_client: httpx.AsyncClient, isbn: str | None, title: str | None = None, author: str | None = None) -> dict[str, object]:
        calls.append(("open_library", title, author))
        return {"title": "Clean Code", "author": "Martin", "provider": "open_library"}

    class FakeRedis:
        storage: dict[str, str] = {}

        async def get(self, key: str) -> str | None:
            return self.storage.get(key)

        async def set(self, key: str, value: str, ex: int) -> None:
            assert key == "book-metadata:title:clean code"
            assert ex == 24 * 60 * 60
            self.storage[key] = value

        async def aclose(self) -> None:
            return None

    monkeypatch.setattr("app.services.metadata.service.fetch_google_books_metadata", _google)
    monkeypatch.setattr("app.services.metadata.service.fetch_open_library_metadata", _open_library)
    monkeypatch.setattr("app.services.metadata.service.redis_async.from_url", lambda *_args, **_kwargs: FakeRedis())

    metadata = asyncio.run(enrich_metadata_with_fallback(None, title="Clean Code", author="Martin"))

    assert metadata is not None
    assert calls[0] == ("google", "Clean Code", "Martin")
    assert calls[1] == ("open_library", "Clean Code", "Martin")
