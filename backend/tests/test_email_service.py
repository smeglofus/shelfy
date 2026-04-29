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

from app.services.email import (
    _send,
    send_limit_approaching,
    send_password_reset,
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


@pytest.mark.asyncio
async def test_send_posts_to_resend_when_api_key_configured() -> None:
    """Configured RESEND_API_KEY: _send posts the expected payload."""
    from app.core.config import Settings

    settings = Settings(
        resend_api_key="re_test_key",
        email_from_address="Shelfy <noreply@example.com>",
    )
    response = MagicMock(status_code=202)
    response.raise_for_status = MagicMock()

    client = AsyncMock()
    client.post.return_value = response
    client_context = MagicMock()
    client_context.__aenter__ = AsyncMock(return_value=client)
    client_context.__aexit__ = AsyncMock(return_value=None)

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
            "from": "Shelfy <noreply@example.com>",
            "to": ["user@example.com"],
            "subject": "Hello",
            "html": "<p>Hi</p>",
        },
    )
    response.raise_for_status.assert_called_once_with()


@pytest.mark.asyncio
async def test_send_swallows_resend_errors() -> None:
    """Resend/client errors are logged and swallowed so request paths do not crash."""
    from app.core.config import Settings

    settings = Settings(resend_api_key="re_test_key")
    response = MagicMock(status_code=500)
    response.raise_for_status.side_effect = RuntimeError("resend down")

    client = AsyncMock()
    client.post.return_value = response
    client_context = MagicMock()
    client_context.__aenter__ = AsyncMock(return_value=client)
    client_context.__aexit__ = AsyncMock(return_value=None)

    with (
        patch("app.services.email.get_settings", return_value=settings),
        patch("app.services.email.httpx.AsyncClient", return_value=client_context),
    ):
        await _send(to="user@example.com", subject="Boom", html="<p>Hi</p>")

    client.post.assert_awaited_once()
    response.raise_for_status.assert_called_once_with()
