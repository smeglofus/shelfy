"""Root test configuration.

Sets TESTING=true before any app code is imported so that the rate limiter
is disabled for the entire test suite.

Also wires a global SQLAlchemy connection event that enables foreign-key
enforcement on every SQLite connection the test suite opens. Production
runs on Postgres which enforces FKs natively; the test suite previously
ran on SQLite where ``PRAGMA foreign_keys`` defaults to ``OFF``, so
``ondelete=CASCADE`` and ``ondelete=SET NULL`` were never exercised and
dangling-FK rows could be inserted in tests without a complaint. That
let one class of "green tests, red prod" bug through.

The event listener is registered against the base ``Engine`` class so it
applies to every async engine the per-test fixtures spin up — no
per-engine wiring needed.
"""
import os

# Must be set before app modules are imported (limiter reads it at module load time)
os.environ.setdefault("TESTING", "true")

from sqlalchemy import event  # noqa: E402  — must come after env setup
from sqlalchemy.engine import Engine  # noqa: E402


@event.listens_for(Engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection: object, _connection_record: object) -> None:
    """Turn on FK enforcement for every SQLite connection the test suite opens.

    Detects SQLite by the DB-API module name, so it stays a no-op for any
    Postgres-backed test (e.g. when ``TEST_DATABASE_URL`` is overridden).
    """
    module_name = type(dbapi_connection).__module__
    if "sqlite" not in module_name.lower():
        return
    cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()
