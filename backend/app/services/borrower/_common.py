"""Shared internals for the ``app.services.borrower`` submodule.

Holds dataclasses + normalize helpers that more than one operation
module needs. Kept private (underscore prefix) so the public API stays
discoverable through the package ``__init__``.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date

from app.models.borrower import Borrower


# Sentinel name written to anonymized borrower rows AND to the denormalized
# ``loan.borrower_name`` column for any loan attached to that borrower. Frontend
# detects ``anonymized_at`` to render a localized label; the DB string is
# whatever is robust and never empty.
ANONYMIZED_BORROWER_NAME = "Deleted borrower"


@dataclass(frozen=True)
class BorrowerWithStats:
    borrower: Borrower
    active_loans: int
    total_loans: int
    last_activity_at: date | None


@dataclass(frozen=True)
class BorrowerStatsPage:
    items: list[BorrowerWithStats]
    total: int
    page: int
    page_size: int


@dataclass(frozen=True)
class BorrowerLoanRow:
    id: uuid.UUID
    book_id: uuid.UUID
    book_title: str
    book_author: str | None
    lent_date: date
    due_date: date | None
    returned_date: date | None
    return_condition: str | None
    notes: str | None


def _normalize_name(value: str | None) -> str:
    if value is None:
        return ""
    return " ".join(value.split())


def _normalize_contact(value: str | None) -> str | None:
    if value is None:
        return None
    collapsed = " ".join(value.split())
    return collapsed or None
