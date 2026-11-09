"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-10-08
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("username", sa.String(64), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(128)),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(16), nullable=False, server_default="viewer"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("token_version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("last_login_at", TS),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("role IN ('admin','operator','viewer')", name="ck_users_role_valid"),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "pos_devices",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("hostname", sa.String(63), nullable=False),
        sa.Column("ip_address", pg.INET, nullable=False),
        sa.Column("mac_address", pg.MACADDR),
        sa.Column("store_name", sa.String(128), nullable=False),
        sa.Column("brand", sa.String(64)),
        sa.Column("notes", sa.String(1000)),
        sa.Column("status", sa.String(16), nullable=False, server_default="unknown"),
        sa.Column("last_seen", TS),
        sa.Column("last_deployment_at", TS),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("hostname", name="uq_pos_devices_hostname"),
        sa.UniqueConstraint("ip_address", name="uq_pos_devices_ip_address"),
        sa.CheckConstraint("status IN ('online','offline','unknown','maintenance')", name="ck_pos_devices_status_valid"),
        sa.CheckConstraint("hostname ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$'", name="ck_pos_devices_hostname_format"),
    )
    op.create_index("ix_pos_devices_store_name", "pos_devices", ["store_name"])
    op.create_index("ix_pos_devices_brand", "pos_devices", ["brand"])
    op.create_index("ix_pos_devices_status", "pos_devices", ["status"])
    op.create_index("ix_pos_devices_store_status", "pos_devices", ["store_name", "status"])
    # case-insensitive hostname lookups (XML matching)
    op.execute("CREATE UNIQUE INDEX ix_pos_devices_hostname_lower ON pos_devices (lower(hostname))")

    op.create_table(
        "xml_jobs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("uploaded_by", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_xml_jobs_uploaded_by_users")),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("file_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("upload_timestamp", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("total_devices", sa.Integer, nullable=False, server_default="0"),
        sa.Column("successful_devices", sa.Integer, nullable=False, server_default="0"),
        sa.Column("failed_devices", sa.Integer, nullable=False, server_default="0"),
        sa.Column("celery_task_id", sa.String(64)),
        sa.Column("error_message", sa.Text),
        sa.Column("started_at", TS),
        sa.Column("completed_at", TS),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('pending','running','success','partial','failed','cancelled')", name="ck_xml_jobs_status_valid"),
        sa.CheckConstraint("successful_devices + failed_devices <= total_devices", name="ck_xml_jobs_counts"),
    )
    op.create_index("ix_xml_jobs_uploaded_by", "xml_jobs", ["uploaded_by"])
    op.create_index("ix_xml_jobs_created_at", "xml_jobs", ["created_at"])
    op.create_index("ix_xml_jobs_status_created", "xml_jobs", ["status", "created_at"])

    op.create_table(
        "xml_files",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("batch_id", pg.UUID(as_uuid=True), nullable=False),
        sa.Column("uploaded_by", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_xml_files_uploaded_by_users")),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("stored_path", sa.String(512), nullable=False),
        sa.Column("size_bytes", sa.BigInteger, nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("root_element", sa.String(128)),
        sa.Column("is_valid", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("validation_error", sa.String(1000)),
        sa.Column("matched_pos_id", sa.Integer, sa.ForeignKey("pos_devices.id", ondelete="SET NULL", name="fk_xml_files_matched_pos_id_pos_devices")),
        sa.Column("match_method", sa.String(32)),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_xml_files_batch_id", "xml_files", ["batch_id"])

    op.create_table(
        "job_results",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("job_id", sa.Integer, sa.ForeignKey("xml_jobs.id", ondelete="CASCADE", name="fk_job_results_job_id_xml_jobs"), nullable=False),
        sa.Column("pos_id", sa.Integer, sa.ForeignKey("pos_devices.id", ondelete="SET NULL", name="fk_job_results_pos_id_pos_devices")),
        sa.Column("xml_file_id", sa.Integer, sa.ForeignKey("xml_files.id", ondelete="SET NULL", name="fk_job_results_xml_file_id_xml_files")),
        sa.Column("hostname", sa.String(63), nullable=False),
        sa.Column("ip_address", sa.String(45), nullable=False),
        sa.Column("xml_filename", sa.String(255), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("attempt", sa.Integer, nullable=False, server_default="1"),
        sa.Column("output", sa.Text),
        sa.Column("error_message", sa.Text),
        sa.Column("started_at", TS),
        sa.Column("completed_at", TS),
        sa.CheckConstraint("status IN ('pending','running','success','failed','cancelled')", name="ck_job_results_status_valid"),
    )
    op.create_index("ix_job_results_job_status", "job_results", ["job_id", "status"])
    op.create_index("ix_job_results_pos_started", "job_results", ["pos_id", "started_at"])

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_audit_logs_user_id_users")),
        sa.Column("username", sa.String(64)),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("target", sa.String(255)),
        sa.Column("details", pg.JSONB),
        sa.Column("ip_address", sa.String(45)),
        sa.Column("timestamp", TS, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_audit_logs_user_id", "audit_logs", ["user_id"])
    op.create_index("ix_audit_logs_timestamp", "audit_logs", ["timestamp"])
    op.create_index("ix_audit_logs_action_ts", "audit_logs", ["action", "timestamp"])

    # Audit log is append-only: block UPDATE/DELETE at the database level.
    op.execute("""
        CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
        BEGIN
          -- Only allowed mutation: FK cascade nulling user_id when a user is removed.
          IF TG_OP = 'UPDATE' AND NEW.user_id IS NULL
             AND (NEW.username, NEW.action, NEW.target, NEW.details, NEW.ip_address, NEW.timestamp)
                 IS NOT DISTINCT FROM
                 (OLD.username, OLD.action, OLD.target, OLD.details, OLD.ip_address, OLD.timestamp) THEN
            RETURN NEW;
          END IF;
          RAISE EXCEPTION 'audit_logs is append-only';
        END; $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER trg_audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs")
    op.execute("DROP FUNCTION IF EXISTS audit_logs_immutable()")
    for t in ("audit_logs", "job_results", "xml_files", "xml_jobs", "pos_devices", "users"):
        op.drop_table(t)
