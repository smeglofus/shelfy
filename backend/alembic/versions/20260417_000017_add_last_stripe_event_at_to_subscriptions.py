"""Add subscriptions.last_stripe_event_at for webhook out-of-order protection.

Stripe delivers webhooks at-least-once and does **not** guarantee ordering
between events — `customer.subscription.updated` for the same subscription
can arrive after a later `customer.subscription.deleted`, or two updates
can be re-delivered in reverse order (see
https://stripe.com/docs/webhooks/best-practices#event-ordering).

Without a per-subscription high-water mark, an older delivery can overwrite
newer state (e.g. downgrade an `active` Pro subscription back to a stale
`past_due` snapshot). We guard against this by tracking the Stripe
`event.created` timestamp that last mutated each local subscription; any
event with an older `event.created` is marked processed (in `stripe_events`)
but its side effect is skipped.

Nullable because existing rows predate the guard; the first fresh event per
subscription after the migration seeds the column.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260417_000017"
down_revision = "20260417_000016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "subscriptions",
        sa.Column("last_stripe_event_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("subscriptions", "last_stripe_event_at")
