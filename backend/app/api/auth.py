from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.core.config import Settings, get_settings
from app.db.session import get_db_session
from app.core.limiter import limiter
from app.models.user import User
from app.schemas.auth import (
    AccessTokenResponse,
    LoginRequest,
    RegisterRequest,
    RefreshRequest,
    TokenResponse,
    UserResponse,
)
from app.services.auth import authenticate_user, issue_token_pair, read_refresh_token_subject, register_user

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
SETTINGS = get_settings()


@router.post("/register", response_model=UserResponse, status_code=201)
@limiter.limit(SETTINGS.rate_limit_register)
async def register(
    request: Request,
    payload: RegisterRequest,
    session: AsyncSession = Depends(get_db_session),
) -> UserResponse:
    user = await register_user(session, str(payload.email), payload.password)
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
