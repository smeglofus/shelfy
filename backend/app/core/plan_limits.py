"""Plan limits — single source of truth for all quota enforcement.

Any code that needs to check a limit imports from here.
Stripe product/price IDs are configured in settings (env vars).
"""
from __future__ import annotations

from app.models.subscription import SubscriptionPlan

# ── Hard limits per plan ───────────────────────────────────────────────────────

LIMITS: dict[SubscriptionPlan, dict[str, int]] = {
    SubscriptionPlan.free: {
        "scans_per_month": 5,
        "enrichments_per_month": 20,
        "libraries": 1,
        "members_per_library": 1,
    },
    SubscriptionPlan.pro: {
        "scans_per_month": 50,
        "enrichments_per_month": -1,       # -1 = unlimited
        "libraries": 3,
        "members_per_library": 3,
    },
    SubscriptionPlan.library: {
        "scans_per_month": 200,
        "enrichments_per_month": -1,       # -1 = unlimited
        "libraries": 10,
        "members_per_library": 15,
    },
}


def get_limit(plan: SubscriptionPlan, key: str) -> int:
    """Return the numeric limit for a given plan and key.

    Returns -1 for unlimited. Raises KeyError for unknown key.
    """
    return LIMITS[plan][key]


def is_unlimited(plan: SubscriptionPlan, key: str) -> bool:
    return get_limit(plan, key) == -1
