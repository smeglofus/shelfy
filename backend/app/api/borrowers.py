import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.api.dependencies.library import get_library_id, require_editor_library
from app.db.session import get_db_session
from app.models.user import User
from app.schemas.borrower import (
    BorrowerBulkAnonymizeRequest,
    BorrowerBulkAnonymizeResponse,
    BorrowerCreate,
    BorrowerDetailResponse,
    BorrowerListItem,
    BorrowerListResponse,
    BorrowerLoanItem,
    BorrowerMergeRequest,
    BorrowerResponse,
    BorrowerRetentionAnonymizeRequest,
    BorrowerUpdate,
)
from app.services.borrower import (
    anonymize_borrower,
    bulk_anonymize_borrowers,
    bulk_anonymize_borrowers_by_inactivity,
    create_borrower,
    get_borrower_detail_or_404,
    list_borrowers_with_stats,
    list_loans_for_borrower,
    merge_borrowers,
    restore_borrower,
    update_borrower,
)

router = APIRouter(prefix="/api/v1/borrowers", tags=["borrowers"])


@router.get("", response_model=BorrowerListResponse)
async def read_borrowers(
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(get_library_id),
    search: str | None = Query(default=None, min_length=1),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> BorrowerListResponse:
    page_data = await list_borrowers_with_stats(
        session, library_id, search=search, page=page, page_size=page_size
    )
    items = [
        BorrowerListItem(
            **BorrowerResponse.model_validate(row.borrower).model_dump(),
            active_loans=row.active_loans,
            total_loans=row.total_loans,
            last_activity_at=row.last_activity_at,
        )
        for row in page_data.items
    ]
    return BorrowerListResponse(
        total=page_data.total,
        page=page_data.page,
        page_size=page_data.page_size,
        items=items,
    )


@router.post("", response_model=BorrowerResponse, status_code=status.HTTP_201_CREATED)
async def create_borrower_endpoint(
    payload: BorrowerCreate,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
    current_user: User = Depends(get_current_user),
) -> BorrowerResponse:
    borrower = await create_borrower(
        session, payload, library_id, actor_user_id=current_user.id
    )
    return BorrowerResponse.model_validate(borrower)


@router.get("/{borrower_id}", response_model=BorrowerDetailResponse)
async def read_borrower(
    borrower_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(get_library_id),
) -> BorrowerDetailResponse:
    # Detail endpoint enriches the base response with resolved audit-actor
    # emails (#261). The three LEFT JOINs live in
    # ``get_borrower_detail_or_404`` and are deliberately *not* in the cheap
    # list endpoint.
    borrower = await get_borrower_detail_or_404(session, borrower_id, library_id)
    return BorrowerDetailResponse(
        **BorrowerResponse.model_validate(borrower).model_dump(),
        created_by_email=borrower.created_by.email if borrower.created_by else None,
        anonymized_by_email=(
            borrower.anonymized_by.email if borrower.anonymized_by else None
        ),
        merged_into_by_email=(
            borrower.merged_into_by.email if borrower.merged_into_by else None
        ),
    )


@router.patch("/{borrower_id}", response_model=BorrowerResponse)
async def update_borrower_endpoint(
    borrower_id: uuid.UUID,
    payload: BorrowerUpdate,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
) -> BorrowerResponse:
    borrower = await update_borrower(session, borrower_id, payload, library_id)
    return BorrowerResponse.model_validate(borrower)


@router.get("/{borrower_id}/loans", response_model=list[BorrowerLoanItem])
async def read_borrower_loans(
    borrower_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(get_library_id),
) -> list[BorrowerLoanItem]:
    rows = await list_loans_for_borrower(session, borrower_id, library_id)
    return [BorrowerLoanItem.model_validate(row) for row in rows]


@router.post("/bulk/anonymize", response_model=BorrowerBulkAnonymizeResponse)
async def bulk_anonymize_borrowers_endpoint(
    payload: BorrowerBulkAnonymizeRequest,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
    current_user: User = Depends(get_current_user),
    immediate: bool = Query(
        default=False,
        description=(
            "DSAR / privacy bypass. When true, skips the 30-day pending "
            "window and wipes PII synchronously (#244)."
        ),
    ),
) -> BorrowerBulkAnonymizeResponse:
    affected = await bulk_anonymize_borrowers(
        session,
        payload.ids,
        library_id,
        actor_user_id=current_user.id,
        immediate=immediate,
    )
    return BorrowerBulkAnonymizeResponse(affected=affected)


@router.post(
    "/bulk-anonymize-by-date", response_model=BorrowerBulkAnonymizeResponse
)
async def bulk_anonymize_by_date_endpoint(
    payload: BorrowerRetentionAnonymizeRequest,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
    current_user: User = Depends(get_current_user),
    immediate: bool = Query(
        default=False,
        description=(
            "When true, skips the 30-day pending window and wipes PII "
            "synchronously for every eligible borrower (#244)."
        ),
    ),
) -> BorrowerBulkAnonymizeResponse:
    """Retention-driven bulk anonymize (#246). Anonymizes every borrower
    in the active library whose most recent lending activity is before
    ``inactive_since`` AND who has no active loan. Send ``dry_run=true``
    to see the affected count without mutating any row.
    """
    affected = await bulk_anonymize_borrowers_by_inactivity(
        session,
        library_id,
        payload.inactive_since,
        dry_run=payload.dry_run,
        actor_user_id=current_user.id,
        immediate=immediate,
    )
    return BorrowerBulkAnonymizeResponse(affected=affected)


@router.post("/{borrower_id}/anonymize", response_model=BorrowerResponse)
async def anonymize_borrower_endpoint(
    borrower_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
    current_user: User = Depends(get_current_user),
    immediate: bool = Query(
        default=False,
        description=(
            "DSAR / privacy bypass. When true, skips the 30-day pending "
            "window and wipes PII synchronously. Default behaviour (#244) "
            "schedules anonymization and leaves PII intact for the window — "
            "use POST /restore to cancel during it."
        ),
    ),
) -> BorrowerResponse:
    borrower = await anonymize_borrower(
        session,
        borrower_id,
        library_id,
        actor_user_id=current_user.id,
        immediate=immediate,
    )
    return BorrowerResponse.model_validate(borrower)


@router.post("/{borrower_id}/restore", response_model=BorrowerResponse)
async def restore_borrower_endpoint(
    borrower_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
) -> BorrowerResponse:
    """Cancel a pending anonymization (#244). Returns 422 if the borrower
    is already finalized (PII gone) or never scheduled."""
    borrower = await restore_borrower(session, borrower_id, library_id)
    return BorrowerResponse.model_validate(borrower)


@router.post("/{target_id}/merge", response_model=BorrowerResponse)
async def merge_borrower_endpoint(
    target_id: uuid.UUID,
    payload: BorrowerMergeRequest,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
    current_user: User = Depends(get_current_user),
) -> BorrowerResponse:
    target = await merge_borrowers(
        session, payload.source_id, target_id, library_id, actor_user_id=current_user.id
    )
    return BorrowerResponse.model_validate(target)
