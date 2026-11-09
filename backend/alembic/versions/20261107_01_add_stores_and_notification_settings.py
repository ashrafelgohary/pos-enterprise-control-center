"""add stores, POS/store relation, and notification settings

Revision ID: 20261107_01
Revises: 0001
Create Date: 2026-11-07

Set `down_revision` to the current Alembic head before running the migration.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "20261107_01"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

POS_TABLE_CANDIDATES = ("pos_devices",)


def _pos_table() -> str:
    tables = set(inspect(op.get_bind()).get_table_names())
    for candidate in POS_TABLE_CANDIDATES:
        if candidate in tables:
            return candidate
    raise RuntimeError(
        "Could not find the POS table. Update POS_TABLE_CANDIDATES in this migration "
        "to match the existing POS model before running upgrade."
    )


def upgrade() -> None:
    op.create_table(
        "stores",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=True),
        sa.Column("brand", sa.String(length=100), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("additional_recipients", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("code", name="uq_stores_code"),
    )
    op.create_index("ix_stores_name", "stores", ["name"])
    op.create_index("ix_stores_brand", "stores", ["brand"])

    op.create_table(
        "application_settings",
        sa.Column("key", sa.String(length=100), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.bulk_insert(
        sa.table("application_settings", sa.column("key", sa.String()), sa.column("value", sa.Text())),
        [{"key": "deployment_email_default_cc", "value": "northafrica.support@alshaya.com"}],
    )

    pos_table = _pos_table()
    with op.batch_alter_table(pos_table) as batch:
        batch.add_column(sa.Column("store_id", sa.Integer(), nullable=True))
        batch.create_index(f"ix_{pos_table}_store_id", ["store_id"])
        batch.create_foreign_key(
            f"fk_{pos_table}_store_id_stores",
            "stores",
            ["store_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    pos_table = _pos_table()
    with op.batch_alter_table(pos_table) as batch:
        batch.drop_constraint(f"fk_{pos_table}_store_id_stores", type_="foreignkey")
        batch.drop_index(f"ix_{pos_table}_store_id")
        batch.drop_column("store_id")
    op.drop_table("application_settings")
    op.drop_index("ix_stores_brand", table_name="stores")
    op.drop_index("ix_stores_name", table_name="stores")
    op.drop_table("stores")
