# ADR 006: Gemini Vision for book spine recognition fallback

- **Status:** Accepted
- **Date:** 2026-03-21

## Context

The initial image-processing pipeline used local OCR to extract text when barcode detection failed.
In practice, spine photos frequently have angled text, low contrast, and cluttered backgrounds where
traditional OCR produced unstable results.

## Decision

Keep `pyzbar` barcode detection as the first step. When no barcode is detected, call Gemini Vision to
extract structured spine metadata (`title`, `author`, optional `isbn`) from the image.

## Consequences

### Positive
- Better resilience for non-ideal spine photos and cover images.
- Simpler worker container image (no Tesseract runtime dependency).
- Structured JSON response can be normalized before metadata enrichment.

### Tradeoffs
- Introduces a managed AI API dependency and request latency variance.
- Requires secure handling of `GEMINI_API_KEY` in environment/secrets.
- Adds provider-specific prompt and response parsing logic that must be maintained.
