from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book, ReadingStatus
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.location import Location
from app.models.user import User

_ROLE_ORDER = {LibraryRole.VIEWER: 0, LibraryRole.EDITOR: 1, LibraryRole.OWNER: 2}


async def create_library(session: AsyncSession, user_id: uuid.UUID, name: str) -> Library:
    """Create a library owned by ``user_id``. Flushes but does not commit —
    the caller owns the transaction boundary (entitlement locks depend on it)."""
    lib = Library(name=name, created_by_user_id=user_id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=user_id, role=LibraryRole.OWNER))
    return lib


async def create_personal_library(session: AsyncSession, user: User) -> Library:
    return await create_library(session, user.id, f"{user.email.split('@')[0]} library")


_SAMPLE_LOCATIONS = [
    {"room": "Living room", "furniture": "Bookcase", "shelf": "Shelf 1", "display_order": 1},
    {"room": "Living room", "furniture": "Bookcase", "shelf": "Shelf 2", "display_order": 2},
    {"room": "Bedroom", "furniture": "Nightstand", "shelf": "To read", "display_order": 1},
]

# (title, author, language, year, reading_status, location_index, shelf_position)
_SAMPLE_BOOKS: list[tuple[str, str, str, int, ReadingStatus, int, int]] = [
    ("Proměna", "Franz Kafka", "cs", 1915, ReadingStatus.READ, 0, 0),
    ("R.U.R.", "Karel Čapek", "cs", 1920, ReadingStatus.READ, 0, 1),
    ("Ostře sledované vlaky", "Bohumil Hrabal", "cs", 1965, ReadingStatus.READ, 0, 2),
    ("Báječná léta pod psa", "Michal Viewegh", "cs", 1992, ReadingStatus.READING, 0, 3),
    ("Zaklínač I: Poslední přání", "Andrzej Sapkowski", "cs", 1990, ReadingStatus.READING, 0, 4),
    ("Hobit", "J.R.R. Tolkien", "cs", 1937, ReadingStatus.READ, 0, 5),
    ("Nesnesitelná lehkost bytí", "Milan Kundera", "cs", 1984, ReadingStatus.READ, 1, 0),
    ("Osudy dobrého vojáka Švejka", "Jaroslav Hašek", "cs", 1923, ReadingStatus.READ, 1, 1),
    ("1984", "George Orwell", "en", 1949, ReadingStatus.READ, 1, 2),
    ("Stopařův průvodce po galaxii", "Douglas Adams", "en", 1979, ReadingStatus.READ, 1, 3),
    ("Malý princ", "Antoine de Saint-Exupéry", "cs", 1943, ReadingStatus.READ, 1, 4),
    ("Zločin a trest", "Fjodor Michajlovič Dostojevský", "cs", 1866, ReadingStatus.UNREAD, 2, 0),
    ("Sto roků samoty", "Gabriel García Márquez", "cs", 1967, ReadingStatus.UNREAD, 2, 1),
    ("Mistr a Markétka", "Michail Bulgakov", "cs", 1967, ReadingStatus.UNREAD, 2, 2),
    ("Duna", "Frank Herbert", "cs", 1965, ReadingStatus.UNREAD, 2, 3),
    ("Pán prstenů: Společenstvo prstenu", "J.R.R. Tolkien", "cs", 1954, ReadingStatus.UNREAD, 2, 4),
]


async def seed_sample_library(session: AsyncSession, library: Library) -> None:
    locations = [
        Location(library_id=library.id, is_sample=True, **loc_data)
        for loc_data in _SAMPLE_LOCATIONS
    ]
    session.add_all(locations)
    await session.flush()

    books = [
        Book(
            library_id=library.id,
            title=title,
            author=author,
            language=lang,
            publication_year=year,
            reading_status=status,
            location_id=locations[loc_idx].id,
            shelf_position=shelf_pos,
            is_sample=True,
        )
        for title, author, lang, year, status, loc_idx, shelf_pos in _SAMPLE_BOOKS
    ]
    session.add_all(books)


async def list_user_libraries(session: AsyncSession, user_id: uuid.UUID) -> list[tuple[Library, LibraryRole]]:
    res = await session.execute(
        select(Library, LibraryMember.role)
        .join(LibraryMember, LibraryMember.library_id == Library.id)
        .where(LibraryMember.user_id == user_id)
    )
    return [(r[0], r[1]) for r in res.all()]


async def get_default_user_library_id(session: AsyncSession, user_id: uuid.UUID) -> uuid.UUID:
    row = (
        await session.execute(
            select(LibraryMember.library_id)
            .where(LibraryMember.user_id == user_id)
            .order_by(LibraryMember.created_at.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No library membership")
    return row


async def require_library_role(
    session: AsyncSession,
    user_id: uuid.UUID,
    library_id: uuid.UUID,
    required: LibraryRole = LibraryRole.VIEWER,
) -> LibraryMember:
    member = (
        await session.execute(
            select(LibraryMember).where(
                and_(LibraryMember.user_id == user_id, LibraryMember.library_id == library_id)
            )
        )
    ).scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Library access denied")
    if _ROLE_ORDER[member.role] < _ROLE_ORDER[required]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient library role")
    return member


async def list_members(session: AsyncSession, library_id: uuid.UUID) -> list[tuple[LibraryMember, User]]:
    res = await session.execute(
        select(LibraryMember, User)
        .join(User, User.id == LibraryMember.user_id)
        .where(LibraryMember.library_id == library_id)
    )
    return [(member, user) for member, user in res.all()]


async def add_member(session: AsyncSession, library_id: uuid.UUID, email: str, role: LibraryRole) -> LibraryMember:
    """Insert or update a library membership.

    The caller owns the transaction boundary — this function flushes but does
    not commit. That invariant matters for issue #119: the endpoint takes a
    ``FOR UPDATE`` lock on the parent Library row before calling here, and the
    lock must stay held until the INSERT is durable. Committing inside this
    function would release the lock early and re-open the race.
    """
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User with this email does not exist")
    member = (
        await session.execute(
            select(LibraryMember).where(
                and_(LibraryMember.library_id == library_id, LibraryMember.user_id == user.id)
            )
        )
    ).scalar_one_or_none()
    if member is None:
        member = LibraryMember(library_id=library_id, user_id=user.id, role=role)
        session.add(member)
    else:
        member.role = role
    await session.flush()
    await session.refresh(member)
    return member


async def _owner_count(session: AsyncSession, library_id: uuid.UUID) -> int:
    return int(
        (
            await session.execute(
                select(func.count())
                .select_from(LibraryMember)
                .where(and_(LibraryMember.library_id == library_id, LibraryMember.role == LibraryRole.OWNER))
            )
        ).scalar_one()
    )


async def update_member_role(
    session: AsyncSession, library_id: uuid.UUID, user_id: uuid.UUID, role: LibraryRole
) -> LibraryMember:
    member = (
        await session.execute(
            select(LibraryMember).where(
                and_(LibraryMember.library_id == library_id, LibraryMember.user_id == user_id)
            )
        )
    ).scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    if member.role == LibraryRole.OWNER and role != LibraryRole.OWNER and await _owner_count(session, library_id) <= 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove last owner")
    member.role = role
    await session.commit()
    await session.refresh(member)
    return member


async def remove_member(session: AsyncSession, library_id: uuid.UUID, user_id: uuid.UUID) -> None:
    member = (
        await session.execute(
            select(LibraryMember).where(
                and_(LibraryMember.library_id == library_id, LibraryMember.user_id == user_id)
            )
        )
    ).scalar_one_or_none()
    if member is None:
        return
    if member.role == LibraryRole.OWNER and await _owner_count(session, library_id) <= 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove last owner")
    await session.delete(member)
    await session.commit()
