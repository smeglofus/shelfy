from datetime import date, datetime
from typing import Literal
import uuid

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from app.schemas.borrower import BorrowerResponse, MAX_NOTES_LENGTH


class LoanCreate(BaseModel):
    borrower_id: uuid.UUID | None = None
    borrower_name: str | None = Field(None, min_length=1, max_length=255)
    borrower_contact: str | None = Field(None, max_length=255)
    lent_date: date = Field(default_factory=date.today)
    due_date: date | None = None
    notes: str | None = Field(None, max_length=MAX_NOTES_LENGTH)

    @model_validator(mode="after")
    def require_borrower_name_without_id(self) -> "LoanCreate":
        if self.borrower_id is None and not self.borrower_name:
            raise ValueError("borrower_name is required when borrower_id is not provided")
        return self


class LoanReturn(BaseModel):
    returned_date: date = Field(default_factory=date.today)
    return_condition: Literal["perfect", "good", "fair", "damaged", "lost"]
    notes: str | None = Field(None, max_length=MAX_NOTES_LENGTH)


class LoanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    book_id: uuid.UUID
    borrower_id: uuid.UUID | None
    borrower_name: str
    borrower_contact: str | None
    borrower: BorrowerResponse | None
    lent_date: date
    due_date: date | None
    returned_date: date | None
    return_condition: str | None
    notes: str | None = Field(None, max_length=MAX_NOTES_LENGTH)
    created_at: datetime

    @computed_field
    def is_active(self) -> bool:
        return self.returned_date is None
