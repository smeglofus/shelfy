import uuid

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.api.dependencies.library import get_library_id, require_editor_library
from app.db.session import get_db_session
from app.models.user import User
from app.schemas.wishlist import (
    WishlistItemCreateRequest,
    WishlistItemResponse,
    WishlistListResponse,
)
from app.services.wishlist import (
    assert_wishlist_enabled,
    create_wishlist_item,
    delete_wishlist_item,
    list_wishlist_items,
)

router = APIRouter(prefix="/api/v1/wishlist", tags=["wishlist"])


@router.get("", response_model=WishlistListResponse)
async def read_wishlist(
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(get_library_id),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> WishlistListResponse:
    """List the active library's wishes (viewer+)."""
    await assert_wishlist_enabled(session, library_id)
    items, total = await list_wishlist_items(session, library_id, page=page, page_size=page_size)
    return WishlistListResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=[WishlistItemResponse.model_validate(item) for item in items],
    )


@router.post("", response_model=WishlistItemResponse, status_code=status.HTTP_201_CREATED)
async def create_wish(
    payload: WishlistItemCreateRequest,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
    current_user: User = Depends(get_current_user),
) -> WishlistItemResponse:
    """Add a wish (editor+)."""
    await assert_wishlist_enabled(session, library_id)
    item = await create_wishlist_item(
        session, payload, library_id, actor_user_id=current_user.id
    )
    return WishlistItemResponse.model_validate(item)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_wish(
    item_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
) -> Response:
    """Remove a wish (editor+)."""
    await assert_wishlist_enabled(session, library_id)
    await delete_wishlist_item(session, item_id, library_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
