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
