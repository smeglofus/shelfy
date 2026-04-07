"""Scheduled maintenance tasks — backup, cleanup, and restore verification.

Tasks registered with Celery beat via celery_beat.py:

  backup.pg_dump          02:00 UTC daily  — pg_dump → gzip → MinIO
  backup.verify_restore   03:00 UTC weekly — download latest backup, restore to
                                             temp DB, verify row counts, drop DB
  cleanup.stripe_events   04:00 UTC weekly — prune stripe_events rows > 90 days

Environment variables (all optional, sensible defaults for docker-compose):
  DATABASE_URL           — postgresql+psycopg2://shelfy:shelfy@postgres/shelfy
  MINIO_ENDPOINT         — http://minio:9000
  MINIO_ACCESS_KEY       — minioadmin
  MINIO_SECRET_KEY       — minioadmin
  MINIO_BACKUP_BUCKET    — shelfy-backups
  MINIO_REGION           — us-east-1
  BACKUP_KEEP_DAYS       — 30
  STRIPE_EVENTS_KEEP_DAYS— 90
"""
from __future__ import annotations

import datetime
import gzip
import os
import re
import subprocess
import tempfile
from urllib.parse import urlparse

import boto3
from botocore.exceptions import ClientError
from celery.schedules import crontab

from celery_app import celery_app

_BACKUP_BUCKET = os.environ.get("MINIO_BACKUP_BUCKET", "shelfy-backups")
_KEEP_DAYS = int(os.environ.get("BACKUP_KEEP_DAYS", "30"))
_STRIPE_EVENTS_KEEP_DAYS = int(os.environ.get("STRIPE_EVENTS_KEEP_DAYS", "90"))


# ── MinIO helpers ──────────────────────────────────────────────────────────────

def _s3_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("MINIO_ENDPOINT", "http://minio:9000"),
        aws_access_key_id=os.environ.get("MINIO_ACCESS_KEY", "minioadmin"),
        aws_secret_access_key=os.environ.get("MINIO_SECRET_KEY", "minioadmin"),
        region_name=os.environ.get("MINIO_REGION", "us-east-1"),
    )


def _ensure_bucket(client) -> None:
    try:
        client.head_bucket(Bucket=_BACKUP_BUCKET)
    except ClientError as exc:
        if exc.response["Error"]["Code"] in ("404", "NoSuchBucket"):
            client.create_bucket(Bucket=_BACKUP_BUCKET)
        else:
            raise


def _prune_old_backups(client, dbname: str) -> None:
    """Delete backups older than KEEP_DAYS from the backup bucket."""
    prefix = f"daily/{dbname}-"
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=_KEEP_DAYS)
    paginator = client.get_paginator("list_objects_v2")
    to_delete = []
    for page in paginator.paginate(Bucket=_BACKUP_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            if obj["LastModified"] < cutoff:
                to_delete.append({"Key": obj["Key"]})
    if to_delete:
        client.delete_objects(Bucket=_BACKUP_BUCKET, Delete={"Objects": to_delete})


# ── URL parsing ────────────────────────────────────────────────────────────────

def _parse_db_url(database_url: str) -> dict[str, str]:
    """Extract pg_dump connection params from a SQLAlchemy DATABASE_URL."""
    raw = re.sub(r"^\w+\+", "", database_url)  # strip "+psycopg2" / "+asyncpg"
    parsed = urlparse(raw)
    return {
        "host": parsed.hostname or "postgres",
        "port": str(parsed.port or 5432),
        "user": parsed.username or "shelfy",
        "password": parsed.password or "",
        "dbname": (parsed.path or "/shelfy").lstrip("/"),
    }


# ── Backup task ────────────────────────────────────────────────────────────────

@celery_app.task(name="backup.pg_dump", bind=True, max_retries=2)
def run_pg_backup(self) -> dict[str, object]:
    """Run pg_dump, gzip the output, and upload to MinIO.

    Retries up to 2 times on transient failures.
    Returns a dict with status, key, and compressed size.
    """
    import structlog
    log = structlog.get_logger()

    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        log.error("backup_no_database_url")
        return {"status": "error", "reason": "DATABASE_URL not set"}

    params = _parse_db_url(database_url)
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
    key = f"daily/{params['dbname']}-{ts}.sql.gz"

    env = os.environ.copy()
    env["PGPASSWORD"] = params["password"]

    cmd = [
        "pg_dump",
        "-h", params["host"],
        "-p", params["port"],
        "-U", params["user"],
        "-F", "p",        # plain SQL — human-readable, portable
        "--no-owner",
        "--no-acl",
        params["dbname"],
    ]

    tmp_path: str | None = None
    try:
        proc = subprocess.run(cmd, env=env, capture_output=True, check=True)
        compressed = gzip.compress(proc.stdout)

        fd, tmp_path = tempfile.mkstemp(suffix=".sql.gz")
        with os.fdopen(fd, "wb") as fh:
            fh.write(compressed)

        client = _s3_client()
        _ensure_bucket(client)
        client.upload_file(tmp_path, _BACKUP_BUCKET, key)

        _prune_old_backups(client, params["dbname"])

        log.info("backup_completed", key=key, size_bytes=len(compressed))
        return {"status": "ok", "key": key, "size": len(compressed)}

    except subprocess.CalledProcessError as exc:
        log.error("backup_pg_dump_failed", stderr=exc.stderr.decode(errors="replace"))
        raise self.retry(exc=exc)
    except Exception as exc:
        log.error("backup_upload_failed", error=str(exc))
        raise self.retry(exc=exc)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


# ── stripe_events retention cleanup ───────────────────────────────────────────

@celery_app.task(name="cleanup.stripe_events")
def cleanup_stripe_events() -> dict[str, object]:
    """Delete stripe_events rows older than STRIPE_EVENTS_KEEP_DAYS (default 90).

    Stripe webhook idempotency only needs to cover Stripe's retry window
    (~72 hours). We keep 90 days for audit purposes, then prune.
    Runs weekly — the table is small so a full-table DELETE WHERE is fine.
    """
    import structlog
    log = structlog.get_logger()

    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        log.error("cleanup_no_database_url")
        return {"status": "error", "reason": "DATABASE_URL not set"}

    params = _parse_db_url(database_url)
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=_STRIPE_EVENTS_KEEP_DAYS)

    import psycopg2  # type: ignore[import-not-found]
    conn = psycopg2.connect(
        host=params["host"],
        port=params["port"],
        user=params["user"],
        password=params["password"],
        dbname=params["dbname"],
    )
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM stripe_events WHERE processed_at < %s",
                (cutoff,),
            )
            deleted = cur.rowcount
        conn.commit()
        log.info("stripe_events_cleanup", deleted=deleted, cutoff=cutoff.isoformat())
        return {"status": "ok", "deleted": deleted}
    finally:
        conn.close()


# ── Restore verification drill ─────────────────────────────────────────────────

@celery_app.task(name="backup.verify_restore")
def verify_restore() -> dict[str, object]:
    """Download the most recent backup and restore it to a temporary database.

    Procedure:
      1. List MinIO backup objects, pick the newest one.
      2. Download + decompress to a temp file.
      3. Create a temporary Postgres database (shelfy_restore_drill_<ts>).
      4. Restore using psql.
      5. Verify non-zero row counts in users, libraries, and books tables.
         A missing table (e.g. a fresh DB with no books yet) counts as 0,
         which is still a valid restore — we check the table *exists*, not
         that it is non-empty beyond users.
      6. Drop the temp database.

    Logs success/failure with Structlog. Does NOT raise on failure so beat
    keeps running — instead returns {"status": "error", "reason": ...}.
    """
    import structlog
    log = structlog.get_logger()

    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        log.error("restore_drill_no_database_url")
        return {"status": "error", "reason": "DATABASE_URL not set"}

    params = _parse_db_url(database_url)
    client = _s3_client()

    # 1. Find newest backup object
    try:
        paginator = client.get_paginator("list_objects_v2")
        objects = []
        for page in paginator.paginate(Bucket=_BACKUP_BUCKET, Prefix=f"daily/{params['dbname']}-"):
            objects.extend(page.get("Contents", []))
        if not objects:
            log.warning("restore_drill_no_backups_found")
            return {"status": "skip", "reason": "no backups found"}
        newest = max(objects, key=lambda o: o["LastModified"])
        key = newest["Key"]
    except ClientError as exc:
        log.error("restore_drill_list_failed", error=str(exc))
        return {"status": "error", "reason": str(exc)}

    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S")
    drill_db = f"shelfy_restore_drill_{ts}"
    tmp_path = None

    env = os.environ.copy()
    env["PGPASSWORD"] = params["password"]
    psql_base = ["psql", "-h", params["host"], "-p", params["port"], "-U", params["user"]]

    try:
        # 2. Download + decompress
        fd, tmp_path = tempfile.mkstemp(suffix=".sql")
        os.close(fd)
        with tempfile.NamedTemporaryFile(suffix=".sql.gz", delete=False) as gz_file:
            gz_path = gz_file.name
        try:
            client.download_file(_BACKUP_BUCKET, key, gz_path)
            with gzip.open(gz_path, "rb") as gz_in, open(tmp_path, "wb") as sql_out:
                sql_out.write(gz_in.read())
        finally:
            if os.path.exists(gz_path):
                os.unlink(gz_path)

        # 3. Create temp database
        subprocess.run(
            psql_base + ["-d", "postgres", "-c", f"CREATE DATABASE {drill_db}"],
            env=env, check=True, capture_output=True,
        )

        # 4. Restore
        subprocess.run(
            psql_base + ["-d", drill_db, "-f", tmp_path],
            env=env, check=True, capture_output=True,
        )

        # 5. Verify row counts across core tables.
        #    users must have ≥ 1 row (a completely empty DB means the restore
        #    silently failed or the source DB was wiped).
        #    libraries and books may legitimately be 0 on a fresh instance, but
        #    we confirm the tables exist by querying them without an error.
        import psycopg2  # type: ignore[import-not-found]
        conn = psycopg2.connect(
            host=params["host"], port=params["port"],
            user=params["user"], password=params["password"],
            dbname=drill_db,
        )
        counts: dict[str, int] = {}
        try:
            with conn.cursor() as cur:
                for table in ("users", "libraries", "books"):
                    cur.execute(f"SELECT COUNT(*) FROM {table}")  # noqa: S608
                    counts[table] = cur.fetchone()[0]
        finally:
            conn.close()

        if counts["users"] == 0:
            log.error("restore_drill_empty_users", backup_key=key, counts=counts)
            return {"status": "error", "reason": "users table is empty after restore", "counts": counts}

        log.info("restore_drill_success", backup_key=key, counts=counts)
        return {"status": "ok", "backup_key": key, "counts": counts}

    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode(errors="replace") if exc.stderr else ""
        log.error("restore_drill_failed", backup_key=key, stderr=stderr[:500])
        return {"status": "error", "reason": stderr[:200]}
    except Exception as exc:
        log.error("restore_drill_failed", backup_key=key, error=str(exc))
        return {"status": "error", "reason": str(exc)}
    finally:
        # 6. Always drop the temp database, even on failure
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
        try:
            subprocess.run(
                psql_base + ["-d", "postgres", "-c", f"DROP DATABASE IF EXISTS {drill_db}"],
                env=env, capture_output=True,
            )
        except Exception:
            pass  # Best-effort cleanup


# ── Beat schedule ──────────────────────────────────────────────────────────────

celery_app.conf.beat_schedule = {
    "daily-pg-backup": {
        "task": "backup.pg_dump",
        "schedule": crontab(hour=2, minute=0),     # 02:00 UTC every day
    },
    "weekly-restore-drill": {
        "task": "backup.verify_restore",
        "schedule": crontab(hour=3, minute=0, day_of_week=1),  # Mon 03:00 UTC
    },
    "weekly-stripe-events-cleanup": {
        "task": "cleanup.stripe_events",
        "schedule": crontab(hour=4, minute=0, day_of_week=1),  # Mon 04:00 UTC
    },
}
celery_app.conf.timezone = "UTC"
