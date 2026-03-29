from datetime import datetime
import uuid

from pydantic import BaseModel, ConfigDict, Field, model_validator


class LocationCreateRequest(BaseModel):
    room: str = Field(min_length=1, max_length=100)
    furniture: str = Field(min_length=1, max_length=100)
    shelf: str = Field(min_length=1, max_length=100)
    display_order: int | None = Field(default=None, ge=0)


class LocationUpdateRequest(BaseModel):
    room: str | None = Field(default=None, min_length=1, max_length=100)
    furniture: str | None = Field(default=None, min_length=1, max_length=100)
    shelf: str | None = Field(default=None, min_length=1, max_length=100)
    display_order: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def reject_explicit_nulls(self) -> "LocationUpdateRequest":
        for field_name in ("room", "furniture", "shelf", "display_order"):
            if field_name in self.model_fields_set and getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null")
        return self


class LocationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    room: str
    furniture: str
    shelf: str
    display_order: int
    created_at: datetime
    updated_at: datetime
