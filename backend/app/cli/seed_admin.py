import asyncio

import structlog

from app.core.config import get_settings
from app.core.logging import configure_structlog
from app.db.session import SessionLocal
from app.services.user_seed import seed_admin_user

configure_structlog(service="backend")
logger = structlog.get_logger()


async def main() -> None:
    settings = get_settings()
    if settings.admin_email is None or settings.admin_password is None:
        raise RuntimeError("ADMIN_EMAIL and ADMIN_PASSWORD must be set")

    async with SessionLocal() as session:
        created = await seed_admin_user(session, settings.admin_email, settings.admin_password)

    logger.info("admin_seed_cli_result", created=created)


if __name__ == "__main__":
    asyncio.run(main())
