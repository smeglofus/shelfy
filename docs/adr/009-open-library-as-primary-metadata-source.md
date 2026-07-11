# ADR 009: Open Library as the primary (and default-only) book metadata source

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

The metadata enrichment pipeline (backend `app/services/metadata/` and its
duplicated copy in `worker/celery_app.py`) used **Google Books as the primary
provider** with Open Library as fallback.

The [Google Books API Terms of Service](https://developers.google.com/books/terms)
state:

> "You may not charge users any fee for the use of your application, unless
> you have entered into a separate agreement with Google or obtained Google's
> written permission."

and "The API is not intended to be used as a replacement for commercial
services." Shelfy is a paid product (Home/Pro/Library plans via Stripe). Even
with a free tier, the application as a whole charges for access, which puts
the previous default outside the ToS absent a separate agreement with Google.
The ToS also restricts persistent storage of results and requires Google-hosted
thumbnails to be displayed with attribution links — incompatible with our
Redis metadata cache and stored `cover_image_url`.

Open Library (Internet Archive) asserts no proprietary rights over its
database, so metadata can be cached and reused commercially. The trade-offs
are lower rate limits (1 req/s anonymous, 3 req/s with an identifying
User-Agent) and weaker coverage, especially for Czech books.

*This is an operational risk-reduction decision, not legal advice; a formal
legal review is recommended before launch. Long-term licensed sources are
tracked separately (#311).*

## Decision

1. **Open Library is the primary and, by default, the only metadata
   provider** in both the backend service and the Celery worker.
2. **Google Books stays in the codebase behind `ENABLE_GOOGLE_BOOKS`**
   (`enable_google_books: bool = False` in `app/core/config.py` and
   `worker/settings.py`). When enabled it restores the legacy order
   (Google primary, Open Library fallback) — only to be flipped if an
   agreement with Google exists. `google_books_api_key` remains but is
   unused while the flag is off.
3. **All Open Library requests send an identifying `User-Agent`**
   (`open_library_user_agent` setting) to qualify for the 3 req/s limit.
4. **Caching is strengthened** to compensate for the lower rate limits:
   hit TTL raised from 24 h to 7 days, and definitive misses (provider
   answered, no record) are negatively cached for 24 h as JSON `null`.
   Provider errors are never cached, so transient failures stay retryable.
5. **Covers are hotlinked from `covers.openlibrary.org`** — third-party
   thumbnails are never copied into our storage (cover licensing is a grey
   area even at Open Library; hotlinking is the safer posture).
6. **Product copy no longer promises "Google Books"** (welcome e-mail now
   says "public book catalogues").

## Consequences

- Compliance risk from the Google Books ToS is removed from the default
  production path.
- Czech-title coverage may degrade until a licensed source is integrated
  (#311); the enrichment status flow (`partial` + manual retry) already
  handles misses gracefully.
- The book-suggestion endpoint (#308) and any future catalogue features must
  build on Open Library, not Google Books.
- The worker keeps its own copy of the pipeline; both copies must stay in
  sync (flag + User-Agent are mirrored in `worker/settings.py`).
