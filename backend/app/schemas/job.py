import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class PosRef(BaseModel):
    id: int
    hostname: str
    ip_address: str
    store_name: str


class UploadedFileOut(BaseModel):
    id: int
    original_filename: str
    size_bytes: int
    sha256: str
    root_element: str | None
    is_valid: bool
    validation_error: str | None
    match_method: str | None
    matched_pos: PosRef | None
    busy: bool = False  # target POS already has a running deployment


class UploadBatchOut(BaseModel):
    batch_id: uuid.UUID
    files: list[UploadedFileOut]


class DeploymentItem(BaseModel):
    file_id: int
    pos_id: int


class DeploymentCreate(BaseModel):
    batch_id: uuid.UUID
    items: list[DeploymentItem] = Field(min_length=1, max_length=2000)


class JobResultOut(ORMModel):
    id: int
    job_id: int
    pos_id: int | None
    hostname: str
    ip_address: str
    xml_filename: str
    status: str
    attempt: int
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None


class JobResultDetail(JobResultOut):
    output: str | None


class JobOut(ORMModel):
    id: int
    filename: str
    file_count: int
    status: str
    total_devices: int
    successful_devices: int
    failed_devices: int
    running_devices: int = 0
    pending_devices: int = 0
    error_message: str | None
    upload_timestamp: datetime
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    uploaded_by_username: str | None = None


class JobDetail(JobOut):
    results: list[JobResultOut]
