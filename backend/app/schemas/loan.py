from datetime import date, datetime
from typing import Literal
import uuid

from pydantic import BaseModel, ConfigDict, Field, computed_field


class LoanCreate(BaseModel):
    borrower_name: str = Field(..., min_length=1, max_length=255)
    borrower_contact: str | None = Field(None, max_length=255)
    lent_date: date = Field(default_factory=date.today)
    due_date: date | None = None
    notes: str | None = None


class LoanReturn(BaseModel):
    returned_date: date = Field(default_factory=date.today)
    return_condition: Literal["perfect", "good", "fair", "damaged", "lost"]
    notes: str | None = None


class LoanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    book_id: uuid.UUID
    borrower_name: str
    borrower_contact: str | None
    lent_date: date
    due_date: date | None
    returned_date: date | None
    return_condition: str | None
    notes: str | None
    created_at: datetime

    @computed_field
    def is_active(self) -> bool:
        return self.returned_date is None
