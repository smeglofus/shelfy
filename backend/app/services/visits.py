"""Anonymous, cookieless visit counting.

The frontend sends one beacon per page *kind* per page load (landing,
demo, pricing, ...) together with the traffic source it saw on entry (the
``utm_source`` query parameter, or the referrer host). Nothing identifying is
stored — no IP, no user id, no cookie, no URL — only a Prometheus counter
increment, so no consent banner is needed.

Both labels are normalised against fixed allowlists here, server-side: the
endpoint is public, so whatever a client sends must never be able to create
new Prometheus time series.
"""

from __future__ import annotations

import re
from typing import Final

from app.core.metrics import PAGE_VIEWS_TOTAL

VISIT_PAGES: Final[frozenset[str]] = frozenset(
    {
        "landing",
        "demo",
        "demo_scan",
        "pricing",
        "login",
        "signup",
        "google_auth",
    }
)

# Known sources → canonical label. Keys are matched against a normalised
# ``utm_source`` value or against the referrer host (suffix match).
_SOURCE_ALIASES: Final[dict[str, str]] = {
    "facebook": "facebook",
    "fb": "facebook",
    "facebook.com": "facebook",
    "fb.com": "facebook",
    "fb.me": "facebook",
    "messenger": "facebook",
    "messenger.com": "facebook",
    "instagram": "instagram",
    "ig": "instagram",
    "instagram.com": "instagram",
    "reddit": "reddit",
    "reddit.com": "reddit",
    "databazeknih": "databazeknih",
    "databazeknih.cz": "databazeknih",
    "google": "google",
    "google.com": "google",
    "google.cz": "google",
    "seznam": "seznam",
    "seznam.cz": "seznam",
    "bing": "bing",
    "bing.com": "bing",
    "duckduckgo": "duckduckgo",
    "duckduckgo.com": "duckduckgo",
    "x": "x",
    "twitter": "x",
    "t.co": "x",
    "linkedin": "linkedin",
    "linkedin.com": "linkedin",
    "github": "github",
    "github.com": "github",
    "email": "email",
    "newsletter": "email",
}

VISIT_SOURCES: Final[frozenset[str]] = frozenset(
    {*_SOURCE_ALIASES.values(), "direct", "other"}
)

_UNSAFE_CHARS = re.compile(r"[^a-z0-9.\-]")


def normalize_visit_page(page: str) -> str | None:
    """Return the page label, or ``None`` for anything off the allowlist."""
    candidate = page.strip().lower()
    return candidate if candidate in VISIT_PAGES else None


def normalize_visit_source(source: str | None) -> str:
    """Map a raw ``utm_source`` / referrer host onto a fixed label set."""
    if not source:
        return "direct"
    candidate = _UNSAFE_CHARS.sub("", source.strip().lower())[:100]
    if not candidate or candidate == "direct":
        return "direct"
    if candidate.startswith("www."):
        candidate = candidate[4:]
    alias = _SOURCE_ALIASES.get(candidate)
    if alias is not None:
        return alias
    # Referrer hosts such as l.facebook.com, m.facebook.com, old.reddit.com.
    for key, label in _SOURCE_ALIASES.items():
        if "." in key and candidate.endswith("." + key):
            return label
    return "other"


def preinitialize_page_view_series() -> None:
    """Create every page×source series at 0.

    Prometheus' ``increase()`` cannot see the first increment of a series that
    appears already at 1, so a brand-new source would be undercounted by one.
    The label sets are small and fixed (allowlists above), so pre-creating all
    of them is cheap.
    """
    for page in VISIT_PAGES:
        for source in VISIT_SOURCES:
            PAGE_VIEWS_TOTAL.labels(page=page, source=source)
