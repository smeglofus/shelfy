from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gemini_parser import parse_gemini_candidates, parse_gemini_text_blob


def test_parse_gemini_candidates_json_array() -> None:
    payload: dict[str, object] = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "text": (
                                '[{"title":"Dune","author":"Frank Herbert","isbn":null,'
                                '"observed_text":"Dune Frank Herbert","confidence":"high"}]'
                            )
                        }
                    ]
                }
            }
        ]
    }

    result = parse_gemini_candidates(payload)

    assert result is not None
    items, parse_method = result
    assert parse_method == "json_array"
    assert len(items) == 1
    assert items[0].title == "Dune"
    assert items[0].author == "Frank Herbert"
    assert items[0].confidence == "high"


def test_parse_gemini_candidates_json_object_fallback() -> None:
    payload: dict[str, object] = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "text": (
                                '{"title":"The Trial","author":"Franz Kafka","isbn":null,'
                                '"observed_text":"The Trial Franz Kafka","confidence":"medium"}'
                            )
                        }
                    ]
                }
            }
        ]
    }

    result = parse_gemini_candidates(payload)

    assert result is not None
    items, parse_method = result
    assert parse_method == "json_object_fallback"
    assert len(items) == 1
    assert items[0].title == "The Trial"


def test_parse_gemini_text_blob_skips_invalid_confidence() -> None:
    blob = (
        "["
        '{"title":"A","author":"B","isbn":null,"observed_text":"A B","confidence":"unknown"},'
        '{"title":"Clean","author":"Row","isbn":null,"observed_text":"Clean Row","confidence":"low"}'
        "]"
    )

    result = parse_gemini_text_blob(blob)

    assert result is not None
    items, parse_method = result
    assert parse_method == "json_array"
    assert len(items) == 1
    assert items[0].title == "Clean"
    assert items[0].confidence == "low"
