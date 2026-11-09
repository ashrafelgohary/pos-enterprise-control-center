import enum
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class JobStatus(str, enum.Enum):
    PENDING = "pending"      # created, not yet picked up by a worker
    RUNNING = "running"
    SUCCESS = "success"      # all targets succeeded
    PARTIAL = "partial"      # some succeeded, some failed
    FAILED = "failed"        # all targets failed / fatal error
    CANCELLED = "cancelled"


class JobResultStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    CANCELLED = "cancelled"


class XmlJob(Base):
    __tablename__ = "xml_jobs"
    __table_args__ = (
        CheckConstraint("status IN ('pending','running','success','partial','failed','cancelled')", name="status_valid"),
        CheckConstraint("successful_devices + failed_devices <= total_devices", name="counts"),
        Index("ix_xml_jobs_status_created", "status", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)  # summary label, e.g. "POS001.xml (+11)"
    file_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    upload_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=JobStatus.PENDING.value)
    total_devices: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    successful_devices: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_devices: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    celery_task_id: Mapped[str | None] = mapped_column(String(64))
    error_message: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)

    user = relationship("User", lazy="joined")
    results = relationship("JobResult", back_populates="job", cascade="all, delete-orphan", lazy="selectin")


class XmlFile(Base):
    """A validated XML file on disk. batch_id groups one upload session (pre-deployment preview)."""
    __tablename__ = "xml_files"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True, default=uuid.uuid4)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_path: Mapped[str] = mapped_column(String(512), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    root_element: Mapped[str | None] = mapped_column(String(128))
    is_valid: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    validation_error: Mapped[str | None] = mapped_column(String(1000))
    matched_pos_id: Mapped[int | None] = mapped_column(ForeignKey("pos_devices.id", ondelete="SET NULL"))
    match_method: Mapped[str | None] = mapped_column(String(32))  # filename | content | manual
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class JobResult(Base):
    __tablename__ = "job_results"
    __table_args__ = (
        CheckConstraint("status IN ('pending','running','success','failed','cancelled')", name="status_valid"),
        Index("ix_job_results_job_status", "job_id", "status"),
        Index("ix_job_results_pos_started", "pos_id", "started_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("xml_jobs.id", ondelete="CASCADE"), nullable=False)
    pos_id: Mapped[int | None] = mapped_column(ForeignKey("pos_devices.id", ondelete="SET NULL"))
    xml_file_id: Mapped[int | None] = mapped_column(ForeignKey("xml_files.id", ondelete="SET NULL"))
    # Snapshot of target at deployment time (POS may be edited/deleted later)
    hostname: Mapped[str] = mapped_column(String(63), nullable=False)
    ip_address: Mapped[str] = mapped_column(String(45), nullable=False)
    xml_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=JobResultStatus.PENDING.value)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    output: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    job = relationship("XmlJob", back_populates="results")
    pos = relationship("PosDevice", lazy="joined")
