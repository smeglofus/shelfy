import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class BorrowerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    contact: str | None = Field(None, max_length=255)
    notes: str | None = None


class BorrowerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    contact: str | None = Field(default=None, max_length=255)
    notes: str | None = None

    @model_validator(mode="after")
    def reject_explicit_nulls(self) -> "BorrowerUpdate":
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name cannot be null")
        return self


class BorrowerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    contact: str | None
    notes: str | None
    anonymized_at: datetime | None
    created_at: datetime
    updated_at: datetime
