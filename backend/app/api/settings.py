from datetime import datetime, timezone

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.api.dependencies.library import get_library_id
from app.core.security import verify_password
from app.db.session import get_db_session
from app.models.book import Book
from app.models.location import Location
from app.models.loan import Loan
from app.models.user import User
from app.schemas.settings import OnboardingStatusResponse, PurgeLibraryRequest, PurgeLibraryResponse

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


@router.post("/purge-library", response_model=PurgeLibraryResponse)
async def purge_library(
    payload: PurgeLibraryRequest,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    library_id: uuid.UUID = Depends(get_library_id),
) -> PurgeLibraryResponse:
    if not verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")

    deleted_loans = (await session.execute(delete(Loan).where(Loan.library_id == library_id))).rowcount or 0
    deleted_books = (await session.execute(delete(Book).where(Book.library_id == library_id))).rowcount or 0
    deleted_locations = (await session.execute(delete(Location).where(Location.library_id == library_id))).rowcount or 0
    await session.commit()

    return PurgeLibraryResponse(
        deleted_books=deleted_books,
        deleted_locations=deleted_locations,
        deleted_loans=deleted_loans,
    )


# ── Onboarding ──────────────────────────────────────────────

@router.get("/onboarding", response_model=OnboardingStatusResponse)
async def get_onboarding_status(
    current_user: User = Depends(get_current_user),
) -> OnboardingStatusResponse:
    should_show = (
        current_user.onboarding_completed_at is None
        and current_user.onboarding_skipped_at is None
    )
    return OnboardingStatusResponse(
        should_show=should_show,
        completed_at=current_user.onboarding_completed_at,
        skipped_at=current_user.onboarding_skipped_at,
    )


@router.post("/onboarding/complete", response_model=OnboardingStatusResponse)
async def complete_onboarding(
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> OnboardingStatusResponse:
    current_user.onboarding_completed_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(current_user)
    return OnboardingStatusResponse(
        should_show=False,
        completed_at=current_user.onboarding_completed_at,
        skipped_at=current_user.onboarding_skipped_at,
    )


@router.post("/onboarding/skip", response_model=OnboardingStatusResponse)
async def skip_onboarding(
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> OnboardingStatusResponse:
    current_user.onboarding_skipped_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(current_user)
    return OnboardingStatusResponse(
        should_show=False,
        completed_at=current_user.onboarding_completed_at,
        skipped_at=current_user.onboarding_skipped_at,
    )


@router.post("/onboarding/reset", response_model=OnboardingStatusResponse)
async def reset_onboarding(
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> OnboardingStatusResponse:
    current_user.onboarding_completed_at = None
    current_user.onboarding_skipped_at = None
    await session.commit()
    await session.refresh(current_user)
    return OnboardingStatusResponse(
        should_show=True,
        completed_at=None,
        skipped_at=None,
    )
