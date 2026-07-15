from pathlib import Path
import sys
import uuid

import httpx
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import celery_app


def test_detect_barcode_returns_normalized_isbn(monkeypatch) -> None:
    class FakeBarcode:
        data = b"978-0-306-40615-7"

    monkeypatch.setattr(celery_app, "decode_barcodes", lambda _image: [FakeBarcode()])

    isbn = celery_app._detect_isbn_from_barcode(np.zeros((10, 10, 3), dtype=np.uint8))

    assert isbn == "9780306406157"


def test_gemini_fallback_triggers_when_no_barcode(monkeypatch) -> None:
    monkeypatch.setattr(celery_app, "_decode_image_bytes", lambda _bytes: np.zeros((10, 10, 3), dtype=np.uint8))
    monkeypatch.setattr(celery_app, "_detect_isbn_from_barcode", lambda _image: None)
    async def _gemini(_image_bytes: bytes) -> list[dict[str, object]] | None:
        return [{
            "isbn": None,
            "title": "The Pragmatic Programmer",
            "author": "Andrew Hunt",
            "source": "gemini_vision",
        }]

    monkeypatch.setattr(celery_app, "_extract_spine_metadata_with_gemini", _gemini)

    result_json, status, error_message = celery_app._extract_metadata(b"fake-bytes")

    assert status == celery_app.ProcessingJobStatus.DONE
    assert error_message is None
    assert isinstance(result_json, list)
    assert result_json[0]["source"] == "gemini_vision"
    assert result_json[0]["title"] == "The Pragmatic Programmer"
    assert result_json[0]["author"] == "Andrew Hunt"


def test_gemini_fallback_returns_failed_when_gemini_returns_none(monkeypatch) -> None:
    monkeypatch.setattr(celery_app, "_decode_image_bytes", lambda _bytes: np.zeros((10, 10, 3), dtype=np.uint8))
    monkeypatch.setattr(celery_app, "_detect_isbn_from_barcode", lambda _image: None)

    async def _gemini_none(_image_bytes: bytes) -> dict[str, object] | None:
        return None

    monkeypatch.setattr(celery_app, "_extract_spine_metadata_with_gemini", _gemini_none)

    result_json, status, error_message = celery_app._extract_metadata(b"fake-bytes")

    assert status == celery_app.ProcessingJobStatus.FAILED
    assert result_json[0]["source"] == "none"
    assert error_message is not None


def test_gemini_fallback_returns_failed_when_gemini_raises(monkeypatch) -> None:
    monkeypatch.setattr(celery_app, "_decode_image_bytes", lambda _bytes: np.zeros((10, 10, 3), dtype=np.uint8))
    monkeypatch.setattr(celery_app, "_detect_isbn_from_barcode", lambda _image: None)

    async def _gemini_error(_image_bytes: bytes) -> dict[str, object] | None:
        raise httpx.RequestError("connection failed")

    monkeypatch.setattr(celery_app, "_extract_spine_metadata_with_gemini", _gemini_error)

    result_json, status, error_message = celery_app._extract_metadata(b"fake-bytes")

    assert status == celery_app.ProcessingJobStatus.FAILED
    assert error_message is not None


def test_process_book_image_stores_result_json(monkeypatch) -> None:
    job_id = uuid.uuid4()
    book_image_id = uuid.uuid4()

    class FakeJob:
        def __init__(self) -> None:
            self.id = job_id
            self.book_image_id = book_image_id
            self.status = celery_app.ProcessingJobStatus.PENDING
            self.result_json = None
            self.error_message = None
            self.attempts = 0

    class FakeBookImage:
        def __init__(self) -> None:
            self.id = book_image_id
            self.minio_path = "uploads/test.jpg"

    fake_job = FakeJob()
    fake_book_image = FakeBookImage()

    class FakeSession:
        def __init__(self, _engine) -> None:
            self.commits = 0

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def get(self, model, identifier):
            if model is celery_app.ProcessingJob and identifier == job_id:
                return fake_job
            if model is celery_app.BookImage and identifier == book_image_id:
                return fake_book_image
            return None

        def commit(self) -> None:
            self.commits += 1

    monkeypatch.setattr(celery_app, "Session", FakeSession)
    monkeypatch.setattr(celery_app, "_get_engine", lambda: object())
    monkeypatch.setattr(celery_app, "_download_image_bytes", lambda _path: b"image")
    monkeypatch.setattr(
        celery_app,
        "_extract_metadata",
        lambda _bytes: (
            [{"isbn": "9780306406157", "title": None, "author": None, "source": "barcode"}],
            celery_app.ProcessingJobStatus.DONE,
            None,
        ),
    )
    async def _no_metadata(_isbn: str | None, title: str | None = None, author: str | None = None) -> None:
        return None

    class FakeBook:
        id = uuid.uuid4()

    monkeypatch.setattr(celery_app, "_enrich_metadata_with_fallback", _no_metadata)
    monkeypatch.setattr(celery_app, "_upsert_book_from_metadata", lambda _session, _image, _local, _meta: FakeBook())

    celery_app.process_book_image.run(job_id=str(job_id))

    assert fake_job.status == celery_app.ProcessingJobStatus.DONE
    assert fake_job.attempts == 1
    assert fake_job.error_message is None
    assert fake_job.result_json == {
        "books": [
            {
                "isbn": "9780306406157",
                "title": None,
                "author": None,
                "source": "barcode",
                "book_id": str(FakeBook.id),
            }
        ]
    }


def test_normalize_and_validate_isbn() -> None:
    assert celery_app.normalize_isbn("978-0-306-40615-7") == "9780306406157"
    assert celery_app.normalize_isbn("0-306-40615-2") == "0306406152"
    assert celery_app.normalize_isbn("1234567890") is None


def test_normalize_vision_result_rejects_placeholder_isbn() -> None:
    """Hallucinated ISBNs like '0000000000' should be rejected."""
    result = celery_app._normalize_vision_result({
        "title": "Some Book",
        "author": "Author",
        "isbn": "000-0-000-00000-0",
        "observed_text": "Some Book Author",
    })
    assert result is not None
    assert result["isbn"] is None


def test_normalize_vision_result_rejects_placeholder_title() -> None:
    """Placeholder titles like 'Unknown title' should become None."""
    result = celery_app._normalize_vision_result({
        "title": "Unknown title",
        "author": None,
        "isbn": None,
        "observed_text": "blurry spine",
    })
    # No title, no author, no isbn → result should be None
    assert result is None


def test_normalize_vision_result_applies_casing() -> None:
    """ALL CAPS titles → sentence case, authors → proper case."""
    result = celery_app._normalize_vision_result({
        "title": "THE GREAT GATSBY",
        "author": "F. SCOTT FITZGERALD",
        "isbn": None,
    })
    assert result is not None
    assert result["title"] == "The great gatsby"
    assert result["author"] == "F. Scott Fitzgerald"


def test_normalize_vision_result_preserves_mixed_case() -> None:
    """Mixed case titles should not be altered."""
    result = celery_app._normalize_vision_result({
        "title": "Harry Potter",
        "author": "J.K. Rowling",
        "isbn": None,
    })
    assert result is not None
    assert result["title"] == "Harry Potter"
    assert result["author"] == "J.K. Rowling"


def test_normalize_vision_result_czech_casing() -> None:
    """Czech ALL CAPS: title → sentence case with diacritics, author → proper case."""
    result = celery_app._normalize_vision_result({
        "title": "TIBETSKÁ KNIHA O ŽIVOTĚ A SMRTI",
        "author": "SOGJAL RINPOČHE",
        "isbn": None,
    })
    assert result is not None
    assert result["title"] == "Tibetská kniha o životě a smrti"
    assert result["author"] == "Sogjal Rinpočhe"


def test_shelf_scan_fallback_includes_low_confidence_items() -> None:
    """Low-confidence items should still be included as draft rows for review."""
    import asyncio

    gemini_response = {
        "candidates": [{
            "content": {
                "parts": [{
                    "text": '[{"title": null, "author": null, "isbn": null, '
                            '"observed_text": "blurry text", "confidence": "low"}]'
                }]
            }
        }]
    }

    async def fake_post(self, url, **kwargs):
        class FakeResponse:
            status_code = 200
            def raise_for_status(self): pass
            def json(self): return gemini_response
        return FakeResponse()

    import httpx
    original_post = httpx.AsyncClient.post
    httpx.AsyncClient.post = fake_post
    try:
        result = asyncio.run(celery_app._extract_shelf_metadata_with_gemini(b"\xff\xd8\xff fake"))
    finally:
        httpx.AsyncClient.post = original_post

    assert result is not None
    assert len(result) == 1
    assert result[0]["confidence"] == "low"
    assert result[0]["observed_text"] == "blurry text"
    assert result[0]["title"] is None


def test_shelf_scan_merged_author_gets_needs_review() -> None:
    """A merged author (slash separator) must downgrade confidence to needs_review."""
    import asyncio

    gemini_response = {
        "candidates": [{
            "content": {
                "parts": [{
                    "text": '[{"title": "The Trial", "author": "Franz Kafka / Milan Kundera",'
                            ' "isbn": null, "observed_text": "The Trial Franz Kafka Milan Kundera",'
                            ' "confidence": "high"}]'
                }]
            }
        }]
    }

    async def fake_post(self, url, **kwargs):
        class FakeResponse:
            status_code = 200
            def raise_for_status(self): pass
            def json(self): return gemini_response
        return FakeResponse()

    import httpx
    original_post = httpx.AsyncClient.post
    httpx.AsyncClient.post = fake_post
    try:
        result = asyncio.run(celery_app._extract_shelf_metadata_with_gemini(b"\xff\xd8\xff fake"))
    finally:
        httpx.AsyncClient.post = original_post

    assert result is not None
    assert len(result) == 1
    row = result[0]
    assert row["confidence"] == "needs_review"
    assert "author_has_separator" in row["quality_flags"]
    # Original fields preserved (not silently corrected)
    assert "Kafka" in str(row["author"])
    assert "Kundera" in str(row["author"])
    assert row["observed_text"] is not None


def test_shelf_scan_clean_row_keeps_confidence() -> None:
    """A clean row (single author, no contamination) keeps Gemini's confidence."""
    import asyncio

    gemini_response = {
        "candidates": [{
            "content": {
                "parts": [{
                    "text": '[{"title": "The Trial", "author": "Franz Kafka",'
                            ' "isbn": null, "observed_text": "The Trial Franz Kafka",'
                            ' "confidence": "high"}]'
                }]
            }
        }]
    }

    async def fake_post(self, url, **kwargs):
        class FakeResponse:
            status_code = 200
            def raise_for_status(self): pass
            def json(self): return gemini_response
        return FakeResponse()

    import httpx
    original_post = httpx.AsyncClient.post
    httpx.AsyncClient.post = fake_post
    try:
        result = asyncio.run(celery_app._extract_shelf_metadata_with_gemini(b"\xff\xd8\xff fake"))
    finally:
        httpx.AsyncClient.post = original_post

    assert result is not None
    assert len(result) == 1
    row = result[0]
    assert row["confidence"] == "high"
    assert "quality_flags" not in row


def test_shelf_scan_title_author_overlap_flagged() -> None:
    """If author name appears inside title, confidence must be downgraded."""
    import asyncio

    gemini_response = {
        "candidates": [{
            "content": {
                "parts": [{
                    "text": '[{"title": "1984 George Orwell", "author": "George Orwell",'
                            ' "isbn": null, "observed_text": "1984 George Orwell",'
                            ' "confidence": "high"}]'
                }]
            }
        }]
    }

    async def fake_post(self, url, **kwargs):
        class FakeResponse:
            status_code = 200
            def raise_for_status(self): pass
            def json(self): return gemini_response
        return FakeResponse()

    import httpx
    original_post = httpx.AsyncClient.post
    httpx.AsyncClient.post = fake_post
    try:
        result = asyncio.run(celery_app._extract_shelf_metadata_with_gemini(b"\xff\xd8\xff fake"))
    finally:
        httpx.AsyncClient.post = original_post

    assert result is not None
    row = result[0]
    assert row["confidence"] == "needs_review"
    assert "title_contains_author" in row["quality_flags"]


def test_shelf_scan_excessive_author_tokens_flagged() -> None:
    """Six+ meaningful author tokens should be flagged as merged spines."""
    import asyncio

    gemini_response = {
        "candidates": [{
            "content": {
                "parts": [{
                    "text": '[{"title": "Book", "author": "Karel Capek Milan Kundera Pavel Kohout",'
                            ' "isbn": null, "observed_text": "Book Karel Capek Milan Kundera Pavel Kohout",'
                            ' "confidence": "medium"}]'
                }]
            }
        }]
    }

    async def fake_post(self, url, **kwargs):
        class FakeResponse:
            status_code = 200
            def raise_for_status(self): pass
            def json(self): return gemini_response
        return FakeResponse()

    import httpx
    original_post = httpx.AsyncClient.post
    httpx.AsyncClient.post = fake_post
    try:
        result = asyncio.run(celery_app._extract_shelf_metadata_with_gemini(b"\xff\xd8\xff fake"))
    finally:
        httpx.AsyncClient.post = original_post

    assert result is not None
    row = result[0]
    assert row["confidence"] == "needs_review"
    assert "author_excessive_tokens" in row["quality_flags"]


def test_shelf_scan_output_schema_with_quality_flags() -> None:
    """Verify the full output shape is backwards-compatible (quality_flags is optional)."""
    import asyncio

    # Mixed batch: one clean, one flagged
    gemini_response = {
        "candidates": [{
            "content": {
                "parts": [{
                    "text": '['
                            '{"title": "Clean Book", "author": "Single Author",'
                            ' "isbn": null, "observed_text": "Clean Book Single Author",'
                            ' "confidence": "high"},'
                            '{"title": "Dirty Book", "author": "Author A / Author B",'
                            ' "isbn": null, "observed_text": "Dirty Book Author A Author B",'
                            ' "confidence": "high"}'
                            ']'
                }]
            }
        }]
    }

    async def fake_post(self, url, **kwargs):
        class FakeResponse:
            status_code = 200
            def raise_for_status(self): pass
            def json(self): return gemini_response
        return FakeResponse()

    import httpx
    original_post = httpx.AsyncClient.post
    httpx.AsyncClient.post = fake_post
    try:
        result = asyncio.run(celery_app._extract_shelf_metadata_with_gemini(b"\xff\xd8\xff fake"))
    finally:
        httpx.AsyncClient.post = original_post

    assert result is not None
    assert len(result) == 2

    # Clean row: standard fields, no quality_flags key
    clean = result[0]
    assert clean["confidence"] == "high"
    assert "quality_flags" not in clean
    for key in ("title", "author", "isbn", "source"):
        assert key in clean

    # Flagged row: has quality_flags, confidence downgraded
    flagged = result[1]
    assert flagged["confidence"] == "needs_review"
    assert isinstance(flagged["quality_flags"], list)
    assert len(flagged["quality_flags"]) > 0
    for key in ("title", "author", "isbn", "source"):
        assert key in flagged


def test_enrichment_cache_hit_skips_external_calls(monkeypatch) -> None:
    class FakeRedis:
        def get(self, _key):
            return '{"title":"Cached","provider":"google_books"}'

        def setex(self, _key, _ttl, _payload):
            raise AssertionError("setex should not be called on cache hit")

    monkeypatch.setattr(celery_app, "_get_redis_client", lambda: FakeRedis())

    async def _raise(*_args, **_kwargs):
        raise AssertionError("external call should not happen")

    monkeypatch.setattr(celery_app, "_fetch_google_books_metadata", _raise)
    monkeypatch.setattr(celery_app, "_fetch_open_library_metadata", _raise)

    result = celery_app.asyncio.run(celery_app._enrich_metadata_with_fallback("9780134494166"))

    assert result == {"title": "Cached", "provider": "google_books"}


def test_enrichment_default_uses_open_library_and_skips_google(monkeypatch) -> None:
    stored = {}

    class FakeRedis:
        def get(self, _key):
            return None

        def setex(self, key, ttl, payload):
            stored[key] = payload

    monkeypatch.setattr(celery_app, "_get_redis_client", lambda: FakeRedis())

    async def _google_must_not_be_called(*_args, **_kwargs):
        raise AssertionError("google books must not be called with the flag off")

    async def _open_library(isbn, title=None, author=None):
        return {"title": "Refactoring", "isbn": isbn, "provider": "open_library"}

    monkeypatch.setattr(celery_app, "_fetch_google_books_metadata", _google_must_not_be_called)
    monkeypatch.setattr(celery_app, "_fetch_open_library_metadata", _open_library)
    monkeypatch.setattr(celery_app.worker_settings, "enable_google_books", False)

    result = celery_app.asyncio.run(celery_app._enrich_metadata_with_fallback("9780201485677"))

    assert result is not None
    assert result["provider"] == "open_library"
    assert "book-metadata:9780201485677" in stored


def test_both_providers_failing_sets_partial_and_creates_book(monkeypatch) -> None:
    job_id = uuid.uuid4()
    book_image_id = uuid.uuid4()

    class FakeJob:
        def __init__(self) -> None:
            self.id = job_id
            self.book_image_id = book_image_id
            self.status = celery_app.ProcessingJobStatus.PENDING
            self.result_json = None
            self.error_message = None
            self.attempts = 0

    class FakeBookImage:
        def __init__(self) -> None:
            self.id = book_image_id
            self.minio_path = "uploads/test.jpg"
            self.book_id = None

    class FakeBook:
        def __init__(self) -> None:
            self.id = uuid.uuid4()
            self.title = ""
            self.author = None
            self.isbn = None
            self.publisher = None
            self.language = None
            self.description = None
            self.publication_year = None
            self.cover_image_url = None
            self.processing_status = celery_app.BookProcessingStatus.MANUAL

    fake_job = FakeJob()
    fake_book_image = FakeBookImage()
    fake_book = FakeBook()

    class FakeResult:
        def scalar_one_or_none(self):
            return None

    added_books = []

    class FakeSession:
        def __init__(self, _engine) -> None:
            self.added = []

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def get(self, model, identifier):
            if model is celery_app.ProcessingJob and identifier == job_id:
                return fake_job
            if model is celery_app.BookImage and identifier == book_image_id:
                return fake_book_image
            if model is celery_app.Book and identifier == fake_book_image.book_id:
                return fake_book
            return None

        def execute(self, _query):
            return FakeResult()

        def add(self, obj) -> None:
            self.added.append(obj)
            if isinstance(obj, celery_app.Book):
                obj.id = fake_book.id
                added_books.append(obj)

        def flush(self) -> None:
            return None

        def commit(self) -> None:
            return None

    monkeypatch.setattr(celery_app, "Session", FakeSession)
    monkeypatch.setattr(celery_app, "_get_engine", lambda: object())
    monkeypatch.setattr(celery_app, "_download_image_bytes", lambda _path: b"image")
    monkeypatch.setattr(
        celery_app,
        "_extract_metadata",
        lambda _bytes: (
            [{"isbn": "9780306406157", "title": "Fallback title", "author": "Fallback author", "source": "ocr"}],
            celery_app.ProcessingJobStatus.DONE,
            None,
        ),
    )

    async def _no_metadata(_isbn: str | None, title: str | None = None, author: str | None = None):
        return None

    monkeypatch.setattr(celery_app, "_enrich_metadata_with_fallback", _no_metadata)
    monkeypatch.setattr(celery_app.uuid, "uuid4", lambda: fake_book.id)

    celery_app.process_book_image.run(job_id=str(job_id))

    assert fake_job.status == celery_app.ProcessingJobStatus.DONE
    assert fake_job.error_message is None
    assert fake_book_image.book_id == fake_book.id
    assert len(added_books) == 1
    assert added_books[0].processing_status == celery_app.BookProcessingStatus.PARTIAL


def test_worker_logs_include_job_id(monkeypatch, capsys) -> None:
    job_id = uuid.uuid4()
    book_image_id = uuid.uuid4()

    class FakeJob:
        def __init__(self) -> None:
            self.id = job_id
            self.book_image_id = book_image_id
            self.status = celery_app.ProcessingJobStatus.PENDING
            self.result_json = None
            self.error_message = None
            self.attempts = 0

    class FakeBookImage:
        def __init__(self) -> None:
            self.id = book_image_id
            self.minio_path = "uploads/test.jpg"
            self.book_id = None

    class FakeResult:
        def scalar_one_or_none(self):
            return None

    class FakeSession:
        def __init__(self, _engine) -> None:
            return None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def get(self, model, identifier):
            if model is celery_app.ProcessingJob and identifier == job_id:
                return FakeJob()
            if model is celery_app.BookImage and identifier == book_image_id:
                return FakeBookImage()
            return None

        def execute(self, _query):
            return FakeResult()

        def add(self, _obj) -> None:
            return None

        def flush(self) -> None:
            return None

        def commit(self) -> None:
            return None

    monkeypatch.setattr(celery_app, "Session", FakeSession)
    monkeypatch.setattr(celery_app, "_get_engine", lambda: object())
    monkeypatch.setattr(celery_app, "_download_image_bytes", lambda _path: b"image")
    monkeypatch.setattr(
        celery_app,
        "_extract_metadata",
        lambda _bytes: (
            [{"isbn": "9780306406157", "title": "Fallback title", "author": "Fallback author", "source": "ocr"}],
            celery_app.ProcessingJobStatus.DONE,
            None,
        ),
    )
    async def _metadata(_isbn: str | None, title: str | None = None, author: str | None = None):
        return None

    monkeypatch.setattr(celery_app, "_enrich_metadata_with_fallback", _metadata)

    celery_app.process_book_image.run(job_id=str(job_id))

    output = capsys.readouterr().out
    assert "\"job_id\": \"" + str(job_id) + "\"" in output


class _FakeVerifyRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    def get(self, key: str):
        return self.store.get(key)

    def setex(self, key: str, _ttl: int, value: str) -> None:
        self.store[key] = value


def _patch_open_library_transport(monkeypatch, handler) -> None:
    """Route the worker's internally-created AsyncClient through a MockTransport."""
    transport = httpx.MockTransport(handler)
    original_client = httpx.AsyncClient
    monkeypatch.setattr(
        celery_app.httpx,
        "AsyncClient",
        lambda **_kwargs: original_client(transport=transport),
    )


def test_verify_shelf_books_adopts_and_suggests(monkeypatch) -> None:
    fake_redis = _FakeVerifyRedis()
    monkeypatch.setattr(celery_app, "_get_redis_client", lambda: fake_redis)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/search.json"
        title = request.url.params["title"]
        if "zivote" in title:
            return httpx.Response(200, json={"docs": [
                {"key": "/works/OL1W", "title": "Tibetská kniha o životě a smrti",
                 "author_name": ["Sogjal Rinpočhe"]},
            ]})
        if title == "Nastavení miminka":
            return httpx.Response(200, json={"docs": [
                {"key": "/works/OL2W", "title": "Nastávající maminky", "author_name": []},
            ]})
        return httpx.Response(200, json={"docs": []})

    _patch_open_library_transport(monkeypatch, handler)

    books: list[dict[str, object]] = [
        # Near-identical (diacritics only) → adopt the catalog form
        {"title": "tibetska kniha o zivote a smrti", "author": "sogjal rinpočhe",
         "confidence": "medium"},
        # OCR misread → keep scanned text, attach suggestion, needs_review
        {"title": "Nastavení miminka", "author": None, "confidence": "high"},
        # No catalog hit → untouched
        {"title": "Zcela neznámá kniha", "author": None, "confidence": "high"},
        # No title → skipped entirely
        {"title": None, "author": None, "confidence": "low"},
    ]

    stats = celery_app.asyncio.run(celery_app._verify_shelf_books_against_catalog(books))

    assert books[0]["title"] == "Tibetská kniha o životě a smrti"
    assert books[0]["author"] == "Sogjal Rinpočhe"
    assert books[0]["confidence"] == "medium"
    assert "catalog_adopted" in books[0]["quality_flags"]

    assert books[1]["title"] == "Nastavení miminka"
    assert books[1]["suggested_title"] == "Nastávající maminky"
    assert books[1]["confidence"] == "needs_review"

    assert books[2]["title"] == "Zcela neznámá kniha"
    assert books[2]["confidence"] == "high"
    assert "suggested_title" not in books[2]

    assert stats == {"adopt": 1, "suggest": 1, "none": 0, "no_candidate": 1}
    # Lookups are cached for repeat scans of the same shelf
    assert len(fake_redis.store) == 3


def test_verify_shelf_books_survives_lookup_failure(monkeypatch) -> None:
    monkeypatch.setattr(celery_app, "_get_redis_client", lambda: _FakeVerifyRedis())

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    _patch_open_library_transport(monkeypatch, handler)

    books: list[dict[str, object]] = [
        {"title": "Válka s mloky", "author": "Karel Čapek", "confidence": "high"},
    ]

    stats = celery_app.asyncio.run(celery_app._verify_shelf_books_against_catalog(books))

    # Row stays exactly as the vision model produced it
    assert books[0] == {"title": "Válka s mloky", "author": "Karel Čapek", "confidence": "high"}
    assert stats["no_candidate"] == 1


def test_verify_shelf_books_uses_cache(monkeypatch) -> None:
    fake_redis = _FakeVerifyRedis()
    monkeypatch.setattr(celery_app, "_get_redis_client", lambda: fake_redis)

    call_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        call_count["n"] += 1
        return httpx.Response(200, json={"docs": [
            {"key": "/works/OL1W", "title": "Válka s mloky", "author_name": ["Karel Čapek"]},
        ]})

    _patch_open_library_transport(monkeypatch, handler)

    books1: list[dict[str, object]] = [{"title": "Válka s mloky", "author": "Karel Čapek"}]
    books2: list[dict[str, object]] = [{"title": "Válka s mloky", "author": "Karel Čapek"}]

    celery_app.asyncio.run(celery_app._verify_shelf_books_against_catalog(books1))
    celery_app.asyncio.run(celery_app._verify_shelf_books_against_catalog(books2))

    assert call_count["n"] == 1
def test_open_library_title_search_returns_edition_isbn_and_description(monkeypatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/search.json":
            # ISBN must be part of the requested fields, otherwise the search
            # response never contains it.
            assert "isbn" in request.url.params["fields"]
            assert "editions" in request.url.params["fields"]
            return httpx.Response(
                200,
                json={
                    "docs": [
                        {
                            "key": "/works/OL1W",
                            "title": "Malý princ",
                            "author_name": ["Antoine de Saint-Exupéry"],
                            "publisher": ["Gallimard"],
                            "first_publish_year": 1943,
                            "language": ["fre", "cze"],
                            "cover_i": 111,
                            "isbn": ["2070612759", "9782070612758"],
                            "editions": {
                                "numFound": 1,
                                "docs": [
                                    {
                                        "key": "/books/OL1M",
                                        "isbn_13": ["9788000012345"],
                                        "publish_date": "2015",
                                        "publishers": ["Albatros"],
                                        "languages": ["cze"],
                                        "cover_i": 777,
                                    }
                                ],
                            },
                        }
                    ]
                },
            )
        assert request.url.path == "/works/OL1W.json"
        return httpx.Response(200, json={"description": {"value": "Slavná novela o malém princi."}})

    _patch_open_library_transport(monkeypatch, handler)

    metadata = celery_app.asyncio.run(
        celery_app._fetch_open_library_metadata(None, title="Malý princ", author="Saint-Exupéry")
    )

    assert metadata is not None
    # ISBN comes from the best-matching edition, not the mixed work-level list.
    assert metadata["isbn"] == "9788000012345"
    assert metadata["description"] == "Slavná novela o malém princi."
    assert metadata["publisher"] == "Albatros"
    assert metadata["publication_year"] == 2015
    assert metadata["language"] == "cze"
    assert metadata["cover_image_url"] == "https://covers.openlibrary.org/b/id/777-L.jpg"


def test_open_library_title_search_falls_back_to_work_level_isbn13(monkeypatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/search.json"
        return httpx.Response(
            200,
            json={
                "docs": [
                    {
                        "title": "Clean Code",
                        "author_name": ["Robert C. Martin"],
                        "first_publish_year": 2008,
                        "isbn": ["0132350882", "9780132350884"],
                    }
                ]
            },
        )

    _patch_open_library_transport(monkeypatch, handler)

    metadata = celery_app.asyncio.run(
        celery_app._fetch_open_library_metadata(None, title="Clean Code")
    )

    assert metadata is not None
    assert metadata["isbn"] == "9780132350884"


def test_open_library_isbn_lookup_backfills_description_from_work(monkeypatch) -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path == "/api/books":
            return httpx.Response(
                200,
                json={
                    "ISBN:9780134494166": {
                        "title": "Clean Architecture",
                        "authors": [{"name": "Robert C. Martin"}],
                        "publish_date": "2017",
                    }
                },
            )
        if request.url.path == "/search.json":
            assert request.url.params["q"] == "isbn:9780134494166"
            return httpx.Response(200, json={"docs": [{"key": "/works/OL2W"}]})
        assert request.url.path == "/works/OL2W.json"
        return httpx.Response(200, json={"description": "Software architecture patterns."})

    _patch_open_library_transport(monkeypatch, handler)

    metadata = celery_app.asyncio.run(
        celery_app._fetch_open_library_metadata("9780134494166")
    )

    assert metadata is not None
    assert metadata["isbn"] == "9780134494166"
    assert metadata["description"] == "Software architecture patterns."
    assert calls == ["/api/books", "/search.json", "/works/OL2W.json"]


def test_open_library_description_backfill_failure_keeps_metadata(monkeypatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/books":
            return httpx.Response(
                200,
                json={"ISBN:9780134494166": {"title": "Clean Architecture", "publish_date": "2017"}},
            )
        # Work resolution is best-effort — a failing works lookup must not
        # break the whole enrichment.
        return httpx.Response(500)

    _patch_open_library_transport(monkeypatch, handler)

    metadata = celery_app.asyncio.run(
        celery_app._fetch_open_library_metadata("9780134494166")
    )

    assert metadata is not None
    assert metadata["title"] == "Clean Architecture"
    assert metadata["description"] is None
