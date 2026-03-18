from pathlib import Path
import sys
import uuid

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import celery_app


def test_detect_barcode_returns_normalized_isbn(monkeypatch) -> None:
    class FakeBarcode:
        data = b"978-0-306-40615-7"

    monkeypatch.setattr(celery_app, "decode_barcodes", lambda _image: [FakeBarcode()])

    isbn = celery_app._detect_isbn_from_barcode(np.zeros((10, 10, 3), dtype=np.uint8))

    assert isbn == "9780306406157"


def test_ocr_fallback_triggers_when_no_barcode(monkeypatch) -> None:
    monkeypatch.setattr(celery_app, "_decode_image_bytes", lambda _bytes: np.zeros((10, 10, 3), dtype=np.uint8))
    monkeypatch.setattr(celery_app, "_detect_isbn_from_barcode", lambda _image: None)
    monkeypatch.setattr(celery_app, "_extract_text_with_ocr", lambda _image: "The Pragmatic Programmer\nBy Andrew Hunt")

    result_json, status, error_message = celery_app._extract_metadata(b"fake-bytes")

    assert status == celery_app.ProcessingJobStatus.DONE
    assert error_message is None
    assert result_json["source"] == "ocr"
    assert result_json["title"] == "The Pragmatic Programmer"
    assert result_json["author"] == "Andrew Hunt"


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
            {"isbn": "9780306406157", "title": None, "author": None, "source": "barcode"},
            celery_app.ProcessingJobStatus.DONE,
            None,
        ),
    )

    celery_app.process_book_image.run(job_id=str(job_id))

    assert fake_job.status == celery_app.ProcessingJobStatus.DONE
    assert fake_job.attempts == 1
    assert fake_job.error_message is None
    assert fake_job.result_json == {
        "isbn": "9780306406157",
        "title": None,
        "author": None,
        "source": "barcode",
    }


def test_normalize_and_validate_isbn() -> None:
    assert celery_app.normalize_isbn("978-0-306-40615-7") == "9780306406157"
    assert celery_app.normalize_isbn("0-306-40615-2") == "0306406152"
    assert celery_app.normalize_isbn("1234567890") is None
