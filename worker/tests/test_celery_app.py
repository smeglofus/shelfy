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
    async def _gemini(_image_bytes: bytes) -> dict[str, object] | None:
        return {
            "isbn": None,
            "title": "The Pragmatic Programmer",
            "author": "Andrew Hunt",
            "source": "gemini_vision",
        }

    monkeypatch.setattr(celery_app, "_extract_spine_metadata_with_gemini", _gemini)

    result_json, status, error_message = celery_app._extract_metadata(b"fake-bytes")

    assert status == celery_app.ProcessingJobStatus.DONE
    assert error_message is None
    assert result_json["source"] == "gemini_vision"
    assert result_json["title"] == "The Pragmatic Programmer"
    assert result_json["author"] == "Andrew Hunt"


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
