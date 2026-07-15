from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app.core.config import get_settings
from app.services.metadata.google_books import fetch_google_books_metadata
from app.services.metadata.knihovny import fetch_knihovny_metadata, looks_czech
from app.services.metadata.open_library import fetch_open_library_metadata
from app.services.metadata.service import (
    CACHE_TTL_SECONDS,
    NEGATIVE_CACHE_TTL_SECONDS,
    enrich_metadata_with_fallback,
)


class FakeRedis:
    def __init__(self, preloaded: dict[str, str] | None = None) -> None:
        self.storage: dict[str, str] = dict(preloaded or {})
        self.ttls: dict[str, int] = {}

    async def get(self, key: str) -> str | None:
        return self.storage.get(key)

    async def set(self, key: str, value: str, ex: int) -> None:
        self.storage[key] = value
        self.ttls[key] = ex

    async def aclose(self) -> None:
        return None


def _use_settings(monkeypatch: pytest.MonkeyPatch, **overrides: object) -> None:
    settings = get_settings().model_copy(update=overrides)
    monkeypatch.setattr("app.services.metadata.service.get_settings", lambda: settings)


def _use_redis(monkeypatch: pytest.MonkeyPatch, fake: FakeRedis) -> None:
    monkeypatch.setattr("app.services.metadata.service.redis_async.from_url", lambda *_a, **_k: fake)


async def _fail_if_called(*_args: object, **_kwargs: object) -> None:
    raise AssertionError("this provider must not be called")


OPEN_LIBRARY_METADATA: dict[str, object] = {
    "title": "Refactoring",
    "author": "Martin Fowler",
    "isbn": "9780201485677",
    "publisher": "Addison-Wesley",
    "language": "eng",
    "description": "Improving existing code.",
    "publication_year": 1999,
    "cover_image_url": "https://covers.openlibrary.org/b/id/12345-L.jpg",
    "provider": "open_library",
}


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


def test_default_path_uses_open_library_and_never_calls_google(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _open_library(_client: httpx.AsyncClient, isbn: str | None, title: str | None = None, author: str | None = None) -> dict[str, object]:
        return dict(OPEN_LIBRARY_METADATA, isbn=isbn)

    fake_redis = FakeRedis()
    _use_settings(monkeypatch, enable_google_books=False)
    _use_redis(monkeypatch, fake_redis)
    monkeypatch.setattr("app.services.metadata.service.fetch_google_books_metadata", _fail_if_called)
    monkeypatch.setattr("app.services.metadata.service.fetch_open_library_metadata", _open_library)

    metadata = asyncio.run(enrich_metadata_with_fallback("9780201485677", title=None, author=None))

    assert metadata is not None
    assert metadata["provider"] == "open_library"
    assert json.loads(fake_redis.storage["book-metadata:9780201485677"])["title"] == "Refactoring"
    assert fake_redis.ttls["book-metadata:9780201485677"] == CACHE_TTL_SECONDS


def test_flag_enabled_restores_google_primary(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _google(_client: httpx.AsyncClient, isbn: str | None, title: str | None = None, author: str | None = None, api_key: str | None = None) -> dict[str, object]:
        return {"title": "Clean Code", "isbn": isbn, "provider": "google_books"}

    _use_settings(monkeypatch, enable_google_books=True)
    _use_redis(monkeypatch, FakeRedis())
    monkeypatch.setattr("app.services.metadata.service.fetch_google_books_metadata", _google)
    monkeypatch.setattr("app.services.metadata.service.fetch_open_library_metadata", _fail_if_called)
    monkeypatch.setattr("app.services.metadata.service.fetch_knihovny_metadata", _fail_if_called)

    metadata = asyncio.run(enrich_metadata_with_fallback("9780132350884", title=None, author=None))

    assert metadata is not None
    assert metadata["provider"] == "google_books"


def test_flag_enabled_falls_back_to_open_library_when_google_misses(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    async def _google(_client: httpx.AsyncClient, _isbn: str | None, title: str | None = None, author: str | None = None, api_key: str | None = None) -> None:
        calls.append("google")
        return None

    async def _open_library(_client: httpx.AsyncClient, isbn: str | None, title: str | None = None, author: str | None = None) -> dict[str, object]:
        calls.append("open_library")
        return dict(OPEN_LIBRARY_METADATA, isbn=isbn)

    _use_settings(monkeypatch, enable_google_books=True)
    _use_redis(monkeypatch, FakeRedis())
    monkeypatch.setattr("app.services.metadata.service.fetch_google_books_metadata", _google)
    monkeypatch.setattr("app.services.metadata.service.fetch_open_library_metadata", _open_library)

    metadata = asyncio.run(enrich_metadata_with_fallback("9780201485677", title=None, author=None))

    assert metadata is not None
    assert metadata["provider"] == "open_library"
    assert calls == ["google", "open_library"]


def test_cache_hit_skips_external_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    cached_payload = {"title": "Cached Book", "provider": "open_library", "isbn": "9780134494166"}
    fake_redis = FakeRedis({"book-metadata:9780134494166": json.dumps(cached_payload)})

    _use_settings(monkeypatch)
    _use_redis(monkeypatch, fake_redis)
    monkeypatch.setattr("app.services.metadata.service.fetch_google_books_metadata", _fail_if_called)
    monkeypatch.setattr("app.services.metadata.service.fetch_open_library_metadata", _fail_if_called)
    monkeypatch.setattr("app.services.metadata.service.fetch_knihovny_metadata", _fail_if_called)

    metadata = asyncio.run(enrich_metadata_with_fallback("9780134494166", title=None, author=None))

    assert metadata == cached_payload
    assert fake_redis.ttls == {}


def test_definitive_miss_is_negatively_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    async def _open_library_miss(_client: httpx.AsyncClient, _isbn: str | None, title: str | None = None, author: str | None = None) -> None:
        calls.append("open_library")
        return None

    fake_redis = FakeRedis()
    _use_settings(monkeypatch)
    _use_redis(monkeypatch, fake_redis)
    async def _knihovny_miss(_client: httpx.AsyncClient, _isbn: str | None, title: str | None = None, author: str | None = None) -> None:
        calls.append("knihovny")
        return None

    monkeypatch.setattr("app.services.metadata.service.fetch_google_books_metadata", _fail_if_called)
    monkeypatch.setattr("app.services.metadata.service.fetch_open_library_metadata", _open_library_miss)
    monkeypatch.setattr("app.services.metadata.service.fetch_knihovny_metadata", _knihovny_miss)

    first = asyncio.run(enrich_metadata_with_fallback("9799999999999", title=None, author=None))
    second = asyncio.run(enrich_metadata_with_fallback("9799999999999", title=None, author=None))

    assert first is None
    assert second is None
    # The second lookup is served from the negative cache entry.
    assert calls == ["open_library", "knihovny"]
    assert fake_redis.storage["book-metadata:9799999999999"] == "null"
    assert fake_redis.ttls["book-metadata:9799999999999"] == NEGATIVE_CACHE_TTL_SECONDS


def test_provider_error_is_not_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _open_library_down(*_args: object, **_kwargs: object) -> None:
        raise httpx.ConnectError("boom")

    fake_redis = FakeRedis()
    _use_settings(monkeypatch)
    _use_redis(monkeypatch, fake_redis)
    async def _knihovny_miss(_client: httpx.AsyncClient, _isbn: str | None, title: str | None = None, author: str | None = None) -> None:
        return None

    monkeypatch.setattr("app.services.metadata.service.fetch_google_books_metadata", _fail_if_called)
    monkeypatch.setattr("app.services.metadata.service.fetch_open_library_metadata", _open_library_down)
    monkeypatch.setattr("app.services.metadata.service.fetch_knihovny_metadata", _knihovny_miss)

    metadata = asyncio.run(enrich_metadata_with_fallback("9780201485677", title=None, author=None))

    assert metadata is None
    # Transient failures stay retryable — nothing may be written to the cache.
    assert fake_redis.storage == {}


def test_open_library_client_normalizes_response_and_sends_user_agent() -> None:
    seen_user_agents: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_user_agents.append(request.headers["User-Agent"])
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
                    "cover": {"large": "https://covers.openlibrary.org/b/id/8221256-L.jpg"},
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
    # Covers are hotlinked straight from Open Library, never rehosted.
    assert str(metadata["cover_image_url"]).startswith("https://covers.openlibrary.org/")
    assert seen_user_agents == [get_settings().open_library_user_agent]


def test_open_library_title_search_sends_user_agent() -> None:
    seen_user_agents: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/search.json"
        seen_user_agents.append(request.headers["User-Agent"])
        return httpx.Response(
            200,
            json={
                "docs": [
                    {
                        "title": "Clean Code",
                        "author_name": ["Robert C. Martin"],
                        "publisher": ["Prentice Hall"],
                        "first_publish_year": 2008,
                        "language": ["eng"],
                        "cover_i": 12345,
                    }
                ]
            },
        )

    async def _run() -> dict[str, object] | None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await fetch_open_library_metadata(client, None, title="Clean Code", author="Martin")

    metadata = asyncio.run(_run())

    assert metadata is not None
    assert metadata["title"] == "Clean Code"
    assert metadata["cover_image_url"] == "https://covers.openlibrary.org/b/id/12345-L.jpg"
    assert seen_user_agents == [get_settings().open_library_user_agent]


def test_open_library_title_search_returns_edition_isbn_and_description() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/search.json":
            # ISBN must be part of the requested fields, otherwise the search
            # response never contains it.
            assert "isbn" in request.url.params["fields"]
            assert "editions" in request.url.params["fields"]
            return httpx.Response(
                200,
                json={
                    "docs": [
                        {
                            "key": "/works/OL1W",
                            "title": "Malý princ",
                            "author_name": ["Antoine de Saint-Exupéry"],
                            "publisher": ["Gallimard"],
                            "first_publish_year": 1943,
                            "language": ["fre", "cze"],
                            "cover_i": 111,
                            "isbn": ["2070612759", "9782070612758"],
                            "editions": {
                                "numFound": 1,
                                "docs": [
                                    {
                                        "key": "/books/OL1M",
                                        "isbn_13": ["9788000012345"],
                                        "publish_date": "2015",
                                        "publishers": ["Albatros"],
                                        "languages": ["cze"],
                                        "cover_i": 777,
                                    }
                                ],
                            },
                        }
                    ]
                },
            )
        assert request.url.path == "/works/OL1W.json"
        return httpx.Response(
            200,
            json={"description": {"value": "Slavná novela o malém princi."}},
        )

    async def _run() -> dict[str, object] | None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await fetch_open_library_metadata(client, None, title="Malý princ", author="Saint-Exupéry")

    metadata = asyncio.run(_run())

    assert metadata is not None
    # ISBN comes from the best-matching edition, not the mixed work-level list.
    assert metadata["isbn"] == "9788000012345"
    assert metadata["description"] == "Slavná novela o malém princi."
    assert metadata["publisher"] == "Albatros"
    assert metadata["publication_year"] == 2015
    assert metadata["language"] == "cze"
    assert metadata["cover_image_url"] == "https://covers.openlibrary.org/b/id/777-L.jpg"


def test_open_library_title_search_falls_back_to_work_level_isbn13() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/search.json"
        return httpx.Response(
            200,
            json={
                "docs": [
                    {
                        "title": "Clean Code",
                        "author_name": ["Robert C. Martin"],
                        "first_publish_year": 2008,
                        "isbn": ["0132350882", "9780132350884"],
                    }
                ]
            },
        )

    async def _run() -> dict[str, object] | None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await fetch_open_library_metadata(client, None, title="Clean Code", author=None)

    metadata = asyncio.run(_run())

    assert metadata is not None
    assert metadata["isbn"] == "9780132350884"


def test_open_library_isbn_lookup_backfills_description_from_work() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path == "/api/books":
            return httpx.Response(
                200,
                json={
                    "ISBN:9780134494166": {
                        "title": "Clean Architecture",
                        "authors": [{"name": "Robert C. Martin"}],
                        "publish_date": "2017",
                    }
                },
            )
        if request.url.path == "/search.json":
            assert request.url.params["q"] == "isbn:9780134494166"
            return httpx.Response(200, json={"docs": [{"key": "/works/OL2W"}]})
        assert request.url.path == "/works/OL2W.json"
        return httpx.Response(200, json={"description": "Software architecture patterns."})

    async def _run() -> dict[str, object] | None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await fetch_open_library_metadata(client, "9780134494166", title=None, author=None)

    metadata = asyncio.run(_run())

    assert metadata is not None
    assert metadata["isbn"] == "9780134494166"
    assert metadata["description"] == "Software architecture patterns."
    assert calls == ["/api/books", "/search.json", "/works/OL2W.json"]


def test_open_library_description_backfill_failure_keeps_metadata() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/books":
            return httpx.Response(
                200,
                json={"ISBN:9780134494166": {"title": "Clean Architecture", "publish_date": "2017"}},
            )
        # Work resolution is best-effort — a failing works lookup must not
        # break the whole enrichment.
        return httpx.Response(500)

    async def _run() -> dict[str, object] | None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await fetch_open_library_metadata(client, "9780134494166", title=None, author=None)

    metadata = asyncio.run(_run())

    assert metadata is not None
    assert metadata["title"] == "Clean Architecture"
    assert metadata["description"] is None


def test_title_author_lookup_without_isbn_uses_open_library_only(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, object, object]] = []

    async def _open_library(_client: httpx.AsyncClient, isbn: str | None, title: str | None = None, author: str | None = None) -> dict[str, object]:
        calls.append(("open_library", title, author))
        return {"title": "Clean Code", "author": "Martin", "provider": "open_library"}

    async def _knihovny_miss(_client: httpx.AsyncClient, _isbn: str | None, title: str | None = None, author: str | None = None) -> None:
        calls.append(("knihovny", title, author))
        return None

    fake_redis = FakeRedis()
    _use_settings(monkeypatch, enable_google_books=False)
    _use_redis(monkeypatch, fake_redis)
    monkeypatch.setattr("app.services.metadata.service.fetch_google_books_metadata", _fail_if_called)
    monkeypatch.setattr("app.services.metadata.service.fetch_open_library_metadata", _open_library)
    monkeypatch.setattr("app.services.metadata.service.fetch_knihovny_metadata", _knihovny_miss)

    metadata = asyncio.run(enrich_metadata_with_fallback(None, title="Clean Code", author="Martin"))

    assert metadata is not None
    # Open Library first (non-Czech lookup); the incomplete record then
    # triggers a knihovny.cz gap-fill attempt.
    assert calls == [("open_library", "Clean Code", "Martin"), ("knihovny", "Clean Code", "Martin")]
    assert "book-metadata:title:clean code" in fake_redis.storage


def test_looks_czech_detection() -> None:
    assert looks_czech("Válka s mloky") is True
    assert looks_czech(None, "nastávající maminky") is True
    assert looks_czech("9788085126396") is True          # 978-80 = Czech ISBN group
    assert looks_czech("8071360279") is True             # ISBN-10, group 80
    assert looks_czech("Clean Code", "Robert C. Martin") is False
    assert looks_czech("9780132350884") is False
    assert looks_czech(None, None) is False


def test_knihovny_client_normalizes_response_and_picks_matching_record() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/search"
        assert request.url.params["type"] == "Title"
        return httpx.Response(
            200,
            json={
                "resultCount": 2,
                "status": "OK",
                "records": [
                    {
                        # Audiokniha bez ISBN a jiný autor — nesmí vyhrát
                        "title": "Válka s mloky",
                        "authors": {"primary": {"Jiný Autor, 1950-": []}, "secondary": [], "corporate": []},
                        "isbns": [],
                        "publishers": ["Radioservis,"],
                        "publicationDates": ["c2009"],
                        "languages": [],
                        "summary": [],
                    },
                    {
                        "title": "Válka s Mloky",
                        "authors": {"primary": {"Karel Čapek, 1890-1938": []}, "secondary": [], "corporate": []},
                        "isbns": ["978-80-85126-39-6"],
                        "publishers": ["Zoologická zahrada hl. m. Prahy,"],
                        "publicationDates": ["2014"],
                        "languages": [],
                        "summary": ["Slavná antiutopická sci-fi z roku 1936."],
                    },
                ],
            },
        )

    async def _run() -> dict[str, object] | None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await fetch_knihovny_metadata(client, None, title="Válka s mloky", author="Karel Čapek")

    metadata = asyncio.run(_run())

    assert metadata is not None
    assert metadata["provider"] == "knihovny_cz"
    assert metadata["title"] == "Válka s Mloky"
    # Životní data se z VuFind zobrazovací formy odstřihnou
    assert metadata["author"] == "Karel Čapek"
    assert metadata["isbn"] == "9788085126396"
    assert metadata["publisher"] == "Zoologická zahrada hl. m. Prahy"
    assert metadata["publication_year"] == 2014
    assert metadata["description"] == "Slavná antiutopická sci-fi z roku 1936."
    # Obálky knihovny.cz nevrací — doplní je gap-fill z Open Library
    assert metadata["cover_image_url"] is None


def test_knihovny_client_isbn_search_uses_isn_type() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["type"] == "ISN"
        assert request.url.params["lookfor"] == "9788085126396"
        return httpx.Response(200, json={"records": [], "status": "OK"})

    async def _run() -> dict[str, object] | None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await fetch_knihovny_metadata(client, "9788085126396")

    assert asyncio.run(_run()) is None


def test_czech_lookup_prefers_knihovny_and_gap_fills_cover(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    async def _knihovny(_client: httpx.AsyncClient, isbn: str | None, title: str | None = None, author: str | None = None) -> dict[str, object]:
        calls.append("knihovny")
        return {
            "title": "Válka s mloky",
            "author": "Karel Čapek",
            "isbn": "9788085126396",
            "description": "Česká anotace.",
            "cover_image_url": None,
            "provider": "knihovny_cz",
        }

    async def _open_library(_client: httpx.AsyncClient, isbn: str | None, title: str | None = None, author: str | None = None) -> dict[str, object]:
        calls.append("open_library")
        return {
            "title": "War with the Newts",
            "description": None,
            "cover_image_url": "https://covers.openlibrary.org/b/id/1-L.jpg",
            "provider": "open_library",
        }

    _use_settings(monkeypatch, enable_google_books=False)
    _use_redis(monkeypatch, FakeRedis())
    monkeypatch.setattr("app.services.metadata.service.fetch_google_books_metadata", _fail_if_called)
    monkeypatch.setattr("app.services.metadata.service.fetch_open_library_metadata", _open_library)
    monkeypatch.setattr("app.services.metadata.service.fetch_knihovny_metadata", _knihovny)

    metadata = asyncio.run(enrich_metadata_with_fallback(None, title="Válka s mloky", author="Karel Čapek"))

    assert metadata is not None
    # Český dotaz → knihovny.cz první; Open Library jen doplní obálku
    assert calls == ["knihovny", "open_library"]
    assert metadata["provider"] == "knihovny_cz"
    assert metadata["description"] == "Česká anotace."
    assert metadata["cover_image_url"] == "https://covers.openlibrary.org/b/id/1-L.jpg"


def test_non_czech_lookup_falls_back_to_knihovny_on_open_library_miss(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    async def _open_library_miss(_client: httpx.AsyncClient, _isbn: str | None, title: str | None = None, author: str | None = None) -> None:
        calls.append("open_library")
        return None

    async def _knihovny(_client: httpx.AsyncClient, isbn: str | None, title: str | None = None, author: str | None = None) -> dict[str, object]:
        calls.append("knihovny")
        return dict(OPEN_LIBRARY_METADATA, provider="knihovny_cz")

    _use_settings(monkeypatch, enable_google_books=False)
    _use_redis(monkeypatch, FakeRedis())
    monkeypatch.setattr("app.services.metadata.service.fetch_google_books_metadata", _fail_if_called)
    monkeypatch.setattr("app.services.metadata.service.fetch_open_library_metadata", _open_library_miss)
    monkeypatch.setattr("app.services.metadata.service.fetch_knihovny_metadata", _knihovny)

    metadata = asyncio.run(enrich_metadata_with_fallback(None, title="Clean Code", author="Martin"))

    assert metadata is not None
    assert calls == ["open_library", "knihovny"]
    assert metadata["provider"] == "knihovny_cz"


def test_knihovny_disabled_keeps_open_library_only(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _open_library_miss(_client: httpx.AsyncClient, _isbn: str | None, title: str | None = None, author: str | None = None) -> None:
        return None

    _use_settings(monkeypatch, enable_google_books=False, enable_knihovny_cz=False)
    _use_redis(monkeypatch, FakeRedis())
    monkeypatch.setattr("app.services.metadata.service.fetch_google_books_metadata", _fail_if_called)
    monkeypatch.setattr("app.services.metadata.service.fetch_open_library_metadata", _open_library_miss)
    monkeypatch.setattr("app.services.metadata.service.fetch_knihovny_metadata", _fail_if_called)

    metadata = asyncio.run(enrich_metadata_with_fallback(None, title="Válka s mloky", author=None))

    assert metadata is None
