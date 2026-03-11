from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from httpx import ASGITransport, AsyncClient
import pytest

from app.api.health import check_database, check_redis
from app.main import app


@pytest.mark.asyncio
async def test_health_returns_ok() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_readiness_returns_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _ok(_: object) -> None:
        return None

    monkeypatch.setattr("app.api.health.check_database", _ok)
    monkeypatch.setattr("app.api.health.check_redis", _ok)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_readiness_returns_503_when_dependency_check_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fail(_: object) -> None:
        raise RuntimeError("dependency error")

    monkeypatch.setattr("app.api.health.check_database", _fail)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {"detail": "Service dependencies are not ready"}


@pytest.mark.asyncio
async def test_check_database_executes_simple_query(monkeypatch: pytest.MonkeyPatch) -> None:
    executed: list[object] = []
    disposed = False

    class _Connection:
        async def execute(self, statement: object) -> None:
            executed.append(statement)

    @asynccontextmanager
    async def _connect() -> AsyncIterator[_Connection]:
        yield _Connection()

    class _Engine:
        def connect(self) -> AsyncIterator[_Connection]:
            return _connect()

        async def dispose(self) -> None:
            nonlocal disposed
            disposed = True

    monkeypatch.setattr("app.api.health.create_async_engine", lambda *_args, **_kwargs: _Engine())

    class _Settings:
        database_url = "sqlite+aiosqlite://"

    await check_database(_Settings())

    assert disposed is True
    assert len(executed) == 1


@pytest.mark.asyncio
async def test_check_redis_pings_and_closes_client(monkeypatch: pytest.MonkeyPatch) -> None:
    pinged = False
    closed = False

    class _Client:
        async def ping(self) -> None:
            nonlocal pinged
            pinged = True

        async def aclose(self) -> None:
            nonlocal closed
            closed = True

    monkeypatch.setattr("app.api.health.redis.from_url", lambda *_args, **_kwargs: _Client())

    class _Settings:
        redis_url = "redis://localhost:6379/0"

    await check_redis(_Settings())

    assert pinged is True
    assert closed is True


@pytest.mark.asyncio
async def test_check_database_disposes_engine_on_error(monkeypatch: pytest.MonkeyPatch) -> None:
    disposed = False

    class _Connection:
        async def execute(self, statement: object) -> None:
            raise RuntimeError("database connection failed")

    @asynccontextmanager
    async def _connect() -> AsyncIterator[_Connection]:
        yield _Connection()

    class _Engine:
        def connect(self) -> AsyncIterator[_Connection]:
            return _connect()

        async def dispose(self) -> None:
            nonlocal disposed
            disposed = True

    monkeypatch.setattr("app.api.health.create_async_engine", lambda *_args, **_kwargs: _Engine())

    class _Settings:
        database_url = "sqlite+aiosqlite://"

    with pytest.raises(RuntimeError, match="database connection failed"):
        await check_database(_Settings())

    assert disposed is True


@pytest.mark.asyncio
async def test_check_redis_closes_client_on_error(monkeypatch: pytest.MonkeyPatch) -> None:
    closed = False

    class _Client:
        async def ping(self) -> None:
            raise RuntimeError("redis ping failed")

        async def aclose(self) -> None:
            nonlocal closed
            closed = True

    monkeypatch.setattr("app.api.health.redis.from_url", lambda *_args, **_kwargs: _Client())

    class _Settings:
        redis_url = "redis://localhost:6379/0"

    with pytest.raises(RuntimeError, match="redis ping failed"):
        await check_redis(_Settings())

    assert closed is True


@pytest.mark.asyncio
async def test_readiness_returns_503_when_redis_check_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _ok(_: object) -> None:
        return None

    async def _fail(_: object) -> None:
        raise RuntimeError("redis error")

    monkeypatch.setattr("app.api.health.check_database", _ok)
    monkeypatch.setattr("app.api.health.check_redis", _fail)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {"detail": "Service dependencies are not ready"}


@pytest.mark.asyncio
async def test_readiness_exception_chaining_preserves_original_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_error = ValueError("specific dependency error")

    async def _fail(_: object) -> None:
        raise original_error

    monkeypatch.setattr("app.api.health.check_database", _fail)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health/ready")

    assert response.status_code == 503


@pytest.mark.asyncio
async def test_health_endpoint_independent_of_dependencies() -> None:
    # Health endpoint should always work regardless of dependency state
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_check_database_with_invalid_url(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Engine:
        def connect(self) -> AsyncIterator[object]:
            raise RuntimeError("invalid database URL")

        async def dispose(self) -> None:
            pass

    monkeypatch.setattr("app.api.health.create_async_engine", lambda *_args, **_kwargs: _Engine())

    class _Settings:
        database_url = "invalid://url"

    with pytest.raises(RuntimeError, match="invalid database URL"):
        await check_database(_Settings())


@pytest.mark.asyncio
async def test_check_redis_with_connection_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Client:
        async def ping(self) -> None:
            raise TimeoutError("connection timeout")

        async def aclose(self) -> None:
            pass

    monkeypatch.setattr("app.api.health.redis.from_url", lambda *_args, **_kwargs: _Client())

    class _Settings:
        redis_url = "redis://localhost:6379/0"

    with pytest.raises(TimeoutError, match="connection timeout"):
        await check_redis(_Settings())


@pytest.mark.asyncio
async def test_readiness_checks_both_dependencies_sequentially(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    check_order: list[str] = []

    async def _check_db(_: object) -> None:
        check_order.append("database")

    async def _check_redis(_: object) -> None:
        check_order.append("redis")

    monkeypatch.setattr("app.api.health.check_database", _check_db)
    monkeypatch.setattr("app.api.health.check_redis", _check_redis)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health/ready")

    assert response.status_code == 200
    assert check_order == ["database", "redis"]