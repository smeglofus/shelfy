"""Tests for catalog_match — fuzzy verification of shelf scans against Open Library."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import catalog_match


class TestNormalizeForCompare:
    def test_strips_diacritics_and_case(self):
        assert catalog_match.normalize_for_compare("Tibetská KNIHA") == "tibetska kniha"

    def test_strips_punctuation(self):
        assert catalog_match.normalize_for_compare("Vojna a mír!") == "vojna a mir"

    def test_collapses_whitespace(self):
        assert catalog_match.normalize_for_compare("  a   b  ") == "a b"


class TestSimilarity:
    def test_identical(self):
        assert catalog_match.similarity("Válka s mloky", "Válka s mloky") == 1.0

    def test_diacritics_and_case_insensitive(self):
        assert catalog_match.similarity("Valka s mloky", "Válka s Mloky") == 1.0

    def test_none_inputs(self):
        assert catalog_match.similarity(None, "x") == 0.0
        assert catalog_match.similarity("x", None) == 0.0
        assert catalog_match.similarity(None, None) == 0.0

    def test_unrelated_titles_score_low(self):
        score = catalog_match.similarity(
            "Válka s mloky", "Harry Potter and the Philosopher's Stone"
        )
        assert score < catalog_match.SUGGEST_THRESHOLD


class TestEvaluateMatch:
    def test_diacritics_only_difference_adopts(self):
        decision, score = catalog_match.evaluate_match(
            "Tibetska kniha o zivote a smrti",
            "sogjal rinpočhe",
            "Tibetská kniha o životě a smrti",
            "Sogjal Rinpočhe",
        )
        assert decision == "adopt"
        assert score == 1.0

    def test_ocr_misread_becomes_suggestion(self):
        """The canonical failure mode: vision snaps to nearby plausible words."""
        decision, _score = catalog_match.evaluate_match(
            "Nastavení miminka", None, "Nastávající maminky", None
        )
        assert decision == "suggest"

    def test_unrelated_book_ignored(self):
        decision, _score = catalog_match.evaluate_match(
            "Válka s mloky", "Karel Čapek", "Harry Potter", "J. K. Rowling"
        )
        assert decision == "none"

    def test_author_mismatch_blocks_silent_adopt(self):
        """Identical title but different author must not be adopted silently."""
        decision, _score = catalog_match.evaluate_match(
            "Válka s mloky", "Karel Čapek", "Válka s mloky", "Jaroslav Hašek"
        )
        assert decision == "suggest"

    def test_missing_authors_fall_back_to_title_only(self):
        decision, score = catalog_match.evaluate_match(
            "Válka s mloky", None, "Válka s mloky", None
        )
        assert decision == "adopt"
        assert score == 1.0


class TestApplyCatalogMatch:
    def test_adopt_replaces_fields_and_flags(self):
        item: dict[str, object] = {
            "title": "tibetska kniha o zivote a smrti",
            "author": "sogjal rinpočhe",
            "confidence": "medium",
        }
        decision = catalog_match.apply_catalog_match(
            item, "Tibetská kniha o životě a smrti", "Sogjal Rinpočhe"
        )
        assert decision == "adopt"
        assert item["title"] == "Tibetská kniha o životě a smrti"
        assert item["author"] == "Sogjal Rinpočhe"
        assert "catalog_adopted" in item["quality_flags"]
        # Adoption is not a reason for review
        assert item["confidence"] == "medium"

    def test_adopt_fills_missing_author(self):
        item: dict[str, object] = {"title": "Válka s mloky", "author": None}
        decision = catalog_match.apply_catalog_match(item, "Válka s mloky", "Karel Čapek")
        assert decision == "adopt"
        assert item["author"] == "Karel Čapek"

    def test_suggest_attaches_suggestion_and_downgrades(self):
        item: dict[str, object] = {
            "title": "Nastavení miminka",
            "author": None,
            "confidence": "high",
        }
        decision = catalog_match.apply_catalog_match(item, "Nastávající maminky", None)
        assert decision == "suggest"
        # Scanned values stay untouched — the human decides
        assert item["title"] == "Nastavení miminka"
        assert item["suggested_title"] == "Nastávající maminky"
        assert item["confidence"] == "needs_review"
        assert "catalog_mismatch" in item["quality_flags"]

    def test_none_leaves_item_untouched(self):
        item: dict[str, object] = {
            "title": "Válka s mloky",
            "author": "Karel Čapek",
            "confidence": "high",
        }
        decision = catalog_match.apply_catalog_match(item, "Harry Potter", "J. K. Rowling")
        assert decision == "none"
        assert item == {
            "title": "Válka s mloky",
            "author": "Karel Čapek",
            "confidence": "high",
        }

    def test_suggest_appends_to_existing_flags(self):
        item: dict[str, object] = {
            "title": "Nastavení miminka",
            "author": None,
            "confidence": "needs_review",
            "quality_flags": ["author_has_separator"],
        }
        catalog_match.apply_catalog_match(item, "Nastávající maminky", None)
        assert item["quality_flags"] == ["author_has_separator", "catalog_mismatch"]


class TestAuthorsMatch:
    def test_shared_surname_matches_across_order(self):
        assert catalog_match.authors_match("Karel Čapek", "Čapek, Karel") is True

    def test_diacritics_insensitive(self):
        assert catalog_match.authors_match("Karel Capek", "Karel Čapek") is True

    def test_ignores_life_dates(self):
        assert catalog_match.authors_match("Jan Budař", "Jan Budař, 1977-") is True

    def test_different_authors_do_not_match(self):
        assert catalog_match.authors_match("Honza Vojtek", "Jarmila Maršálová") is False

    def test_short_tokens_never_manufacture_a_match(self):
        # Only two-letter/initial tokens in common must not count as a match.
        assert catalog_match.authors_match("J. K. Rowling", "J. R. R. Tolkien") is False

    def test_missing_side_is_not_a_match(self):
        assert catalog_match.authors_match(None, "Karel Čapek") is False
        assert catalog_match.authors_match("Karel Čapek", None) is False


class TestTitleLookupResultIsTrustworthy:
    def test_rejects_same_title_different_author(self):
        # The reported bug: generic title "Příběh lásky" scanned as Honza
        # Vojtek's book; knihovny.cz returns a stranger's identically-titled
        # record. Identical title, conflicting author -> must be rejected.
        assert catalog_match.title_lookup_result_is_trustworthy(
            "Příběh lásky", "Honza Vojtek", "Příběh lásky", "Jarmila Maršálová"
        ) is False

    def test_accepts_matching_title_and_author(self):
        assert catalog_match.title_lookup_result_is_trustworthy(
            "Válka s mloky", "Karel Čapek", "Válka s mloky", "Karel Čapek"
        ) is True

    def test_accepts_when_query_has_no_author(self):
        # No author to discriminate on -> trust the title match rather than
        # gut coverage for spines scanned without an author.
        assert catalog_match.title_lookup_result_is_trustworthy(
            "Válka s mloky", None, "Válka s mloky", "Karel Čapek"
        ) is True

    def test_accepts_when_record_has_no_author(self):
        assert catalog_match.title_lookup_result_is_trustworthy(
            "Válka s mloky", "Karel Čapek", "Válka s mloky", None
        ) is True

    def test_rejects_clearly_different_title(self):
        assert catalog_match.title_lookup_result_is_trustworthy(
            "Válka s mloky", "Karel Čapek", "Harry Potter", "Karel Čapek"
        ) is False

    def test_tolerates_minor_title_variation_with_matching_author(self):
        assert catalog_match.title_lookup_result_is_trustworthy(
            "Válka s mloky", "Karel Čapek", "Válka s mloky (2. vydání)", "Karel Čapek"
        ) is True
