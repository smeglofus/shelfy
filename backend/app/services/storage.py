from __future__ import annotations

from typing import Any


RETRIABLE_STORAGE_ERROR_CODES = {
    "RequestTimeout",
    "Throttling",
    "InternalError",
    "SlowDown",
    "ServiceUnavailable",
}


class StorageService:
    async def ensure_bucket(self) -> None:
        """Ensure the upload bucket exists.

        This project currently provides a no-op implementation for local development.
        """
        return None


storage_service = StorageService()


def is_retriable_storage_error(error: Exception) -> bool:
    error_code = _extract_storage_error_code(error)
    if error_code is None:
        return False
    return error_code in RETRIABLE_STORAGE_ERROR_CODES


def _extract_storage_error_code(error: Exception) -> str | None:
    response = getattr(error, "response", None)
    if isinstance(response, dict):
        error_payload = response.get("Error")
        if isinstance(error_payload, dict):
            code = error_payload.get("Code")
            if isinstance(code, str):
                return code

    code = getattr(error, "code", None)
    if isinstance(code, str):
        return code

    return None
