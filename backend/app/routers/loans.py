import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.db.session import get_db_session
from app.models.user import User
from app.schemas.loan import LoanCreate, LoanResponse, LoanReturn
from app.services.loan_service import create_loan, delete_loan, list_loans, return_loan

router = APIRouter(prefix="/api/v1/books/{book_id}/loans", tags=["loans"])


@router.post("", response_model=LoanResponse, status_code=status.HTTP_201_CREATED)
async def create_loan_endpoint(
    book_id: uuid.UUID,
    payload: LoanCreate,
    session: AsyncSession = Depends(get_db_session),
    _current_user: User = Depends(get_current_user),
) -> LoanResponse:
    loan = await create_loan(session, book_id, payload)
    return LoanResponse.model_validate(loan)


@router.get("", response_model=list[LoanResponse])
async def list_loans_endpoint(
    book_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    _current_user: User = Depends(get_current_user),
) -> list[LoanResponse]:
    loans = await list_loans(session, book_id)
    return [LoanResponse.model_validate(loan) for loan in loans]


@router.patch("/{loan_id}/return", response_model=LoanResponse)
async def return_loan_endpoint(
    book_id: uuid.UUID,
    loan_id: uuid.UUID,
    payload: LoanReturn,
    session: AsyncSession = Depends(get_db_session),
    _current_user: User = Depends(get_current_user),
) -> LoanResponse:
    loan = await return_loan(session, book_id, loan_id, payload)
    return LoanResponse.model_validate(loan)


@router.delete("/{loan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_loan_endpoint(
    book_id: uuid.UUID,
    loan_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    _current_user: User = Depends(get_current_user),
) -> Response:
    await delete_loan(session, book_id, loan_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
