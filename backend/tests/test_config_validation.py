import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_production_rejects_short_admin_password() -> None:
    with pytest.raises(ValidationError):
        Settings(
            environment="production",
            jwt_secret_key="super-strong-secret",
            minio_access_key="prod-access",
            minio_secret_key="prod-secret",
            admin_password="short",
        )


def test_production_accepts_strong_admin_password() -> None:
    settings = Settings(
        environment="production",
        jwt_secret_key="super-strong-secret",
        minio_access_key="prod-access",
        minio_secret_key="prod-secret",
        admin_password="very-strong-password",
    )
    assert settings.admin_password == "very-strong-password"


def test_cors_origins_reject_wildcard() -> None:
    # CORSMiddleware is configured with allow_credentials=True; a wildcard
    # origin combined with credentials would be both insecure (credentialed
    # CSRF) and rejected by browsers, so config must fail fast.
    with pytest.raises(ValidationError):
        Settings(
            environment="development",
            cors_allowed_origins=["*"],
        )


def test_cors_origins_accept_explicit_list() -> None:
    settings = Settings(
        environment="development",
        cors_allowed_origins=["https://shelfy.app", "http://localhost:5173"],
    )
    assert "https://shelfy.app" in settings.cors_allowed_origins
