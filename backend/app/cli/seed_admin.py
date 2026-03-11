import asyncio

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services.user_seed import seed_admin_user


async def main() -> None:
    settings = get_settings()
    if settings.admin_email is None or settings.admin_password is None:
        raise RuntimeError("ADMIN_EMAIL and ADMIN_PASSWORD must be set")

    async with SessionLocal() as session:
        await seed_admin_user(session, settings.admin_email, settings.admin_password)


if __name__ == "__main__":
    asyncio.run(main())
