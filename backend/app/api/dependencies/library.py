from __future__ import annotations

import uuid

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.db.session import get_db_session
from app.models.library import LibraryRole
from app.models.user import User
from app.services.library import get_default_user_library_id, require_library_role


async def get_library_id(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    x_library_id: str | None = Header(default=None, alias="X-Library-Id"),
) -> uuid.UUID:
    if x_library_id:
        try:
            candidate_library_id = uuid.UUID(x_library_id)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid X-Library-Id") from exc

        try:
            await require_library_role(session, current_user.id, candidate_library_id, LibraryRole.VIEWER)
            return candidate_library_id
        except HTTPException as exc:
            if exc.status_code != status.HTTP_403_FORBIDDEN:
                raise
            # Stale/inaccessible header: safely fall back to the user's default library.

    library_id = await get_default_user_library_id(session, current_user.id)
    await require_library_role(session, current_user.id, library_id, LibraryRole.VIEWER)
    return library_id


async def require_viewer_library(
    library_id: uuid.UUID = Depends(get_library_id),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> uuid.UUID:
    await require_library_role(session, current_user.id, library_id, LibraryRole.VIEWER)
    return library_id


async def require_editor_library(
    library_id: uuid.UUID = Depends(get_library_id),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> uuid.UUID:
    await require_library_role(session, current_user.id, library_id, LibraryRole.EDITOR)
    return library_id
