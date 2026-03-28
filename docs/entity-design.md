# Entity Design — Shelfy

> **Status:** Phase 0 deliverable  
> **Last updated:** 2026-03-28  
> This document is the authoritative reference for all data models.
> Update it before adding new fields or relations.

---

## Overview

```
User ──< Book >── Location
              │
              ├─< Loan
              │
              └─< ImageProcessingTask
```

- **User** — single admin user (seeded from env); owns everything
- **Location** — physical place in the house (room / furniture / shelf)
- **Book** — the core entity; optionally linked to a Location
- **Loan** — lending history record for one lend/return cycle
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
| `processing_status` | ENUM NOT NULL | default "manual"; see BookProcessingStatus below |
| `created_at` | TIMESTAMP WITH TIME ZONE | server default now() |
| `updated_at` | TIMESTAMP WITH TIME ZONE | auto-updated |

#### ReadingStatus enum

```python
class ReadingStatus(str, Enum):
    UNREAD = "unread"
    READING = "reading"
    READ = "read"
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
- `reading_status` is independent from lending. A book can be `read` and also currently lent.
- Current lending state is derived from whether there is an active `Loan` (`returned_date IS NULL`).
- `processing_status` replaced the original `source` enum to better represent
  the async processing pipeline states.


---

### Loan

Introduced post-Phase 13 to support lending history and return tracking.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `book_id` | UUID FK → Book NOT NULL | CASCADE on book delete |
| `borrower_name` | VARCHAR(255) NOT NULL | required |
| `borrower_contact` | VARCHAR(255) | nullable (email/phone) |
| `lent_date` | DATE NOT NULL | defaults to current date |
| `due_date` | DATE | nullable |
| `returned_date` | DATE | nullable; NULL means active loan |
| `return_condition` | VARCHAR(50) | nullable; set on return (`perfect/good/fair/damaged/lost`) |
| `notes` | TEXT | nullable |
| `created_at` | TIMESTAMP WITH TIME ZONE | server default now() |

#### Notes

- One book may have many historical loans but at most one active loan at a time.
- Loan history is immutable audit data except admin delete operations.

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
| Loan → Book | many-to-one | CASCADE DELETE |
| ImageProcessingTask → Book | many-to-one | CASCADE DELETE |

---

## Indexes

| Table | Index | Reason |
|---|---|---|
| `books` | `ix_books_isbn` | lookup by ISBN |
| `books` | `ix_books_location_id` | list books by location |
| `books` | `ix_books_title` (gin/trgm) | full-text title search (Phase 8) |
| `loans` | `ix_loans_book_id` | list loans by book efficiently |
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
