import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.library import get_library_id, require_editor_library
from app.db.session import get_db_session
from app.schemas.location import LocationCreateRequest, LocationResponse, LocationUpdateRequest
from app.services.location import (
    create_location,
    delete_location,
    get_location_or_404,
    list_locations,
    update_location,
)

router = APIRouter(prefix="/api/v1/locations", tags=["locations"])


@router.get("", response_model=list[LocationResponse])
async def read_locations(
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(get_library_id),
) -> list[LocationResponse]:
    locations = await list_locations(session, library_id)
    return [LocationResponse.model_validate(location) for location in locations]


@router.post("", response_model=LocationResponse, status_code=status.HTTP_201_CREATED)
async def create_location_endpoint(
    payload: LocationCreateRequest,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
) -> LocationResponse:
    location = await create_location(session, payload, library_id)
    return LocationResponse.model_validate(location)


@router.get("/{location_id}", response_model=LocationResponse)
async def read_location(
    location_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(get_library_id),
) -> LocationResponse:
    location = await get_location_or_404(session, location_id, library_id)
    return LocationResponse.model_validate(location)


@router.patch("/{location_id}", response_model=LocationResponse)
async def update_location_endpoint(
    location_id: uuid.UUID,
    payload: LocationUpdateRequest,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
) -> LocationResponse:
    location = await update_location(session, location_id, payload, library_id)
    return LocationResponse.model_validate(location)


@router.delete("/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_location_endpoint(
    location_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
) -> Response:
    await delete_location(session, location_id, library_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
