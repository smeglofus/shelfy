"""create book images and processing jobs tables

Revision ID: 20260915_000004
Revises: 20260910_000003
Create Date: 2026-09-15 00:00:04
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260915_000004"
down_revision: str | None = "20260910_000003"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


processing_job_status = sa.Enum(
    "pending",
    "processing",
    "done",
    "failed",
    name="processing_job_status",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    is_postgresql = bind.dialect.name == "postgresql"

    if is_postgresql:
        processing_job_status.create(bind, checkfirst=True)

    op.create_table(
        "book_images",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("book_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("minio_path", sa.String(length=500), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_book_images_book_id", "book_images", ["book_id"], unique=False)
    op.create_index("ix_book_images_minio_path", "book_images", ["minio_path"], unique=True)

    op.create_table(
        "processing_jobs",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column(
            "status",
            processing_job_status if is_postgresql else sa.String(length=20),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("book_image_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["book_image_id"], ["book_images.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_processing_jobs_book_image_id", "processing_jobs", ["book_image_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    is_postgresql = bind.dialect.name == "postgresql"

    op.drop_index("ix_processing_jobs_book_image_id", table_name="processing_jobs")
    op.drop_table("processing_jobs")

    op.drop_index("ix_book_images_minio_path", table_name="book_images")
    op.drop_index("ix_book_images_book_id", table_name="book_images")
    op.drop_table("book_images")

    if is_postgresql:
        processing_job_status.drop(bind, checkfirst=True)
