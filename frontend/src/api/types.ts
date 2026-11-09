export type Role = 'admin' | 'operator' | 'viewer';
export type PosStatus = 'online' | 'offline' | 'unknown' | 'maintenance';
export type JobStatus = 'pending' | 'running' | 'success' | 'partial' | 'failed' | 'cancelled';
export type ResultStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

export interface Page<T> { items: T[]; total: number; page: number; page_size: number }

export interface Me { id: number; username: string; email: string; full_name: string | null; role: Role; permissions: string[] }

export interface User {
  id: number; username: string; email: string; full_name: string | null; role: Role; is_active: boolean;
  last_login_at: string | null; created_at: string; updated_at: string;
}

export interface Pos {
  id: number; hostname: string; ip_address: string; mac_address: string | null; store_name: string;
  brand: string | null; notes: string | null; status: PosStatus; last_seen: string | null;
  last_deployment_at: string | null; created_at: string; updated_at: string;
}
export type PosInput = Pick<Pos, 'hostname' | 'ip_address' | 'mac_address' | 'store_name' | 'brand' | 'notes'> & { status?: PosStatus };

export interface PosRef { id: number; hostname: string; ip_address: string; store_name: string }

export interface UploadedFile {
  id: number; original_filename: string; size_bytes: number; sha256: string; root_element: string | null;
  is_valid: boolean; validation_error: string | null; match_method: 'filename' | 'mac' | 'content' | 'manual' | null;
  matched_pos: PosRef | null; busy: boolean;
}
export interface UploadBatch { batch_id: string; files: UploadedFile[] }

export interface Job {
  id: number; filename: string; file_count: number; status: JobStatus; total_devices: number;
  successful_devices: number; failed_devices: number; running_devices: number; pending_devices: number;
  error_message: string | null; upload_timestamp: string; started_at: string | null; completed_at: string | null;
  created_at: string; uploaded_by_username: string | null;
}
export interface JobResult {
  id: number; job_id: number; pos_id: number | null; hostname: string; ip_address: string; xml_filename: string;
  status: ResultStatus; attempt: number; error_message: string | null; started_at: string | null; completed_at: string | null;
}
export interface JobResultDetail extends JobResult { output: string | null }
export interface JobDetail extends Job { results: JobResult[] }

export interface AuditEntry {
  id: number; user_id: number | null; username: string | null; action: string; target: string | null;
  details: Record<string, unknown> | null; ip_address: string | null; timestamp: string;
}

export interface DashboardSummary {
  pos: { total: number; online: number; offline: number; unknown: number; maintenance: number };
  jobs: { pending: number; running: number; successful: number; partial: number; failed: number; total: number };
  trend: { date: string; success: number; failed: number }[];
  stores: { store: string; total: number; offline: number }[];
  recent_jobs: { id: number; filename: string; status: JobStatus; total: number; successful: number; failed: number; created_at: string; user: string | null }[];
  activity: { id: number; username: string | null; action: string; target: string | null; timestamp: string }[];
}

export interface ImportResult { created: number; updated: number; skipped: number; errors: string[] }
