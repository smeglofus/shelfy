"""Fuzzy matching of shelf-scan results against a library catalog.

The vision model occasionally misreads spine text onto the nearest plausible
words ("nastávající maminky" → "nastavení miminka").  Comparing the scanned
title/author against the closest Open Library record lets us either adopt the
catalog form (near-identical match — fixes casing/diacritics/minor OCR noise)
or surface it as a suggestion for human review (partial match).

Pure logic only — no I/O — so it stays trivially testable.  The Open Library
lookups live in celery_app.py next to the other provider calls.

Design principles:
  • Adopting silently is only allowed for near-identical text (>= ADOPT).
  • A partial match never overwrites data — it downgrades confidence and
    attaches a suggestion; the human decides.
  • No match at all is NOT a negative signal: Open Library's coverage of
    Czech books is thin, so absence must never flag a row.
"""
from __future__ import annotations

from difflib import SequenceMatcher
import re
import unicodedata

# Combined score at/above which the catalog form replaces the scanned text.
ADOPT_THRESHOLD = 0.92
# Title similarity must also individually clear this bar before adopting.
ADOPT_TITLE_THRESHOLD = 0.90
# Combined score at/above which the catalog form is attached as a suggestion.
SUGGEST_THRESHOLD = 0.55

# Weight of the title score when an author is available on both sides.
_TITLE_WEIGHT = 0.75

# Minimum title similarity for a title-only (ISBN-less) enrichment hit to be
# trusted. Deliberately lenient — the discriminator for generic shared titles
# is the author, not tiny title variations (subtitles, edition suffixes).
ENRICH_TITLE_THRESHOLD = 0.80


def normalize_for_compare(text: str) -> str:
    """Lowercase, strip diacritics and punctuation — OCR noise the comparison
    should see through (casing and diacritics are exactly what we want to be
    able to adopt from the catalog)."""
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
    (diacritics- and order-insensitive).

    Deliberately token-based rather than a whole-string ratio: catalogues
    render names in different orders ("Karel Čapek" vs "Čapek, Karel") and
    with life dates, but a shared surname is a strong same-author signal.
    Tokens of two chars or fewer (initials, "a", "de") are ignored so they
    never manufacture a false match.
    """
    if not a or not b:
        return False
    a_tokens = {t for t in normalize_for_compare(a).split() if len(t) > 2}
    b_tokens = {t for t in normalize_for_compare(b).split() if len(t) > 2}
    return bool(a_tokens & b_tokens)


def title_lookup_result_is_trustworthy(
    query_title: str | None,
    query_author: str | None,
    result_title: str | None,
    result_author: str | None,
) -> bool:
    """Guard for ISBN-less (title-only) metadata enrichment.

    A title-only catalogue search returns the *best-ranked* record for the
    title, with no guarantee it is the same book — generic titles ("Příběh
    lásky") are shared by many unrelated works. Adopting that record silently
    overwrites the book with a stranger's publisher/year/description.

    We trust the result only when:
      * the titles are reasonably close (``ENRICH_TITLE_THRESHOLD``), and
      * *if* the query names an author and the record also names one, the
        two authors match. Identical generic titles by different authors are
        different books, so an author conflict is a hard reject.

    A missing author on either side is not treated as a conflict: many
    scanned spines carry no author, and rejecting those outright would gut
    enrichment coverage. The author check only fires when it can actually
    discriminate.
    """
    title_score = similarity(query_title, result_title)
    if query_author and result_author:
        if authors_match(query_author, result_author):
            # Author corroborates the book — tolerate subtitle/edition noise
            # in the title (e.g. "Válka s mloky" vs "Válka s mloky (2. vyd.)").
            return title_score >= SUGGEST_THRESHOLD
        # Author conflict: identical generic titles by different authors are
        # different books — the exact bug this guard exists to stop.
        return False
    # No author to corroborate — the title must carry the decision alone, so
    # it has to clear the stricter bar.
    return title_score >= ENRICH_TITLE_THRESHOLD


def evaluate_match(
    scanned_title: str | None,
    scanned_author: str | None,
    catalog_title: str | None,
    catalog_author: str | None,
) -> tuple[str, float]:
    """Compare a scanned row against its closest catalog candidate.

    Returns ``(decision, score)`` where decision is:
        "adopt"   — near-identical; safe to take the catalog form verbatim
        "suggest" — plausibly the same book; attach as suggestion, human decides
        "none"    — too different; ignore the candidate
    """
    title_score = similarity(scanned_title, catalog_title)

    if scanned_author and catalog_author:
        author_score = similarity(scanned_author, catalog_author)
        score = _TITLE_WEIGHT * title_score + (1 - _TITLE_WEIGHT) * author_score
    else:
        score = title_score

    if score >= ADOPT_THRESHOLD and title_score >= ADOPT_TITLE_THRESHOLD:
        return "adopt", score
    if score >= SUGGEST_THRESHOLD:
        return "suggest", score
    return "none", score


def apply_catalog_match(
    item: dict[str, object],
    catalog_title: str | None,
    catalog_author: str | None,
) -> str:
    """Mutate a shelf-scan row according to the match decision.

    Returns the decision string so the caller can log/aggregate.
    """
    title = item.get("title") if isinstance(item.get("title"), str) else None
    author = item.get("author") if isinstance(item.get("author"), str) else None

    decision, score = evaluate_match(title, author, catalog_title, catalog_author)

    if decision == "adopt":
        if isinstance(catalog_title, str) and catalog_title.strip():
            item["title"] = catalog_title.strip()
        if isinstance(catalog_author, str) and catalog_author.strip():
            item["author"] = catalog_author.strip()
        flags = item.setdefault("quality_flags", [])
        if isinstance(flags, list):
            flags.append("catalog_adopted")
    elif decision == "suggest":
        if isinstance(catalog_title, str) and catalog_title.strip():
            item["suggested_title"] = catalog_title.strip()
        if isinstance(catalog_author, str) and catalog_author.strip():
            item["suggested_author"] = catalog_author.strip()
        # Only downgrade when there is actually something to review.
        if "suggested_title" in item or "suggested_author" in item:
            item["confidence"] = "needs_review"
            flags = item.setdefault("quality_flags", [])
            if isinstance(flags, list):
                flags.append("catalog_mismatch")
        else:
            decision = "none"

    return decision
