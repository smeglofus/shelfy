"""Last-seen tracking for business telemetry.

``touch_last_seen`` stamps ``users.last_seen_at`` at most once per
``LAST_SEEN_THROTTLE`` window per user. The throttle lives in the SQL
WHERE clause, so concurrent requests cannot double-write and the hot
path (recently-stamped user) is a single UPDATE matching zero rows —
no Redis round-trip, no extra SELECT.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import uuid

from sqlalchemy import or_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

LAST_SEEN_THROTTLE = timedelta(minutes=15)


async def touch_last_seen(
    session: AsyncSession, user_id: uuid.UUID, *, now: datetime | None = None
) -> bool:
    """Stamp the user's last activity; returns True when a write happened.

    Commits only when a row was actually updated. Called from
    ``get_current_user`` — i.e. before any endpoint logic runs — so the
    commit never releases locks an endpoint has taken.
    """
    stamp = now or datetime.now(timezone.utc)
    threshold = stamp - LAST_SEEN_THROTTLE
    result = await session.execute(
        update(User)
        .where(User.id == user_id)
        .where(or_(User.last_seen_at.is_(None), User.last_seen_at < threshold))
        .values(last_seen_at=stamp)
        # No identity-map sync: the default 'evaluate' strategy compares the
        # WHERE clause in Python against in-session instances and dies on
        # naive/aware datetime mixes; nothing reads last_seen_at from the
        # session, so skipping the sync is both safe and cheaper.
        .execution_options(synchronize_session=False)
    )
    if result.rowcount:
        await session.commit()
        return True
    return False
