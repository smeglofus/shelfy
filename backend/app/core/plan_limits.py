"""Plan limits — single source of truth for all quota enforcement.

Any code that needs to check a limit imports from here.
Stripe product/price IDs are configured in settings (env vars).
"""
from __future__ import annotations

from app.models.subscription import SubscriptionPlan

# ── Hard limits per plan ───────────────────────────────────────────────────────

# Pricing model (ADR 013, 2026-11-11): only two plans are offered —
#   * free       — generous; only shelf scans (the one feature with a real
#                  per-use cost: Gemini Vision) are capped,
#   * home       — shown to users as "Podporovatel" / "Supporter" (59 Kč/month,
#                  590 Kč/year; reuses the existing Stripe "home" prices).
# ``pro`` and ``library`` are legacy plans: no longer sold, kept only so that
# existing subscribers keep working. They must never be less generous than
# the supporter plan.
#
# ``-1`` means unlimited — supported for the *_per_month metrics and
# books_per_library. ``libraries`` and ``members_per_library`` must stay
# finite (the counting checks compare against the number directly).
LIMITS: dict[SubscriptionPlan, dict[str, int]] = {
    SubscriptionPlan.free: {
        "scans_per_month": 20,
        "enrichments_per_month": -1,
        "libraries": 1,
        "members_per_library": 3,
        "books_per_library": -1,
    },
    SubscriptionPlan.home: {
        "scans_per_month": 60,
        "enrichments_per_month": -1,
        "libraries": 5,
        "members_per_library": 10,
        "books_per_library": -1,
    },
    # Legacy — not offered for new checkouts.
    SubscriptionPlan.pro: {
        "scans_per_month": 60,
        "enrichments_per_month": -1,
        "libraries": 5,
        "members_per_library": 10,
        "books_per_library": -1,
    },
    # Legacy — not offered for new checkouts.
    SubscriptionPlan.library: {
        "scans_per_month": 200,
        "enrichments_per_month": -1,
        "libraries": 10,
        "members_per_library": 30,
        "books_per_library": -1,
    },
}

# Plans that can be bought via Stripe Checkout today.
PURCHASABLE_PLANS: frozenset[SubscriptionPlan] = frozenset({SubscriptionPlan.home})


def get_limit(plan: SubscriptionPlan, key: str) -> int:
    """Return the numeric limit for a given plan and key.

    Returns -1 for unlimited. Raises KeyError for unknown key.
    """
    return LIMITS[plan][key]


def is_unlimited(plan: SubscriptionPlan, key: str) -> bool:
    return get_limit(plan, key) == -1
