import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.db.session import get_db_session
from app.models.user import User
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
    _current_user: User = Depends(get_current_user),
) -> list[LocationResponse]:
    locations = await list_locations(session)
    return [LocationResponse.model_validate(location) for location in locations]


@router.post("", response_model=LocationResponse, status_code=status.HTTP_201_CREATED)
async def create_location_endpoint(
    payload: LocationCreateRequest,
    session: AsyncSession = Depends(get_db_session),
    _current_user: User = Depends(get_current_user),
) -> LocationResponse:
    location = await create_location(session, payload)
    return LocationResponse.model_validate(location)


@router.get("/{location_id}", response_model=LocationResponse)
async def read_location(
    location_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    _current_user: User = Depends(get_current_user),
) -> LocationResponse:
    location = await get_location_or_404(session, location_id)
    return LocationResponse.model_validate(location)


@router.patch("/{location_id}", response_model=LocationResponse)
async def update_location_endpoint(
    location_id: uuid.UUID,
    payload: LocationUpdateRequest,
    session: AsyncSession = Depends(get_db_session),
    _current_user: User = Depends(get_current_user),
) -> LocationResponse:
    location = await update_location(session, location_id, payload)
    return LocationResponse.model_validate(location)


@router.delete("/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_location_endpoint(
    location_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    _current_user: User = Depends(get_current_user),
) -> Response:
    await delete_location(session, location_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
