from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError


class GeminiBookCandidate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str | None = None
    author: str | None = None
    isbn: str | None = None
    observed_text: str | None = None
    confidence: Literal["high", "medium", "low"] = "medium"


class GeminiResponsePart(BaseModel):
    model_config = ConfigDict(extra="ignore")

    text: str | None = None


class GeminiResponseContent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    parts: list[GeminiResponsePart] = []


class GeminiResponseCandidate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    content: GeminiResponseContent


class GeminiGenerateContentResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    candidates: list[GeminiResponseCandidate] = []


def _extract_json_object(text: str) -> dict[str, object] | None:
    start_index = text.find("{")
    end_index = text.rfind("}")
    if start_index == -1 or end_index == -1 or end_index <= start_index:
        return None

    try:
        parsed = json.loads(text[start_index : end_index + 1])
    except json.JSONDecodeError:
        return None

    return parsed if isinstance(parsed, dict) else None


def _extract_json_array(text: str) -> list[dict[str, object]] | None:
    start_index = text.find("[")
    end_index = text.rfind("]")
    if start_index == -1 or end_index == -1 or end_index <= start_index:
        return None

    try:
        parsed = json.loads(text[start_index : end_index + 1])
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed, list):
        return None

    out: list[dict[str, object]] = []
    for item in parsed:
        if isinstance(item, dict):
            out.append(item)
    return out or None


def parse_gemini_text_blob(text_blob: str) -> tuple[list[GeminiBookCandidate], str] | None:
    parsed_array = _extract_json_array(text_blob)
    parse_method = "json_array"
    if parsed_array is None:
        parsed_obj = _extract_json_object(text_blob)
        if parsed_obj is None:
            return None
        parsed_array = [parsed_obj]
        parse_method = "json_object_fallback"

    items: list[GeminiBookCandidate] = []
    for raw_item in parsed_array:
        try:
            items.append(GeminiBookCandidate.model_validate(raw_item))
        except ValidationError:
            continue
    return (items, parse_method) if items else None


def parse_gemini_candidates(payload: dict[str, object]) -> tuple[list[GeminiBookCandidate], str] | None:
    try:
        response = GeminiGenerateContentResponse.model_validate(payload)
    except ValidationError:
        return None

    if not response.candidates:
        return None

    text_blocks = [part.text for part in response.candidates[0].content.parts if part.text]
    if not text_blocks:
        return None

    return parse_gemini_text_blob("\n".join(text_blocks))
