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

    The Authorization header is the only place the API key appears; it is
    never logged (only ``to`` / ``subject`` / ``status`` make it into log
    records).  ``reply_to`` is included only when ``email_reply_to_address``
    is set so deployments without a support inbox don't claim one.
    """
    settings = get_settings()
    if not settings.resend_api_key:
        logger.debug("email.skipped (no RESEND_API_KEY)", extra={"to": to, "subject": subject})
        return

    payload: dict[str, object] = {
        "from": settings.email_from_address,
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if settings.email_reply_to_address:
        payload["reply_to"] = settings.email_reply_to_address

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
                json=payload,
            )
            response.raise_for_status()
            logger.info("email.sent", extra={"to": to, "subject": subject, "status": response.status_code})
    except Exception as exc:  # noqa: BLE001
        logger.warning("email.failed", extra={"to": to, "subject": subject, "error": str(exc)})


# ── Email templates ────────────────────────────────────────────────────────────

_SUPPORTED_LOCALES = {"cs", "en"}


def normalize_locale(locale: str | None) -> str:
    """Return a supported email locale, defaulting to English.

    The frontend currently stores the UI language in a browser cookie rather
    than on the user row. Email callers can pass that value directly; unknown
    values intentionally fall back to English.
    """
    if not locale:
        return "en"
    normalized = locale.lower().split("-", maxsplit=1)[0]
    return normalized if normalized in _SUPPORTED_LOCALES else "en"


def _base(content: str, *, locale: str | None = None) -> str:
    """Minimal responsive wrapper so emails render well in any client."""
    lang = normalize_locale(locale)
    footer = {
        "cs": "Shelfy · Tento e-mail dostáváš, protože máš účet na shelfy.cz",
        "en": "Shelfy · You're receiving this because you have an account at shelfy.cz",
    }[lang]
    return f"""<!DOCTYPE html>
<html lang="{lang}">
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
              {footer}
            </p>
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _cta(url: str, label: str) -> str:
    return f"""<a href="{url}"
     style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;
            text-decoration:none;display:inline-block;margin-top:8px">
    {label}
  </a>"""


async def send_welcome(to: str, name: str, *, locale: str | None = None) -> None:
    """Welcome email sent immediately after registration."""
    settings = get_settings()
    lang = normalize_locale(locale)
    if lang == "cs":
        html = _base(f"""
<p>Ahoj {name},</p>
<p>Vítej v <strong>Shelfy</strong> — tvém osobním správci knihovny! 🎉</p>
<p>Hned můžeš:</p>
<ul>
  <li>📷 naskenovat knihovnu pomocí AI skenu police,</li>
  <li>🔍 doplnit obálky a metadata z Google Books,</li>
  <li>📍 organizovat knihy podle umístění a stavu čtení.</li>
</ul>
<p>{_cta(f"{settings.app_url}/books", "Otevřít Shelfy →")}</p>
<p style="color:#555">Příjemné čtení,<br>tým Shelfy</p>
""", locale=lang)
        subject = "Vítej v Shelfy 📚"
    else:
        html = _base(f"""
<p>Hey {name},</p>
<p>Welcome to <strong>Shelfy</strong> — your personal book library manager! 🎉</p>
<p>Here's what you can do right away:</p>
<ul>
  <li>📷 Scan your bookshelf with the AI shelf-scanning feature</li>
  <li>🔍 Auto-enrich books with cover images &amp; metadata from Google Books</li>
  <li>📍 Organise books by location and reading status</li>
</ul>
<p>{_cta(f"{settings.app_url}/books", "Open Shelfy →")}</p>
<p style="color:#555">Happy reading,<br>The Shelfy team</p>
""", locale=lang)
        subject = "Welcome to Shelfy 📚"
    await _send(to=to, subject=subject, html=html)


async def send_trial_ending(to: str, name: str, days_left: int, *, locale: str | None = None) -> None:
    """Sent on trial day 10 (4 days left) and day 13 (1 day left)."""
    settings = get_settings()
    lang = normalize_locale(locale)
    if lang == "cs":
        urgency = "zkušební období končí zítra" if days_left == 1 else f"zkušební období končí za {days_left} dny"
        html = _base(f"""
<p>Ahoj {name},</p>
<p>Jen připomínka — <strong>{urgency}</strong>.</p>
<p>Pokud chceš dál používat neomezené obohacování, skeny polic a sdílené knihovny,
   přejdi na placený tarif před koncem trialu.</p>
<p>{_cta(f"{settings.app_url}/settings#billing", "Upgradovat →")}</p>
<p style="color:#555">Díky, že zkoušíš Shelfy,<br>tým Shelfy</p>
""", locale=lang)
        subject = "Zkušební období Shelfy končí zítra ⏰" if days_left == 1 else f"Zkušební období Shelfy končí za {days_left} dny"
    else:
        urgency = "your trial ends tomorrow" if days_left == 1 else f"your trial ends in {days_left} days"
        html = _base(f"""
<p>Hey {name},</p>
<p>Just a heads-up — <strong>{urgency}</strong>.</p>
<p>To keep enjoying unlimited enrichments, shelf scans, and shared libraries,
   upgrade to a paid plan before your trial expires.</p>
<p>{_cta(f"{settings.app_url}/settings#billing", "Upgrade now →")}</p>
<p style="color:#555">Thanks for trying Shelfy,<br>The Shelfy team</p>
""", locale=lang)
        subject = "Your Shelfy trial ends tomorrow ⏰" if days_left == 1 else f"Your Shelfy trial ends in {days_left} days"
    await _send(to=to, subject=subject, html=html)


async def send_limit_approaching(
    to: str,
    name: str,
    metric: str,
    used: int,
    limit: int,
    *,
    locale: str | None = None,
) -> None:
    """Sent when a user reaches ≥ 80 % of a monthly quota."""
    settings = get_settings()
    lang = normalize_locale(locale)
    pct = int(used / limit * 100)
    metric_label = metric.replace("_", " ")
    if lang == "cs":
        html = _base(f"""
<p>Ahoj {name},</p>
<p>Tento měsíc jsi využil/a <strong>{used} z {limit} ({metric_label})</strong> ({pct} %).</p>
<p>Po dosažení limitu půjde funkce znovu použít až v dalším fakturačním období —
   pokud nepřejdeš na vyšší tarif.</p>
<p>{_cta(f"{settings.app_url}/settings#billing", "Zobrazit tarify →")}</p>
<p style="color:#555">Tým Shelfy</p>
""", locale=lang)
        subject = f"Jsi na {pct} % limitu: {metric_label}"
    else:
        html = _base(f"""
<p>Hey {name},</p>
<p>You've used <strong>{used} of {limit} {metric_label}</strong> ({pct} %) this month.</p>
<p>When you hit the limit you won't be able to use this feature until the next billing period
   — unless you upgrade.</p>
<p>{_cta(f"{settings.app_url}/settings#billing", "View plans →")}</p>
<p style="color:#555">The Shelfy team</p>
""", locale=lang)
        subject = f"You're at {pct}% of your {metric_label} quota"
    await _send(to=to, subject=subject, html=html)


async def send_password_reset(to: str, reset_url: str, *, locale: str | None = None) -> None:
    """Sent when a user requests a password reset."""
    lang = normalize_locale(locale)
    if lang == "cs":
        html = _base(f"""
<p>Ahoj,</p>
<p>Dostali jsme žádost o reset hesla k tvému účtu Shelfy.</p>
<p>{_cta(reset_url, "Resetovat heslo →")}</p>
<p>Odkaz platí 60 minut a lze ho použít pouze jednou.
   Pokud jsi o reset nežádal/a, můžeš tento e-mail bezpečně ignorovat —
   heslo se nezměnilo.</p>
<p style="color:#555">Tým Shelfy</p>
""", locale=lang)
        subject = "Reset hesla do Shelfy"
    else:
        html = _base(f"""
<p>Hey,</p>
<p>We received a request to reset the password for your Shelfy account.</p>
<p>{_cta(reset_url, "Reset my password →")}</p>
<p>This link is valid for 60 minutes and can be used only once.
   If you did not request a reset, you can safely ignore this email —
   your password has not been changed.</p>
<p style="color:#555">The Shelfy team</p>
""", locale=lang)
        subject = "Reset your Shelfy password"
    await _send(to=to, subject=subject, html=html)
