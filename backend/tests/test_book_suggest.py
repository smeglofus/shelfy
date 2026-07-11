"""Service + API tests for the add-book autocomplete (#308).

Service-level tests exercise ``suggest_books`` directly — the coverage
gate undercounts ASGI-async paths, so the cache/error branches are pinned
here rather than only through the endpoint.
"""
from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
import asyncio
import json
import os
from typing import Any

from httpx import ASGITransport, AsyncClient
import httpx
import pytest
import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.dependencies.redis import get_redis
from app.core.config import Settings, get_settings
from app.core.security import get_password_hash
from app.db.base import Base
from app.db.session import get_db_session
from app.main import app
from app.models.user import User
from app.services.metadata.search import (
    MIN_QUERY_LENGTH,
    SUGGEST_CACHE_TTL_SECONDS,
    search_open_library_books,
    suggest_books,
)

# ── Service-level tests ────────────────────────────────────────────────────────


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


DUNE_DOC = {
    "title": "Dune",
    "author_name": ["Frank Herbert"],
    "isbn": ["0441172717", "9780441172719"],
    "publisher": ["Ace Books"],
    "first_publish_year": 1965,
    "language": ["eng"],
    "cover_i": 11481354,
}


def test_search_open_library_books_normalizes_docs_and_sends_user_agent() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"docs": [DUNE_DOC, {"title": ""}, {"no_title": True}]})

    async def _run() -> list[dict[str, Any]]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await search_open_library_books(client, "dune", 8)

    suggestions = asyncio.run(_run())

    assert len(seen) == 1
    assert seen[0].url.path == "/search.json"
    assert seen[0].url.params["q"] == "dune"
    assert seen[0].url.params["limit"] == "8"
    assert seen[0].headers["User-Agent"] == get_settings().open_library_user_agent

    # Docs without a usable title are dropped.
    assert len(suggestions) == 1
    dune = suggestions[0]
    assert dune["title"] == "Dune"
    assert dune["author"] == "Frank Herbert"
    # ISBN-13 preferred over ISBN-10.
    assert dune["isbn"] == "9780441172719"
    assert dune["publication_year"] == 1965
    assert dune["cover_image_url"] == "https://covers.openlibrary.org/b/id/11481354-L.jpg"
    assert dune["provider"] == "open_library"


def test_suggest_books_short_query_skips_external_call(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fail(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("external search must not run for short queries")

    monkeypatch.setattr("app.services.metadata.search.search_open_library_books", _fail)
    fake_redis = FakeRedis()

    short = "d" * (MIN_QUERY_LENGTH - 1)
    assert asyncio.run(suggest_books(short, 8, fake_redis)) == []  # type: ignore[arg-type]
    assert asyncio.run(suggest_books("   ", 8, fake_redis)) == []  # type: ignore[arg-type]
    assert fake_redis.storage == {}


def test_suggest_books_caches_results_per_query(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    async def _search(_client: httpx.AsyncClient, query: str, _limit: int) -> list[dict[str, Any]]:
        calls.append(query)
        return [{"title": "Dune", "provider": "open_library"}]

    monkeypatch.setattr("app.services.metadata.search.search_open_library_books", _search)
    fake_redis = FakeRedis()

    first = asyncio.run(suggest_books("Dune ", 8, fake_redis))  # type: ignore[arg-type]
    second = asyncio.run(suggest_books("dune", 8, fake_redis))  # type: ignore[arg-type]

    assert first == second == [{"title": "Dune", "provider": "open_library"}]
    # Second lookup is a cache hit — the normalized key ignores case/whitespace.
    assert calls == ["Dune"]
    assert fake_redis.ttls["book-suggest:8:dune"] == SUGGEST_CACHE_TTL_SECONDS


def test_suggest_books_provider_error_returns_empty_and_is_not_cached(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _down(*_args: object, **_kwargs: object) -> None:
        raise httpx.ConnectError("boom")

    monkeypatch.setattr("app.services.metadata.search.search_open_library_books", _down)
    fake_redis = FakeRedis()

    assert asyncio.run(suggest_books("dune", 8, fake_redis)) == []  # type: ignore[arg-type]
    assert fake_redis.storage == {}


def test_suggest_books_empty_result_is_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    async def _search(_client: httpx.AsyncClient, query: str, _limit: int) -> list[dict[str, Any]]:
        calls.append(query)
        return []

    monkeypatch.setattr("app.services.metadata.search.search_open_library_books", _search)
    fake_redis = FakeRedis()

    assert asyncio.run(suggest_books("neznama kniha", 8, fake_redis)) == []  # type: ignore[arg-type]
    assert asyncio.run(suggest_books("neznama kniha", 8, fake_redis)) == []  # type: ignore[arg-type]
    assert calls == ["neznama kniha"]
    assert fake_redis.storage["book-suggest:8:neznama kniha"] == json.dumps([])


# ── API tests ─────────────────────────────────────────────────────────────────
# DB fixture pattern mirrors tests/test_books.py (SQLite fallback locally,
# Postgres via TEST_DATABASE_URL in CI).


def _require_test_database_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///./test_suggest.db")


@pytest.fixture
async def test_session() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(_require_test_database_url())
    async with engine.begin() as connection:
        await connection.run_sync(
            lambda sync_conn: sa.Enum(
                "manual", "pending", "done", "failed", "partial",
                name="book_processing_status",
            ).create(sync_conn, checkfirst=True)  # type: ignore[no-untyped-call]
        )
        await connection.run_sync(
            lambda sync_conn: sa.Enum(
                "unread", "reading", "read", "lent",
                name="reading_status",
            ).create(sync_conn, checkfirst=True)  # type: ignore[no-untyped-call]
        )
        await connection.run_sync(
            lambda sync_conn: sa.Enum(
                "owner", "editor", "viewer",
                name="library_role",
            ).create(sync_conn, checkfirst=True)  # type: ignore[no-untyped-call]
        )
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    yield session_factory

    await engine.dispose()


@pytest.fixture
def test_settings() -> Settings:
    return Settings(
        database_url=_require_test_database_url(),
        jwt_secret_key="test-secret",
    )


@pytest.fixture
def fake_redis() -> FakeRedis:
    return FakeRedis()


@pytest.fixture(autouse=True)
def override_dependencies(
    test_session: async_sessionmaker[AsyncSession],
    test_settings: Settings,
    fake_redis: FakeRedis,
) -> Iterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        async with test_session() as session:
            yield session

    async def _get_redis() -> AsyncIterator[FakeRedis]:
        yield fake_redis

    app.dependency_overrides[get_db_session] = _get_db
    app.dependency_overrides[get_settings] = lambda: test_settings
    app.dependency_overrides[get_redis] = _get_redis
    yield
    app.dependency_overrides.clear()


async def _auth_headers(client: AsyncClient, session: AsyncSession) -> dict[str, str]:
    existing = (
        await session.execute(select(User).where(User.email == "admin@example.com"))
    ).scalar_one_or_none()
    if existing is None:
        session.add(User(email="admin@example.com", hashed_password=get_password_hash("secret")))
        await session.commit()
    login_response = await client.post(
        "/api/v1/auth/login", json={"email": "admin@example.com", "password": "secret"}
    )
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_suggest_endpoint_requires_auth() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/books/suggest", params={"q": "dune"})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_suggest_endpoint_returns_candidates(
    monkeypatch: pytest.MonkeyPatch,
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async def _search(_client: httpx.AsyncClient, query: str, limit: int) -> list[dict[str, Any]]:
        assert query == "dune"
        assert limit == 8
        return [
            {
                "title": "Dune",
                "author": "Frank Herbert",
                "isbn": "9780441172719",
                "publisher": "Ace Books",
                "language": "eng",
                "publication_year": 1965,
                "cover_image_url": "https://covers.openlibrary.org/b/id/11481354-L.jpg",
                "provider": "open_library",
            }
        ]

    monkeypatch.setattr("app.services.metadata.search.search_open_library_books", _search)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)
        response = await client.get(
            "/api/v1/books/suggest", params={"q": "dune"}, headers=headers
        )

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["title"] == "Dune"
    assert body[0]["isbn"] == "9780441172719"
    assert body[0]["provider"] == "open_library"


@pytest.mark.asyncio
async def test_suggest_endpoint_short_query_returns_empty_without_external_call(
    monkeypatch: pytest.MonkeyPatch,
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async def _fail(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("external search must not run for short queries")

    monkeypatch.setattr("app.services.metadata.search.search_open_library_books", _fail)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)
        response = await client.get(
            "/api/v1/books/suggest", params={"q": "du"}, headers=headers
        )

    assert response.status_code == 200
    assert response.json() == []
