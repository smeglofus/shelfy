"""Unit tests for the title-only enrichment trust guard (pure logic)."""
from __future__ import annotations

from app.services.metadata.match import (
    authors_match,
    normalize_for_compare,
    similarity,
    title_lookup_result_is_trustworthy,
)


class TestNormalizeForCompare:
    def test_strips_diacritics_and_case(self) -> None:
        assert normalize_for_compare("Příběh LÁSKY") == "pribeh lasky"

    def test_strips_punctuation_and_collapses_whitespace(self) -> None:
        assert normalize_for_compare("  Vojna a  mír! ") == "vojna a mir"


class TestSimilarity:
    def test_identical_ignoring_diacritics(self) -> None:
        assert similarity("Válka s mloky", "Valka s Mloky") == 1.0

    def test_none_inputs(self) -> None:
        assert similarity(None, "x") == 0.0
        assert similarity("x", None) == 0.0


class TestAuthorsMatch:
    def test_shared_surname_across_order_and_diacritics(self) -> None:
        assert authors_match("Karel Capek", "Čapek, Karel") is True

    def test_ignores_life_dates(self) -> None:
        assert authors_match("Jan Budař", "Jan Budař, 1977-") is True

    def test_different_authors(self) -> None:
        assert authors_match("Honza Vojtek", "Jarmila Maršálová") is False

    def test_initials_do_not_manufacture_match(self) -> None:
        assert authors_match("J. K. Rowling", "J. R. R. Tolkien") is False

    def test_missing_side(self) -> None:
        assert authors_match(None, "Karel Čapek") is False


class TestTitleLookupResultIsTrustworthy:
    def test_rejects_same_title_conflicting_author(self) -> None:
        # The reported bug.
        assert title_lookup_result_is_trustworthy(
            "Příběh lásky", "Honza Vojtek", "Příběh lásky", "Jarmila Maršálová"
        ) is False

    def test_accepts_matching_title_and_author(self) -> None:
        assert title_lookup_result_is_trustworthy(
            "Válka s mloky", "Karel Čapek", "Válka s mloky", "Karel Čapek"
        ) is True

    def test_author_match_tolerates_subtitle(self) -> None:
        assert title_lookup_result_is_trustworthy(
            "Válka s mloky", "Karel Čapek", "Válka s mloky (2. vydání)", "Karel Čapek"
        ) is True

    def test_accepts_when_query_has_no_author(self) -> None:
        assert title_lookup_result_is_trustworthy(
            "Válka s mloky", None, "Válka s mloky", "Karel Čapek"
        ) is True

    def test_accepts_when_record_has_no_author(self) -> None:
        assert title_lookup_result_is_trustworthy(
            "Válka s mloky", "Karel Čapek", "Válka s mloky", None
        ) is True

    def test_rejects_clearly_different_title(self) -> None:
        assert title_lookup_result_is_trustworthy(
            "Válka s mloky", "Karel Čapek", "Harry Potter", "Karel Čapek"
        ) is False

    def test_rejects_weak_title_when_no_author_to_corroborate(self) -> None:
        # Author absent on the query side, so the title alone must carry it and
        # a subtitle-heavy variant no longer clears the stricter bar.
        assert title_lookup_result_is_trustworthy(
            "Láska", None, "Láska nebeská a jiné povídky", None
        ) is False


class TestTitleLookupSubtitleContainment:
    def test_accepts_catalog_subtitle_when_author_matches(self) -> None:
        assert title_lookup_result_is_trustworthy(
            "Příběh lásky", "Honza Vojtko",
            "Příběh lásky : jak a proč milujeme", "Honza Vojtko",
        ) is True

    def test_rejects_different_book_by_same_author(self) -> None:
        assert title_lookup_result_is_trustworthy(
            "Morana Mařena", "Honza Vojtko", "Vztahy a pasti", "Honza Vojtko"
        ) is False

    def test_subtitle_containment_needs_author(self) -> None:
        assert title_lookup_result_is_trustworthy(
            "Příběh lásky", None, "Příběh lásky : jak a proč milujeme", None
        ) is False
