from __future__ import annotations

import asyncio
import base64
from datetime import datetime
from enum import Enum
from functools import lru_cache
import json
import re
import uuid
from time import perf_counter

import structlog

import boto3
from celery import Celery
from celery.exceptions import Retry
import cv2
import httpx
import numpy as np
try:
    from pyzbar.pyzbar import decode as decode_barcodes
except ImportError:
    decode_barcodes = None
from redis import Redis
from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Integer, String, Text, Uuid, create_engine, exc, func, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from settings import worker_settings

CACHE_TTL_SECONDS = 24 * 60 * 60


def _configure_structlog() -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", key="timestamp"),
            structlog.processors.JSONRenderer(),
        ],
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
    structlog.contextvars.bind_contextvars(service="worker")


_configure_structlog()
logger = structlog.get_logger()


class Base(DeclarativeBase):
    pass


class ProcessingJobStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"


class BookProcessingStatus(str, Enum):
    MANUAL = "manual"
    PENDING = "pending"
    DONE = "done"
    FAILED = "failed"
    PARTIAL = "partial"


class Book(Base):
    __tablename__ = "books"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    author: Mapped[str | None] = mapped_column(String(500), nullable=True)
    isbn: Mapped[str | None] = mapped_column(String(20), nullable=True, unique=True, index=True)
    publisher: Mapped[str | None] = mapped_column(String(300), nullable=True)
    language: Mapped[str | None] = mapped_column(String(10), nullable=True)
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)
    publication_year: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    cover_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    processing_status: Mapped[BookProcessingStatus] = mapped_column(
        SAEnum(
            BookProcessingStatus,
            values_callable=lambda e: [member.value for member in e],
            validate_strings=True,
            name="book_processing_status",
            create_type=False,
        ),
        nullable=False,
        default=BookProcessingStatus.MANUAL,
    )


class BookImage(Base):
    __tablename__ = "book_images"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    book_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("books.id", ondelete="SET NULL"), nullable=True, index=True)
    minio_path: Mapped[str] = mapped_column(String(1024), nullable=False)


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    status: Mapped[ProcessingJobStatus] = mapped_column(
        SAEnum(
            ProcessingJobStatus,
            values_callable=lambda e: [member.value for member in e],
            validate_strings=True,
            name="processing_job_status",
            create_type=False,
        ),
        nullable=False,
        default=ProcessingJobStatus.PENDING,
    )
    book_image_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("book_images.id", ondelete="CASCADE"), nullable=False, index=True
    )
    result_json: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


def get_celery_app() -> Celery:
    broker_url = worker_settings.celery_broker_url
    backend_url = worker_settings.celery_result_backend

    app = Celery("shelfy_worker", broker=broker_url, backend=backend_url)
    app.conf.update(task_default_queue="default")
    return app


celery_app = get_celery_app()


@lru_cache(maxsize=1)
def _get_engine():
    database_url = worker_settings.database_url
    sync_database_url = database_url.replace("+asyncpg", "+psycopg2")
    return create_engine(sync_database_url, pool_pre_ping=True)


@lru_cache(maxsize=1)
def _get_redis_client() -> Redis:
    redis_url = worker_settings.redis_url
    return Redis.from_url(redis_url, decode_responses=True)


def _get_minio_client():
    endpoint = worker_settings.minio_endpoint
    access_key = worker_settings.minio_access_key
    secret_key = worker_settings.minio_secret_key
    if not access_key or not secret_key:
        raise RuntimeError("MINIO_ACCESS_KEY and MINIO_SECRET_KEY must be set")
    region = worker_settings.minio_region
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=region,
    )


def _download_image_bytes(minio_path: str) -> bytes:
    client = _get_minio_client()
    bucket = worker_settings.minio_bucket
    response = client.get_object(Bucket=bucket, Key=minio_path)
    body = response["Body"]
    try:
        return body.read()
    finally:
        body.close()


def _decode_image_bytes(image_bytes: bytes) -> np.ndarray:
    image_array = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Unable to decode image bytes")
    return image


def normalize_isbn(raw_value: str) -> str | None:
    cleaned = re.sub(r"[^0-9Xx]", "", raw_value).upper()
    if len(cleaned) == 10 and _is_valid_isbn10(cleaned):
        return cleaned
    if len(cleaned) == 13 and _is_valid_isbn13(cleaned):
        return cleaned
    return None


def _is_valid_isbn10(isbn10: str) -> bool:
    if not re.fullmatch(r"\d{9}[\dX]", isbn10):
        return False

    total = 0
    for index, char in enumerate(isbn10):
        value = 10 if char == "X" else int(char)
        total += value * (10 - index)
    return total % 11 == 0


def _is_valid_isbn13(isbn13: str) -> bool:
    if not re.fullmatch(r"\d{13}", isbn13):
        return False

    checksum = 0
    for index, char in enumerate(isbn13[:-1]):
        checksum += int(char) * (1 if index % 2 == 0 else 3)
    check_digit = (10 - (checksum % 10)) % 10
    return check_digit == int(isbn13[-1])


def _extract_isbn_from_text(text: str) -> str | None:
    matches = re.finditer(r"(?:97[89][\d\s-]{10,}|[\dXx][\d\s-]{8,}[\dXx])", text)
    for match in matches:
        normalized = normalize_isbn(match.group(0))
        if normalized is not None:
            return normalized
    return None


def _extract_title_author_from_text(text: str) -> tuple[str | None, str | None]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return None, None

    title = lines[0]
    author: str | None = None

    for line in lines[1:4]:
        lowered = line.lower()
        if lowered.startswith("by "):
            author = line[3:].strip() or None
            break

    if author is None and len(lines) >= 2:
        author = lines[1]

    return title, author


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


def _normalize_vision_result(parsed: dict[str, object]) -> dict[str, object] | None:
    observed_text = parsed.get("observed_text") if isinstance(parsed.get("observed_text"), str) else None
    candidate_isbn = parsed.get("isbn") if isinstance(parsed.get("isbn"), str) else None
    normalized_isbn = normalize_isbn(candidate_isbn or "") if candidate_isbn else None
    if normalized_isbn is None and observed_text:
        normalized_isbn = _extract_isbn_from_text(observed_text)

    title = parsed.get("title") if isinstance(parsed.get("title"), str) else None
    author = parsed.get("author") if isinstance(parsed.get("author"), str) else None

    if not (title or author or normalized_isbn):
        return None

    result: dict[str, object] = {
        "isbn": normalized_isbn,
        "title": title,
        "author": author,
        "source": "gemini_vision",
    }
    if observed_text:
        result["observed_text"] = observed_text
    return result
def _detect_mime_type(image_bytes: bytes) -> str:
    if image_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if image_bytes[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    return "image/jpeg"


def _detect_isbn_from_barcode(image: np.ndarray) -> str | None:
    if decode_barcodes is None:
        return None

    decoded = decode_barcodes(image)
    for item in decoded:
        normalized = normalize_isbn(item.data.decode("utf-8", errors="ignore"))
        if normalized is not None:
            return normalized
    return None


async def _extract_spine_metadata_with_gemini(image_bytes: bytes) -> list[dict[str, object]] | None:
    api_key = worker_settings.gemini_api_key
    if not api_key:
        logger.warning(
            "gemini_vision_disabled",
            processing_step="spine_recognition",
            reason="GEMINI_API_KEY not configured",
        )
        return None

    prompt = (
        "You are reading a photo of a book spine or cover. "
        "Return only strict JSON array. Each array item must be object with keys: title (string|null), author (string|null), "
        "isbn (string|null), observed_text (string|null). Do not include markdown."
    )
    mime_type = _detect_mime_type(image_bytes)
    request_payload: dict[str, object] = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {"inline_data": {"mime_type": mime_type, "data": base64.b64encode(image_bytes).decode("ascii")}},
                ]
            }
        ],
        "generationConfig": {"temperature": 0},
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
                params={"key": api_key},
                json=request_payload,
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "gemini_vision_http_error",
            processing_step="spine_recognition",
            status_code=exc.response.status_code,
        )
        return None
    except (httpx.RequestError, json.JSONDecodeError, ValueError) as exc:
        logger.warning(
            "gemini_vision_failed",
            processing_step="spine_recognition",
            error_type=type(exc).__name__,
        )
        return None

    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return None

    content = candidates[0].get("content", {})
    parts = content.get("parts", [])
    if not isinstance(parts, list):
        return None

    text_blocks = [part.get("text") for part in parts if isinstance(part, dict) and isinstance(part.get("text"), str)]
    if not text_blocks:
        return None

    blob = "\n".join(text_blocks)
    parsed_array = _extract_json_array(blob)
    parsed_items: list[dict[str, object]]
    if parsed_array is not None:
        parsed_items = parsed_array
    else:
        parsed_obj = _extract_json_object(blob)
        if parsed_obj is None:
            return None
        parsed_items = [parsed_obj]

    normalized_results: list[dict[str, object]] = []
    for parsed in parsed_items:
        normalized = _normalize_vision_result(parsed)
        if normalized is not None:
            normalized_results.append(normalized)

    return normalized_results or None


def _extract_metadata(image_bytes: bytes) -> tuple[list[dict[str, object]], ProcessingJobStatus, str | None]:
    image = _decode_image_bytes(image_bytes)

    barcode_isbn = _detect_isbn_from_barcode(image)
    if barcode_isbn is not None:
        return ([
            {
                "isbn": barcode_isbn,
                "title": None,
                "author": None,
                "source": "barcode",
            }
        ], ProcessingJobStatus.DONE, None)

    try:
        vision_result = asyncio.run(_extract_spine_metadata_with_gemini(image_bytes))
    except (httpx.RequestError, json.JSONDecodeError, ValueError) as exc:
        logger.warning(
            "gemini_vision_failed",
            processing_step="spine_recognition",
            error_type=type(exc).__name__,
        )
        vision_result = None

    if vision_result is not None:
        return (vision_result, ProcessingJobStatus.DONE, None)

    return ([
        {
            "isbn": None,
            "title": None,
            "author": None,
            "source": "none",
        }
    ], ProcessingJobStatus.FAILED, "No barcode detected and Gemini Vision returned no book metadata")


def _cache_key(isbn: str | None, title: str | None = None) -> str | None:
    if isbn:
        return f"book-metadata:{isbn}"
    if title:
        return f"book-metadata:title:{title.lower().strip()}"
    return None


async def _fetch_google_books_metadata(isbn: str | None, title: str | None = None, author: str | None = None) -> dict[str, object] | None:
    start = perf_counter()
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://www.googleapis.com/books/v1/volumes",
                params={"q": (f"isbn:{isbn}" if isbn else "+".join([p for p in [f"intitle:{title}" if title else "", f"inauthor:{author}" if author else ""] if p])), "maxResults": 1},
                timeout=10.0,
            )
            response.raise_for_status()
            payload = response.json()
    finally:
        logger.info("external_api_call", provider="google_books", isbn=isbn, title=title, author=author, processing_step="metadata_lookup", latency_seconds=perf_counter() - start)

    if not isbn and not title:
        return None

    items = payload.get("items")
    if not items:
        return None

    volume = items[0].get("volumeInfo", {})
    published_date = str(volume.get("publishedDate", ""))
    publication_year = int(published_date[:4]) if len(published_date) >= 4 and published_date[:4].isdigit() else None
    image_links = volume.get("imageLinks") or {}

    return {
        "title": volume.get("title"),
        "author": (volume.get("authors") or [None])[0],
        "isbn": isbn or None,
        "publisher": volume.get("publisher"),
        "language": volume.get("language"),
        "description": volume.get("description"),
        "publication_year": publication_year,
        "cover_image_url": image_links.get("thumbnail") or image_links.get("smallThumbnail"),
        "provider": "google_books",
    }


async def _fetch_open_library_metadata(isbn: str | None, title: str | None = None, author: str | None = None) -> dict[str, object] | None:
    start = perf_counter()
    try:
        async with httpx.AsyncClient() as client:
            if isbn:
                bib_key = f"ISBN:{isbn}"
                response = await client.get(
                    "https://openlibrary.org/api/books",
                    params={"bibkeys": bib_key, "format": "json", "jscmd": "data"},
                    timeout=10.0,
                )
            elif title:
                response = await client.get(
                    "https://openlibrary.org/search.json",
                    params={"title": title, "author": author or "", "limit": 1},
                    timeout=10.0,
                )
            else:
                return None
            response.raise_for_status()
            payload = response.json()
    finally:
        logger.info("external_api_call", provider="open_library", isbn=isbn, title=title, author=author, processing_step="metadata_lookup", latency_seconds=perf_counter() - start)

    if isbn:
        bib_key = f"ISBN:{isbn}"
        book_data = payload.get(bib_key)
        if not book_data:
            return None
    else:
        docs = payload.get("docs") or []
        if not docs:
            return None
        doc = docs[0]
        book_data = {
            "title": doc.get("title"),
            "authors": [{"name": (doc.get("author_name") or [None])[0]}],
            "publishers": [{"name": (doc.get("publisher") or [None])[0]}],
            "publish_date": str((doc.get("first_publish_year") or "")),
            "languages": [{"key": f"/languages/{(doc.get('language') or [None])[0]}"}] if doc.get("language") else [],
            "description": None,
            "cover": {
                "large": f"https://covers.openlibrary.org/b/id/{doc.get('cover_i')}-L.jpg" if doc.get("cover_i") else None,
            },
        }

    publish_date = str(book_data.get("publish_date", ""))
    publication_year: int | None = None
    for token in publish_date.replace(",", " ").split():
        if len(token) == 4 and token.isdigit():
            publication_year = int(token)
            break

    cover_data = book_data.get("cover") or {}
    language_key = ((book_data.get("languages") or [{}])[0].get("key") or "").split("/")[-1] or None
    description = book_data.get("description")
    if isinstance(description, dict):
        description = description.get("value")

    return {
        "title": book_data.get("title"),
        "author": (book_data.get("authors") or [{}])[0].get("name"),
        "isbn": isbn,
        "publisher": (book_data.get("publishers") or [{}])[0].get("name"),
        "language": language_key,
        "description": description,
        "publication_year": publication_year,
        "cover_image_url": cover_data.get("large") or cover_data.get("medium") or cover_data.get("small"),
        "provider": "open_library",
    }


async def _enrich_metadata_with_fallback(isbn: str | None, title: str | None = None, author: str | None = None) -> dict[str, object] | None:
    cache = _get_redis_client()
    cache_key = _cache_key(isbn, title)
    if cache_key is None:
        return None
    cached = cache.get(cache_key)
    if cached:
        return json.loads(cached)

    metadata: dict[str, object] | None = None

    try:
        metadata = await _fetch_google_books_metadata(isbn, title=title, author=author)
    except Exception:
        metadata = None

    if metadata is None:
        try:
            metadata = await _fetch_open_library_metadata(isbn, title=title, author=author)
        except Exception:
            metadata = None

    if metadata is not None:
        cache.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(metadata))
    return metadata


def _upsert_book_from_metadata(
    session: Session,
    book_image: BookImage,
    local_result: dict[str, object],
    metadata: dict[str, object] | None,
) -> Book:
    isbn = local_result.get("isbn") if isinstance(local_result.get("isbn"), str) else None
    metadata_or_empty = metadata or {}

    book: Book | None = None
    if book_image.book_id is not None:
        book = session.get(Book, book_image.book_id)

    if book is None and isbn:
        book = session.execute(select(Book).where(Book.isbn == isbn)).scalar_one_or_none()

    if book is None:
        book = Book(id=uuid.uuid4(), title="Unknown title")
        session.add(book)

    book.title = (metadata_or_empty.get("title") if isinstance(metadata_or_empty.get("title"), str) else None) or (
        local_result.get("title") if isinstance(local_result.get("title"), str) else None
    ) or "Unknown title"
    book.author = (metadata_or_empty.get("author") if isinstance(metadata_or_empty.get("author"), str) else None) or (
        local_result.get("author") if isinstance(local_result.get("author"), str) else None
    )
    book.isbn = isbn
    book.publisher = metadata_or_empty.get("publisher") if isinstance(metadata_or_empty.get("publisher"), str) else None
    book.language = metadata_or_empty.get("language") if isinstance(metadata_or_empty.get("language"), str) else None
    book.description = metadata_or_empty.get("description") if isinstance(metadata_or_empty.get("description"), str) else None
    book.publication_year = metadata_or_empty.get("publication_year") if isinstance(metadata_or_empty.get("publication_year"), int) else None
    book.cover_image_url = metadata_or_empty.get("cover_image_url") if isinstance(metadata_or_empty.get("cover_image_url"), str) else None
    book.processing_status = BookProcessingStatus.DONE if metadata is not None else BookProcessingStatus.PARTIAL

    session.flush()
    book_image.book_id = book.id
    return book


def _mark_failed(job_id: str, message: str) -> None:
    with Session(_get_engine()) as session:
        job = session.get(ProcessingJob, uuid.UUID(job_id))
        if job is not None:
            job.status = ProcessingJobStatus.FAILED
            job.result_json = None
            job.error_message = message[:1000]
            session.commit()


def _mark_book_partial(book_id: str, message: str) -> None:
    with Session(_get_engine()) as session:
        book = session.get(Book, uuid.UUID(book_id))
        if book is None:
            return

        book.processing_status = BookProcessingStatus.PARTIAL
        if not book.description:
            book.description = message[:1000]
        session.commit()


@celery_app.task(
    name="worker.celery_app.process_book_image",
    bind=True,
    acks_late=True,
    autoretry_for=(exc.OperationalError, exc.InterfaceError),
    retry_backoff=True,
    retry_backoff_max=60,
    max_retries=3,
)
def process_book_image(self, job_id: str) -> None:
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(service="worker", job_id=job_id, isbn=None, processing_step="job_processing")
    try:
        logger.info("process_book_image_started")
        with Session(_get_engine()) as session:
            job = session.get(ProcessingJob, uuid.UUID(job_id))
            if job is None:
                raise self.retry(exc=RuntimeError(f"ProcessingJob {job_id} not found — may not be committed yet"), countdown=2)

            image = session.get(BookImage, job.book_image_id)
            if image is None:
                raise self.retry(exc=RuntimeError(f"BookImage for job {job_id} not found"), countdown=2)

            job.status = ProcessingJobStatus.PROCESSING
            job.attempts += 1
            session.commit()

            image_bytes = _download_image_bytes(image.minio_path)
            local_results, local_status, error_message = _extract_metadata(image_bytes)

            if local_status == ProcessingJobStatus.FAILED:
                job.status = local_status
                job.result_json = {"books": local_results}
                job.error_message = error_message
                session.commit()
                return

            processed_books: list[dict[str, object]] = []
            had_partial = False

            for local_result in local_results:
                isbn = local_result.get("isbn") if isinstance(local_result.get("isbn"), str) else None
                title = local_result.get("title") if isinstance(local_result.get("title"), str) else None
                author = local_result.get("author") if isinstance(local_result.get("author"), str) else None

                metadata: dict[str, object] | None = None
                if isbn or title:
                    structlog.contextvars.bind_contextvars(isbn=isbn, processing_step="metadata_enrichment")
                    metadata = asyncio.run(_enrich_metadata_with_fallback(isbn, title=title, author=author))

                if metadata is None:
                    had_partial = True
                    logger.warning("metadata_enrichment_partial", job_id=job_id, isbn=isbn, title=title, author=author, processing_step="metadata_enrichment")

                book = _upsert_book_from_metadata(session, image, local_result, metadata)
                item_result = {**local_result, "book_id": str(book.id)}
                if metadata is not None:
                    item_result["metadata"] = metadata
                processed_books.append(item_result)

            job.status = ProcessingJobStatus.DONE
            job.result_json = {"books": processed_books}
            job.error_message = None
            session.commit()
            processing_result = "partial" if had_partial else "success"
            logger.info("process_book_image_completed", job_id=job_id, processing_step="job_complete", status=processing_result, books_count=len(processed_books))
    except Retry:
        raise
    except (exc.OperationalError, exc.InterfaceError):
        raise
    except Exception as error:
        logger.exception("process_book_image_failed", job_id=job_id, processing_step="job_processing", error=str(error))
        _mark_failed(job_id, str(error))
        raise
    finally:
        structlog.contextvars.clear_contextvars()


@celery_app.task(
    name="worker.celery_app.retry_book_enrichment",
    bind=True,
    acks_late=True,
    autoretry_for=(exc.OperationalError, exc.InterfaceError),
    retry_backoff=True,
    retry_backoff_max=60,
    max_retries=3,
)
def retry_book_enrichment(self, book_id: str) -> None:
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(service="worker", book_id=book_id, isbn=None, processing_step="retry_enrichment")
    try:
        logger.info("retry_book_enrichment_started")
        with Session(_get_engine()) as session:
            book = session.get(Book, uuid.UUID(book_id))
            if book is None:
                raise self.retry(exc=RuntimeError(f"Book {book_id} not found"), countdown=2)
            if not book.isbn:
                _mark_book_partial(book_id, "Retry skipped: book ISBN is missing")
                return

            metadata = asyncio.run(_enrich_metadata_with_fallback(book.isbn, title=book.title, author=book.author))
            if metadata is None:
                _mark_book_partial(book_id, "Retry enrichment failed for all providers")
                logger.warning("retry_book_enrichment_partial", book_id=book_id, processing_step="retry_enrichment")
                return

            book.title = metadata.get("title") if isinstance(metadata.get("title"), str) else book.title
            book.author = metadata.get("author") if isinstance(metadata.get("author"), str) else book.author
            book.publisher = metadata.get("publisher") if isinstance(metadata.get("publisher"), str) else book.publisher
            book.language = metadata.get("language") if isinstance(metadata.get("language"), str) else book.language
            book.description = metadata.get("description") if isinstance(metadata.get("description"), str) else book.description
            book.publication_year = metadata.get("publication_year") if isinstance(metadata.get("publication_year"), int) else book.publication_year
            book.cover_image_url = metadata.get("cover_image_url") if isinstance(metadata.get("cover_image_url"), str) else book.cover_image_url
            book.processing_status = BookProcessingStatus.DONE
            session.commit()
            logger.info("retry_book_enrichment_completed", book_id=book_id, isbn=book.isbn, processing_step="retry_enrichment")
    except Retry:
        raise
    except (exc.OperationalError, exc.InterfaceError):
        raise
    except Exception as error:
        logger.exception("retry_enrichment_failed", book_id=book_id, processing_step="retry_enrichment", error=str(error))
        _mark_book_partial(book_id, "Retry enrichment failed")
        raise
    finally:
        structlog.contextvars.clear_contextvars()
