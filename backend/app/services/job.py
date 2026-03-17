from __future__ import annotations

from fastapi import UploadFile

MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024
READ_CHUNK_SIZE_BYTES = 1024 * 1024


class FileTooLargeError(Exception):
    pass


async def read_upload_payload(file: UploadFile) -> bytes:
    total_size = 0
    chunks: list[bytes] = []

    while True:
        chunk = await file.read(READ_CHUNK_SIZE_BYTES)
        if not chunk:
            break

        next_size = total_size + len(chunk)
        if next_size > MAX_UPLOAD_SIZE_BYTES:
            raise FileTooLargeError("Uploaded file exceeds maximum allowed size")

        chunks.append(chunk)
        total_size = next_size

    return b"".join(chunks)
