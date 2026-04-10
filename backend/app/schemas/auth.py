import uuid

from pydantic import BaseModel, ConfigDict, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


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
