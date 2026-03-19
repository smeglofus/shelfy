from __future__ import annotations

from types import SimpleNamespace, TracebackType
from typing import Any

import pytest

from app.cli import seed_admin


@pytest.mark.asyncio
async def test_seed_admin_cli_exits_with_help_when_env_missing(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    monkeypatch.setattr(seed_admin, "get_settings", lambda: SimpleNamespace(admin_email=None, admin_password=None))

    with pytest.raises(SystemExit) as exc:
        await seed_admin.main()

    assert exc.value.code == 1
    captured = capsys.readouterr()
    assert "ADMIN_EMAIL and ADMIN_PASSWORD" in captured.out


@pytest.mark.asyncio
async def test_seed_admin_cli_calls_seed_and_logs(monkeypatch: pytest.MonkeyPatch) -> None:
    class DummySession:
        async def __aenter__(self) -> "DummySession":
            return self

        async def __aexit__(
            self,
            exc_type: type[BaseException] | None,
            exc: BaseException | None,
            tb: TracebackType | None,
        ) -> None:
            return None

    monkeypatch.setattr(
        seed_admin,
        "get_settings",
        lambda: SimpleNamespace(admin_email="admin@example.com", admin_password="secret"),
    )
    monkeypatch.setattr(seed_admin, "SessionLocal", lambda: DummySession())

    called: dict[str, object] = {}

    async def fake_seed(session: Any, email: str, password: str) -> bool:
        called["email"] = email
        called["password"] = password
        return True

    monkeypatch.setattr(seed_admin, "seed_admin_user", fake_seed)

    await seed_admin.main()

    assert called == {"email": "admin@example.com", "password": "secret"}
