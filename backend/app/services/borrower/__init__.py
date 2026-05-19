"""Borrower service surface.

This module used to be a single ~1000-line file (``services/borrower.py``)
and was split into per-concern submodules after the #244 epic landed.
All historical imports continue to work because everything is re-exported
here. Adding a new operation? Drop it in the relevant submodule —
:mod:`query`, :mod:`lifecycle`, :mod:`anonymize`, :mod:`merge` — and add
it to ``__all__`` below.
"""
from app.services.borrower._common import (
    ANONYMIZED_BORROWER_NAME,
    BorrowerLoanRow,
    BorrowerStatsPage,
    BorrowerWithStats,
    _normalize_contact,
    _normalize_name,
)
from app.services.borrower.anonymize import (
    ANONYMIZE_PENDING_TTL,
    _hard_anonymize_in_memory,
    anonymize_borrower,
    bulk_anonymize_borrowers,
    bulk_anonymize_borrowers_by_inactivity,
    finalize_due_pending_anonymizations,
    restore_borrower,
    select_borrowers_for_retention_anonymize,
)
from app.services.borrower.lifecycle import (
    create_borrower,
    link_loans_to_borrowers,
    update_borrower,
)
from app.services.borrower.merge import (
    MERGE_UNDO_TTL,
    MergeResult,
    apply_merge_undo,
    gc_expired_merge_undo_logs,
    merge_borrowers,
)
from app.services.borrower.query import (
    BorrowerStatusFilter,
    get_borrower_detail_or_404,
    get_borrower_or_404,
    list_borrowers,
    list_borrowers_with_stats,
    list_loans_for_borrower,
)

__all__ = [
    # _common
    "ANONYMIZED_BORROWER_NAME",
    "BorrowerLoanRow",
    "BorrowerStatsPage",
    "BorrowerWithStats",
    # _common (private helpers — exported because tests pin direct
    # contracts on them, e.g. ``_normalize_name(None) == ""``).
    "_normalize_contact",
    "_normalize_name",
    # query
    "BorrowerStatusFilter",
    "get_borrower_detail_or_404",
    "get_borrower_or_404",
    "list_borrowers",
    "list_borrowers_with_stats",
    "list_loans_for_borrower",
    # lifecycle
    "create_borrower",
    "link_loans_to_borrowers",
    "update_borrower",
    # anonymize
    "ANONYMIZE_PENDING_TTL",
    "_hard_anonymize_in_memory",
    "anonymize_borrower",
    "bulk_anonymize_borrowers",
    "bulk_anonymize_borrowers_by_inactivity",
    "finalize_due_pending_anonymizations",
    "restore_borrower",
    "select_borrowers_for_retention_anonymize",
    # merge
    "MERGE_UNDO_TTL",
    "MergeResult",
    "apply_merge_undo",
    "gc_expired_merge_undo_logs",
    "merge_borrowers",
]
