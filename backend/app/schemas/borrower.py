import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_NOTES_LENGTH = 2000


class BorrowerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    contact: str | None = Field(None, max_length=255)
    notes: str | None = Field(None, max_length=MAX_NOTES_LENGTH)


class BorrowerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    contact: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(None, max_length=MAX_NOTES_LENGTH)

    @model_validator(mode="after")
    def reject_explicit_nulls(self) -> "BorrowerUpdate":
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name cannot be null")
        return self


class BorrowerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    contact: str | None
    notes: str | None = Field(max_length=MAX_NOTES_LENGTH)
    anonymized_at: datetime | None
    # Pending-anonymization deadline (#244). When non-null and
    # ``anonymized_at`` is null, the row is in the "scheduled" state — PII
    # is still intact, restore is available until the worker finalizes it.
    pending_anonymization_until: datetime | None = None
    # Audit trail (#245). Null for rows created before the column was added,
    # or when the actor user was deleted (FK ondelete=SET NULL).
    created_by_user_id: uuid.UUID | None = None
    anonymized_by_user_id: uuid.UUID | None = None
    merged_into_by_user_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


class BorrowerDetailResponse(BorrowerResponse):
    """Borrower detail response with audit actors resolved to user emails (#261).

    Used only by ``GET /api/v1/borrowers/{borrower_id}`` to avoid paying the
    cost of 3 extra JOINs on the cheap list endpoint. Each field is the
    resolved email of the user pointed to by the corresponding ``*_user_id``
    column, or ``None`` when the column is NULL (legacy rows, deleted users,
    or actions performed without an authenticated user context).
    """

    created_by_email: str | None = None
    anonymized_by_email: str | None = None
    merged_into_by_email: str | None = None


class BorrowerListItem(BorrowerResponse):
    """Borrower record enriched with lending-activity stats for the overview page."""

    active_loans: int
    total_loans: int
    last_activity_at: date | None


class BorrowerMergeRequest(BaseModel):
    """Body for POST /api/v1/borrowers/{target_id}/merge."""

    source_id: uuid.UUID


class BorrowerListResponse(BaseModel):
    """Paginated wrapper around BorrowerListItem rows.

    Matches the shape used by `BookListResponse` so the frontend paginator
    component is trivially reusable.
    """

    total: int
    page: int
    page_size: int
    items: list[BorrowerListItem]


class BorrowerLoanItem(BaseModel):
    """A loan as seen from the borrower-detail page — denormalized with book info."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    book_id: uuid.UUID
    book_title: str
    book_author: str | None
    lent_date: date
    due_date: date | None
    returned_date: date | None
    return_condition: str | None
    notes: str | None = Field(max_length=MAX_NOTES_LENGTH)


class BorrowerBulkAnonymizeRequest(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def reject_duplicate_ids(self) -> "BorrowerBulkAnonymizeRequest":
        if len(set(self.ids)) != len(self.ids):
            raise ValueError("ids must be unique")
        return self


class BorrowerBulkAnonymizeResponse(BaseModel):
    affected: int


class BorrowerRetentionAnonymizeRequest(BaseModel):
    """Body for ``POST /api/v1/borrowers/bulk-anonymize-by-date`` (#246).

    Anonymizes every borrower in the active library whose most recent
    lending activity is before ``inactive_since`` AND who has no active
    loan. Pass ``dry_run=True`` to get the count without mutating.
    """

    inactive_since: date
    dry_run: bool = False
