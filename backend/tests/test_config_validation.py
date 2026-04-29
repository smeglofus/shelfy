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



def test_rate_limit_storage_uri_uses_dedicated_redis_db() -> None:
    from app.core.limiter import _rate_limit_storage_uri

    assert _rate_limit_storage_uri("redis://localhost:6379/0") == "redis://localhost:6379/2"
    assert _rate_limit_storage_uri("redis://localhost:6379") == "redis://localhost:6379/2"


def test_limiter_client_ip_prefers_trusted_proxy_headers(monkeypatch) -> None:
    from types import SimpleNamespace

    from app.core.config import Settings
    from app.core import limiter as limiter_module

    monkeypatch.setattr(
        limiter_module,
        "get_settings",
        lambda: Settings(trust_proxy_headers=True),
    )

    request = SimpleNamespace(
        headers={"cf-connecting-ip": " 203.0.113.7 "},
        client=SimpleNamespace(host="10.0.0.5"),
    )
    assert limiter_module._client_ip_from_headers(request) == "203.0.113.7"

    request.headers = {"x-forwarded-for": "198.51.100.9, 10.0.0.5"}
    assert limiter_module._client_ip_from_headers(request) == "198.51.100.9"


def test_limiter_client_ip_falls_back_to_direct_client(monkeypatch) -> None:
    from types import SimpleNamespace

    from app.core.config import Settings
    from app.core import limiter as limiter_module

    monkeypatch.setattr(
        limiter_module,
        "get_settings",
        lambda: Settings(trust_proxy_headers=False),
    )

    request = SimpleNamespace(
        headers={"cf-connecting-ip": "203.0.113.7"},
        client=SimpleNamespace(host="10.0.0.5"),
    )
    assert limiter_module._client_ip_from_headers(request) == "10.0.0.5"

    request.client = None
    assert limiter_module._client_ip_from_headers(request) == "unknown"
