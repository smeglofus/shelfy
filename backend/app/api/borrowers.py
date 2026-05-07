import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.library import get_library_id, require_editor_library
from app.db.session import get_db_session
from app.schemas.borrower import BorrowerCreate, BorrowerResponse, BorrowerUpdate
from app.services.borrower import (
    create_borrower,
    get_borrower_or_404,
    list_borrowers,
    update_borrower,
)

router = APIRouter(prefix="/api/v1/borrowers", tags=["borrowers"])


@router.get("", response_model=list[BorrowerResponse])
async def read_borrowers(
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(get_library_id),
) -> list[BorrowerResponse]:
    borrowers = await list_borrowers(session, library_id)
    return [BorrowerResponse.model_validate(b) for b in borrowers]


@router.post("", response_model=BorrowerResponse, status_code=status.HTTP_201_CREATED)
async def create_borrower_endpoint(
    payload: BorrowerCreate,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
) -> BorrowerResponse:
    borrower = await create_borrower(session, payload, library_id)
    return BorrowerResponse.model_validate(borrower)


@router.get("/{borrower_id}", response_model=BorrowerResponse)
async def read_borrower(
    borrower_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(get_library_id),
) -> BorrowerResponse:
    borrower = await get_borrower_or_404(session, borrower_id, library_id)
    return BorrowerResponse.model_validate(borrower)


@router.patch("/{borrower_id}", response_model=BorrowerResponse)
async def update_borrower_endpoint(
    borrower_id: uuid.UUID,
    payload: BorrowerUpdate,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
) -> BorrowerResponse:
    borrower = await update_borrower(session, borrower_id, payload, library_id)
    return BorrowerResponse.model_validate(borrower)
