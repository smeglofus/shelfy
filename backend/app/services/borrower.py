import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import and_, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.models.book import Book
from app.models.borrower import Borrower
from app.models.loan import Loan
from app.schemas.borrower import BorrowerCreate, BorrowerUpdate

logger = structlog.get_logger()

# Sentinel name written to anonymized borrower rows AND to the denormalized
# ``loan.borrower_name`` column for any loan attached to that borrower. Frontend
# detects ``anonymized_at`` to render a localized label; the DB string is
# whatever is robust and never empty.
ANONYMIZED_BORROWER_NAME = "Deleted borrower"


@dataclass(frozen=True)
class BorrowerWithStats:
    borrower: Borrower
    active_loans: int
    total_loans: int
    last_activity_at: date | None


@dataclass(frozen=True)
class BorrowerStatsPage:
    items: list[BorrowerWithStats]
    total: int
    page: int
    page_size: int


@dataclass(frozen=True)
class BorrowerLoanRow:
    id: uuid.UUID
    book_id: uuid.UUID
    book_title: str
    book_author: str | None
    lent_date: date
    due_date: date | None
    returned_date: date | None
    return_condition: str | None
    notes: str | None


def _normalize_name(value: str | None) -> str:
    if value is None:
        return ""
    return " ".join(value.split())


def _normalize_contact(value: str | None) -> str | None:
    if value is None:
        return None
    collapsed = " ".join(value.split())
    return collapsed or None


async def list_borrowers(session: AsyncSession, library_id: uuid.UUID) -> list[Borrower]:
    result = await session.execute(
        select(Borrower)
        .where(Borrower.library_id == library_id)
        .order_by(Borrower.name)
    )
    return list(result.scalars().all())


async def list_borrowers_with_stats(
    session: AsyncSession,
    library_id: uuid.UUID,
    *,
    search: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> BorrowerStatsPage:
    """List a library's borrowers with aggregated lending stats, paginated.

    ``search`` is a case-insensitive substring match on the borrower name.
    The match runs on the *stored* name; for anonymized rows that means
    matching against the sentinel ("Deleted borrower"). Localized labels
    are a frontend concern (see ``displayBorrowerName``).
    """
    active_count = func.count(Loan.id).filter(Loan.returned_date.is_(None))
    total_count = func.count(Loan.id)

    where_clauses = [Borrower.library_id == library_id]
    if search:
        # ``ilike`` keeps the search case-insensitive on Postgres; SQLite's
        # default LIKE is already case-insensitive for ASCII so this is fine
        # for tests too.
        where_clauses.append(Borrower.name.ilike(f"%{search}%"))

    # Count BEFORE applying limit/offset so the paginator knows the true
    # total. Cheap because there are no joins on the count query.
    total_stmt = select(func.count()).select_from(Borrower).where(*where_clauses)
    total = int((await session.execute(total_stmt)).scalar_one())

    # The library-id check on Loan is defensive: in normal operation a loan's
    # library_id always matches its borrower's, but pinning it here prevents a
    # malformed cross-library row from being counted into stats.
    page_stmt = (
        select(
            Borrower,
            active_count.label("active_loans"),
            total_count.label("total_loans"),
            func.max(Loan.lent_date).label("last_activity_at"),
        )
        .outerjoin(
            Loan,
            and_(Loan.borrower_id == Borrower.id, Loan.library_id == library_id),
        )
        .where(*where_clauses)
        .group_by(Borrower.id)
        .order_by(Borrower.name)
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    result = await session.execute(page_stmt)
    items = [
        BorrowerWithStats(
            borrower=row[0],
            active_loans=int(row[1] or 0),
            total_loans=int(row[2] or 0),
            last_activity_at=row[3],
        )
        for row in result.all()
    ]
    return BorrowerStatsPage(items=items, total=total, page=page, page_size=page_size)


async def list_loans_for_borrower(
    session: AsyncSession, borrower_id: uuid.UUID, library_id: uuid.UUID
) -> list[BorrowerLoanRow]:
    """List a borrower's loans with denormalized book metadata.

    Active loans (no returned_date) come first, then returned loans by most
    recent return. Within each group, lent_date desc.
    """
    await get_borrower_or_404(session, borrower_id, library_id)

    stmt = (
        select(
            Loan.id,
            Loan.book_id,
            Book.title,
            Book.author,
            Loan.lent_date,
            Loan.due_date,
            Loan.returned_date,
            Loan.return_condition,
            Loan.notes,
        )
        .join(Book, Book.id == Loan.book_id)
        .where(Loan.borrower_id == borrower_id, Loan.library_id == library_id)
        .order_by(
            Loan.returned_date.is_(None).desc(),
            Loan.returned_date.desc().nullslast(),
            Loan.lent_date.desc(),
            Loan.id.desc(),
        )
    )
    result = await session.execute(stmt)
    return [
        BorrowerLoanRow(
            id=row[0],
            book_id=row[1],
            book_title=row[2],
            book_author=row[3],
            lent_date=row[4],
            due_date=row[5],
            returned_date=row[6],
            return_condition=row[7],
            notes=row[8],
        )
        for row in result.all()
    ]


async def create_borrower(
    session: AsyncSession, payload: BorrowerCreate, library_id: uuid.UUID
) -> Borrower:
    borrower = Borrower(
        library_id=library_id,
        name=payload.name,
        contact=payload.contact,
        notes=payload.notes,
    )
    session.add(borrower)
    await session.commit()
    await session.refresh(borrower)
    logger.info("borrower_created", borrower_id=str(borrower.id), library_id=str(library_id))
    return borrower


async def get_borrower_or_404(
    session: AsyncSession, borrower_id: uuid.UUID, library_id: uuid.UUID
) -> Borrower:
    result = await session.execute(
        select(Borrower).where(Borrower.id == borrower_id, Borrower.library_id == library_id)
    )
    borrower = result.scalar_one_or_none()
    if borrower is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Borrower not found")
    return borrower


async def update_borrower(
    session: AsyncSession,
    borrower_id: uuid.UUID,
    payload: BorrowerUpdate,
    library_id: uuid.UUID,
) -> Borrower:
    borrower = await get_borrower_or_404(session, borrower_id, library_id)
    update_data = payload.model_dump(exclude_unset=True)
    for field_name, value in update_data.items():
        setattr(borrower, field_name, value)
    await session.commit()
    await session.refresh(borrower)
    logger.info("borrower_updated", borrower_id=str(borrower.id), fields=list(update_data.keys()))
    return borrower


async def link_loans_to_borrowers(session: AsyncSession, library_id: uuid.UUID) -> int:
    """Link a library's existing loans to Borrower records.

    Idempotent: loans that already have ``borrower_id`` set are skipped.
    Loans whose ``borrower_name`` is blank after whitespace normalization are
    also skipped. Within the library, loans matching the same normalized
    ``(name, contact)`` reuse a single Borrower; otherwise a new Borrower is
    created. Borrowers are never shared across libraries.

    Returns the number of loans linked in this call.
    """
    existing = (
        await session.execute(select(Borrower).where(Borrower.library_id == library_id))
    ).scalars().all()
    bucket: dict[tuple[str, str | None], Borrower] = {
        (_normalize_name(b.name), _normalize_contact(b.contact)): b for b in existing
    }

    loans = (
        await session.execute(
            select(Loan).where(Loan.library_id == library_id, Loan.borrower_id.is_(None))
        )
    ).scalars().all()

    linked = 0
    for loan in loans:
        normalized_name = _normalize_name(loan.borrower_name)
        if not normalized_name:
            continue
        normalized_contact = _normalize_contact(loan.borrower_contact)
        key = (normalized_name, normalized_contact)

        borrower = bucket.get(key)
        if borrower is None:
            borrower = Borrower(
                library_id=library_id,
                name=normalized_name,
                contact=normalized_contact,
            )
            session.add(borrower)
            await session.flush()
            bucket[key] = borrower

        loan.borrower_id = borrower.id
        linked += 1

    if linked:
        await session.commit()
        logger.info(
            "loans_linked_to_borrowers",
            library_id=str(library_id),
            linked=linked,
            borrowers_total=len(bucket),
        )
    return linked


async def merge_borrowers(
    session: AsyncSession,
    source_id: uuid.UUID,
    target_id: uuid.UUID,
    library_id: uuid.UUID,
) -> Borrower:
    """Merge ``source`` into ``target`` and delete the source row.

    - Both rows must be in ``library_id`` (404 otherwise).
    - ``source_id == target_id`` is rejected (422).
    - Anonymized rows on either side are rejected (422). For source, an
      anonymized record carries no useful identity to consolidate; for
      target, see #234 — we don't attach fresh data to a record whose
      personal data was explicitly deleted.
    - All ``loans.borrower_id == source`` rows are re-pointed to
      ``target``. ADR 008's archival semantic applies: ``loan.borrower_name``
      and ``loan.borrower_contact`` are NOT updated — they're a snapshot of
      who the borrower was *at the time of lending*. Display code reads
      ``loan.borrower.name`` via the relationship, so the merged loans show
      the target's name automatically.
    - The source row is then deleted.

    Returns the target borrower (post-merge state, unchanged identity).
    """
    if source_id == target_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot merge a borrower into itself",
        )

    source = await get_borrower_or_404(session, source_id, library_id)
    target = await get_borrower_or_404(session, target_id, library_id)

    if source.anonymized_at is not None or target.anonymized_at is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot merge anonymized borrowers",
        )

    await session.execute(
        update(Loan)
        .where(Loan.borrower_id == source_id, Loan.library_id == library_id)
        .values(borrower_id=target_id)
    )

    await session.delete(source)
    await session.commit()
    await session.refresh(target)
    logger.info(
        "borrowers_merged",
        source_id=str(source_id),
        target_id=str(target_id),
        library_id=str(library_id),
    )
    return target


async def anonymize_borrower(
    session: AsyncSession, borrower_id: uuid.UUID, library_id: uuid.UUID
) -> Borrower:
    """Strip identifying data from a borrower and from their loan history.

    Idempotent: calling this on an already-anonymized borrower is a no-op
    that returns the existing row unchanged. Cross-library access raises
    404 via ``get_borrower_or_404``.

    Loan rows are updated alongside the borrower because ``Loan.borrower_name``
    and ``Loan.borrower_contact`` carry a denormalized copy of the borrower
    text. Leaving those untouched would defeat the anonymization.
    """
    borrower = await get_borrower_or_404(session, borrower_id, library_id)

    if borrower.anonymized_at is not None:
        return borrower

    borrower.name = ANONYMIZED_BORROWER_NAME
    borrower.contact = None
    borrower.notes = None
    borrower.anonymized_at = datetime.now(timezone.utc)

    # Cascade-clear denormalized borrower text on loan rows. Loan history
    # remains (book_id, lent/due/returned dates, return_condition) so the
    # library still knows who borrowed what — minus the personal data.
    await session.execute(
        update(Loan)
        .where(Loan.borrower_id == borrower_id, Loan.library_id == library_id)
        .values(borrower_name=ANONYMIZED_BORROWER_NAME, borrower_contact=None)
    )

    await session.commit()
    await session.refresh(borrower)
    logger.info(
        "borrower_anonymized",
        borrower_id=str(borrower.id),
        library_id=str(library_id),
    )
    return borrower


async def bulk_anonymize_borrowers(
    session: AsyncSession, borrower_ids: list[uuid.UUID], library_id: uuid.UUID
) -> int:
    """Anonymize many borrowers in one request.

    Strict ownership semantics: every id must exist in ``library_id``.
    """
    if not borrower_ids:
        return 0

    rows = (
        await session.execute(
            select(Borrower).where(Borrower.id.in_(borrower_ids), Borrower.library_id == library_id)
        )
    ).scalars().all()
    if len(rows) != len(set(borrower_ids)):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Borrower not found",
        )

    affected = 0
    for borrower in rows:
        if borrower.anonymized_at is not None:
            continue
        borrower.name = ANONYMIZED_BORROWER_NAME
        borrower.contact = None
        borrower.notes = None
        borrower.anonymized_at = datetime.now(timezone.utc)
        affected += 1

    await session.execute(
        update(Loan)
        .where(Loan.borrower_id.in_(borrower_ids), Loan.library_id == library_id)
        .values(borrower_name=ANONYMIZED_BORROWER_NAME, borrower_contact=None)
    )

    await session.commit()
    logger.info(
        "borrowers_bulk_anonymized",
        borrower_ids_count=len(borrower_ids),
        affected=affected,
        library_id=str(library_id),
    )
    return affected


async def select_borrowers_for_retention_anonymize(
    session: AsyncSession, library_id: uuid.UUID, inactive_since: date
) -> list[uuid.UUID]:
    """Return ids of borrowers in ``library_id`` eligible for retention-driven
    anonymization given ``inactive_since`` as the cutoff date.

    A borrower is eligible when **all** of the following hold:

    - They are not already anonymized.
    - They have no active loans (any loan with ``returned_date IS NULL``).
    - Their most recent ``lent_date`` is strictly before ``inactive_since``,
      OR they have no loans at all. (Borrowers added through the API but
      never lent to are also retention candidates — their record carries
      personal data without serving any active purpose.)

    Loan rows are scoped to the same library on both sides of every check
    (defense in depth, mirroring the pattern in
    ``list_borrowers_with_stats``).
    """
    has_active_loan = select(Loan.id).where(
        Loan.borrower_id == Borrower.id,
        Loan.library_id == library_id,
        Loan.returned_date.is_(None),
    )
    has_recent_loan = select(Loan.id).where(
        Loan.borrower_id == Borrower.id,
        Loan.library_id == library_id,
        Loan.lent_date >= inactive_since,
    )

    stmt = (
        select(Borrower.id)
        .where(
            Borrower.library_id == library_id,
            Borrower.anonymized_at.is_(None),
            ~has_active_loan.exists(),
            ~has_recent_loan.exists(),
        )
    )
    result = await session.execute(stmt)
    return [row[0] for row in result.all()]


async def bulk_anonymize_borrowers_by_inactivity(
    session: AsyncSession,
    library_id: uuid.UUID,
    inactive_since: date,
    *,
    dry_run: bool = False,
) -> int:
    """Retention-driven bulk anonymize for a library.

    Wraps ``select_borrowers_for_retention_anonymize`` plus
    ``bulk_anonymize_borrowers`` — issue #246. When ``dry_run`` is True,
    returns the count that *would* be anonymized without mutating any row.
    Otherwise actually anonymizes them and returns the number of newly
    anonymized borrowers (matching the contract of
    ``bulk_anonymize_borrowers``).
    """
    candidate_ids = await select_borrowers_for_retention_anonymize(
        session, library_id, inactive_since
    )
    if dry_run or not candidate_ids:
        return len(candidate_ids)
    return await bulk_anonymize_borrowers(session, candidate_ids, library_id)
