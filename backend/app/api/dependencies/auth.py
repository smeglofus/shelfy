from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cookies import ACCESS_COOKIE_NAME
from app.core.security import decode_token
from app.db.session import get_db_session
from app.models.user import User
from app.services.auth import get_user_by_email

# auto_error=False so a missing Authorization header doesn't short-circuit
# with a 401 before we've had a chance to look at the cookie. This keeps
# the auto-generated OpenAPI "Authorize" button working for Bearer tokens
# while allowing the SPA to authenticate purely via httpOnly cookie.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


def _extract_token(request: Request, bearer_token: str | None) -> str | None:
    """Prefer the httpOnly cookie (SPA), fall back to the Bearer header (mobile / CLI)."""
    cookie_token = request.cookies.get(ACCESS_COOKIE_NAME)
    if cookie_token:
        return cookie_token
    return bearer_token


async def get_current_user(
    request: Request,
    bearer_token: str | None = Depends(oauth2_scheme),
    session: AsyncSession = Depends(get_db_session),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    token = _extract_token(request, bearer_token)
    if not token:
        raise credentials_exception

    try:
        payload = decode_token(token)
    except JWTError as exc:
        raise credentials_exception from exc

    if payload.get("type") != "access":
        raise credentials_exception

    subject = payload.get("sub")
    if not isinstance(subject, str):
        raise credentials_exception

    user = await get_user_by_email(session, subject)
    if user is None:
        raise credentials_exception

    request.state.user_id = str(user.id)

    # Set Sentry user context so every error is tagged with the authenticated user.
    # Lazy import — zero cost when Sentry is not configured.
    try:
        import sentry_sdk
        sentry_sdk.set_user({"id": str(user.id), "email": user.email})
        # Propagate X-Library-Id header as a tag for easier per-library filtering.
        library_id = request.headers.get("x-library-id")
        if library_id:
            sentry_sdk.set_tag("library_id", library_id)
    except ImportError:
        pass

    return user
