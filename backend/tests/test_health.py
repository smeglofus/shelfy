from collections.abc import AsyncGenerator, AsyncIterator
from typing import Any
from contextlib import asynccontextmanager

from httpx import ASGITransport, AsyncClient
import pytest

from app.api.health import check_database, check_redis
from app.core.config import Settings
from app.db.session import get_db_session
from app.main import app


@pytest.mark.asyncio
async def test_health_returns_ok() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_cors_preflight_allows_configured_origin() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.options(
            "/health",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"



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
    async def _connect() -> AsyncGenerator[_Connection, None]:
        yield _Connection()

    class _Engine:
        def connect(self) -> Any:
            return _connect()

        async def dispose(self) -> None:
            nonlocal disposed
            disposed = True

    monkeypatch.setattr("app.api.health.create_async_engine", lambda *_args, **_kwargs: _Engine())

    test_settings = Settings(database_url="sqlite+aiosqlite://")
    await check_database(test_settings)

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

    test_settings = Settings(redis_url="redis://localhost:6379/0")
    await check_redis(test_settings)

    assert pinged is True
    assert closed is True


@pytest.mark.asyncio
async def test_metrics_endpoint_returns_prometheus_payload() -> None:
    class _FakeResult:
        def scalar_one(self) -> int:
            return 0

    class _FakeSession:
        async def execute(self, _statement: object) -> _FakeResult:
            return _FakeResult()

    async def _override_session() -> AsyncIterator[_FakeSession]:
        yield _FakeSession()

    app.dependency_overrides[get_db_session] = _override_session
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/metrics")
    finally:
        app.dependency_overrides.pop(get_db_session, None)

    assert response.status_code == 200
    assert "http_requests_total" in response.text
    assert "book_processing_jobs_total" in response.text
    assert "external_api_calls_total" in response.text
    assert "external_api_latency_seconds" in response.text


@pytest.mark.asyncio
async def test_request_logging_contains_request_id(capsys: pytest.CaptureFixture[str]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health", headers={"x-request-id": "req-123"})

    assert response.status_code == 200
    captured = capsys.readouterr().out
    assert "\"event\": \"http_request\"" in captured
    assert "\"request_id\": \"req-123\"" in captured
