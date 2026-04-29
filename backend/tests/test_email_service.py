"""Service-level tests for app/services/email.py.

The test environment has no RESEND_API_KEY configured, so _send() returns
after the first guard-check at line 40 (no network call is made).

send_welcome() is already covered by the registration flow in
test_auth_service.py (register_user → api/auth POST /register →
send_welcome).  This file covers the three remaining email templates whose
function bodies are otherwise unreachable in any current test.

Two additional tests mock httpx.AsyncClient to cover the actual HTTP dispatch
path inside _send() (lines 46-65) which only executes when RESEND_API_KEY is
set.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pytest import LogCaptureFixture

from app.services.email import (
    _send,
    normalize_locale,
    send_limit_approaching,
    send_password_reset,
    send_welcome,
    send_trial_ending,
)


@pytest.mark.asyncio
async def test_send_trial_ending_one_day_remaining() -> None:
    """Urgent variant (1 day left): subject contains 'tomorrow', no exception raised."""
    # _send() no-ops when RESEND_API_KEY is absent; this exercises lines 127-148.
    await send_trial_ending("user@example.com", "Alice", 1)


@pytest.mark.asyncio
async def test_send_trial_ending_multiple_days() -> None:
    """Non-urgent variant (>1 day): subject interpolates day count."""
    await send_trial_ending("user@example.com", "Alice", 4)


@pytest.mark.asyncio
async def test_send_limit_approaching() -> None:
    """Quota-approaching email: verifies the call chain runs without error (lines 159-176)."""
    await send_limit_approaching(
        "user@example.com",
        name="Bob",
        metric="enrichments",
        used=16,
        limit=20,
    )


@pytest.mark.asyncio
async def test_send_password_reset() -> None:
    """Password-reset email: verifies lines 185-200 execute without error."""
    await send_password_reset(
        "user@example.com",
        reset_url="https://shelfy.app/reset/abc123token",
    )


def _make_resend_client_mocks(
    *, raise_for_status_side_effect: Exception | None = None,
) -> tuple[AsyncMock, MagicMock, MagicMock]:
    """Build a (client, response, context-manager) trio for httpx.AsyncClient patching."""
    response = MagicMock(status_code=202)
    if raise_for_status_side_effect is not None:
        response.raise_for_status = MagicMock(side_effect=raise_for_status_side_effect)
    else:
        response.raise_for_status = MagicMock()

    client = AsyncMock()
    client.post.return_value = response

    client_context = MagicMock()
    client_context.__aenter__ = AsyncMock(return_value=client)
    client_context.__aexit__ = AsyncMock(return_value=None)
    return client, response, client_context


def test_normalize_locale_defaults_to_english() -> None:
    assert normalize_locale(None) == "en"
    assert normalize_locale("en-US") == "en"
    assert normalize_locale("cs-CZ") == "cs"
    assert normalize_locale("de-DE") == "en"


@pytest.mark.asyncio
async def test_send_password_reset_renders_czech_copy() -> None:
    send_mock = AsyncMock()

    with patch("app.services.email._send", send_mock):
        await send_password_reset(
            "user@example.com",
            reset_url="https://shelfy.cz/reset-password?token=abc123",
            locale="cs-CZ",
        )

    assert send_mock.await_args is not None
    kwargs = send_mock.await_args.kwargs
    assert kwargs["subject"] == "Reset hesla do Shelfy"
    assert 'html lang="cs"' in kwargs["html"]
    assert "Resetovat heslo" in kwargs["html"]
    assert "https://shelfy.cz/reset-password?token=abc123" in kwargs["html"]


@pytest.mark.asyncio
async def test_send_password_reset_falls_back_to_english_copy() -> None:
    send_mock = AsyncMock()

    with patch("app.services.email._send", send_mock):
        await send_password_reset(
            "user@example.com",
            reset_url="https://shelfy.cz/reset-password?token=abc123",
            locale="de-DE",
        )

    assert send_mock.await_args is not None
    kwargs = send_mock.await_args.kwargs
    assert kwargs["subject"] == "Reset your Shelfy password"
    assert 'html lang="en"' in kwargs["html"]
    assert "Reset my password" in kwargs["html"]


@pytest.mark.asyncio
async def test_send_welcome_renders_czech_copy() -> None:
    send_mock = AsyncMock()

    with patch("app.services.email._send", send_mock):
        await send_welcome("user@example.com", "Alice", locale="cs")

    assert send_mock.await_args is not None
    kwargs = send_mock.await_args.kwargs
    assert kwargs["subject"] == "Vítej v Shelfy 📚"
    assert "Ahoj Alice" in kwargs["html"]
    assert "Otevřít Shelfy" in kwargs["html"]


@pytest.mark.asyncio
async def test_send_posts_to_resend_with_branded_sender_and_reply_to() -> None:
    """Configured RESEND_API_KEY: payload includes shelfy.cz sender + reply_to."""
    from app.core.config import Settings

    settings = Settings(
        resend_api_key="re_test_key",
        email_from_address="Shelfy <noreply@shelfy.cz>",
        email_reply_to_address="support@shelfy.cz",
    )
    client, response, client_context = _make_resend_client_mocks()

    with (
        patch("app.services.email.get_settings", return_value=settings),
        patch("app.services.email.httpx.AsyncClient", return_value=client_context),
    ):
        await _send(to="user@example.com", subject="Hello", html="<p>Hi</p>")

    client.post.assert_awaited_once_with(
        "https://api.resend.com/emails",
        headers={
            "Authorization": "Bearer re_test_key",
            "Content-Type": "application/json",
        },
        json={
            "from": "Shelfy <noreply@shelfy.cz>",
            "to": ["user@example.com"],
            "subject": "Hello",
            "html": "<p>Hi</p>",
            "reply_to": "support@shelfy.cz",
        },
    )
    response.raise_for_status.assert_called_once_with()


@pytest.mark.asyncio
async def test_send_omits_reply_to_when_unset() -> None:
    """email_reply_to_address=None → no reply_to key in the JSON payload."""
    from app.core.config import Settings

    settings = Settings(
        resend_api_key="re_test_key",
        email_from_address="Shelfy <noreply@shelfy.cz>",
        email_reply_to_address=None,
    )
    client, _, client_context = _make_resend_client_mocks()

    with (
        patch("app.services.email.get_settings", return_value=settings),
        patch("app.services.email.httpx.AsyncClient", return_value=client_context),
    ):
        await _send(to="user@example.com", subject="Hi", html="<p>Hi</p>")

    posted = client.post.await_args.kwargs["json"]
    assert "reply_to" not in posted
    assert posted["from"] == "Shelfy <noreply@shelfy.cz>"


@pytest.mark.asyncio
async def test_send_password_reset_uses_branded_sender_and_reply_to() -> None:
    """End-to-end: send_password_reset → _send → Resend payload carries shelfy.cz From + Reply-To."""
    from app.core.config import Settings

    settings = Settings(
        resend_api_key="re_test_key",
        email_from_address="Shelfy <noreply@shelfy.cz>",
        email_reply_to_address="support@shelfy.cz",
    )
    client, _, client_context = _make_resend_client_mocks()

    with (
        patch("app.services.email.get_settings", return_value=settings),
        patch("app.services.email.httpx.AsyncClient", return_value=client_context),
    ):
        await send_password_reset(
            "user@example.com",
            reset_url="https://shelfy.cz/reset/abc123token",
        )

    posted = client.post.await_args.kwargs["json"]
    assert posted["from"] == "Shelfy <noreply@shelfy.cz>"
    assert posted["reply_to"] == "support@shelfy.cz"
    assert posted["to"] == ["user@example.com"]
    assert "Reset your Shelfy password" in posted["subject"]
    # Reset URL is rendered into the HTML so the user can click through.
    assert "https://shelfy.cz/reset/abc123token" in posted["html"]


@pytest.mark.asyncio
async def test_send_does_not_log_authorization_header_on_failure(caplog: LogCaptureFixture) -> None:
    """When Resend fails, the warning log carries to/subject/error — never the API key.

    Defence-in-depth: a regression that started logging request headers would
    leak the bearer token.  We assert the secret never appears anywhere in the
    captured log records.
    """
    from app.core.config import Settings

    secret = "re_super_secret_key_ABC123"
    settings = Settings(resend_api_key=secret, email_from_address="Shelfy <noreply@shelfy.cz>")
    _, _, client_context = _make_resend_client_mocks(
        raise_for_status_side_effect=RuntimeError("resend down"),
    )

    import logging
    with (
        patch("app.services.email.get_settings", return_value=settings),
        patch("app.services.email.httpx.AsyncClient", return_value=client_context),
        caplog.at_level(logging.WARNING, logger="app.services.email"),
    ):
        await _send(to="user@example.com", subject="Boom", html="<p>Hi</p>")

    # Error path was taken (logged a warning) and the API key never appeared.
    assert any("email.failed" in rec.getMessage() for rec in caplog.records)
    for rec in caplog.records:
        assert secret not in rec.getMessage()
        # Also check structured fields — extra={...} attributes get attached as record attrs.
        assert secret not in str(rec.__dict__)


@pytest.mark.asyncio
async def test_send_swallows_resend_errors() -> None:
    """Resend/client errors are logged and swallowed so request paths do not crash."""
    from app.core.config import Settings

    settings = Settings(resend_api_key="re_test_key")
    _, response, client_context = _make_resend_client_mocks(
        raise_for_status_side_effect=RuntimeError("resend down"),
    )

    with (
        patch("app.services.email.get_settings", return_value=settings),
        patch("app.services.email.httpx.AsyncClient", return_value=client_context),
    ):
        await _send(to="user@example.com", subject="Boom", html="<p>Hi</p>")

    response.raise_for_status.assert_called_once_with()
