import uuid

from fastapi import HTTPException, status
from sqlalchemy import Column, MetaData, Table, Uuid, func, inspect, select
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.models.location import Location
from app.schemas.location import LocationCreateRequest, LocationUpdateRequest

logger = structlog.get_logger()


async def list_locations(session: AsyncSession) -> list[Location]:
    result = await session.execute(select(Location).order_by(Location.room, Location.furniture, Location.display_order, Location.shelf))
    return list(result.scalars().all())


async def create_location(session: AsyncSession, payload: LocationCreateRequest) -> Location:
    max_order = (await session.execute(
        select(func.max(Location.display_order)).where(
            Location.room == payload.room,
            Location.furniture == payload.furniture,
        )
    )).scalar_one()
    next_order = (int(max_order) + 1) if max_order is not None else 0

    location = Location(
        room=payload.room,
        furniture=payload.furniture,
        shelf=payload.shelf,
        display_order=payload.display_order if payload.display_order is not None else next_order,
    )
    session.add(location)
    await session.commit()
    await session.refresh(location)
    logger.info("location_created", location_id=str(location.id))
    return location


async def get_location_or_404(session: AsyncSession, location_id: uuid.UUID) -> Location:
    result = await session.execute(select(Location).where(Location.id == location_id))
    location = result.scalar_one_or_none()
    if location is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found")
    return location


async def update_location(
    session: AsyncSession, location_id: uuid.UUID, payload: LocationUpdateRequest
) -> Location:
    location = await get_location_or_404(session, location_id)
    update_data = payload.model_dump(exclude_unset=True, exclude_none=True)
    for field_name, value in update_data.items():
        setattr(location, field_name, value)

    await session.commit()
    await session.refresh(location)
    logger.info("location_updated", location_id=str(location.id), fields=list(update_data.keys()))
    return location


async def delete_location(session: AsyncSession, location_id: uuid.UUID) -> None:
    location = await get_location_or_404(session, location_id)

    if await _location_has_books(session, location_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Location cannot be deleted because books are assigned",
        )

    await session.delete(location)
    await session.commit()
    logger.info("location_deleted", location_id=str(location_id))


async def _location_has_books(session: AsyncSession, location_id: uuid.UUID) -> bool:
    connection = await session.connection()
    books_columns = await connection.run_sync(
        lambda sync_conn: {column["name"] for column in inspect(sync_conn).get_columns("books")}
        if inspect(sync_conn).has_table("books")
        else set()
    )

    if "location_id" not in books_columns:
        return False

    books = Table("books", MetaData(), Column("location_id", Uuid(as_uuid=True)))
    result = await session.execute(
        select(func.count()).select_from(books).where(books.c.location_id == location_id)
    )
    return int(result.scalar_one()) > 0
