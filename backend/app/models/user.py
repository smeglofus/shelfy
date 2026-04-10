from datetime import datetime
import uuid
from typing import Optional

from sqlalchemy import DateTime, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)

    # ── OAuth fields ────────────────────────────────────────────────────────────
    # google_sub: Google account subject (unique identifier from Google's ID token)
    google_sub: Mapped[Optional[str]] = mapped_column(
        String(255), unique=True, index=True, nullable=True
    )
    # auth_provider: 'local' (email+password) or 'google'
    auth_provider: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default="local"
    )
    # avatar_url: profile photo URL from Google (or future providers)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    # oauth_linked_at: timestamp when OAuth was first linked to this account
    oauth_linked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ── Onboarding ──────────────────────────────────────────────────────────────
    onboarding_completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )
    onboarding_skipped_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    # ── Timestamps ──────────────────────────────────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
