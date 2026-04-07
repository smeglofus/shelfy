"""Transactional email service via Resend.

All functions are fire-and-forget async helpers.  They silently no-op when
RESEND_API_KEY is not configured, so the app works perfectly in development
without any email credentials.

Usage:
    from app.services import email as email_svc
    await email_svc.send_welcome(user.email, user.email.split("@")[0])

Email catalogue
---------------
welcome                — sent once on registration
trial_ending_day10     — 4 days left on trial  (sent by beat task)
trial_ending_day13     — 1 day left on trial   (sent by beat task)
limit_approaching      — user at ≥ 80 % of a monthly quota (beat task)
"""
from __future__ import annotations

import logging

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_RESEND_SEND_URL = "https://api.resend.com/emails"


async def _send(*, to: str, subject: str, html: str) -> None:
    """Low-level async POST to the Resend /emails endpoint.

    No-ops silently when RESEND_API_KEY is absent.
    Network / API errors are logged but never re-raised so that email failures
    never crash the main request path.
    """
    settings = get_settings()
    if not settings.resend_api_key:
        logger.debug("email.skipped (no RESEND_API_KEY)", extra={"to": to, "subject": subject})
        return

    # Retry up to 3 times on network-level errors (connection reset, DNS failure, etc.).
    # 5xx responses are not automatically retried here — Resend's own delivery retries
    # handle transient server-side issues.
    transport = httpx.AsyncHTTPTransport(retries=3)
    try:
        async with httpx.AsyncClient(timeout=10, transport=transport) as client:
            response = await client.post(
                _RESEND_SEND_URL,
                headers={
                    "Authorization": f"Bearer {settings.resend_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": settings.email_from_address,
                    "to": [to],
                    "subject": subject,
                    "html": html,
                },
            )
            response.raise_for_status()
            logger.info("email.sent", extra={"to": to, "subject": subject, "status": response.status_code})
    except Exception as exc:  # noqa: BLE001
        logger.warning("email.failed", extra={"to": to, "subject": subject, "error": str(exc)})


# ── Email templates ────────────────────────────────────────────────────────────

def _base(content: str) -> str:
    """Minimal responsive wrapper so emails render well in any client."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Shelfy</title>
</head>
<body style="font-family:sans-serif;background:#f9f9f9;margin:0;padding:32px 16px">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0"
               style="background:#fff;border-radius:8px;padding:40px;max-width:560px">
          <tr><td>
            <h2 style="color:#1a1a1a;margin-top:0">📚 Shelfy</h2>
            {content}
            <hr style="border:none;border-top:1px solid #eee;margin:32px 0">
            <p style="color:#888;font-size:12px;margin:0">
              Shelfy · You're receiving this because you have an account at shelfy.app
            </p>
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


async def send_welcome(to: str, name: str) -> None:
    """Welcome email sent immediately after registration."""
    settings = get_settings()
    html = _base(f"""
<p>Hey {name},</p>
<p>Welcome to <strong>Shelfy</strong> — your personal book library manager! 🎉</p>
<p>Here's what you can do right away:</p>
<ul>
  <li>📷 Scan your bookshelf with the AI shelf-scanning feature</li>
  <li>🔍 Auto-enrich books with cover images &amp; metadata from Google Books</li>
  <li>📍 Organise books by location and reading status</li>
</ul>
<p>
  <a href="{settings.app_url}/books"
     style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;
            text-decoration:none;display:inline-block;margin-top:8px">
    Open Shelfy →
  </a>
</p>
<p style="color:#555">Happy reading,<br>The Shelfy team</p>
""")
    await _send(to=to, subject="Welcome to Shelfy 📚", html=html)


async def send_trial_ending(to: str, name: str, days_left: int) -> None:
    """Sent on trial day 10 (4 days left) and day 13 (1 day left)."""
    settings = get_settings()
    urgency = "your trial ends tomorrow" if days_left == 1 else f"your trial ends in {days_left} days"
    html = _base(f"""
<p>Hey {name},</p>
<p>Just a heads-up — <strong>{urgency}</strong>.</p>
<p>To keep enjoying unlimited enrichments, shelf scans, and shared libraries,
   upgrade to a paid plan before your trial expires.</p>
<p>
  <a href="{settings.app_url}/settings#billing"
     style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;
            text-decoration:none;display:inline-block;margin-top:8px">
    Upgrade now →
  </a>
</p>
<p style="color:#555">Thanks for trying Shelfy,<br>The Shelfy team</p>
""")
    subject = (
        "Your Shelfy trial ends tomorrow ⏰"
        if days_left == 1
        else f"Your Shelfy trial ends in {days_left} days"
    )
    await _send(to=to, subject=subject, html=html)


async def send_limit_approaching(
    to: str,
    name: str,
    metric: str,
    used: int,
    limit: int,
) -> None:
    """Sent when a user reaches ≥ 80 % of a monthly quota."""
    settings = get_settings()
    pct = int(used / limit * 100)
    metric_label = metric.replace("_", " ")
    html = _base(f"""
<p>Hey {name},</p>
<p>You've used <strong>{used} of {limit} {metric_label}</strong> ({pct} %) this month.</p>
<p>When you hit the limit you won't be able to use this feature until the next billing period
   — unless you upgrade.</p>
<p>
  <a href="{settings.app_url}/settings#billing"
     style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;
            text-decoration:none;display:inline-block;margin-top:8px">
    View plans →
  </a>
</p>
<p style="color:#555">The Shelfy team</p>
""")
    await _send(
        to=to,
        subject=f"You're at {pct}% of your {metric_label} quota",
        html=html,
    )
