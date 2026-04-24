"""Tests for Apple Pay / Google Pay readiness on Stripe Checkout.

These tests cover the *server-side* contract that determines whether Stripe
will render the Apple Pay / Google Pay buttons on hosted Checkout. They do
NOT make any network calls — every Stripe SDK entrypoint is patched.

Coverage:

  ``create_checkout_session`` payload
    - omits ``payment_method_types`` (Dashboard drives method selection;
      passing it would silently override and is the #1 cause of wallets
      disappearing in production — see the module-level comment in
      ``app/services/billing.py``)
    - sets ``payment_method_collection="always"`` so a card is collected
      even on trials (the wallet button is exactly that)
    - keeps ``mode="subscription"`` (Stripe automatically sets
      ``setup_future_usage=off_session`` on the underlying SetupIntent in
      this mode, which is what wallets need for recurring charges)
    - preserves the existing plan/interval contract — the wallet work is
      strictly additive

  ``assess_wallet_readiness``
    - missing STRIPE_SECRET_KEY → warns + ``ok=False``
    - APP_URL with no host (e.g. ``http://``) → warns
    - HTTP scheme on a non-localhost host → warns (Apple Pay needs HTTPS)
    - host not in ``PaymentMethodDomain.list()`` → warns (not registered)
    - host registered but ``apple_pay.status != "active"`` → warns
      (registered but unverified) and surfaces Stripe's error message when
      present
    - host registered and ``apple_pay.status == "active"`` → no warnings,
      ``ok=True``
    - Stripe API error during list → warns gracefully (never raises)

  ``GET /api/v1/billing/wallet-readiness`` endpoint
    - 200 with the structured assessment when configured + healthy
    - includes warnings array when misconfigured
    - 503 when STRIPE_SECRET_KEY is unset (covered by ``_require_stripe``)
"""
from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Iterator
from typing import Any
from unittest.mock import MagicMock

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.dependencies.auth import get_current_user
from app.core.config import Settings, get_settings
from app.db.base import Base
from app.db.session import get_db_session
from app.main import app
from app.models.subscription import Subscription, SubscriptionPlan, SubscriptionStatus
from app.models.user import User
from app.services import billing as billing_svc


# ── Fixtures ────────────────────────────────────────────────────────────────────

_PRICE_PRO_MONTHLY = "price_test_pro_monthly_walletcheck"


@pytest.fixture
async def test_sessionmaker() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
def test_settings() -> Settings:
    """Minimal Settings exercising the wallet-relevant fields."""
    return Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret_key="test-secret",
        jwt_algorithm="HS256",
        stripe_secret_key="sk_test_walletcheck",
        stripe_webhook_secret="whsec_test_walletcheck_123456789012345678901234",
        stripe_price_id_pro_monthly=_PRICE_PRO_MONTHLY,
        app_url="https://shelfy.test",
    )


@pytest.fixture
async def seeded_user(
    test_sessionmaker: async_sessionmaker[AsyncSession],
) -> tuple[uuid.UUID, User]:
    """Create a User + free Subscription. Returns (user_id, user instance)."""
    async with test_sessionmaker() as s:
        user = User(email=f"{uuid.uuid4()}@wallet.test", hashed_password="x")
        s.add(user)
        await s.flush()
        sub = Subscription(
            user_id=user.id,
            plan=SubscriptionPlan.free,
            status=SubscriptionStatus.active,
        )
        s.add(sub)
        await s.commit()
        await s.refresh(user)
        return user.id, user


@pytest.fixture
def override_db(
    test_sessionmaker: async_sessionmaker[AsyncSession],
    test_settings: Settings,
) -> Iterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        async with test_sessionmaker() as s:
            yield s

    app.dependency_overrides[get_db_session] = _get_db
    app.dependency_overrides[get_settings] = lambda: test_settings
    yield
    app.dependency_overrides.clear()


# ── ``create_checkout_session`` payload contract ───────────────────────────────


@pytest.mark.asyncio
async def test_create_checkout_session_omits_payment_method_types(
    test_sessionmaker: async_sessionmaker[AsyncSession],
    test_settings: Settings,
    seeded_user: tuple[uuid.UUID, User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Wallet-readiness: ``payment_method_types`` MUST be omitted.

    Passing it (even ``["card"]``) silently overrides Dashboard payment-method
    config. We deliberately let Dashboard drive — see the module comment in
    ``app/services/billing.py``.
    """
    _, user = seeded_user

    captured_kwargs: dict[str, Any] = {}

    def fake_create(**kwargs: Any) -> dict[str, Any]:
        captured_kwargs.update(kwargs)
        return {"id": "cs_test_wallet_payload", "url": "https://checkout.stripe.test/fake"}

    fake_customer = MagicMock()
    fake_customer.__getitem__ = lambda self, key: "cus_test_walletcheck" if key == "id" else None

    monkeypatch.setattr(
        billing_svc._stripe.Customer, "create", lambda **_: fake_customer
    )
    monkeypatch.setattr(
        billing_svc._stripe.checkout.Session, "create", fake_create
    )

    async with test_sessionmaker() as session:
        await billing_svc.create_checkout_session(
            session, user, "pro", test_settings, interval="monthly"
        )

    assert captured_kwargs, "Stripe Session.create should have been invoked"

    # The crux of the test: never set payment_method_types on the server.
    assert "payment_method_types" not in captured_kwargs, (
        "create_checkout_session must NOT pass payment_method_types — Dashboard "
        "should drive method selection so wallets stay enabled"
    )

    # Wallet-relevant flags we DO want set, with documented values.
    assert captured_kwargs["mode"] == "subscription"
    assert captured_kwargs["payment_method_collection"] == "always"
    assert captured_kwargs["allow_promotion_codes"] is True

    # The plan/interval contract from Task 4 must still hold — wallet work is
    # strictly additive and shouldn't have changed line-item routing.
    assert captured_kwargs["line_items"] == [
        {"price": _PRICE_PRO_MONTHLY, "quantity": 1}
    ]


@pytest.mark.asyncio
async def test_create_checkout_session_first_time_includes_trial(
    test_sessionmaker: async_sessionmaker[AsyncSession],
    test_settings: Settings,
    seeded_user: tuple[uuid.UUID, User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Trial flag still flows through after wallet wiring (regression guard).

    The wallet button has to be able to collect a card up front even with a
    trial — that's why we keep ``payment_method_collection="always"``. This
    test asserts that the trial period setup hasn't been clobbered.
    """
    _, user = seeded_user

    captured: dict[str, Any] = {}

    def fake_create(**kwargs: Any) -> dict[str, Any]:
        captured.update(kwargs)
        return {"id": "cs_trial", "url": "https://checkout.stripe.test/trial"}

    fake_customer = MagicMock()
    fake_customer.__getitem__ = lambda self, key: "cus_trial" if key == "id" else None

    monkeypatch.setattr(billing_svc._stripe.Customer, "create", lambda **_: fake_customer)
    monkeypatch.setattr(billing_svc._stripe.checkout.Session, "create", fake_create)

    async with test_sessionmaker() as session:
        await billing_svc.create_checkout_session(
            session, user, "pro", test_settings, interval="monthly"
        )

    sd = captured["subscription_data"]
    assert sd["trial_period_days"] == billing_svc._TRIAL_DAYS
    # ...and `payment_method_collection="always"` is what makes the wallet
    # button viable during the trial sign-up.
    assert captured["payment_method_collection"] == "always"


# ── ``assess_wallet_readiness`` ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_assess_wallet_readiness_missing_secret_key_warns() -> None:
    """No Stripe key → cannot probe; surface a clear warning, never raise."""
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret_key="test-secret",
        stripe_secret_key=None,
        app_url="https://shelfy.test",
    )
    readiness = await billing_svc.assess_wallet_readiness(settings)

    assert readiness.ok is False
    assert any("STRIPE_SECRET_KEY" in w for w in readiness.warnings)
    assert readiness.apple_pay_domain_registered is False
    assert readiness.apple_pay_domain_verified is False


@pytest.mark.asyncio
async def test_assess_wallet_readiness_no_host_warns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """APP_URL without a hostname (e.g. ``http://``) yields a warning.

    A configured Stripe key + an unparseable APP_URL is a real misconfig:
    Stripe domain registration needs a hostname.
    """
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret_key="test-secret",
        stripe_secret_key="sk_test_x",
        app_url="http://",
    )
    monkeypatch.setattr(billing_svc, "_list_payment_method_domains", lambda: [])

    readiness = await billing_svc.assess_wallet_readiness(settings)

    assert readiness.ok is False
    assert readiness.app_url_host is None
    assert any("hostname" in w.lower() for w in readiness.warnings)


@pytest.mark.asyncio
async def test_assess_wallet_readiness_http_in_prod_warns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """HTTP scheme on a non-localhost host → Apple Pay can't register."""
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret_key="test-secret",
        stripe_secret_key="sk_test_x",
        app_url="http://shelfy.example.com",
    )
    monkeypatch.setattr(billing_svc, "_list_payment_method_domains", lambda: [])

    readiness = await billing_svc.assess_wallet_readiness(settings)

    assert readiness.ok is False
    assert readiness.app_url_https is False
    assert any("HTTPS" in w for w in readiness.warnings)


@pytest.mark.asyncio
async def test_assess_wallet_readiness_localhost_http_does_not_warn_about_https(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Localhost HTTP is a dev convenience — don't yell about HTTPS there.

    The domain still won't be registered (unless the dev added localhost in
    Stripe, which Stripe rejects), so we still emit the not-registered
    warning. But we shouldn't double-warn about the scheme.
    """
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret_key="test-secret",
        stripe_secret_key="sk_test_x",
        app_url="http://localhost:5173",
    )
    monkeypatch.setattr(billing_svc, "_list_payment_method_domains", lambda: [])

    readiness = await billing_svc.assess_wallet_readiness(settings)

    # No HTTPS warning for localhost.
    assert not any("HTTPS" in w for w in readiness.warnings)
    # But the domain is still unregistered, so we expect a registration warning.
    assert any("NOT registered" in w for w in readiness.warnings)


@pytest.mark.asyncio
async def test_assess_wallet_readiness_domain_not_registered_warns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret_key="test-secret",
        stripe_secret_key="sk_test_x",
        app_url="https://shelfy.example.com",
    )
    # Stripe knows about a different domain only.
    monkeypatch.setattr(
        billing_svc,
        "_list_payment_method_domains",
        lambda: [{"domain_name": "other.example.com", "apple_pay": {"status": "active"}}],
    )

    readiness = await billing_svc.assess_wallet_readiness(settings)

    assert readiness.app_url_host == "shelfy.example.com"
    assert readiness.apple_pay_domain_registered is False
    assert readiness.apple_pay_domain_verified is False
    assert any("NOT registered" in w for w in readiness.warnings)


@pytest.mark.asyncio
async def test_assess_wallet_readiness_registered_but_inactive_warns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret_key="test-secret",
        stripe_secret_key="sk_test_x",
        app_url="https://shelfy.example.com",
    )
    monkeypatch.setattr(
        billing_svc,
        "_list_payment_method_domains",
        lambda: [
            {
                "domain_name": "shelfy.example.com",
                "apple_pay": {
                    "status": "inactive",
                    "status_details": {"error_message": "well-known fetch returned 404"},
                },
            }
        ],
    )

    readiness = await billing_svc.assess_wallet_readiness(settings)

    assert readiness.apple_pay_domain_registered is True
    assert readiness.apple_pay_domain_verified is False
    # Warning should mention the registered-but-not-verified state AND surface
    # the underlying Stripe error so ops doesn't have to dig into the Dashboard.
    joined = " | ".join(readiness.warnings)
    assert "registered but not verified" in joined
    assert "404" in joined


@pytest.mark.asyncio
async def test_assess_wallet_readiness_happy_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """All checks pass → ``ok=True`` and zero warnings."""
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret_key="test-secret",
        stripe_secret_key="sk_test_x",
        app_url="https://shelfy.example.com",
    )
    monkeypatch.setattr(
        billing_svc,
        "_list_payment_method_domains",
        lambda: [
            {
                "domain_name": "shelfy.example.com",
                "apple_pay": {"status": "active"},
            }
        ],
    )

    readiness = await billing_svc.assess_wallet_readiness(settings)

    assert readiness.ok is True
    assert readiness.warnings == ()
    assert readiness.apple_pay_domain_registered is True
    assert readiness.apple_pay_domain_verified is True
    assert readiness.app_url_https is True
    assert readiness.app_url_host == "shelfy.example.com"


@pytest.mark.asyncio
async def test_assess_wallet_readiness_stripe_error_does_not_raise(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A Stripe outage during probe → graceful warning, never a 5xx in callers."""
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret_key="test-secret",
        stripe_secret_key="sk_test_x",
        app_url="https://shelfy.example.com",
    )

    def boom() -> list[dict[str, Any]]:
        raise billing_svc._stripe.error.APIError("Stripe is having a bad day")

    monkeypatch.setattr(billing_svc, "_list_payment_method_domains", boom)

    readiness = await billing_svc.assess_wallet_readiness(settings)

    assert readiness.ok is False
    assert any("Stripe API error" in w for w in readiness.warnings)


# ── ``GET /api/v1/billing/wallet-readiness`` endpoint ──────────────────────────


@pytest.mark.asyncio
async def test_wallet_readiness_endpoint_returns_assessment(
    test_sessionmaker: async_sessionmaker[AsyncSession],
    test_settings: Settings,
    seeded_user: tuple[uuid.UUID, User],
    override_db: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Authenticated GET returns the structured assessment as JSON."""
    _, user = seeded_user
    app.dependency_overrides[get_current_user] = lambda: user

    # Patch out the actual Stripe call.
    async def fake_assess(_settings: Settings) -> billing_svc.WalletReadiness:
        return billing_svc.WalletReadiness(
            app_url_https=True,
            app_url_host="shelfy.test",
            apple_pay_domain_registered=True,
            apple_pay_domain_verified=True,
            warnings=(),
        )

    monkeypatch.setattr(billing_svc, "assess_wallet_readiness", fake_assess)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        res = await client.get("/api/v1/billing/wallet-readiness")

    assert res.status_code == 200, res.text
    body = res.json()
    assert body == {
        "ok": True,
        "app_url_host": "shelfy.test",
        "app_url_https": True,
        "apple_pay_domain_registered": True,
        "apple_pay_domain_verified": True,
        "warnings": [],
    }


@pytest.mark.asyncio
async def test_wallet_readiness_endpoint_surfaces_warnings(
    test_sessionmaker: async_sessionmaker[AsyncSession],
    test_settings: Settings,
    seeded_user: tuple[uuid.UUID, User],
    override_db: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Misconfig → 200 with ``ok=False`` and a populated warnings list.

    The endpoint MUST NOT raise on misconfig — that's exactly what ``warnings``
    exists to communicate. Operators expect to be able to ``curl`` this and
    parse JSON unconditionally.
    """
    _, user = seeded_user
    app.dependency_overrides[get_current_user] = lambda: user

    async def fake_assess(_settings: Settings) -> billing_svc.WalletReadiness:
        return billing_svc.WalletReadiness(
            app_url_https=False,
            app_url_host="shelfy.test",
            apple_pay_domain_registered=False,
            apple_pay_domain_verified=False,
            warnings=("APP_URL scheme is 'http'; Apple Pay requires HTTPS",),
        )

    monkeypatch.setattr(billing_svc, "assess_wallet_readiness", fake_assess)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        res = await client.get("/api/v1/billing/wallet-readiness")

    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is False
    assert body["warnings"] and "HTTPS" in body["warnings"][0]


@pytest.mark.asyncio
async def test_wallet_readiness_endpoint_503_when_stripe_unset(
    test_sessionmaker: async_sessionmaker[AsyncSession],
    seeded_user: tuple[uuid.UUID, User],
) -> None:
    """No Stripe key configured → 503 (handled by ``_require_stripe``)."""
    _, user = seeded_user

    bad_settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret_key="test-secret",
        stripe_secret_key=None,
        app_url="https://shelfy.test",
    )

    async def _get_db() -> AsyncIterator[AsyncSession]:
        async with test_sessionmaker() as s:
            yield s

    app.dependency_overrides[get_db_session] = _get_db
    app.dependency_overrides[get_settings] = lambda: bad_settings
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
            res = await client.get("/api/v1/billing/wallet-readiness")
    finally:
        app.dependency_overrides.clear()

    assert res.status_code == 503
