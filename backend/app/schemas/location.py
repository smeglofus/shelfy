from datetime import datetime
import uuid

from pydantic import BaseModel, ConfigDict


class LocationCreateRequest(BaseModel):
    room: str
    furniture: str
    shelf: str


class LocationUpdateRequest(BaseModel):
    room: str | None = None
    furniture: str | None = None
    shelf: str | None = None


class LocationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    room: str
    furniture: str
    shelf: str
    created_at: datetime
    updated_at: datetime
