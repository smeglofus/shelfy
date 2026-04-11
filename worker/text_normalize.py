"""Post-processing text normalization for OCR / Gemini recognized book metadata.

Handles:
- ALL-CAPS to natural title case (Czech + English aware)
- Whitespace / punctuation cleanup
- Duplicate word removal
- Confidence-based field nullification
- Preserves acronyms, Roman numerals, and diacritics
"""
from __future__ import annotations

import re
import unicodedata

# ── Words that should stay uppercase even when normalizing ──────────────────

# Common abbreviations / acronyms
_UPPERCASE_WORDS: frozenset[str] = frozenset({
    "USA", "UK", "EU", "UN", "NATO", "NASA", "UNESCO",
    "PhD", "MBA", "CEO", "CTO", "DNA", "RNA", "HIV", "AIDS",
    "FBI", "CIA", "KGB", "SSSR", "DIY", "FAQ", "IT", "AI",
    "OK", "DJ", "TV", "CD", "DVD", "LP", "EP",
})

# Roman numerals (I through XX plus common compounds)
_ROMAN_NUMERAL_RE = re.compile(
    r"^(?:M{0,3})(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$",
    re.IGNORECASE,
)

# ── Small words that should stay lowercase in title case (articles, preps) ──
_SMALL_WORDS_EN: frozenset[str] = frozenset({
    "a", "an", "the", "and", "but", "or", "nor", "for", "yet", "so",
    "at", "by", "in", "of", "on", "to", "up", "as", "is", "it",
})

_SMALL_WORDS_CS: frozenset[str] = frozenset({
    "a", "i", "k", "o", "s", "u", "v", "z", "na", "do", "za", "od",
    "po", "ve", "ze", "se", "si", "je", "ke", "pro", "při", "nad",
    "pod", "ale", "ani", "aby", "jak", "než", "kde", "kdy",
})

_SMALL_WORDS = _SMALL_WORDS_EN | _SMALL_WORDS_CS

# Minimum length for an ALL-CAPS string to be treated as "probably shouting"
_ALL_CAPS_THRESHOLD = 4


def _is_roman_numeral(word: str) -> bool:
    """Check if a word is a valid Roman numeral (I, II, III, IV, etc.)."""
    stripped = word.strip(".,;:!?()")
    if not stripped or len(stripped) > 15:
        return False
    return bool(_ROMAN_NUMERAL_RE.fullmatch(stripped))


def _is_all_caps(text: str) -> bool:
    """Return True if text is ALL CAPS and long enough to be 'shouting'.

    Short strings like 'AI' or 'IT' are not treated as shouting even if uppercase.
    We check letter characters only (ignoring digits, punctuation).
    """
    letters = [ch for ch in text if ch.isalpha()]
    if len(letters) < _ALL_CAPS_THRESHOLD:
        return False
    return all(ch.isupper() for ch in letters)


def _capitalize_word(word: str, is_first: bool, mode: str) -> str:
    """Capitalize a single word with awareness of acronyms, Roman numerals, and language conventions.

    Modes:
        "sentence" — only first word capitalized (Czech-style title case)
        "proper"   — every word capitalized (for author names / proper nouns)
    """
    # Preserve explicitly uppercase words (acronyms)
    upper = word.upper()
    if upper in _UPPERCASE_WORDS:
        return upper

    # Preserve Roman numerals
    if _is_roman_numeral(word):
        return word.upper()

    if not word:
        return word

    if mode == "sentence":
        # Sentence case: only first word gets capitalized
        if is_first:
            return word[0].upper() + word[1:].lower()
        return word.lower()

    # "proper" mode: capitalize every word (for names)
    return word[0].upper() + word[1:].lower()


def normalize_casing(text: str, mode: str = "sentence") -> str:
    """Convert ALL-CAPS text to natural case.

    Only normalizes if the text appears to be all caps.
    Preserves acronyms (USA, NATO), Roman numerals (II, III, XIV),
    and diacritics.  If the text is mixed case or short, returns it as-is.

    Modes:
        "sentence" — first word capitalized, rest lowercase (Czech-safe default)
        "proper"   — every word capitalized (for proper nouns / author names)
    """
    if not text or not _is_all_caps(text):
        return text

    words = text.split()
    result: list[str] = []
    for i, word in enumerate(words):
        result.append(_capitalize_word(word, is_first=(i == 0), mode=mode))

    return " ".join(result)


def clean_whitespace(text: str) -> str:
    """Normalize whitespace: collapse runs, strip edges, remove control chars."""
    if not text:
        return text
    # Remove control characters except standard whitespace
    cleaned = "".join(
        ch for ch in text
        if not unicodedata.category(ch).startswith("C") or ch in (" ", "\t", "\n")
    )
    # Collapse whitespace runs
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def clean_punctuation(text: str) -> str:
    """Remove duplicate / noisy punctuation artifacts from OCR."""
    if not text:
        return text
    # Collapse repeated punctuation (e.g. ".." → ".", ",," → ",")
    text = re.sub(r"([.,:;!?])\1+", r"\1", text)
    # Remove leading punctuation (except opening quotes/parens)
    text = re.sub(r'^[.,:;!?\-–—]+\s*', '', text)
    # Remove trailing garbage punctuation (keep period, !, ?)
    text = re.sub(r'\s*[,:;]+$', '', text)
    return text.strip()


def deduplicate_words(text: str) -> str:
    """Remove immediately repeated words (OCR stutter artifact).

    Example: "The The Great Gatsby" → "The Great Gatsby"
    """
    if not text:
        return text
    words = text.split()
    if len(words) < 2:
        return text
    result = [words[0]]
    for word in words[1:]:
        if word.lower() != result[-1].lower():
            result.append(word)
    return " ".join(result)


def normalize_recognized_text(text: str | None, *, mode: str = "sentence") -> str | None:
    """Full pipeline: whitespace → punctuation → dedup → casing.

    Returns None if the result is empty after cleanup.
    """
    if text is None:
        return None
    cleaned = clean_whitespace(text)
    cleaned = clean_punctuation(cleaned)
    cleaned = deduplicate_words(cleaned)
    cleaned = normalize_casing(cleaned, mode=mode)
    return cleaned if cleaned else None


# Casing mode per field — titles use sentence case (Czech-safe), authors use proper case
_FIELD_CASING_MODE: dict[str, str] = {
    "title": "sentence",
    "author": "proper",
}


def normalize_book_fields(
    book: dict[str, object],
    *,
    apply_casing: bool = True,
) -> dict[str, object]:
    """Normalize title/author fields on a recognized book dict.

    This is the main entry point called from the scan pipeline.
    Only modifies auto-recognized values; user-edited values should not
    pass through this function.

    Titles use sentence case (Czech-safe: "Tibetská kniha o životě a smrti").
    Authors use proper case (each word capitalized: "Sogjal Rinpoche").

    Args:
        book: Dict with at least 'title' and 'author' keys.
        apply_casing: Whether to apply ALL-CAPS normalization.

    Returns:
        The same dict (mutated in-place) with normalized fields.
    """
    for field in ("title", "author"):
        value = book.get(field)
        if not isinstance(value, str):
            continue
        normalized = clean_whitespace(value)
        normalized = clean_punctuation(normalized)
        normalized = deduplicate_words(normalized)
        if apply_casing:
            mode = _FIELD_CASING_MODE.get(field, "sentence")
            normalized = normalize_casing(normalized, mode=mode)
        book[field] = normalized if normalized else None

    return book
