"""Shared password-strength policy.

Single source of truth for what counts as a strong enough password. Used
by the registration schema and by the password-reset confirm endpoint so
both paths enforce identical rules — drift between them would let reset
bypass policies the registration form rejects.

Raises ``ValueError`` on failure so this helper plugs directly into
Pydantic ``field_validator`` without any extra wrapping.
"""
from __future__ import annotations

MIN_LENGTH = 10


def validate_password_strength(password: str) -> str:
    """Enforce password policy; return the input unchanged on success.

    Rules (mirror registration):
      - at least ``MIN_LENGTH`` characters
      - at least one digit
      - at least one non-digit character
    """
    if len(password) < MIN_LENGTH:
        raise ValueError(f"Password must be at least {MIN_LENGTH} characters long")
    if not any(ch.isdigit() for ch in password):
        raise ValueError("Password must contain at least one digit")
    if not any(not ch.isdigit() for ch in password):
        raise ValueError("Password must contain at least one non-digit character")
    return password
