"""Wishlist service (#309) — books a library wants to acquire.

Internal feature: every function is scoped by ``library_id`` (the router
resolves it through the ``get_library_id`` / ``require_*_library``
dependencies), so cross-library access dies before it reaches a query.
"""
from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.models.library import Library
from app.models.wishlist_item import WishlistItem
from app.schemas.wishlist import WishlistItemCreateRequest

logger = structlog.get_logger()


async def assert_wishlist_enabled(session: AsyncSession, library_id: uuid.UUID) -> None:
    """403 when the owner turned the wishlist off for this library.

    The frontend hides the route, but the API must not quietly keep
    serving a feature the owner disabled.
    """
    enabled = (
        await session.execute(
            select(Library.wishlist_enabled).where(Library.id == library_id)
        )
    ).scalar_one_or_none()
    if not enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Wishlist is disabled for this library",
        )


async def list_wishlist_items(
    session: AsyncSession,
    library_id: uuid.UUID,
    *,
    page: int,
    page_size: int,
) -> tuple[list[WishlistItem], int]:
    """Newest wishes first, paginated the same way as borrowers."""
    total = (
        await session.execute(
            select(func.count())
            .select_from(WishlistItem)
            .where(WishlistItem.library_id == library_id)
        )
    ).scalar_one()
    rows = (
        await session.execute(
            select(WishlistItem)
            .where(WishlistItem.library_id == library_id)
            .order_by(WishlistItem.created_at.desc(), WishlistItem.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()
    return list(rows), int(total)


async def create_wishlist_item(
    session: AsyncSession,
    payload: WishlistItemCreateRequest,
    library_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID | None = None,
) -> WishlistItem:
    item = WishlistItem(
        library_id=library_id,
        created_by_user_id=actor_user_id,
        title=payload.title,
        author=payload.author,
        isbn=payload.isbn,
        note=payload.note,
        cover_image_url=payload.cover_image_url,
        publication_year=payload.publication_year,
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    logger.info(
        "wishlist_item_created",
        wishlist_item_id=str(item.id),
        library_id=str(library_id),
        actor_user_id=str(actor_user_id) if actor_user_id else None,
    )
    return item


async def delete_wishlist_item(
    session: AsyncSession, item_id: uuid.UUID, library_id: uuid.UUID
) -> None:
    """Delete a wish; 404 when it doesn't exist *in this library*."""
    item = (
        await session.execute(
            select(WishlistItem).where(
                WishlistItem.id == item_id, WishlistItem.library_id == library_id
            )
        )
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Wishlist item not found"
        )
    await session.delete(item)
    await session.commit()
    logger.info(
        "wishlist_item_deleted",
        wishlist_item_id=str(item_id),
        library_id=str(library_id),
    )


async def set_wishlist_enabled(
    session: AsyncSession, library_id: uuid.UUID, enabled: bool
) -> Library:
    """Flip the per-library wishlist toggle. Caller must have verified OWNER."""
    library = await session.get(Library, library_id)
    if library is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Library not found")
    library.wishlist_enabled = enabled
    await session.commit()
    await session.refresh(library)
    logger.info(
        "library_wishlist_toggled", library_id=str(library_id), enabled=enabled
    )
    return library
