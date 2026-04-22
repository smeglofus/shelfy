import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, field_validator


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, value: str) -> str:
        if len(value) < 10:
            raise ValueError("Password must be at least 10 characters long")
        if not any(ch.isdigit() for ch in value):
            raise ValueError("Password must contain at least one digit")
        if not any(not ch.isdigit() for ch in value):
            raise ValueError("Password must contain at least one non-digit character")
        return value


class TokenResponse(BaseModel):
    """Response shape for login / OAuth callback.

    The SPA authenticates via the httpOnly ``access_token`` / ``refresh_token``
    cookies set alongside this body. ``csrf_token`` mirrors the value of
    the ``csrf_token`` cookie so a freshly loaded client can populate its
    CSRF header without waiting for a subsequent response.

    ``access_token`` / ``refresh_token`` remain in the body for backward
    compatibility with the Bearer-header code paths used by mobile / CLI
    clients — they are set to empty strings in environments where raw
    token issuance to the body is disabled.
    """

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    csrf_token: str | None = None


class RefreshRequest(BaseModel):
    # Optional — cookie-based SPA clients submit an empty body and rely on
    # the HttpOnly refresh_token cookie to be replayed by the browser.
    refresh_token: str | None = None


class AccessTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    avatar_url: str | None = None
    has_local_password: bool = True


class DeleteAccountRequest(BaseModel):
    """Password confirmation required to permanently delete an account (GDPR Art. 17).

    For local (email+password) accounts ``password`` must be the correct current
    password.  For OAuth-only accounts the field can be omitted or sent as an
    empty string — the valid Bearer token already proves identity.
    """

    password: str = ""


# ── Google OAuth ───────────────────────────────────────────────────────────────

class OAuthAuthorizeResponse(BaseModel):
    """URL to redirect the user to for Google consent."""
    auth_url: str


class OAuthCallbackRequest(BaseModel):
    """Authorization code + state returned by Google after user consent."""
    code: str
    state: str
