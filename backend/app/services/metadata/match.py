"""Trust guard for ISBN-less (title-only) metadata enrichment.

A title-only catalogue search returns the *best-ranked* record for the title,
with no guarantee it is the same book — generic titles ("Příběh lásky") are
shared by many unrelated works, and adopting the wrong one silently overwrites
the book with a stranger's publisher/year/description.

This mirrors the pure matching logic in ``worker/catalog_match.py`` (the two
services keep their metadata logic in parity but cannot import across the
deploy boundary). Pure logic only — no I/O — so it stays trivially testable.
"""
from __future__ import annotations

from difflib import SequenceMatcher
import re
import unicodedata

# Minimum title similarity for a title-only hit to be trusted when no author
# is available to corroborate it. Deliberately lenient — the discriminator for
# shared generic titles is the author, not tiny title variations.
ENRICH_TITLE_THRESHOLD = 0.80
# Looser title bar accepted once the author has already confirmed the book.
AUTHOR_CONFIRMED_TITLE_THRESHOLD = 0.55


def normalize_for_compare(text: str) -> str:
    """Lowercase, strip diacritics and punctuation — the noise the comparison
    should see through."""
    decomposed = unicodedata.normalize("NFD", text.lower())
    without_marks = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", " ", without_marks).strip()


def similarity(a: str | None, b: str | None) -> float:
    if not a or not b:
        return 0.0
    norm_a = normalize_for_compare(a)
    norm_b = normalize_for_compare(b)
    if not norm_a or not norm_b:
        return 0.0
    return SequenceMatcher(None, norm_a, norm_b).ratio()


def authors_match(a: str | None, b: str | None) -> bool:
    """True when two author strings share a significant name token
    (diacritics- and order-insensitive). Tokens of two chars or fewer are
    ignored so initials never manufacture a false match."""
    if not a or not b:
        return False
    a_tokens = {t for t in normalize_for_compare(a).split() if len(t) > 2}
    b_tokens = {t for t in normalize_for_compare(b).split() if len(t) > 2}
    return bool(a_tokens & b_tokens)


def _query_title_contained(query_title: str | None, result_title: str | None) -> bool:
    """True when every significant word of the scanned title also appears in
    the catalogue title. Catalogues routinely carry a subtitle the spine/scan
    omits ("Příběh lásky" ⊂ "Příběh lásky: jak a proč milujeme"), which a plain
    length-sensitive ratio penalises below threshold even though it is plainly
    the same book. Single-character tokens are ignored as noise."""
    if not query_title or not result_title:
        return False
    q = {t for t in normalize_for_compare(query_title).split() if len(t) > 1}
    r = {t for t in normalize_for_compare(result_title).split() if len(t) > 1}
    return bool(q) and q <= r


def title_lookup_result_is_trustworthy(
    query_title: str | None,
    query_author: str | None,
    result_title: str | None,
    result_author: str | None,
) -> bool:
    """Decide whether an ISBN-less catalogue hit really is the book we asked
    for. See module docstring.

    Trusted only when the titles are close enough, and — if the query names an
    author and the record also names one — the two authors match. A missing
    author on either side is not a conflict (many scanned spines carry none);
    the author check only fires when it can actually discriminate.
    """
    title_score = similarity(query_title, result_title)
    if query_author and result_author:
        if authors_match(query_author, result_author):
            # Author corroborates the book — tolerate subtitle/edition noise in
            # the title, either as a close ratio or as full word containment
            # ("Příběh lásky" ⊂ "Příběh lásky: jak a proč milujeme", whose ratio
            # dips below the bar purely from the subtitle's length).
            return (
                title_score >= AUTHOR_CONFIRMED_TITLE_THRESHOLD
                or _query_title_contained(query_title, result_title)
            )
        # Author conflict: identical generic titles by different authors are
        # different books — the exact bug this guard exists to stop.
        return False
    return title_score >= ENRICH_TITLE_THRESHOLD
