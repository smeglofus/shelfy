"""Tests for knihovny_client — Knihovny.cz VuFind API fetcher (mirror of backend tests)."""
from pathlib import Path
import sys

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asyncio

import knihovny_client


class TestLooksCzech:
    def test_diacritics(self):
        assert knihovny_client.looks_czech("Válka s mloky") is True
        assert knihovny_client.looks_czech(None, "nastávající maminky") is True

    def test_czech_isbn_groups(self):
        assert knihovny_client.looks_czech("9788085126396") is True   # 978-80
        assert knihovny_client.looks_czech("8071360279") is True      # ISBN-10, 80

    def test_non_czech(self):
        assert knihovny_client.looks_czech("Clean Code", "Robert C. Martin") is False
        assert knihovny_client.looks_czech("9780132350884") is False
        assert knihovny_client.looks_czech(None, None) is False


def test_fetch_normalizes_response_and_picks_matching_record() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/search"
        # Title + author -> combined VuFind field search (Title AND Author).
        assert request.url.params.get_list("type0[]") == ["Title", "Author"]
        assert request.url.params.get_list("lookfor0[]") == ["Válka s mloky", "Karel Čapek"]
        assert request.url.params["join"] == "AND"
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
            return await knihovny_client.fetch_knihovny_metadata(
                client, None, title="Válka s mloky", author="Karel Čapek"
            )

    metadata = asyncio.run(_run())

    assert metadata is not None
    assert metadata["provider"] == "knihovny_cz"
    assert metadata["title"] == "Válka s Mloky"
    assert metadata["author"] == "Karel Čapek"
    assert metadata["isbn"] == "9788085126396"
    assert metadata["publisher"] == "Zoologická zahrada hl. m. Prahy"
    assert metadata["publication_year"] == 2014
    assert metadata["description"] == "Slavná antiutopická sci-fi z roku 1936."
    assert metadata["cover_image_url"] is None


def test_fetch_isbn_search_uses_isn_type_and_handles_miss() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["type"] == "ISN"
        assert request.url.params["lookfor"] == "9788085126396"
        return httpx.Response(200, json={"records": [], "status": "OK"})

    async def _run() -> dict[str, object] | None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await knihovny_client.fetch_knihovny_metadata(client, "9788085126396")

    assert asyncio.run(_run()) is None


def test_fetch_without_identifiers_returns_none() -> None:
    async def _run() -> dict[str, object] | None:
        async with httpx.AsyncClient() as client:
            return await knihovny_client.fetch_knihovny_metadata(client, None, title=None)

    assert asyncio.run(_run()) is None


class TestSearchParams:
    def test_isbn_uses_isn_type(self) -> None:
        params = knihovny_client._search_params("9788085126396", None, None)
        assert params is not None
        assert ("lookfor", "9788085126396") in params
        assert ("type", "ISN") in params

    def test_title_and_author_use_combined_field_search(self) -> None:
        params = knihovny_client._search_params(None, "Příběh lásky", "Honza Vojtko")
        assert params is not None
        # Title AND Author combined query (the fix that surfaces the right
        # subtitled edition of a generic title).
        assert ("lookfor0[]", "Příběh lásky") in params
        assert ("type0[]", "Title") in params
        assert ("lookfor0[]", "Honza Vojtko") in params
        assert ("type0[]", "Author") in params
        assert ("join", "AND") in params
        assert not any(key == "type" for key, _ in params)

    def test_title_only_uses_plain_title_search(self) -> None:
        params = knihovny_client._search_params(None, "Válka s mloky", None)
        assert params is not None
        assert ("lookfor", "Válka s mloky") in params
        assert ("type", "Title") in params
        assert not any(key == "type0[]" for key, _ in params)

    def test_no_identifiers_returns_none(self) -> None:
        assert knihovny_client._search_params(None, None, None) is None
