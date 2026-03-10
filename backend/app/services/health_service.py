from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine
import redis.asyncio as redis

from app.core.config import Settings


async def check_database(settings: Settings) -> None:
    engine = create_async_engine(settings.database_url, future=True)
    try:
        async with engine.connect() as connection:
            await connection.execute(select(1))
    finally:
        await engine.dispose()


async def check_redis(settings: Settings) -> None:
    client = redis.from_url(settings.redis_url, decode_responses=True)
    try:
        await client.ping()
    finally:
        await client.aclose()
