# Entity Design — Shelfy

> **Status:** Phase 0 deliverable  
> **Last updated:** 2026-03-12  
> This document is the authoritative reference for all data models.
> Update it before adding new fields or relations.

---

## Overview

```
User ──< Book >── Location
              │
              └─< ImageProcessingTask
```

- **User** — single admin user (seeded from env); owns everything
- **Location** — physical place in the house (room / furniture / shelf)
- **Book** — the core entity; optionally linked to a Location
- **ImageProcessingTask** — async Celery job that processes a book cover photo

---

## Entities

### User

Already implemented in Phase 2. Shown here for completeness.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `email` | VARCHAR(255) UNIQUE NOT NULL | |
| `hashed_password` | VARCHAR(255) NOT NULL | bcrypt |
| `is_active` | BOOLEAN DEFAULT TRUE | |
| `created_at` | TIMESTAMP WITH TIME ZONE | server default now() |
| `updated_at` | TIMESTAMP WITH TIME ZONE | auto-updated |

---

### Location

Already implemented in Phase 3.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `room` | VARCHAR(100) NOT NULL | e.g. "Office" |
| `furniture` | VARCHAR(100) NOT NULL | e.g. "Bookshelf" |
| `shelf` | VARCHAR(100) NOT NULL | e.g. "Shelf 2" |
| `created_at` | TIMESTAMP WITH TIME ZONE | server default now() |
| `updated_at` | TIMESTAMP WITH TIME ZONE | auto-updated |

Delete is blocked (409) when any Book references this Location.

---

### Book

Core entity. Introduced in Phase 5. Extended with reading status fields post-Phase 13.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `title` | VARCHAR(500) NOT NULL | |
| `author` | VARCHAR(500) | nullable; some books have no author |
| `isbn` | VARCHAR(20) UNIQUE | nullable; not all books have ISBN |
| `publisher` | VARCHAR(300) | nullable |
| `publication_year` | INTEGER | nullable |
| `language` | VARCHAR(10) | nullable; ISO 639-1, e.g. "cs", "en" |
| `description` | TEXT | nullable |
| `cover_image_url` | VARCHAR(500) | nullable; MinIO presigned URL or external URL |
| `location_id` | UUID FK → Location | nullable; RESTRICT on location delete |
| `reading_status` | ENUM | nullable; default "unread"; see ReadingStatus below |
| `lent_to` | VARCHAR(300) | nullable; name of person book is lent to |
| `processing_status` | ENUM NOT NULL | default "manual"; see BookProcessingStatus below |
| `created_at` | TIMESTAMP WITH TIME ZONE | server default now() |
| `updated_at` | TIMESTAMP WITH TIME ZONE | auto-updated |

#### ReadingStatus enum

```python
class ReadingStatus(str, Enum):
    UNREAD = "unread"
    READING = "reading"
    READ = "read"
    LENT = "lent"
```

#### BookProcessingStatus enum

```python
class BookProcessingStatus(str, Enum):
    MANUAL = "manual"       # user typed it in
    PENDING = "pending"     # processing job queued
    DONE = "done"           # processing completed successfully
    FAILED = "failed"       # processing failed
    PARTIAL = "partial"     # metadata incomplete (API fallback failed)
```

#### Notes

- `cover_image_url` stores a URL (presigned MinIO or external). Column was renamed
  from the original spec's `cover_image_key` during implementation.
- `isbn` has a UNIQUE constraint but is nullable (NULL ≠ NULL in SQL).
- Deleting a Location is RESTRICTED when books reference it (returns 409).
  This differs from the original spec (SET NULL) — decided during Phase 5 implementation.
- `reading_status` defaults to "unread". When set to "lent", the `lent_to` field
  should contain the borrower's name.
- `processing_status` replaced the original `source` enum to better represent
  the async processing pipeline states.

---

### ImageProcessingTask

Introduced in Phase 7 (Vision pipeline). Represents one Celery job
that processes a photo to extract book metadata.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | also used as the Celery task ID |
| `book_id` | UUID FK → Book NOT NULL | CASCADE on book delete |
| `original_image_key` | VARCHAR(500) NOT NULL | MinIO object key of the uploaded photo |
| `status` | ENUM NOT NULL | see TaskStatus below |
| `result` | JSONB | nullable; raw Vision API / OCR output |
| `error_message` | TEXT | nullable; populated on FAILED status |
| `created_at` | TIMESTAMP WITH TIME ZONE | server default now() |
| `updated_at` | TIMESTAMP WITH TIME ZONE | auto-updated |

#### TaskStatus enum

```python
class TaskStatus(str, Enum):
    PENDING = "pending"         # job queued, not yet picked up
    PROCESSING = "processing"   # Celery worker is running
    DONE = "done"               # finished successfully
    FAILED = "failed"           # unrecoverable error
```

#### Notes

- One Book can have multiple ImageProcessingTasks (e.g. user retries).
- The `result` JSONB stores the raw response from the Vision LLM so it can be
  re-parsed later without re-calling the API.
- A `DONE` task does not automatically update the Book — the service layer
  applies the result and creates a separate audit trail.

---

## Relationships summary

| Relationship | Cardinality | FK behaviour |
|---|---|---|
| Book → Location | many-to-one (optional) | RESTRICT on location delete |
| ImageProcessingTask → Book | many-to-one | CASCADE DELETE |

---

## Indexes

| Table | Index | Reason |
|---|---|---|
| `books` | `ix_books_isbn` | lookup by ISBN |
| `books` | `ix_books_location_id` | list books by location |
| `books` | `ix_books_title` (gin/trgm) | full-text title search (Phase 8) |
| `image_processing_tasks` | `ix_tasks_book_id` | list tasks for a book |
| `image_processing_tasks` | `ix_tasks_status` | worker queue polling |

> Full-text index on `title` is deferred to Phase 8 (Search). Add as a
> separate Alembic migration.

---

## Out of scope (future)

| Feature | Notes |
|---|---|
| Tag / genre | Not planned for v1 |
| Multi-user / shared library | Not planned for v1 |
| Real-time barcode scanning from camera | Not planned for v1 |
| Import/export (CSV, Goodreads) | Candidate for v1.1 |
