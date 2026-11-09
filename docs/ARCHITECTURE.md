# POS Control Center — Architecture

## 1. System architecture

```mermaid
flowchart TB
    U[IT Administrator<br/>Browser] -->|HTTPS| RP[Corporate NGINX host<br/>TLS termination]
    RP -->|HTTP :8080| WEB

    subgraph DOCKER[Docker Compose stack]
      direction TB
      WEB[web<br/>NGINX + React SPA<br/>CSP · security headers · login rate-limit]
      API[api<br/>FastAPI · Gunicorn/Uvicorn<br/>Auth · RBAC · validation · audit]
      PG[(PostgreSQL 16<br/>users · pos · jobs · results · audit)]
      RD[(Redis 7<br/>queue · rate-limit · revocation · cancel flags)]
      WK[worker<br/>Celery + ansible-runner<br/>queues: deployments, maintenance]
      BT[beat<br/>scheduler: health checks, cleanup]
      VOL[[uploads volume<br/>validated XML]]
      ANS[[/ansible read-only<br/>YOUR playbook · roles · group_vars]]
      SEC[[Docker secrets<br/>ssh/become/vault/key]]

      WEB -->|/api/*| API
      API --> PG
      API --> RD
      API --> VOL
      BT --> RD
      RD --> WK
      WK --> PG
      WK --> VOL
      WK --> ANS
      SEC -. worker only .-> WK
    end

    WK -->|SSH via Ansible| POS1[POS001]
    WK -->|SSH via Ansible| POS2[POS002]
    WK -->|SSH via Ansible| POSN[POS…n]
```

**Network segmentation:** `backend` is an `internal: true` network (Postgres, Redis, API, worker). Only `web` publishes a port. Only `worker` joins the `egress` network that routes to the store POS VLANs. **The browser never talks to a POS, and Ansible credentials exist only inside the worker container.**

## 2. How the GUI talks to Ansible

```mermaid
sequenceDiagram
    autonumber
    actor Op as Operator
    participant UI as React UI
    participant API as FastAPI
    participant DB as PostgreSQL
    participant Q as Redis (Celery)
    participant W as Worker
    participant AR as ansible-runner
    participant P as POS devices

    Op->>UI: Drop POS001.xml … POS012.xml
    UI->>API: POST /deployments/uploads (multipart)
    API->>API: filename whitelist · size limit · defusedxml parse · sha256
    API->>DB: xml_files rows (batch_id), match POS by filename → XML content
    API-->>UI: preview (valid / matched / unmatched / busy)
    Op->>UI: Adjust targets, Start deployment
    UI->>API: POST /deployments {batch_id, items[file_id,pos_id]}
    API->>DB: xml_jobs + job_results (PENDING) + audit
    API->>Q: send_task(run_deployment, job_id)   (returns immediately)
    API-->>UI: 201 Job #1042
    loop every 2s
      UI->>API: GET /deployments/jobs/1042
    end
    Q->>W: run_deployment(1042)
    W->>W: build private_data_dir/inventory/hosts.yml (only DB-validated hosts + vars)
    W->>AR: ansible_runner.run(playbook=site.yml, limit=POS001,…, passwords from secrets)
    AR->>P: SSH (your playbook, unchanged)
    AR-->>W: events (runner_on_start / failed / unreachable / stats)
    W->>DB: per-host RUNNING → SUCCESS/FAILED, output, error, timings
    W->>DB: job status SUCCESS / PARTIAL / FAILED + audit
```

### Why this is safe
| Risk | Control |
|---|---|
| Command injection | No shell. `ansible-runner` Python API spawns `ansible-playbook` with an argv list. Variables are written as JSON data to the inventory / extravars, never concatenated into a command. Playbook path is config-only and verified to live inside `/ansible`. |
| Arbitrary hosts | Inventory is generated from the database only. Hostnames are regex-validated at API **and** DB (`CHECK` constraint); IPs are parsed by `ipaddress` and stored as `INET`. |
| Path traversal | Filenames must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.xml$`; storage path is `uploads/<uuid>/<name>` and resolved/verified to stay inside the upload root; files opened with `O_EXCL`. |
| Malicious XML | `defusedxml` with DTDs, entities and external references forbidden (XXE / billion-laughs). |
| Credential exposure | SSH / become / vault passwords are Docker secrets mounted only in `worker`, fed to Ansible's prompts via ansible-runner `passwords` (not in the DB, never sent to the browser). |
| Long runs blocking HTTP | Celery queue; API returns immediately; `acks_late` + `reject_on_worker_lost` re-queue if a worker dies. |
| Concurrent deploys to the same POS | API rejects (HTTP 409) any job that targets a POS with a pending/running result. |

## 3. Database ERD

```mermaid
erDiagram
    users ||--o{ xml_jobs : "uploaded_by"
    users ||--o{ xml_files : "uploaded_by"
    users ||--o{ audit_logs : "user_id"
    xml_jobs ||--|{ job_results : "job_id (CASCADE)"
    pos_devices ||--o{ job_results : "pos_id (SET NULL)"
    pos_devices ||--o{ xml_files : "matched_pos_id"
    xml_files ||--o{ job_results : "xml_file_id"

    users {
      int id PK
      varchar username UK
      varchar email UK
      varchar full_name
      varchar password_hash "argon2id"
      varchar role "CHECK admin|operator|viewer"
      bool is_active
      int token_version "session invalidation"
      timestamptz last_login_at
      timestamptz created_at
      timestamptz updated_at
    }
    pos_devices {
      int id PK
      varchar hostname UK "CHECK regex, unique lower()"
      inet ip_address UK
      macaddr mac_address
      varchar store_name "IX"
      varchar brand "IX"
      varchar notes
      varchar status "online|offline|unknown|maintenance"
      timestamptz last_seen
      timestamptz last_deployment_at
      timestamptz created_at
      timestamptz updated_at
    }
    xml_jobs {
      int id PK
      int uploaded_by FK
      varchar filename "summary label"
      int file_count
      timestamptz upload_timestamp
      varchar status "pending|running|success|partial|failed|cancelled"
      int total_devices
      int successful_devices
      int failed_devices
      varchar celery_task_id
      text error_message
      timestamptz started_at
      timestamptz completed_at
      timestamptz created_at
    }
    xml_files {
      int id PK
      uuid batch_id "IX upload session"
      int uploaded_by FK
      varchar original_filename
      varchar stored_path
      bigint size_bytes
      char sha256
      varchar root_element
      bool is_valid
      varchar validation_error
      int matched_pos_id FK
      varchar match_method "filename|content|manual"
      timestamptz created_at
    }
    job_results {
      int id PK
      int job_id FK
      int pos_id FK
      int xml_file_id FK
      varchar hostname "snapshot"
      varchar ip_address "snapshot"
      varchar xml_filename
      varchar status "pending|running|success|failed|cancelled"
      int attempt
      text output "ansible stdout per host"
      text error_message
      timestamptz started_at
      timestamptz completed_at
    }
    audit_logs {
      int id PK
      int user_id FK
      varchar username "denormalised"
      varchar action "IX(action,timestamp)"
      varchar target
      jsonb details
      varchar ip_address
      timestamptz timestamp "IX"
    }
```

Notes: `audit_logs` is **append-only**, enforced by a PostgreSQL trigger (UPDATE/DELETE raise). `job_results` keeps a hostname/IP snapshot so history survives POS edits or deletion. Users are deactivated, never hard-deleted.

## 4. API (prefix `/api/v1`)

All endpoints except `/auth/login` and `/health*` require the session cookie. Every POST/PUT/PATCH/DELETE also requires the `X-CSRF-Token` header.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/auth/login` | public (rate-limited) | Username/email + password → httpOnly session cookie + CSRF cookie |
| POST | `/auth/logout` | any | Revoke session (JTI denylist) |
| GET | `/auth/me` | any | Current user + permissions |
| POST | `/auth/change-password` | any | Rotates `token_version` (signs out other sessions) |
| GET | `/roles` | pos:read | Role → permission matrix |
| GET/POST | `/users` | users:manage | List / create |
| PATCH | `/users/{id}` | users:manage | Edit role/email/name, activate/deactivate |
| POST | `/users/{id}/reset-password` | users:manage | Admin password reset |
| GET | `/pos` | pos:read | Search `q`, filter `status/store/brand`, `sort/order`, `page/page_size` |
| POST | `/pos` | pos:write | Create |
| GET/PATCH/DELETE | `/pos/{id}` | read / write / delete | Detail, edit, delete |
| POST | `/pos/bulk-delete` | pos:delete | `{ids:[…]}` |
| POST | `/pos/import` | pos:import | CSV upload, `update_existing` |
| GET | `/pos/export` | pos:import | CSV (formula-injection safe) |
| GET | `/pos/facets` · `/pos/lookup` | pos:read | Filter values · typeahead |
| GET | `/pos/{id}/deployments` | jobs:read | Per-POS deployment history incl. output |
| POST | `/deployments/uploads` | xml:upload | Multi-file XML upload → validated preview batch |
| DELETE | `/deployments/uploads/{batch_id}` | xml:upload | Discard an unused batch |
| POST | `/deployments` | jobs:run | Create job `{batch_id, items:[{file_id,pos_id}]}` → queued |
| GET | `/deployments/jobs` | jobs:read | `view=all|running|failed`, `q`, paging |
| GET | `/deployments/jobs/{id}` | jobs:read | Job + per-POS results |
| GET | `/deployments/results/{id}` | jobs:read | Full Ansible output / error |
| POST | `/deployments/jobs/{id}/retry` | jobs:run | Retry all failed/cancelled POS |
| POST | `/deployments/results/{id}/retry` | jobs:run | Retry one POS |
| POST | `/deployments/jobs/{id}/cancel` | jobs:run | Cancel pending + stop running Ansible |
| GET | `/audit-logs` · `/audit-logs/actions` · `/audit-logs/export` | audit:read | Search/filter/export |
| GET | `/dashboard/summary` | pos:read | Cards, 14-day trend, store health, activity |
| GET | `/system/info` | system:read | Non-secret config, worker status |
| GET | `/health` · `/health/ready` | public | Liveness / readiness |

## 5. RBAC

| Permission | Admin | Operator | Viewer |
|---|:-:|:-:|:-:|
| Manage users | ✓ | | |
| View POS | ✓ | ✓ | ✓ |
| Add / edit POS | ✓ | ✓ | |
| Delete POS | ✓ | | |
| Import / export POS | ✓ | ✓ | |
| Upload XML | ✓ | ✓ | |
| Run / retry / cancel jobs | ✓ | ✓ | |
| View job history | ✓ | ✓ | ✓ |
| View audit logs | ✓ | | |
| View system settings | ✓ | | |

Roles live in `backend/app/core/rbac.py`, so changes go through code review. Enforcement is server-side on every endpoint; the UI only hides controls a user cannot use.

## 6. Authentication design
- **Argon2id** password hashing (auto-rehash on login when parameters change), constant-time path for unknown users.
- **JWT in an httpOnly, SameSite=Strict, Secure cookie** — not readable by JavaScript, so XSS cannot steal it.
- **CSRF:** double-submit token whose HMAC is embedded in the JWT, so a forged cookie is useless.
- **Sliding sessions** (re-issued after half-life). Logout writes the JTI to a Redis denylist. `token_version` invalidates all sessions on password change, deactivation or role change.
- **Brute-force protection:** NGINX `limit_req` on `/auth/login`, Redis per-IP limit, and per-account lockout after N failures.
