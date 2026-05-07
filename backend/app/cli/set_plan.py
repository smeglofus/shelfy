"""Admin CLI: manually set a user's subscription plan.

Usage:
    python -m app.cli.set_plan --email user@example.com --plan pro
    python -m app.cli.set_plan --email user@example.com --plan free
    python -m app.cli.set_plan --email user@example.com --plan home
    python -m app.cli.set_plan --email user@example.com --plan library

Optional flags:
    --note "Beta tester"   Human-readable reason stored in the note field
    --dry-run              Print what would happen without writing to DB
"""
from __future__ import annotations

import argparse
import asyncio
import sys

import structlog
from sqlalchemy import select

from app.core.logging import configure_structlog
from app.db.session import SessionLocal
from app.models.subscription import SubscriptionPlan, SubscriptionStatus
from app.models.user import User
from app.services.entitlements import get_or_create_subscription

configure_structlog(service="backend")
logger = structlog.get_logger()

VALID_PLANS = [p.value for p in SubscriptionPlan]


async def set_plan(email: str, plan: str, note: str, dry_run: bool) -> None:
    async with SessionLocal() as session:
        result = await session.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user is None:
            logger.error("set_plan_user_not_found", email=email)
            print(f"ERROR: No user found with email '{email}'", file=sys.stderr)
            raise SystemExit(1)

        sub = await get_or_create_subscription(session, user.id)
        old_plan = sub.plan
        old_status = sub.status

        if dry_run:
            print(
                f"DRY RUN — would change {email}: "
                f"plan {old_plan!r} → {plan!r}, status {old_status!r} → 'active'"
                + (f"  (note: {note})" if note else "")
            )
            return

        sub.plan = SubscriptionPlan(plan)
        sub.status = SubscriptionStatus.active
        await session.commit()

    logger.info(
        "set_plan_success",
        email=email,
        old_plan=old_plan,
        new_plan=plan,
        note=note or None,
    )
    print(f"OK — {email}: plan {old_plan!r} → {plan!r}, status set to 'active'")


def main() -> None:
    parser = argparse.ArgumentParser(description="Manually set a user's subscription plan.")
    parser.add_argument("--email", required=True, help="User email address")
    parser.add_argument("--plan", required=True, choices=VALID_PLANS, help="Target plan")
    parser.add_argument("--note", default="", help="Optional reason (not stored unless model supports it)")
    parser.add_argument("--dry-run", action="store_true", help="Preview change without writing")
    args = parser.parse_args()

    asyncio.run(set_plan(args.email, args.plan, args.note, args.dry_run))


if __name__ == "__main__":
    main()
