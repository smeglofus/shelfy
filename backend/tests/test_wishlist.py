"""Wishlist tests (#309): CRUD, role gating, cross-library isolation,
owner-only toggle, and the disabled-wishlist guard.

Service-level tests run next to the API tests because the coverage gate
undercounts ASGI-async paths (see AGENTS.md notes). Isolation follows the
Test-DB contract: the "foreign" library is a real ``Library`` row (real
``created_by_user_id``) — the caller just has no ``LibraryMember`` there.
"""
from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
import os
import uuid

from httpx import ASGITransport, AsyncClient
from fastapi import HTTPException
import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings, get_settings
from app.core.security import get_password_hash
from app.db.base import Base
from app.db.session import get_db_session
from app.main import app
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.user import User
from app.schemas.wishlist import WishlistItemCreateRequest
from app.services.wishlist import (
    assert_wishlist_enabled,
    create_wishlist_item,
    delete_wishlist_item,
    list_wishlist_items,
    set_wishlist_enabled,
)


def _require_test_database_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///./test_wishlist.db")


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


@pytest.fixture(autouse=True)
def override_dependencies(
    test_session: async_sessionmaker[AsyncSession], test_settings: Settings
) -> Iterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        async with test_session() as session:
            yield session

    app.dependency_overrides[get_db_session] = _get_db
    app.dependency_overrides[get_settings] = lambda: test_settings
    yield
    app.dependency_overrides.clear()


async def _create_user(session: AsyncSession, email: str, password: str = "secret") -> User:
    user = User(email=email, hashed_password=get_password_hash(password))
    session.add(user)
    await session.flush()
    await session.refresh(user)
    return user


async def _create_library(
    session: AsyncSession, owner: User, name: str = "My Library"
) -> Library:
    lib = Library(name=name, created_by_user_id=owner.id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=owner.id, role=LibraryRole.OWNER))
    await session.commit()
    await session.refresh(lib)
    return lib


async def _add_member(
    session: AsyncSession, library: Library, user: User, role: LibraryRole
) -> None:
    session.add(LibraryMember(library_id=library.id, user_id=user.id, role=role))
    await session.commit()


async def _login(client: AsyncClient, email: str, password: str = "secret") -> dict[str, str]:
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    # Clear cookies so the last login's cookie doesn't shadow earlier users'
    # Bearer tokens (the auth dependency prefers cookie over the header) —
    # same pattern as tests/test_isolation.py.
    client.cookies.clear()
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# ── Service-level tests ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_service_create_list_delete_roundtrip(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with test_session() as session:
        owner = await _create_user(session, "owner@example.com")
        lib = await _create_library(session, owner)

        item = await create_wishlist_item(
            session,
            WishlistItemCreateRequest(
                title="Duna",
                author="Frank Herbert",
                isbn="9780441172719",
                note="Doporučila Alice",
                cover_image_url="https://covers.openlibrary.org/b/id/11481354-L.jpg",
                publication_year=1965,
            ),
            lib.id,
            actor_user_id=owner.id,
        )
        assert item.created_by_user_id == owner.id

        items, total = await list_wishlist_items(session, lib.id, page=1, page_size=20)
        assert total == 1
        assert items[0].title == "Duna"

        await delete_wishlist_item(session, item.id, lib.id)
        _, total = await list_wishlist_items(session, lib.id, page=1, page_size=20)
        assert total == 0


@pytest.mark.asyncio
async def test_service_delete_is_library_scoped(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """A wish in another library is invisible — delete raises 404, row survives."""
    async with test_session() as session:
        owner_a = await _create_user(session, "a@example.com")
        owner_b = await _create_user(session, "b@example.com")
        lib_a = await _create_library(session, owner_a, "Library A")
        lib_b = await _create_library(session, owner_b, "Library B")

        foreign_item = await create_wishlist_item(
            session,
            WishlistItemCreateRequest(title="Cizí přání"),
            lib_b.id,
            actor_user_id=owner_b.id,
        )

        with pytest.raises(HTTPException) as exc:
            await delete_wishlist_item(session, foreign_item.id, lib_a.id)
        assert exc.value.status_code == 404

        _, total_b = await list_wishlist_items(session, lib_b.id, page=1, page_size=20)
        assert total_b == 1


@pytest.mark.asyncio
async def test_service_toggle_and_guard(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with test_session() as session:
        owner = await _create_user(session, "owner@example.com")
        lib = await _create_library(session, owner)

        # Default ON (server_default=true) — the guard passes.
        assert lib.wishlist_enabled is True
        await assert_wishlist_enabled(session, lib.id)

        library = await set_wishlist_enabled(session, lib.id, False)
        assert library.wishlist_enabled is False
        with pytest.raises(HTTPException) as exc:
            await assert_wishlist_enabled(session, lib.id)
        assert exc.value.status_code == 403

        library = await set_wishlist_enabled(session, lib.id, True)
        assert library.wishlist_enabled is True

        with pytest.raises(HTTPException) as missing:
            await set_wishlist_enabled(session, uuid.uuid4(), True)
        assert missing.value.status_code == 404


# ── API tests ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_editor_creates_and_deletes_wish_viewer_reads(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with test_session() as session:
        owner = await _create_user(session, "owner@example.com")
        editor = await _create_user(session, "editor@example.com")
        viewer = await _create_user(session, "viewer@example.com")
        lib = await _create_library(session, owner)
        await _add_member(session, lib, editor, LibraryRole.EDITOR)
        await _add_member(session, lib, viewer, LibraryRole.VIEWER)

    async with _client() as client:
        editor_headers = await _login(client, "editor@example.com")
        viewer_headers = await _login(client, "viewer@example.com")
        lib_header = {"X-Library-Id": str(lib.id)}

        created = await client.post(
            "/api/v1/wishlist",
            json={"title": "Duna", "author": "Frank Herbert"},
            headers={**editor_headers, **lib_header},
        )
        assert created.status_code == 201
        item_id = created.json()["id"]

        listed = await client.get(
            "/api/v1/wishlist", headers={**viewer_headers, **lib_header}
        )
        assert listed.status_code == 200
        body = listed.json()
        assert body["total"] == 1
        assert body["items"][0]["title"] == "Duna"

        deleted = await client.delete(
            f"/api/v1/wishlist/{item_id}", headers={**editor_headers, **lib_header}
        )
        assert deleted.status_code == 204

        relisted = await client.get(
            "/api/v1/wishlist", headers={**viewer_headers, **lib_header}
        )
        assert relisted.json()["total"] == 0


@pytest.mark.asyncio
async def test_viewer_cannot_write_wishlist(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with test_session() as session:
        owner = await _create_user(session, "owner@example.com")
        viewer = await _create_user(session, "viewer@example.com")
        lib = await _create_library(session, owner)
        await _add_member(session, lib, viewer, LibraryRole.VIEWER)
        item = await create_wishlist_item(
            session, WishlistItemCreateRequest(title="Duna"), lib.id, actor_user_id=owner.id
        )

    async with _client() as client:
        viewer_headers = await _login(client, "viewer@example.com")
        lib_header = {"X-Library-Id": str(lib.id)}

        created = await client.post(
            "/api/v1/wishlist",
            json={"title": "Nadace"},
            headers={**viewer_headers, **lib_header},
        )
        assert created.status_code == 403

        deleted = await client.delete(
            f"/api/v1/wishlist/{item.id}", headers={**viewer_headers, **lib_header}
        )
        assert deleted.status_code == 403


@pytest.mark.asyncio
async def test_wishlist_isolated_between_libraries(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Real foreign Library row, no LibraryMember for the caller (Test-DB contract)."""
    async with test_session() as session:
        owner = await _create_user(session, "owner@example.com")
        stranger = await _create_user(session, "stranger@example.com")
        lib = await _create_library(session, owner, "Mine")
        foreign_lib = await _create_library(session, stranger, "Foreign")
        await create_wishlist_item(
            session, WishlistItemCreateRequest(title="Cizí přání"), foreign_lib.id,
            actor_user_id=stranger.id,
        )

    async with _client() as client:
        headers = await _login(client, "owner@example.com")

        # Own library: empty.
        mine = await client.get(
            "/api/v1/wishlist", headers={**headers, "X-Library-Id": str(lib.id)}
        )
        assert mine.status_code == 200
        assert mine.json()["total"] == 0

        # Foreign library: 403 from the membership dependency.
        foreign = await client.get(
            "/api/v1/wishlist", headers={**headers, "X-Library-Id": str(foreign_lib.id)}
        )
        assert foreign.status_code == 403


@pytest.mark.asyncio
async def test_only_owner_toggles_wishlist_and_disabled_blocks_api(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with test_session() as session:
        owner = await _create_user(session, "owner@example.com")
        editor = await _create_user(session, "editor@example.com")
        lib = await _create_library(session, owner)
        await _add_member(session, lib, editor, LibraryRole.EDITOR)

    async with _client() as client:
        owner_headers = await _login(client, "owner@example.com")
        editor_headers = await _login(client, "editor@example.com")
        lib_header = {"X-Library-Id": str(lib.id)}

        # Non-owner cannot flip the toggle.
        forbidden = await client.patch(
            f"/api/v1/libraries/{lib.id}",
            json={"wishlist_enabled": False},
            headers=editor_headers,
        )
        assert forbidden.status_code == 403

        # Owner disables → payload reflects it and the wishlist API locks.
        disabled = await client.patch(
            f"/api/v1/libraries/{lib.id}",
            json={"wishlist_enabled": False},
            headers=owner_headers,
        )
        assert disabled.status_code == 200
        assert disabled.json()["wishlist_enabled"] is False

        blocked = await client.get(
            "/api/v1/wishlist", headers={**owner_headers, **lib_header}
        )
        assert blocked.status_code == 403

        blocked_post = await client.post(
            "/api/v1/wishlist",
            json={"title": "Duna"},
            headers={**owner_headers, **lib_header},
        )
        assert blocked_post.status_code == 403

        # Libraries payload carries the flag for the frontend nav.
        libraries = await client.get("/api/v1/libraries", headers=owner_headers)
        assert libraries.status_code == 200
        assert libraries.json()[0]["wishlist_enabled"] is False

        # Owner re-enables → wishlist works again.
        enabled = await client.patch(
            f"/api/v1/libraries/{lib.id}",
            json={"wishlist_enabled": True},
            headers=owner_headers,
        )
        assert enabled.status_code == 200
        assert enabled.json()["wishlist_enabled"] is True

        ok = await client.get("/api/v1/wishlist", headers={**owner_headers, **lib_header})
        assert ok.status_code == 200
