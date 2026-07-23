"""Knihovny.cz metadata fetcher — the Czech central library portal.

Knihovny.cz (run by the Moravian Library, backed by Czech library
catalogues incl. the National Library) exposes a public VuFind JSON API.
Coverage of Czech titles — including annotations — is far better than
Open Library's, so it is the first choice for Czech-looking lookups and
a fallback for everything else (ADR 012).
"""
from __future__ import annotations

import re
from typing import Any
import unicodedata

import httpx

from app.core.config import get_settings

_API_URL = "https://www.knihovny.cz/api/v1/search"
_FIELDS = (
    "title",
    "authors",
    "isbns",
    "publishers",
    "publicationDates",
    "languages",
    "summary",
)

# Characters that only occur in Czech (and Slovak) orthography — a cheap,
# reliable signal that a scanned title/author is a Czech book.
_CZECH_CHARS = set("ěščřžýáíéúůďťňó" "ĚŠČŘŽÝÁÍÉÚŮĎŤŇÓ")


def looks_czech(*texts: str | None) -> bool:
    """True when any text carries Czech diacritics or a Czech ISBN prefix."""
    for text in texts:
        if not text:
            continue
        if any(ch in _CZECH_CHARS for ch in text):
            return True
        digits = re.sub(r"[^0-9Xx]", "", text)
        # 978-80-… (ISBN-13) / 80-… (ISBN-10) is the Czech(oslovak) group.
        if len(digits) == 13 and digits.startswith("97880"):
            return True
        if len(digits) == 10 and digits.startswith("80"):
            return True
    return False


def _clean_author(raw: str) -> str:
    # VuFind display form carries life dates: "Karel Čapek, 1890-1938".
    return re.sub(r",\s*[0-9].*$", "", raw).strip()


def _primary_author(record: dict[str, Any]) -> str | None:
    authors = record.get("authors")
    if not isinstance(authors, dict):
        return None
    primary = authors.get("primary")
    # ``primary`` is a dict keyed by display name (or an empty list).
    if isinstance(primary, dict):
        for name in primary:
            if isinstance(name, str) and name.strip():
                return _clean_author(name)
    return None


def _first_str(record: dict[str, Any], field: str) -> str | None:
    values = record.get(field)
    first = values[0] if isinstance(values, list) and values else None
    return first if isinstance(first, str) else None


def _normalize_isbn_digits(raw: str) -> str | None:
    digits = re.sub(r"[^0-9Xx]", "", raw).upper()
    return digits if len(digits) in (10, 13) else None


def _strip_diacritics(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text.lower())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def _author_matches(query_author: str | None, record_author: str | None) -> bool:
    if not query_author or not record_author:
        return False
    query_tokens = [t for t in _strip_diacritics(query_author).split() if len(t) > 2]
    record_norm = _strip_diacritics(record_author)
    return any(token in record_norm for token in query_tokens)


def _pick_record(records: list[dict[str, Any]], author: str | None) -> dict[str, Any] | None:
    """Prefer records that match the author and actually carry an ISBN and
    annotation; ties resolve to API relevance order."""
    best: dict[str, Any] | None = None
    best_score = -1
    for record in records:
        if not isinstance(record, dict):
            continue
        score = 0
        if _author_matches(author, _primary_author(record)):
            score += 4
        if record.get("isbns"):
            score += 2
        if record.get("summary"):
            score += 1
        if score > best_score:
            best = record
            best_score = score
    return best


def _search_params(
    isbn: str | None, title: str | None, author: str | None
) -> list[tuple[str, str | int | float | bool | None]] | None:
    """VuFind query params for a lookup, or None when there is nothing to search.

    With both a title and an author we issue a combined field search
    (Title AND Author). Putting the author into the *query* — not only into
    the post-fetch ``_pick_record`` scoring — surfaces the correct edition
    even when the bare title is extremely common and the right record carries
    a subtitle, which would otherwise rank far below the fetched window
    (e.g. "Příběh lásky": the wanted book sits at rank ~12 for the bare title,
    but is the sole hit once the author is part of the query).
    """
    if isbn:
        query: list[tuple[str, str | int | float | bool | None]] = [("lookfor", isbn), ("type", "ISN")]
    elif title and author:
        query = [
            ("lookfor0[]", title),
            ("type0[]", "Title"),
            ("lookfor0[]", author),
            ("type0[]", "Author"),
            ("join", "AND"),
        ]
    elif title:
        query = [("lookfor", title), ("type", "Title")]
    else:
        return None
    query.append(("limit", "5"))
    query.extend(("field[]", field) for field in _FIELDS)
    return query


async def fetch_knihovny_metadata(
    client: httpx.AsyncClient,
    isbn: str | None,
    title: str | None = None,
    author: str | None = None,
) -> dict[str, Any] | None:
    params = _search_params(isbn, title, author)
    if params is None:
        return None

    response = await client.get(
        _API_URL,
        params=params,
        headers={"User-Agent": get_settings().open_library_user_agent},
        timeout=10.0,
    )
    response.raise_for_status()
    payload = response.json()
    records = payload.get("records") if isinstance(payload, dict) else None
    if not isinstance(records, list) or not records:
        return None

    record = _pick_record(records, author)
    if record is None:
        return None

    record_title = record.get("title") if isinstance(record.get("title"), str) else None
    if not record_title:
        return None

    record_isbn = _first_str(record, "isbns")
    resolved_isbn = _normalize_isbn_digits(record_isbn) if record_isbn else None
    if isbn and resolved_isbn is None:
        resolved_isbn = _normalize_isbn_digits(isbn)

    publisher = _first_str(record, "publishers")
    if publisher:
        publisher = publisher.rstrip(", ").strip() or None

    year: int | None = None
    publication_date = _first_str(record, "publicationDates")
    if publication_date:
        match = re.search(r"\d{4}", publication_date)
        if match:
            year = int(match.group(0))

    language = _first_str(record, "languages")
    if language and not re.fullmatch(r"[A-Za-z]{2,3}", language):
        language = None

    return {
        "title": record_title.strip(),
        "author": _primary_author(record),
        "isbn": resolved_isbn,
        "publisher": publisher,
        "language": language.lower() if language else None,
        "description": _first_str(record, "summary"),
        # Knihovny.cz nevrací volně použitelné obálky (ObalkyKnih má vlastní
        # licenční podmínky) — obálku doplní gap-fill z Open Library.
        "cover_image_url": None,
        "publication_year": year,
        "provider": "knihovny_cz",
    }
