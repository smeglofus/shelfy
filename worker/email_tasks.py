"""Scheduled email notification tasks.

Tasks registered with Celery beat via celery_beat.py:

  email.trial_reminders     08:00 UTC daily  — trial ending day-10 and day-13 reminders
  email.limit_approaching   09:00 UTC daily  — notify users at ≥ 80 % of monthly quota

Both tasks use psycopg2 (synchronous, available in the worker image) to query
the DB directly and httpx (sync) to call the Resend API, avoiding the need to
bootstrap the full FastAPI/SQLAlchemy async stack inside Celery.

Redis dedup keys prevent the same email being sent twice in the same day:
  email:{task}:{user_id}:{date}   →  EX 86400 s
"""
from __future__ import annotations

import datetime
import logging
import os

import httpx
import psycopg2
import psycopg2.extras
import redis as redis_lib
from celery.schedules import crontab

from celery_app import celery_app

log = logging.getLogger(__name__)

# ── Config ─────────────────────────────────────────────────────────────────────

_DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://shelfy:shelfy@postgres:5432/shelfy",
).replace("postgresql+asyncpg://", "postgresql://").replace("+asyncpg", "")

_REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
_RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
_EMAIL_FROM = os.environ.get("EMAIL_FROM_ADDRESS", "Shelfy <noreply@shelfy.app>")
_APP_URL = os.environ.get("APP_URL", "https://shelfy.app")

_LIMIT_THRESHOLD = 0.80   # notify when ≥ 80 % used
_RESEND_URL = "https://api.resend.com/emails"


# ── Helpers ────────────────────────────────────────────────────────────────────

def _db_conn():
    return psycopg2.connect(_DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


def _redis_conn():
    return redis_lib.from_url(_REDIS_URL, decode_responses=True)


def _dedup_key(task: str, user_id: str, suffix: str = "") -> str:
    today = datetime.date.today().isoformat()
    return f"email:{task}:{user_id}:{today}{(':' + suffix) if suffix else ''}"


def _already_sent(r, key: str) -> bool:
    return r.exists(key) == 1


def _mark_sent(r, key: str) -> None:
    r.setex(key, 86400, "1")


def _send_email(to: str, subject: str, html: str) -> bool:
    """POST to Resend API. Returns True on success, False otherwise."""
    if not _RESEND_API_KEY:
        log.debug("email.skipped_no_api_key", extra={"to": to})
        return False
    try:
        resp = httpx.post(
            _RESEND_URL,
            headers={
                "Authorization": f"Bearer {_RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={"from": _EMAIL_FROM, "to": [to], "subject": subject, "html": html},
            timeout=15,
        )
        resp.raise_for_status()
        return True
    except Exception as exc:  # noqa: BLE001
        log.warning("email.send_failed", extra={"to": to, "error": str(exc)})
        return False


# ── Email templates (minimal inline HTML) ─────────────────────────────────────

def _wrap(content: str) -> str:
    return f"""<!DOCTYPE html><html><body style="font-family:sans-serif;padding:32px">
<h2>📚 Shelfy</h2>{content}
<hr style="margin:32px 0"><p style="color:#888;font-size:12px">
You're receiving this because you have a Shelfy account.</p></body></html>"""


def _trial_html(name: str, days_left: int) -> str:
    urgency = "your trial ends <strong>tomorrow</strong>" if days_left == 1 else f"your trial ends in <strong>{days_left} days</strong>"
    return _wrap(f"""
<p>Hey {name},</p>
<p>Just a heads-up — {urgency}.</p>
<p>Upgrade before then to keep unlimited enrichments, shelf scans, and shared libraries.</p>
<p><a href="{_APP_URL}/settings#billing"
      style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;
             text-decoration:none">Upgrade now →</a></p>
<p>Thanks,<br>The Shelfy team</p>""")


def _limit_html(name: str, metric: str, used: int, limit: int) -> str:
    pct = int(used / limit * 100)
    label = metric.replace("_", " ")
    return _wrap(f"""
<p>Hey {name},</p>
<p>You've used <strong>{used} of {limit} {label}</strong> ({pct} %) this month.</p>
<p>When you hit the limit, this feature pauses until the next billing period — unless you upgrade.</p>
<p><a href="{_APP_URL}/settings#billing"
      style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;
             text-decoration:none">View plans →</a></p>
<p>The Shelfy team</p>""")


# ── Tasks ──────────────────────────────────────────────────────────────────────

@celery_app.task(name="email.trial_reminders", bind=True, max_retries=2)
def check_trial_reminders(self) -> dict:
    """Send day-10 and day-13 trial ending reminders.

    Queries for users whose trial ends in exactly 4 days (day 10 of 14)
    or 1 day (day 13 of 14) and sends a single nudge each time.
    """
    today = datetime.date.today()
    sent = 0

    try:
        conn = _db_conn()
        r = _redis_conn()
        cur = conn.cursor()

        # Find users in trial whose trial_ends_at is 4 days away (day 10) or 1 day away (day 13)
        cur.execute("""
            SELECT u.id::text, u.email,
                   (s.trial_ends_at::date - CURRENT_DATE) AS days_left
            FROM subscriptions s
            JOIN users u ON u.id = s.user_id
            WHERE s.status = 'trialing'
              AND s.trial_ends_at IS NOT NULL
              AND (s.trial_ends_at::date - CURRENT_DATE) IN (4, 1)
        """)
        rows = cur.fetchall()

        for row in rows:
            user_id = row["id"]
            email = row["email"]
            days_left = row["days_left"]
            name = email.split("@")[0]

            key = _dedup_key("trial", user_id, str(days_left))
            if _already_sent(r, key):
                continue

            subject = (
                "Your Shelfy trial ends tomorrow ⏰"
                if days_left == 1
                else f"Your Shelfy trial ends in {days_left} days"
            )
            html = _trial_html(name, days_left)

            if _send_email(email, subject, html):
                _mark_sent(r, key)
                sent += 1
                log.info("email.trial_reminder_sent",
                         extra={"user_id": user_id, "days_left": days_left})

        cur.close()
        conn.close()

    except Exception as exc:  # noqa: BLE001
        log.error("email.trial_reminders_failed", extra={"error": str(exc)})
        raise self.retry(exc=exc, countdown=300)

    return {"sent": sent, "date": today.isoformat()}


@celery_app.task(name="email.limit_approaching", bind=True, max_retries=2)
def check_limit_approaching(self) -> dict:
    """Notify free-plan users who have reached ≥ 80 % of a monthly quota.

    Only free-plan users with active status are queried — paid plans have much
    higher or unlimited quotas so upgrade prompts would be irrelevant.
    Sends at most once per metric per day (Redis dedup key).
    """
    today = datetime.date.today()
    period_start = today.replace(day=1)
    sent = 0

    # Plan limits for free tier — kept in sync with app/core/plan_limits.py
    FREE_LIMITS: dict[str, int] = {
        "enrichments": 20,
        "scans": 5,
    }

    try:
        conn = _db_conn()
        r = _redis_conn()
        cur = conn.cursor()

        for metric, limit in FREE_LIMITS.items():
            threshold = int(limit * _LIMIT_THRESHOLD)
            cur.execute("""
                SELECT u.id::text, u.email, uc.count AS used
                FROM usage_counters uc
                JOIN subscriptions s ON s.user_id = uc.user_id
                JOIN users u ON u.id = uc.user_id
                WHERE uc.metric = %s
                  AND uc.period_start = %s
                  AND uc.count >= %s
                  AND uc.count < %s          -- don't re-notify after hard limit hit
                  AND s.plan = 'free'
                  AND s.status = 'active'
            """, (metric, period_start, threshold, limit))
            rows = cur.fetchall()

            for row in rows:
                user_id = row["id"]
                email = row["email"]
                used = row["used"]
                name = email.split("@")[0]

                key = _dedup_key("limit", user_id, metric)
                if _already_sent(r, key):
                    continue

                subject = f"You're at {int(used / limit * 100)}% of your {metric.replace('_', ' ')} quota"
                html = _limit_html(name, metric, used, limit)

                if _send_email(email, subject, html):
                    _mark_sent(r, key)
                    sent += 1
                    log.info("email.limit_approaching_sent",
                             extra={"user_id": user_id, "metric": metric, "used": used})

        cur.close()
        conn.close()

    except Exception as exc:  # noqa: BLE001
        log.error("email.limit_approaching_failed", extra={"error": str(exc)})
        raise self.retry(exc=exc, countdown=300)

    return {"sent": sent, "date": today.isoformat()}


# ── Beat schedule ──────────────────────────────────────────────────────────────

celery_app.conf.beat_schedule.update({
    "email.trial_reminders": {
        "task": "email.trial_reminders",
        "schedule": crontab(hour=8, minute=0),      # 08:00 UTC daily
    },
    "email.limit_approaching": {
        "task": "email.limit_approaching",
        "schedule": crontab(hour=9, minute=0),      # 09:00 UTC daily
    },
})
