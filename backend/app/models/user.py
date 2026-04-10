from datetime import datetime
import uuid
from typing import Optional

from sqlalchemy import Boolean, DateTime, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)

    # ── Auth-provider bookkeeping ────────────────────────────────────────────────
    # auth_provider: the primary sign-in method, e.g. 'local' | 'google'.
    # Has a Python-side default so ORM objects are always consistent before flush.
    auth_provider: Mapped[str] = mapped_column(
        String(32), nullable=False, default="local", server_default="local"
    )
    # has_local_password: True when the account has a *real* (user-known) password.
    # Remains True even after Google is linked to an existing email+password account.
    # New OAuth-only users are created with False.
    # This is the authoritative flag for "require password confirmation on delete".
    has_local_password: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )

    # ── OAuth fields ─────────────────────────────────────────────────────────────
    google_sub: Mapped[Optional[str]] = mapped_column(
        String(255), unique=True, index=True, nullable=True
    )
    avatar_url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    oauth_linked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ── Onboarding ───────────────────────────────────────────────────────────────
    onboarding_completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )
    onboarding_skipped_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    # ── Timestamps ───────────────────────────────────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
