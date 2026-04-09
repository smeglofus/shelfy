"""Authentication endpoints — register, login, token refresh, profile, GDPR."""
import json
from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.core.config import Settings, get_settings
from app.core.limiter import limiter
from app.core.security import verify_password
from app.db.session import get_db_session
from app.models.book import Book
from app.models.library import Library, LibraryMember
from app.models.loan import Loan
from app.models.subscription import Subscription, UsageCounter
from app.models.user import User
from app.schemas.auth import (
    AccessTokenResponse,
    DeleteAccountRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from app.services import billing as billing_svc
from app.services import email as email_svc
from app.services.auth import authenticate_user, issue_token_pair, read_refresh_token_subject, register_user
from app.services.entitlements import get_or_create_subscription

logger = structlog.get_logger()

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
SETTINGS = get_settings()


# ── Standard auth ──────────────────────────────────────────────────────────────

@router.post("/register", response_model=UserResponse, status_code=201)
@limiter.limit(SETTINGS.rate_limit_register)
async def register(
    request: Request,
    payload: RegisterRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_db_session),
) -> UserResponse:
    user = await register_user(session, str(payload.email), payload.password)
    # Fire-and-forget welcome email — never blocks the response
    name = user.email.split("@")[0]
    background_tasks.add_task(email_svc.send_welcome, user.email, name)
    return UserResponse.model_validate(user)


@router.post("/login", response_model=TokenResponse)
@limiter.limit(SETTINGS.rate_limit_login)
async def login(
    request: Request,
    payload: LoginRequest,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> TokenResponse:
    user = await authenticate_user(session, str(payload.email), payload.password)
    access_token, refresh_token = issue_token_pair(user.email, settings)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=AccessTokenResponse)
@limiter.limit(SETTINGS.rate_limit_refresh)
async def refresh_token(
    request: Request,
    payload: RefreshRequest,
    settings: Settings = Depends(get_settings),
) -> AccessTokenResponse:
    subject = read_refresh_token_subject(payload.refresh_token)
    access_token, _ = issue_token_pair(subject, settings)
    return AccessTokenResponse(access_token=access_token)


@router.get("/me", response_model=UserResponse)
async def read_me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(current_user)


# ── GDPR: account deletion (Art. 17 — right to erasure) ───────────────────────

@router.delete("/me", status_code=204)
async def delete_account(
    payload: DeleteAccountRequest,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Permanently delete the authenticated user's account (GDPR Art. 17).

    Requires password confirmation — prevents CSRF and accidental deletion via
    a hijacked token.

    What is deleted **immediately** (synchronous, within this request):
      • User row — Postgres CASCADE removes everything owned by this user:
          subscriptions, usage_counters, usage_events, stripe_events
          library_members rows (removes the user from all shared libraries)
          libraries created by this user → books → loans
      • The JWT is invalidated implicitly: the user row no longer exists so
        any subsequent request with the same token returns 401.

    What is **best-effort** (errors are logged and ignored, never block deletion):
      • Stripe subscription cancellation — the subscription is immediately
        canceled in Stripe; if Stripe is unreachable the local row is still
        deleted. Stripe will eventually expire the subscription on its own.

    What is **NOT** deleted by this endpoint:
      • MinIO shelf-scan images — these are referenced by processing_job rows
        which cascade-delete, but the MinIO objects themselves are orphaned.
        A nightly MinIO object lifecycle policy handles the cleanup.
      • PostgreSQL backup files in shelfy-backups — retained for BACKUP_KEEP_DAYS
        (default 30 days) for recovery purposes, then pruned automatically.
    """
    if not verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect password",
        )

    user_id = str(current_user.id)

    # Proactively delete libraries where the current user is the only member.
    # Prevents orphaned library data when the account is removed.
    sole_member_library_ids = (
        select(LibraryMember.library_id)
        .group_by(LibraryMember.library_id)
        .having(func.count(LibraryMember.id) == 1)
        .subquery()
    )
    sole_member_libraries = (
        await session.execute(
            select(Library)
            .join(sole_member_library_ids, sole_member_library_ids.c.library_id == Library.id)
            .join(LibraryMember, LibraryMember.library_id == Library.id)
            .where(LibraryMember.user_id == current_user.id)
        )
    ).scalars().all()

    for library in sole_member_libraries:
        await session.delete(library)

    await billing_svc.cancel_stripe_subscription(session, current_user.id, settings)
    await session.delete(current_user)
    await session.commit()
    logger.info("account_deleted", user_id=user_id)
    return Response(status_code=204)


# ── GDPR: data export (Art. 20 — right to data portability) ───────────────────

@router.get("/me/export")
async def export_my_data(
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Export all personal data as a downloadable JSON file.

    Includes: profile, subscription status, all libraries with books and their
    lending history, and monthly usage counters.
    """
    # 1. Subscription
    sub = await get_or_create_subscription(session, current_user.id)

    # 2. Usage counters — all months, newest first
    usage_rows = (
        await session.execute(
            select(UsageCounter)
            .where(UsageCounter.user_id == current_user.id)
            .order_by(UsageCounter.period_start.desc())
        )
    ).scalars().all()

    # 3. Libraries + books + loans
    memberships = (
        await session.execute(
            select(Library, LibraryMember.role)
            .join(LibraryMember, LibraryMember.library_id == Library.id)
            .where(LibraryMember.user_id == current_user.id)
            .order_by(Library.created_at.asc())
        )
    ).all()

    libraries_out = []
    for lib, role in memberships:
        books_rows = (
            await session.execute(
                select(Book).where(Book.library_id == lib.id).order_by(Book.created_at.asc())
            )
        ).scalars().all()

        books_out = []
        for book in books_rows:
            loans_rows = (
                await session.execute(
                    select(Loan).where(Loan.book_id == book.id).order_by(Loan.lent_date.desc())
                )
            ).scalars().all()
            books_out.append({
                "id": str(book.id),
                "title": book.title,
                "author": book.author,
                "isbn": book.isbn,
                "publisher": book.publisher,
                "language": book.language,
                "description": book.description,
                "publication_year": book.publication_year,
                "reading_status": book.reading_status.value if hasattr(book.reading_status, "value") else book.reading_status,
                "processing_status": book.processing_status.value if hasattr(book.processing_status, "value") else book.processing_status,
                "created_at": book.created_at.isoformat() if book.created_at else None,
                "loans": [
                    {
                        "id": str(loan.id),
                        "borrower_name": loan.borrower_name,
                        "borrower_contact": loan.borrower_contact,
                        "lent_date": str(loan.lent_date),
                        "due_date": str(loan.due_date) if loan.due_date else None,
                        "returned_date": str(loan.returned_date) if loan.returned_date else None,
                        "notes": loan.notes,
                        "created_at": loan.created_at.isoformat() if loan.created_at else None,
                    }
                    for loan in loans_rows
                ],
            })

        libraries_out.append({
            "id": str(lib.id),
            "name": lib.name,
            "role": role if isinstance(role, str) else role.value,
            "created_at": lib.created_at.isoformat() if lib.created_at else None,
            "books": books_out,
        })

    export_data = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "shelfy_version": "1.0",
        "profile": {
            "id": str(current_user.id),
            "email": current_user.email,
            "created_at": current_user.created_at.isoformat(),
        },
        "subscription": {
            "plan": sub.plan if isinstance(sub.plan, str) else sub.plan.value,
            "status": sub.status if isinstance(sub.status, str) else sub.status.value,
            "trial_ends_at": sub.trial_ends_at.isoformat() if sub.trial_ends_at else None,
            "current_period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
        },
        "usage": [
            {
                "metric": row.metric if isinstance(row.metric, str) else row.metric.value,
                "period_start": str(row.period_start),
                "count": row.count,
            }
            for row in usage_rows
        ],
        "libraries": libraries_out,
    }

    user_id_str = str(current_user.id)
    logger.info("data_export_requested", user_id=user_id_str)
    return Response(
        content=json.dumps(export_data, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="shelfy-export-{user_id_str}.json"',
        },
    )
