from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.core.security import get_password_hash
from app.models.library import LibraryMember
from app.models.subscription import Subscription, SubscriptionPlan, SubscriptionStatus
from app.models.user import User
from app.services.auth import get_user_by_email
from app.services.library import create_personal_library

logger = structlog.get_logger()


async def _ensure_registration_defaults(session: AsyncSession, user: User) -> None:
    subscription = (
        await session.execute(select(Subscription).where(Subscription.user_id == user.id))
    ).scalar_one_or_none()
    if subscription is None:
        session.add(
            Subscription(
                user_id=user.id,
                plan=SubscriptionPlan.free,
                status=SubscriptionStatus.active,
            )
        )

    library_membership = (
        await session.execute(select(LibraryMember).where(LibraryMember.user_id == user.id).limit(1))
    ).scalar_one_or_none()
    if library_membership is None:
        await create_personal_library(session, user)


async def seed_admin_user(session: AsyncSession, email: str, password: str) -> bool:
    existing_user = await get_user_by_email(session, email)
    if existing_user is not None:
        await _ensure_registration_defaults(session, existing_user)
        await session.commit()
        logger.info("admin_user_exists", user_id=str(existing_user.id))
        return False

    user = User(email=email, hashed_password=get_password_hash(password))
    session.add(user)
    await session.flush()
    await _ensure_registration_defaults(session, user)
    await session.commit()
    await session.refresh(user)
    logger.info("admin_user_created", user_id=str(user.id))
    return True
