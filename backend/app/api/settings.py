from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.core.security import verify_password
from app.db.session import get_db_session
from app.models.book import Book
from app.models.location import Location
from app.models.loan import Loan
from app.models.user import User
from app.schemas.settings import PurgeLibraryRequest, PurgeLibraryResponse

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


@router.post("/purge-library", response_model=PurgeLibraryResponse)
async def purge_library(
    payload: PurgeLibraryRequest,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> PurgeLibraryResponse:
    if not verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")

    deleted_loans = (await session.execute(delete(Loan))).rowcount or 0
    deleted_books = (await session.execute(delete(Book))).rowcount or 0
    deleted_locations = (await session.execute(delete(Location))).rowcount or 0
    await session.commit()

    return PurgeLibraryResponse(
        deleted_books=deleted_books,
        deleted_locations=deleted_locations,
        deleted_loans=deleted_loans,
    )
