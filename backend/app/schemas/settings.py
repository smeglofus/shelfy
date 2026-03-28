from pydantic import BaseModel, Field


class PurgeLibraryRequest(BaseModel):
    password: str = Field(min_length=1, max_length=255)


class PurgeLibraryResponse(BaseModel):
    deleted_books: int
    deleted_locations: int
    deleted_loans: int
