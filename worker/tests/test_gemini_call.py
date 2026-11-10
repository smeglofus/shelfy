"""Tests for the shared Gemini request helper (model config, thinking level, downscaling)."""

from __future__ import annotations

import asyncio
import base64
from pathlib import Path
import sys
from typing import Any

import cv2
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import celery_app


_OK_PAYLOAD = {"candidates": [{"content": {"parts": [{"text": "[]"}]}}]}


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, Any] | None = None) -> None:
        self.status_code = status_code
        self._payload = payload or {}

    def raise_for_status(self) -> None:
        import httpx

        if self.status_code >= 400:
            request = httpx.Request("POST", "https://example.test")
            raise httpx.HTTPStatusError(
                "error", request=request, response=httpx.Response(self.status_code, request=request)
            )

    def json(self) -> dict[str, Any]:
        return self._payload


def _jpeg(width: int, height: int) -> bytes:
    image = np.full((height, width, 3), 127, dtype=np.uint8)
    ok, encoded = cv2.imencode(".jpg", image)
    assert ok
    return encoded.tobytes()


@pytest.fixture
def gemini_settings(monkeypatch: pytest.MonkeyPatch) -> Any:
    settings = celery_app.worker_settings
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    monkeypatch.setattr(settings, "gemini_model", "gemini-test-model")
    monkeypatch.setattr(settings, "gemini_thinking_level", "low")
    monkeypatch.setattr(settings, "gemini_image_max_side", 2048)
    return settings


def _capture_posts(monkeypatch: pytest.MonkeyPatch, responses: list[_FakeResponse]) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    async def fake_post(self: Any, url: str, **kwargs: Any) -> _FakeResponse:
        # Deep-ish copy of the generationConfig: the helper mutates it on retry.
        body = kwargs["json"]
        calls.append({"url": url, "generationConfig": dict(body["generationConfig"]), "body": body})
        return responses[len(calls) - 1]

    import httpx

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    return calls


def test_call_uses_configured_model_and_thinking_level(monkeypatch: pytest.MonkeyPatch, gemini_settings: Any) -> None:
    calls = _capture_posts(monkeypatch, [_FakeResponse(200, _OK_PAYLOAD)])

    payload = asyncio.run(celery_app._call_gemini("p", _jpeg(10, 10), timeout=5.0, processing_step="t"))

    assert payload == _OK_PAYLOAD
    assert len(calls) == 1
    assert "/models/gemini-test-model:generateContent" in calls[0]["url"]
    assert calls[0]["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "low"}
    assert calls[0]["generationConfig"]["temperature"] == 0


def test_empty_thinking_level_omits_thinking_config(monkeypatch: pytest.MonkeyPatch, gemini_settings: Any) -> None:
    monkeypatch.setattr(gemini_settings, "gemini_thinking_level", "")
    calls = _capture_posts(monkeypatch, [_FakeResponse(200, _OK_PAYLOAD)])

    asyncio.run(celery_app._call_gemini("p", _jpeg(10, 10), timeout=5.0, processing_step="t"))

    assert "thinkingConfig" not in calls[0]["generationConfig"]


def test_rejected_thinking_config_retries_without_it(monkeypatch: pytest.MonkeyPatch, gemini_settings: Any) -> None:
    calls = _capture_posts(monkeypatch, [_FakeResponse(400), _FakeResponse(200, _OK_PAYLOAD)])

    payload = asyncio.run(celery_app._call_gemini("p", _jpeg(10, 10), timeout=5.0, processing_step="t"))

    assert payload == _OK_PAYLOAD
    assert len(calls) == 2
    assert "thinkingConfig" in calls[0]["generationConfig"]
    assert "thinkingConfig" not in calls[1]["generationConfig"]


def test_http_error_returns_none(monkeypatch: pytest.MonkeyPatch, gemini_settings: Any) -> None:
    # 402 = prepaid credits depleted; must degrade to None, not raise.
    _capture_posts(monkeypatch, [_FakeResponse(402)])

    assert asyncio.run(celery_app._call_gemini("p", _jpeg(10, 10), timeout=5.0, processing_step="t")) is None


def test_missing_api_key_returns_none_without_request(monkeypatch: pytest.MonkeyPatch, gemini_settings: Any) -> None:
    monkeypatch.setattr(gemini_settings, "gemini_api_key", None)
    calls = _capture_posts(monkeypatch, [])

    assert asyncio.run(celery_app._call_gemini("p", _jpeg(10, 10), timeout=5.0, processing_step="t")) is None
    assert calls == []


def test_large_image_is_downscaled_to_max_side(gemini_settings: Any) -> None:
    prepared, mime_type = celery_app._prepare_image_for_gemini(_jpeg(4000, 3000))

    decoded = cv2.imdecode(np.frombuffer(prepared, dtype=np.uint8), cv2.IMREAD_COLOR)
    assert mime_type == "image/jpeg"
    assert decoded.shape[1] == 2048
    assert decoded.shape[0] == 1536


def test_small_image_passes_through_unchanged(gemini_settings: Any) -> None:
    original = _jpeg(800, 600)

    prepared, _ = celery_app._prepare_image_for_gemini(original)

    assert prepared == original


def test_downscaling_can_be_disabled(monkeypatch: pytest.MonkeyPatch, gemini_settings: Any) -> None:
    monkeypatch.setattr(gemini_settings, "gemini_image_max_side", 0)
    original = _jpeg(4000, 3000)

    prepared, _ = celery_app._prepare_image_for_gemini(original)

    assert prepared == original


def test_undecodable_bytes_pass_through(gemini_settings: Any) -> None:
    prepared, mime_type = celery_app._prepare_image_for_gemini(b"\xff\xd8\xff not really a jpeg")

    assert prepared == b"\xff\xd8\xff not really a jpeg"
    assert mime_type == "image/jpeg"


def test_downscaled_image_is_what_gets_sent(monkeypatch: pytest.MonkeyPatch, gemini_settings: Any) -> None:
    calls = _capture_posts(monkeypatch, [_FakeResponse(200, _OK_PAYLOAD)])

    asyncio.run(celery_app._call_gemini("p", _jpeg(4000, 3000), timeout=5.0, processing_step="t"))

    inline = calls[0]["body"]["contents"][0]["parts"][1]["inline_data"]
    sent = cv2.imdecode(np.frombuffer(base64.b64decode(inline["data"]), dtype=np.uint8), cv2.IMREAD_COLOR)
    assert max(sent.shape[:2]) == 2048
