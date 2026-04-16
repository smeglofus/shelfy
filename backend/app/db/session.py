from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

settings = get_settings()

# Pool sizing: backend handles JSON-mostly endpoints with short DB transactions.
# Defaults of 5/10 are too low for even modest concurrency; bump to 20/10 with
# pre-ping to recover from idle disconnects (RDS / pgbouncer tend to drop them)
# and a 30-min recycle to dodge stale TCP connections behind load balancers.
# SQLite (used in some unit tests) does not accept these pool kwargs, so omit
# them when pointing at a SQLite URL.
_engine_kwargs: dict[str, object] = {}
if not settings.database_url.startswith("sqlite"):
    _engine_kwargs.update(
        pool_size=20,
        max_overflow=10,
        pool_pre_ping=True,
        pool_recycle=1800,
    )

engine = create_async_engine(settings.database_url, **_engine_kwargs)
SessionLocal = async_sessionmaker(bind=engine, autocommit=False, autoflush=False, class_=AsyncSession)


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
