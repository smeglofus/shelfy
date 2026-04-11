"""Tests for text_normalize module — casing, cleanup, and book field normalization."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import text_normalize


# ── normalize_casing ────────────────────────────────────────────────

class TestNormalizeCasing:
    def test_all_caps_title_sentence_case(self):
        # Default mode is sentence case — only first word capitalized
        assert text_normalize.normalize_casing("THE GREAT GATSBY") == "The great gatsby"

    def test_all_caps_proper_case(self):
        # Proper mode capitalizes every word (for author names)
        assert text_normalize.normalize_casing("THE GREAT GATSBY", mode="proper") == "The Great Gatsby"

    def test_all_caps_czech_title_preserves_diacritics(self):
        result = text_normalize.normalize_casing("TIBETSKÁ KNIHA O ŽIVOTĚ A SMRTI")
        assert result == "Tibetská kniha o životě a smrti"

    def test_all_caps_author_proper_case(self):
        assert text_normalize.normalize_casing("SOGJAL RINPOCHE", mode="proper") == "Sogjal Rinpoche"

    def test_mixed_case_left_alone(self):
        assert text_normalize.normalize_casing("Harry Potter") == "Harry Potter"

    def test_short_caps_left_alone(self):
        # Short text like "AI" or "IT" should not be treated as shouting
        assert text_normalize.normalize_casing("AI") == "AI"
        assert text_normalize.normalize_casing("IT") == "IT"

    def test_roman_numerals_preserved(self):
        result = text_normalize.normalize_casing("HARRY POTTER A RELIKVIE SMRTI II")
        assert "II" in result
        assert result == "Harry potter a relikvie smrti II"

    def test_roman_numeral_complex(self):
        result = text_normalize.normalize_casing("DĚJINY EVROPY XIV")
        assert "XIV" in result

    def test_acronym_preserved(self):
        result = text_normalize.normalize_casing("DĚJINY USA A NATO")
        assert "USA" in result
        assert "NATO" in result

    def test_empty_string(self):
        assert text_normalize.normalize_casing("") == ""

    def test_none_passthrough(self):
        # normalize_casing takes str, but normalize_recognized_text handles None
        assert text_normalize.normalize_recognized_text(None) is None

    def test_single_word_caps(self):
        # "KAFKA" is 5 letters, all caps → normalize
        assert text_normalize.normalize_casing("KAFKA") == "Kafka"

    def test_lowercase_stays_lowercase(self):
        assert text_normalize.normalize_casing("already lowercase") == "already lowercase"

    def test_sentence_case_only_first_word(self):
        result = text_normalize.normalize_casing("THE WAR OF THE WORLDS")
        assert result == "The war of the worlds"

    def test_proper_case_all_words(self):
        result = text_normalize.normalize_casing("THE WAR OF THE WORLDS", mode="proper")
        assert result == "The War Of The Worlds"

    def test_czech_sentence_case(self):
        result = text_normalize.normalize_casing("VÁLKA A MÍR NA VÝCHODĚ")
        assert result == "Válka a mír na východě"


# ── clean_whitespace ────────────────────────────────────────────────

class TestCleanWhitespace:
    def test_collapses_runs(self):
        assert text_normalize.clean_whitespace("  hello   world  ") == "hello world"

    def test_strips_control_chars(self):
        assert text_normalize.clean_whitespace("hello\x00world") == "helloworld"

    def test_preserves_normal_space(self):
        assert text_normalize.clean_whitespace("hello world") == "hello world"

    def test_empty(self):
        assert text_normalize.clean_whitespace("") == ""


# ── clean_punctuation ───────────────────────────────────────────────

class TestCleanPunctuation:
    def test_duplicate_periods(self):
        assert text_normalize.clean_punctuation("Hello..world") == "Hello.world"

    def test_leading_punctuation_removed(self):
        assert text_normalize.clean_punctuation("--Hello") == "Hello"

    def test_trailing_comma_removed(self):
        assert text_normalize.clean_punctuation("Hello,") == "Hello"

    def test_normal_text_unchanged(self):
        assert text_normalize.clean_punctuation("Hello, world!") == "Hello, world!"


# ── deduplicate_words ───────────────────────────────────────────────

class TestDeduplicateWords:
    def test_repeated_word(self):
        assert text_normalize.deduplicate_words("The The Great Gatsby") == "The Great Gatsby"

    def test_case_insensitive_dedup(self):
        assert text_normalize.deduplicate_words("the THE great") == "the great"

    def test_no_duplicates(self):
        assert text_normalize.deduplicate_words("one two three") == "one two three"

    def test_single_word(self):
        assert text_normalize.deduplicate_words("hello") == "hello"

    def test_empty(self):
        assert text_normalize.deduplicate_words("") == ""


# ── normalize_recognized_text (full pipeline) ──────────────────────

class TestNormalizeRecognizedText:
    def test_full_pipeline_sentence_default(self):
        result = text_normalize.normalize_recognized_text("  THE  GREAT  GATSBY  ")
        assert result == "The great gatsby"

    def test_full_pipeline_proper_mode(self):
        result = text_normalize.normalize_recognized_text("  THE  GREAT  GATSBY  ", mode="proper")
        assert result == "The Great Gatsby"

    def test_full_pipeline_czech(self):
        result = text_normalize.normalize_recognized_text("TIBETSKÁ KNIHA O ŽIVOTĚ A SMRTI")
        assert result == "Tibetská kniha o životě a smrti"

    def test_full_pipeline_with_noise(self):
        result = text_normalize.normalize_recognized_text("..THE THE  GATSBY,,")
        assert result == "The gatsby"

    def test_returns_none_for_empty_after_cleanup(self):
        assert text_normalize.normalize_recognized_text("...") is None

    def test_returns_none_for_none(self):
        assert text_normalize.normalize_recognized_text(None) is None


# ── normalize_book_fields ───────────────────────────────────────────

class TestNormalizeBookFields:
    def test_title_sentence_case_author_proper_case(self):
        """Title gets sentence case, author gets proper case (each word capitalized)."""
        book = {"title": "THE GREAT GATSBY", "author": "F. SCOTT FITZGERALD", "isbn": None}
        result = text_normalize.normalize_book_fields(book)
        assert result["title"] == "The great gatsby"
        assert result["author"] == "F. Scott Fitzgerald"

    def test_czech_title_sentence_case(self):
        book = {"title": "TIBETSKÁ KNIHA O ŽIVOTĚ A SMRTI", "author": "SOGJAL RINPOČHE"}
        result = text_normalize.normalize_book_fields(book)
        assert result["title"] == "Tibetská kniha o životě a smrti"
        assert result["author"] == "Sogjal Rinpočhe"

    def test_preserves_non_string_fields(self):
        book = {"title": None, "author": None, "isbn": "9780306406157"}
        result = text_normalize.normalize_book_fields(book)
        assert result["title"] is None
        assert result["isbn"] == "9780306406157"

    def test_skip_casing_when_disabled(self):
        book = {"title": "THE GREAT GATSBY", "author": "FITZGERALD"}
        result = text_normalize.normalize_book_fields(book, apply_casing=False)
        assert result["title"] == "THE GREAT GATSBY"

    def test_mutates_in_place(self):
        book = {"title": "  KAFKA  ", "author": "FRANZ  KAFKA"}
        result = text_normalize.normalize_book_fields(book)
        assert result is book  # same object
        assert book["title"] == "Kafka"
        assert book["author"] == "Franz Kafka"

    def test_mixed_case_not_altered(self):
        """Already properly cased text should not be changed."""
        book = {"title": "Harry Potter", "author": "J.K. Rowling"}
        text_normalize.normalize_book_fields(book)
        assert book["title"] == "Harry Potter"
        assert book["author"] == "J.K. Rowling"


# ── _is_roman_numeral ──────────────────────────────────────────────

class TestIsRomanNumeral:
    def test_basic_numerals(self):
        for numeral in ("I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"):
            assert text_normalize._is_roman_numeral(numeral), f"{numeral} should be Roman"

    def test_larger_numerals(self):
        assert text_normalize._is_roman_numeral("XIV")
        assert text_normalize._is_roman_numeral("XX")
        assert text_normalize._is_roman_numeral("XLII")

    def test_not_roman(self):
        assert not text_normalize._is_roman_numeral("HELLO")
        assert not text_normalize._is_roman_numeral("ABC")
        assert not text_normalize._is_roman_numeral("")
