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

## Update 2026-11-10 — configurable model, paid tier requirement

- `gemini-2.5-flash` shuts down on 2026-12-01 (issue #336). The model is now
  configurable via `GEMINI_MODEL` (default `gemini-3.8-flash`) and both scan
  paths share one request helper (`_call_gemini` in `worker/celery_app.py`).
- `GEMINI_THINKING_LEVEL` (default `low`) caps Gemini 3 reasoning tokens —
  spine transcription needs little reasoning and the model default (`high`)
  multiplies output cost. A 400 on the thinking config retries without it.
- Photos are downscaled to `GEMINI_IMAGE_MAX_SIDE` (default 2048 px) before
  upload; Gemini resamples to its own token budget anyway.
- The Gemini API Additional Terms (effective 2026-03-23) allow only **Paid
  Services** when serving users in the EEA/CH/UK, so the production key must
  belong to a billing-enabled project. The free tier is not an option for
  Shelfy, and a "bring your own key" model was considered and rejected
  (storing third-party API keys is a liability out of proportion to the
  savings).
