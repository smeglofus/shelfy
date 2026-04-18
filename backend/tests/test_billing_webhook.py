"""Tests for the Stripe webhook handler (#120).

Covers:

  Signature security
    - valid signature → 200
    - invalid signature → 400
    - missing Stripe-Signature header → 400
    - webhook secret unset → 503

  Idempotency / replay safety
    - duplicate event (same event.id) is a no-op on the second delivery
    - mid-dispatch failure rolls back the StripeEvent claim so Stripe's retry
      can finally apply the side effect

  Event coverage
    - checkout.session.completed links the Stripe subscription to our row
    - customer.subscription.updated syncs plan, status, period
    - customer.subscription.deleted marks the row canceled
    - invoice.payment_succeeded recovers past_due → active
    - invoice.payment_failed flips active → past_due
    - unknown event type is recorded but ignored (200)

  Ordering
    - an older event.created does NOT downgrade a newer subscription state

  Plan mapping
    - STRIPE_PRICE_ID_HOME_* → SubscriptionPlan.home (monthly + yearly)
    - STRIPE_PRICE_ID_PRO_* → SubscriptionPlan.pro (monthly + yearly)
    - STRIPE_PRICE_ID_LIBRARY_* → SubscriptionPlan.library (monthly + yearly)
    - unknown / empty price ID → SubscriptionPlan.free

All tests use an in-memory SQLite DB and a fake Stripe signing secret; no
network calls to Stripe are performed. Signatures are constructed using the
real ``stripe.WebhookSignature`` primitives so we exercise the actual
verification code path end-to-end.
"""
from __future__ import annotations

import hmac
import hashlib
import json
import time
import uuid
from collections.abc import AsyncIterator, Iterator
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings, get_settings
from app.db.base import Base
from app.db.session import get_db_session
from app.main import app
from app.models.subscription import (
    StripeEvent,
    Subscription,
    SubscriptionPlan,
    SubscriptionStatus,
)
from app.models.user import User
from app.services import billing as billing_svc


# ── Fixtures ────────────────────────────────────────────────────────────────────

_WEBHOOK_SECRET = "whsec_test_123456789012345678901234567890"
_PRICE_HOME_MONTHLY = "price_test_home_monthly"
_PRICE_HOME_YEARLY = "price_test_home_yearly"
_PRICE_PRO_MONTHLY = "price_test_pro_monthly"
_PRICE_PRO_YEARLY = "price_test_pro_yearly"
_PRICE_LIBRARY_MONTHLY = "price_test_library_monthly"
_PRICE_LIBRARY_YEARLY = "price_test_library_yearly"

# Back-compat aliases so the older tests in this module keep reading clearly:
# the monthly price is the canonical one exercised in most flows.
_PRICE_PRO = _PRICE_PRO_MONTHLY
_PRICE_LIBRARY = _PRICE_LIBRARY_MONTHLY


@pytest.fixture
async def test_sessionmaker() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
def test_settings() -> Settings:
    return Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret_key="test-secret",
        jwt_algorithm="HS256",
        stripe_secret_key="sk_test_dummy",
        stripe_webhook_secret=_WEBHOOK_SECRET,
        stripe_price_id_home_monthly=_PRICE_HOME_MONTHLY,
        stripe_price_id_home_yearly=_PRICE_HOME_YEARLY,
        stripe_price_id_pro_monthly=_PRICE_PRO_MONTHLY,
        stripe_price_id_pro_yearly=_PRICE_PRO_YEARLY,
        stripe_price_id_library_monthly=_PRICE_LIBRARY_MONTHLY,
        stripe_price_id_library_yearly=_PRICE_LIBRARY_YEARLY,
    )


@pytest.fixture(autouse=True)
def override_dependencies(
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


# ── Helpers ─────────────────────────────────────────────────────────────────────

def _as_utc(dt: datetime) -> datetime:
    """Return ``dt`` as a tz-aware UTC datetime.

    SQLite stores ``TIMESTAMP WITH TIME ZONE`` columns as naive strings and
    reads them back without tzinfo — so tests need to re-attach UTC before
    comparing against aware expectations. Postgres preserves tzinfo natively.
    """
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _sign(payload: bytes, secret: str = _WEBHOOK_SECRET, ts: int | None = None) -> str:
    """Build a Stripe-Signature header value for ``payload`` with ``secret``.

    Matches the format Stripe uses on real webhook deliveries so
    ``stripe.Webhook.construct_event`` verifies successfully:
        t=<unix_ts>,v1=<hex_hmac>
    """
    ts = ts or int(time.time())
    signed = f"{ts}.{payload.decode()}".encode()
    sig = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return f"t={ts},v1={sig}"


def _event(
    event_type: str,
    data_object: dict,
    *,
    event_id: str | None = None,
    created: datetime | None = None,
) -> bytes:
    """Build a minimal Stripe webhook event JSON payload."""
    created_ts = int((created or datetime.now(timezone.utc)).timestamp())
    body = {
        "id": event_id or f"evt_{uuid.uuid4().hex[:24]}",
        "object": "event",
        "type": event_type,
        "created": created_ts,
        "data": {"object": data_object},
        "livemode": False,
        "api_version": "2024-06-20",
    }
    return json.dumps(body).encode()


async def _seed_user_with_customer(
    sm: async_sessionmaker[AsyncSession],
    *,
    customer_id: str,
    plan: SubscriptionPlan = SubscriptionPlan.free,
    status: SubscriptionStatus = SubscriptionStatus.active,
    last_event_at: datetime | None = None,
) -> tuple[uuid.UUID, uuid.UUID]:
    """Create a user + subscription linked to a Stripe customer id.

    Returns (user_id, subscription_id).
    """
    async with sm() as s:
        user = User(email=f"{uuid.uuid4()}@t.test", hashed_password="x")
        s.add(user)
        await s.flush()
        sub = Subscription(
            user_id=user.id,
            plan=plan,
            status=status,
            stripe_customer_id=customer_id,
            last_stripe_event_at=last_event_at,
        )
        s.add(sub)
        await s.commit()
        return user.id, sub.id


async def _post_webhook(client: AsyncClient, payload: bytes, *, sig: str | None) -> "httpx.Response":  # noqa: F821
    headers: dict[str, str] = {"content-type": "application/json"}
    if sig is not None:
        headers["stripe-signature"] = sig
    return await client.post("/api/v1/billing/webhook", content=payload, headers=headers)


# ── Signature verification ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_valid_signature_is_accepted(
    test_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    customer_id = "cus_valid_sig"
    await _seed_user_with_customer(test_sessionmaker, customer_id=customer_id)

    payload = _event(
        "customer.subscription.updated",
        {
            "id": "sub_A",
            "customer": customer_id,
            "status": "active",
            "items": {"data": [{"price": {"id": _PRICE_PRO}}]},
            "current_period_start": int(time.time()),
            "current_period_end": int(time.time()) + 30 * 86400,
            "trial_end": None,
        },
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        res = await _post_webhook(client, payload, sig=_sign(payload))

    assert res.status_code == 200, res.text


@pytest.mark.asyncio
async def test_invalid_signature_is_rejected() -> None:
    payload = _event("customer.subscription.updated", {"id": "sub_X", "customer": "cus_X", "status": "active"})
    bad_sig = _sign(payload, secret="whsec_WRONG_SECRET")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        res = await _post_webhook(client, payload, sig=bad_sig)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_missing_signature_is_rejected() -> None:
    payload = _event("customer.subscription.updated", {"id": "sub_X", "customer": "cus_X", "status": "active"})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        res = await _post_webhook(client, payload, sig=None)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_signature_requires_raw_body() -> None:
    """Sanity check: signing one body but sending a different body must fail.

    Regression guard — if someone ever changes the endpoint to re-serialise
    the JSON before verifying, this test will fail.
    """
    signed_payload = _event("customer.subscription.updated", {"id": "sub_A", "customer": "cus_A", "status": "active"})
    sig = _sign(signed_payload)
    tampered = signed_payload.replace(b'"active"', b'"canceled"')

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        res = await _post_webhook(client, tampered, sig=sig)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_webhook_secret_unset_returns_503(
    test_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # Replace the settings dep to drop the webhook secret.
    bad_settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret_key="test-secret",
        stripe_secret_key="sk_test_dummy",
        stripe_webhook_secret=None,  # NOT configured
    )
    app.dependency_overrides[get_settings] = lambda: bad_settings
    payload = _event("customer.subscription.updated", {"id": "sub_X", "customer": "cus_X", "status": "active"})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        res = await _post_webhook(client, payload, sig=_sign(payload))
    assert res.status_code == 503


# ── Idempotency / replay ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_duplicate_event_is_a_noop(
    test_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    customer_id = "cus_dup"
    await _seed_user_with_customer(
        test_sessionmaker, customer_id=customer_id, plan=SubscriptionPlan.free
    )

    event_id = "evt_dup_12345"
    payload = _event(
        "customer.subscription.updated",
        {
            "id": "sub_dup",
            "customer": customer_id,
            "status": "active",
            "items": {"data": [{"price": {"id": _PRICE_PRO}}]},
            "current_period_start": int(time.time()),
            "current_period_end": int(time.time()) + 30 * 86400,
        },
        event_id=event_id,
    )
    sig = _sign(payload)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        res1 = await _post_webhook(client, payload, sig=sig)
        res2 = await _post_webhook(client, payload, sig=sig)

    assert res1.status_code == 200
    assert res2.status_code == 200

    # Only ONE StripeEvent row should exist, and the plan must be 'pro' (not
    # counted twice, not re-applied).
    async with test_sessionmaker() as s:
        events = (await s.execute(select(StripeEvent))).scalars().all()
        subs = (await s.execute(select(Subscription))).scalars().all()

    assert len(events) == 1
    assert events[0].event_id == event_id
    assert len(subs) == 1
    assert SubscriptionPlan(subs[0].plan) is SubscriptionPlan.pro


@pytest.mark.asyncio
async def test_mid_dispatch_failure_rolls_back_claim(
    test_sessionmaker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If a handler raises, the StripeEvent row MUST NOT be persisted.

    Otherwise Stripe's retry would see the claim and silently skip the side
    effect forever — the exact failure mode #120 is guarding against.
    """
    customer_id = "cus_fail"
    await _seed_user_with_customer(test_sessionmaker, customer_id=customer_id)

    async def _boom(session, data, event_created_at, settings):  # type: ignore[no-untyped-def]
        raise RuntimeError("simulated downstream failure")

    monkeypatch.setattr(billing_svc, "_handle_subscription_updated", _boom)

    payload = _event(
        "customer.subscription.updated",
        {
            "id": "sub_fail",
            "customer": customer_id,
            "status": "active",
            "items": {"data": [{"price": {"id": _PRICE_PRO}}]},
        },
        event_id="evt_fail_1",
    )

    # ``raise_app_exceptions=False`` — we WANT the 5xx response back, not the
    # exception re-raised into the test body. In real deployments FastAPI's
    # exception handler converts this to a 500 which is exactly what Stripe
    # sees and triggers a retry on.
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://t") as client:
        res = await _post_webhook(client, payload, sig=_sign(payload))

    # We surface the failure so Stripe retries. 500 (or any 5xx) is fine.
    assert res.status_code >= 500

    # Critical assertion: claim row is NOT in the DB, so the retry will work.
    async with test_sessionmaker() as s:
        events = (await s.execute(select(StripeEvent))).scalars().all()
    assert events == []


# ── Event coverage ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_checkout_session_completed_links_subscription(
    test_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # The checkout_completed handler looks up the local row by user_id metadata.
    async with test_sessionmaker() as s:
        user = User(email="co@t.test", hashed_password="x")
        s.add(user)
        await s.flush()
        s.add(Subscription(user_id=user.id, plan=SubscriptionPlan.free, status=SubscriptionStatus.active))
        await s.commit()
        user_id = user.id

    payload = _event(
        "checkout.session.completed",
        {
            "id": "cs_test_123",
            "subscription": "sub_new_abc",
            "metadata": {"user_id": str(user_id)},
        },
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        res = await _post_webhook(client, payload, sig=_sign(payload))
    assert res.status_code == 200

    async with test_sessionmaker() as s:
        sub = (await s.execute(select(Subscription).where(Subscription.user_id == user_id))).scalar_one()
    assert sub.stripe_subscription_id == "sub_new_abc"


@pytest.mark.asyncio
async def test_subscription_updated_syncs_plan_status_period(
    test_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    customer_id = "cus_sync"
    await _seed_user_with_customer(test_sessionmaker, customer_id=customer_id)

    period_start = int(time.time())
    period_end = period_start + 30 * 86400
    payload = _event(
        "customer.subscription.updated",
        {
            "id": "sub_sync",
            "customer": customer_id,
            "status": "trialing",
            "items": {"data": [{"price": {"id": _PRICE_LIBRARY}}]},
            "current_period_start": period_start,
            "current_period_end": period_end,
            "trial_end": period_end,
        },
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        res = await _post_webhook(client, payload, sig=_sign(payload))
    assert res.status_code == 200

    async with test_sessionmaker() as s:
        sub = (
            await s.execute(select(Subscription).where(Subscription.stripe_customer_id == customer_id))
        ).scalar_one()
    assert SubscriptionPlan(sub.plan) is SubscriptionPlan.library
    assert SubscriptionStatus(sub.status) is SubscriptionStatus.trialing
    # SQLite drops tzinfo on round-trip — compare as UTC epoch to avoid
    # naive-vs-aware mismatches. The service stores tz-aware UTC; Postgres
    # preserves it, SQLite does not.
    assert sub.current_period_end is not None
    assert sub.trial_ends_at is not None
    assert int(_as_utc(sub.current_period_end).timestamp()) == period_end
    assert int(_as_utc(sub.trial_ends_at).timestamp()) == period_end
    assert sub.stripe_subscription_id == "sub_sync"


@pytest.mark.asyncio
async def test_subscription_deleted_marks_canceled(
    test_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    customer_id = "cus_del"
    await _seed_user_with_customer(
        test_sessionmaker, customer_id=customer_id, plan=SubscriptionPlan.pro
    )

    payload = _event(
        "customer.subscription.deleted",
        {"id": "sub_del", "customer": customer_id, "status": "canceled"},
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        res = await _post_webhook(client, payload, sig=_sign(payload))
    assert res.status_code == 200

    async with test_sessionmaker() as s:
        sub = (
            await s.execute(select(Subscription).where(Subscription.stripe_customer_id == customer_id))
        ).scalar_one()
    assert SubscriptionStatus(sub.status) is SubscriptionStatus.canceled


@pytest.mark.asyncio
async def test_invoice_payment_succeeded_recovers_past_due(
    test_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    customer_id = "cus_recover"
    await _seed_user_with_customer(
        test_sessionmaker,
        customer_id=customer_id,
        plan=SubscriptionPlan.pro,
        status=SubscriptionStatus.past_due,
    )

    period_end = int(time.time()) + 45 * 86400
    payload = _event(
        "invoice.payment_succeeded",
        {"id": "in_1", "customer": customer_id, "period_end": period_end},
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        res = await _post_webhook(client, payload, sig=_sign(payload))
    assert res.status_code == 200

    async with test_sessionmaker() as s:
        sub = (
            await s.execute(select(Subscription).where(Subscription.stripe_customer_id == customer_id))
        ).scalar_one()
    assert SubscriptionStatus(sub.status) is SubscriptionStatus.active
    assert sub.current_period_end is not None
    assert int(_as_utc(sub.current_period_end).timestamp()) == period_end


@pytest.mark.asyncio
async def test_invoice_payment_failed_marks_past_due(
    test_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    customer_id = "cus_fail_pay"
    await _seed_user_with_customer(
        test_sessionmaker,
        customer_id=customer_id,
        plan=SubscriptionPlan.pro,
        status=SubscriptionStatus.active,
    )

    payload = _event(
        "invoice.payment_failed",
        {"id": "in_2", "customer": customer_id},
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        res = await _post_webhook(client, payload, sig=_sign(payload))
    assert res.status_code == 200

    async with test_sessionmaker() as s:
        sub = (
            await s.execute(select(Subscription).where(Subscription.stripe_customer_id == customer_id))
        ).scalar_one()
    assert SubscriptionStatus(sub.status) is SubscriptionStatus.past_due


@pytest.mark.asyncio
async def test_unknown_event_type_is_ignored_but_recorded(
    test_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    payload = _event(
        "payment_intent.created",
        {"id": "pi_test", "amount": 100},
        event_id="evt_unknown_1",
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        res = await _post_webhook(client, payload, sig=_sign(payload))
    assert res.status_code == 200

    async with test_sessionmaker() as s:
        events = (await s.execute(select(StripeEvent))).scalars().all()
    assert len(events) == 1
    assert events[0].event_type == "payment_intent.created"


# ── Ordering ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_older_event_does_not_downgrade_newer_state(
    test_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Stripe delivers webhooks at-least-once and NOT in order (#120).

    Scenario: a later ``customer.subscription.updated`` lifted the user to
    ``pro + active``. A re-delivery of an earlier ``past_due`` update arrives
    afterwards. The older delivery must NOT overwrite the newer state.
    """
    customer_id = "cus_order"
    newer_ts = datetime.now(timezone.utc)
    older_ts = newer_ts - timedelta(minutes=5)

    # Simulate that we've already applied the newer event.
    await _seed_user_with_customer(
        test_sessionmaker,
        customer_id=customer_id,
        plan=SubscriptionPlan.pro,
        status=SubscriptionStatus.active,
        last_event_at=newer_ts,
    )

    # Now deliver the older event (past_due on the same customer).
    payload = _event(
        "customer.subscription.updated",
        {
            "id": "sub_order",
            "customer": customer_id,
            "status": "past_due",
            "items": {"data": [{"price": {"id": _PRICE_PRO}}]},
            "current_period_start": int(older_ts.timestamp()),
            "current_period_end": int(older_ts.timestamp()) + 30 * 86400,
        },
        event_id="evt_older",
        created=older_ts,
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        res = await _post_webhook(client, payload, sig=_sign(payload))
    assert res.status_code == 200, res.text

    async with test_sessionmaker() as s:
        sub = (
            await s.execute(select(Subscription).where(Subscription.stripe_customer_id == customer_id))
        ).scalar_one()
        events = (await s.execute(select(StripeEvent))).scalars().all()

    # Side effect was skipped (state preserved) …
    assert SubscriptionStatus(sub.status) is SubscriptionStatus.active
    assert SubscriptionPlan(sub.plan) is SubscriptionPlan.pro
    # … but the event IS recorded, so Stripe stops retrying.
    assert len(events) == 1
    assert events[0].event_id == "evt_older"


# ── Plan mapping ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "price_attr,expected_plan",
    [
        (_PRICE_HOME_MONTHLY,    SubscriptionPlan.home),
        (_PRICE_HOME_YEARLY,     SubscriptionPlan.home),
        (_PRICE_PRO_MONTHLY,     SubscriptionPlan.pro),
        (_PRICE_PRO_YEARLY,      SubscriptionPlan.pro),
        (_PRICE_LIBRARY_MONTHLY, SubscriptionPlan.library),
        (_PRICE_LIBRARY_YEARLY,  SubscriptionPlan.library),
    ],
)
def test_plan_from_price_id_maps_all_six_variants(
    price_attr: str,
    expected_plan: SubscriptionPlan,
    test_settings: Settings,
) -> None:
    """Each of the 6 configured price IDs must map to the correct plan.

    Guards the invariant that yearly and monthly variants share the same
    plan enum value — the billing cadence is tracked separately via
    ``Subscription.current_period_end``.
    """
    assert (
        billing_svc._plan_from_price_id(price_attr, test_settings) is expected_plan
    )


def test_plan_from_price_id_maps_unknown_to_free(test_settings: Settings) -> None:
    """Unknown price IDs are safe-defaulted to ``free``.

    This is the safe fallback for webhooks: if an admin reconfigures prices
    mid-flight, we'd rather drop users to free and let them re-checkout
    than silently promote them to a plan they didn't pay for.
    """
    assert (
        billing_svc._plan_from_price_id("price_totally_unknown", test_settings)
        is SubscriptionPlan.free
    )


def test_plan_from_price_id_handles_empty(test_settings: Settings) -> None:
    assert billing_svc._plan_from_price_id("", test_settings) is SubscriptionPlan.free


def test_plan_from_price_id_ignores_unconfigured_slots() -> None:
    """If a slot is left empty (None) in Settings, the empty-price lookup
    must not accidentally match it.

    Regression test for the None-pollution bug the reverse-lookup table
    could have had without the explicit ``reverse.pop(None, None)``.
    """
    partial_settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret_key="test-secret",
        jwt_algorithm="HS256",
        stripe_secret_key="sk_test_dummy",
        stripe_webhook_secret=_WEBHOOK_SECRET,
        # Only configure pro/monthly — everything else is None.
        stripe_price_id_pro_monthly=_PRICE_PRO_MONTHLY,
    )
    assert (
        billing_svc._plan_from_price_id("", partial_settings) is SubscriptionPlan.free
    )
    assert (
        billing_svc._plan_from_price_id("price_unrelated", partial_settings)
        is SubscriptionPlan.free
    )
    assert (
        billing_svc._plan_from_price_id(_PRICE_PRO_MONTHLY, partial_settings)
        is SubscriptionPlan.pro
    )


@pytest.mark.asyncio
async def test_home_plan_sync_on_subscription_updated(
    test_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """End-to-end: a subscription.updated carrying the Home yearly price
    lifts the local row to ``plan=home`` (the new SaaS tier)."""
    customer_id = "cus_home_sync"
    await _seed_user_with_customer(test_sessionmaker, customer_id=customer_id)

    period_start = int(time.time())
    period_end = period_start + 365 * 86400
    payload = _event(
        "customer.subscription.updated",
        {
            "id": "sub_home",
            "customer": customer_id,
            "status": "active",
            "items": {"data": [{"price": {"id": _PRICE_HOME_YEARLY}}]},
            "current_period_start": period_start,
            "current_period_end": period_end,
            "trial_end": None,
        },
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        res = await _post_webhook(client, payload, sig=_sign(payload))
    assert res.status_code == 200, res.text

    async with test_sessionmaker() as s:
        sub = (
            await s.execute(select(Subscription).where(Subscription.stripe_customer_id == customer_id))
        ).scalar_one()
    assert SubscriptionPlan(sub.plan) is SubscriptionPlan.home
    assert SubscriptionStatus(sub.status) is SubscriptionStatus.active
