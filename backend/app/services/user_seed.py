from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_password_hash
from app.models.user import User
from app.services.auth import get_user_by_email


async def seed_admin_user(session: AsyncSession, email: str, password: str) -> bool:
    existing_user = await get_user_by_email(session, email)
    if existing_user is not None:
        return False

    user = User(email=email, hashed_password=get_password_hash(password))
    session.add(user)
    await session.commit()
    return True
