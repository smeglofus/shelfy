import pytest
from httpx import ASGITransport, AsyncClient

from app.core.metrics import PAGE_VIEWS_TOTAL, render_metrics
from app.main import app
from app.services.visits import (
    VISIT_SOURCES,
    normalize_visit_page,
    normalize_visit_source,
    preinitialize_page_view_series,
)


def _count(page: str, source: str) -> float:
    return float(PAGE_VIEWS_TOTAL.labels(page=page, source=source)._value.get())


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (None, "direct"),
        ("", "direct"),
        ("direct", "direct"),
        ("facebook", "facebook"),
        ("FB", "facebook"),
        ("l.facebook.com", "facebook"),
        ("m.facebook.com", "facebook"),
        ("www.facebook.com", "facebook"),
        ("old.reddit.com", "reddit"),
        ("www.databazeknih.cz", "databazeknih"),
        ("www.google.cz", "google"),
        ("t.co", "x"),
        ("some-random-blog.example", "other"),
        ("notfacebook.com", "other"),
        ("<script>", "other"),
        ("a" * 500, "other"),
    ],
)
def test_normalize_visit_source(raw: str | None, expected: str) -> None:
    assert normalize_visit_source(raw) == expected
    assert normalize_visit_source(raw) in VISIT_SOURCES


def test_normalize_visit_page() -> None:
    assert normalize_visit_page("landing") == "landing"
    assert normalize_visit_page(" Demo ") == "demo"
    assert normalize_visit_page("admin") is None
    assert normalize_visit_page("") is None


@pytest.mark.asyncio
async def test_visit_beacon_increments_counter_without_csrf() -> None:
    before = _count("landing", "facebook")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/telemetry/visit",
            json={"page": "landing", "source": "l.facebook.com"},
        )

    assert response.status_code == 202
    assert response.json() == {"ok": True}
    assert _count("landing", "facebook") == before + 1


@pytest.mark.asyncio
async def test_visit_beacon_drops_unknown_page() -> None:
    before = _count("demo", "direct")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/telemetry/visit",
            json={"page": "../../etc/passwd", "source": None},
        )

    assert response.status_code == 202
    assert response.json() == {"ok": False}
    assert _count("demo", "direct") == before


@pytest.mark.asyncio
async def test_visit_beacon_rejects_oversized_payload() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/telemetry/visit",
            json={"page": "x" * 100, "source": "facebook"},
        )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_visit_counter_is_exposed_in_prometheus_output() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post("/api/v1/telemetry/visit", json={"page": "pricing", "source": "reddit"})

    body, _ = render_metrics()
    assert b'shelfy_page_views_total{page="pricing",source="reddit"}' in body


def test_all_page_source_series_are_preinitialized() -> None:
    preinitialize_page_view_series()
    body, _ = render_metrics()
    assert b'shelfy_page_views_total{page="signup",source="databazeknih"}' in body
