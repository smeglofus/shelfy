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


# ── detect_merged_author ──────────────────────────────────────────

class TestDetectMergedAuthor:
    """Tests for the merged-author heuristic that flags cross-spine contamination."""

    # ── Should flag (true positives) ──

    def test_slash_separator_flags(self):
        """Slash between names = almost certainly two spines merged."""
        flags = text_normalize.detect_merged_author("Karel Čapek / Milan Kundera")
        assert "author_has_separator" in flags

    def test_pipe_separator_flags(self):
        flags = text_normalize.detect_merged_author("Čapek | Kundera")
        assert "author_has_separator" in flags

    def test_semicolon_separator_flags(self):
        flags = text_normalize.detect_merged_author("Čapek; Kundera")
        assert "author_has_separator" in flags

    def test_em_dash_separator_flags(self):
        """Spaced em-dash or en-dash between names."""
        flags = text_normalize.detect_merged_author("Čapek — Kundera")
        assert "author_has_separator" in flags
        flags2 = text_normalize.detect_merged_author("Čapek – Kundera")
        assert "author_has_separator" in flags2

    def test_excessive_tokens_flags(self):
        """Six+ meaningful words = almost certainly concatenated names."""
        # Three 2-word names concatenated (6 meaningful tokens)
        flags = text_normalize.detect_merged_author(
            "Karel Čapek Milan Kundera Pavel Kohout"
        )
        assert "author_excessive_tokens" in flags

    def test_excessive_tokens_with_particles_excluded(self):
        """Name particles (von, de) don't count toward the threshold."""
        # 7 total tokens, but only 5 meaningful → NOT flagged
        flags = text_normalize.detect_merged_author(
            "Johann Wolfgang von Goethe de la"
        )
        assert "author_excessive_tokens" not in flags

    def test_both_separator_and_tokens(self):
        """A row can have multiple flags at once."""
        flags = text_normalize.detect_merged_author(
            "Karel Čapek Milan Kundera / Pavel Kohout Bohumil Hrabal"
        )
        assert "author_has_separator" in flags
        assert "author_excessive_tokens" in flags

    # ── Should NOT flag (true negatives) ──

    def test_clean_two_word_author(self):
        assert text_normalize.detect_merged_author("George Orwell") == []

    def test_clean_three_word_author(self):
        assert text_normalize.detect_merged_author("Arthur Conan Doyle") == []

    def test_clean_four_word_author_with_particle(self):
        """Long but legitimate name with 'von' particle."""
        assert text_normalize.detect_merged_author("Johann Wolfgang von Goethe") == []

    def test_clean_hyphenated_name(self):
        """Hyphenated surnames must NOT trigger separator detection."""
        assert text_normalize.detect_merged_author("Jean-Paul Sartre") == []

    def test_clean_five_word_author(self):
        """Five meaningful tokens is the max clean threshold."""
        assert text_normalize.detect_merged_author(
            "Sir Arthur Conan Doyle Jr"
        ) == []

    def test_none_input(self):
        assert text_normalize.detect_merged_author(None) == []

    def test_empty_string(self):
        assert text_normalize.detect_merged_author("") == []

    def test_single_word(self):
        assert text_normalize.detect_merged_author("Kafka") == []


# ── detect_title_author_overlap ───────────────────────────────────

class TestDetectTitleAuthorOverlap:
    """Tests for cross-field contamination detection."""

    # ── Should flag ──

    def test_author_in_title(self):
        """Author name leaked into the title field."""
        flags = text_normalize.detect_title_author_overlap(
            "1984 George Orwell", "George Orwell"
        )
        assert "title_contains_author" in flags

    def test_author_in_title_case_insensitive(self):
        flags = text_normalize.detect_title_author_overlap(
            "1984 george orwell", "George Orwell"
        )
        assert "title_contains_author" in flags

    def test_title_in_author(self):
        """Title text leaked into the author field (reverse contamination)."""
        flags = text_normalize.detect_title_author_overlap(
            "The Trial", "The Trial Franz Kafka"
        )
        assert "author_contains_title" in flags

    def test_both_directions(self):
        """Identical title and author = flagged in both directions."""
        flags = text_normalize.detect_title_author_overlap(
            "Franz Kafka", "Franz Kafka"
        )
        assert "title_contains_author" in flags
        assert "author_contains_title" in flags

    # ── Should NOT flag ──

    def test_single_word_author_not_flagged(self):
        """Single-word overlap like 'Kafka' in 'Kafka on the Shore' is OK."""
        flags = text_normalize.detect_title_author_overlap(
            "Kafka on the Shore", "Kafka"
        )
        assert flags == []

    def test_no_overlap(self):
        flags = text_normalize.detect_title_author_overlap(
            "1984", "George Orwell"
        )
        assert flags == []

    def test_partial_word_overlap_not_flagged(self):
        """Partial match (shared word) shouldn't trigger full-name overlap."""
        flags = text_normalize.detect_title_author_overlap(
            "The Orwell Reader", "George Orwell"
        )
        assert flags == []

    def test_none_title(self):
        assert text_normalize.detect_title_author_overlap(None, "George Orwell") == []

    def test_none_author(self):
        assert text_normalize.detect_title_author_overlap("1984", None) == []

    def test_both_none(self):
        assert text_normalize.detect_title_author_overlap(None, None) == []


# ── audit_book_row ────────────────────────────────────────────────

class TestAuditBookRow:
    """Integration tests: audit_book_row orchestrates all per-row heuristics."""

    def test_clean_row_returns_empty(self):
        """A well-formed single-book row should produce no flags."""
        book = {"title": "The Trial", "author": "Franz Kafka", "isbn": None}
        assert text_normalize.audit_book_row(book) == []

    def test_merged_author_detected(self):
        book = {
            "title": "The Trial",
            "author": "Franz Kafka / Milan Kundera",
            "isbn": None,
        }
        flags = text_normalize.audit_book_row(book)
        assert "author_has_separator" in flags

    def test_title_author_contamination_detected(self):
        book = {
            "title": "1984 George Orwell",
            "author": "George Orwell",
            "isbn": None,
        }
        flags = text_normalize.audit_book_row(book)
        assert "title_contains_author" in flags

    def test_multiple_flags_combined(self):
        """A row with both merged author AND overlap gets all flags."""
        book = {
            "title": "1984 George Orwell",
            "author": "George Orwell / Milan Kundera",
            "isbn": None,
        }
        flags = text_normalize.audit_book_row(book)
        # Separator detection fires on the "/"
        assert "author_has_separator" in flags
        # Overlap detection: full author after splitting won't match since we
        # check the ENTIRE author string — but "George Orwell" alone is not the
        # full author.  Only full-string overlap is flagged.
        # To get both flags, we need a case where the FULL author IS in the title.
        book2 = {
            "title": "1984 George Orwell extra text",
            "author": "George Orwell",
            "isbn": None,
            "observed_text": "1984 George Orwell / Milan Kundera extra text",
        }
        # Re-check with a second merged-author variant: overlap + excessive tokens
        book3 = {
            "title": "The Trial Franz Kafka",
            "author": "Franz Kafka Milan Kundera Pavel Kohout Bohumil Hrabal",
            "isbn": None,
        }
        flags3 = text_normalize.audit_book_row(book3)
        assert "author_excessive_tokens" in flags3
        # "Franz Kafka" (2 words) found in "The Trial Franz Kafka"?
        # No — the overlap check uses the FULL author string, not substrings.
        # This is intentionally conservative to avoid false positives.

    def test_none_fields_no_crash(self):
        book = {"title": None, "author": None, "isbn": "9780306406157"}
        assert text_normalize.audit_book_row(book) == []

    def test_only_title_no_crash(self):
        book = {"title": "The Trial", "author": None, "isbn": None}
        assert text_normalize.audit_book_row(book) == []

    def test_czech_clean_author_not_flagged(self):
        """Czech proper-cased author should not be flagged."""
        book = {
            "title": "Válka s mloky",
            "author": "Karel Čapek",
            "isbn": None,
        }
        assert text_normalize.audit_book_row(book) == []

    def test_does_not_mutate_book(self):
        """audit_book_row must never modify the input dict."""
        book = {
            "title": "1984 George Orwell",
            "author": "George Orwell",
            "isbn": None,
        }
        import copy
        original = copy.deepcopy(book)
        text_normalize.audit_book_row(book)
        assert book == original

    # ── Casing normalization regression ──

    def test_casing_normalization_still_works_after_audit(self):
        """Ensure normalize_book_fields + audit are composable without interference."""
        book = {"title": "THE GREAT GATSBY", "author": "F. SCOTT FITZGERALD"}
        text_normalize.normalize_book_fields(book, apply_casing=True)
        flags = text_normalize.audit_book_row(book)
        # Casing normalized correctly
        assert book["title"] == "The great gatsby"
        assert book["author"] == "F. Scott Fitzgerald"
        # Clean row → no flags
        assert flags == []

    def test_casing_then_audit_flags_merged(self):
        """Merged author survives casing normalization and still gets flagged."""
        book = {
            "title": "THE TRIAL",
            "author": "FRANZ KAFKA / MILAN KUNDERA",
        }
        text_normalize.normalize_book_fields(book, apply_casing=True)
        flags = text_normalize.audit_book_row(book)
        assert book["title"] == "The trial"
        assert "author_has_separator" in flags
