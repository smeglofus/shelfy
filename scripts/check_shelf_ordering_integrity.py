#!/usr/bin/env python3
"""Check shelf ordering integrity in DB."""

from __future__ import annotations

import asyncio
import os
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

SQL_DUP = """
SELECT location_id, shelf_position, COUNT(*) AS c
FROM books
WHERE location_id IS NOT NULL AND shelf_position IS NOT NULL
GROUP BY location_id, shelf_position
HAVING COUNT(*) > 1
ORDER BY c DESC;
"""

SQL_GAPS = """
WITH ranked AS (
  SELECT location_id,
         shelf_position,
         ROW_NUMBER() OVER (PARTITION BY location_id ORDER BY shelf_position) - 1 AS expected
  FROM books
  WHERE location_id IS NOT NULL AND shelf_position IS NOT NULL
)
SELECT location_id, shelf_position, expected
FROM ranked
WHERE shelf_position <> expected;
"""

async def main() -> int:
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL is not set")
        return 2

    engine = create_async_engine(db_url)
    async with engine.connect() as conn:
        dup = (await conn.execute(text(SQL_DUP))).all()
        gaps = (await conn.execute(text(SQL_GAPS))).all()

    await engine.dispose()

    if dup:
        print("❌ Duplicate shelf positions found:")
        for row in dup[:20]:
            print(row)
    if gaps:
        print("❌ Non-contiguous shelf positions found:")
        for row in gaps[:20]:
            print(row)

    if not dup and not gaps:
        print("✅ Shelf ordering integrity check passed")
        return 0
    return 1

if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
