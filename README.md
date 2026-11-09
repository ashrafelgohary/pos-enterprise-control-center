# POS Control Center

An internal platform for managing POS devices across retail stores. You can register and monitor POS terminals, drag and drop XML configuration files, match them to devices, and deploy them through **your existing Ansible playbook**. Every job is tracked per POS in real time, and every action is audited.

| Layer | Technology |
|---|---|
| Frontend | React 18 · TypeScript · Mantine 7 · TanStack Query · Vite |
| API | Python 3.12 · FastAPI · SQLAlchemy 2 · Pydantic 2 |
| Database | PostgreSQL 16 (Alembic migrations) |
| Jobs | Celery 5 + Redis 7 (worker + beat) |
| Automation | ansible-runner 2.4 + ansible-core 2.16 → your playbook, unchanged |
| Delivery | Docker Compose · NGINX (unprivileged) |

Diagrams, ERD, the full API and the security design are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project structure

```
pos-control-center/
├── docker-compose.yml / docker-compose.dev.yml
├── .env.example · Makefile · scripts/init-secrets.sh
├── secrets/                 # Docker secrets (git-ignored) → worker only
├── docs/                    # ARCHITECTURE.md, pos-import-sample.csv
├── backend/
│   ├── Dockerfile           # targets: api, worker
│   ├── alembic/versions/    # 0001_initial_schema.py
│   ├── ansible/             # ◀ INTEGRATION POINT – put your project here
│   └── app/
│       ├── core/            # config, security, rbac, rate_limit
│       ├── models/ schemas/ # DB models, Pydantic schemas
│       ├── api/v1/          # auth, users, pos, deployments, audit, dashboard, system
│       ├── services/        # ansible_service, deployment_service, xml_service, pos, audit, health
│       └── worker/          # celery_app, tasks
└── frontend/
    ├── Dockerfile · nginx.conf
    └── src/ api/ auth/ components/ pages/
```

## Quick start (production)

```bash
make init                                   # .env with random keys + empty secret files
vi .env                                     # review ALLOWED_HOSTS, COOKIE_SECURE, ANSIBLE_*, INITIAL_ADMIN_*
echo -n 'ssh-password'  > secrets/ansible_ssh_password      # what you type for -k
echo -n 'sudo-password' > secrets/ansible_become_password   # what you type for -K
sudo chown 1000:1000 secrets/ansible_* && chmod 600 secrets/ansible_*

cp -r /path/to/POS_XML_Automation/ansible/* backend/ansible/   # your site.yml, roles/, group_vars/

make build && make up
make logs
```

Open `http://<docker-host>:8080`, sign in with the initial admin, change the password (Settings → Security), then remove `INITIAL_ADMIN_PASSWORD` from `.env`. Migrations run automatically on API start.

### Behind your NGINX host (TLS)
```nginx
server {
    listen 443 ssl;
    server_name poscc.alshaya.eg.local;
    ssl_certificate     /etc/nginx/certs/poscc.crt;
    ssl_certificate_key /etc/nginx/certs/poscc.key;
    client_max_body_size 200m;
    location / {
        proxy_pass http://<docker-host>:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 300s;
    }
}
```
Keep `COOKIE_SECURE=true` behind TLS. Set it to `false` only for a plain-HTTP lab.

## Integrating your playbook

The worker mounts `backend/ansible/` read-only at `/ansible` and runs `ANSIBLE_PLAYBOOK` (default `site.yml`). This is equivalent to:
```
ansible-playbook -i <generated inventory> site.yml --limit POS001,POS002 -k -K -u $ANSIBLE_USER
```
Hosts come from the database in group `pos` (`ANSIBLE_INVENTORY_GROUP`), so your play's `hosts:` must be `pos` or `all`. Your `inventory/group_vars` and `host_vars` are linked into each run.

| Variable per host | Example |
|---|---|
| `inventory_hostname`, `pos_hostname`, `target_pos` | `POS001` |
| `ansible_host`, `pos_ip` | `10.148.101.11` |
| `xml_src_path` | `/data/uploads/<batch>/POS001.xml` |
| `xml_filename` | `POS001.xml` |
| `pos_store`, `pos_brand`, `pos_id` | metadata |
| `poscc_job_id`, `poscc_run_id` | extra vars |

To avoid editing your playbook:
- `ANSIBLE_VAR_MAP={"xml_src_path":"your_var"}` aliases variable names.
- `ANSIBLE_STAGE_PATH_TEMPLATE=/ansible-staging/{hostname}/{filename}` stages files first, like `stage_pos_xmls.py`.
- `ANSIBLE_EXTRA_VARS={...}` adds static vars.

A host is **SUCCESS** when it is processed with no failed or unreachable tasks (`ignore_errors` tasks don't count). Otherwise it is **FAILED**, with the first failing task as the error. ansible-core 2.16 still manages Python 2.7/3.6 POS.

## Using it
1. **POS Management**: add devices or import `docs/pos-import-sample.csv`. Status refreshes via a TCP check on port 22.
2. **Deployments → New**: drop XML files, then Validate. Files are matched by filename or by XML content. Fix unmatched rows, then Start.
3. **Job page**: live progress per POS, Ansible output and errors, retry per POS or all, and cancel.
4. **History / Failed / Running**: open any job for its detail.
5. **Administration**: users, the role matrix, and audit logs (with CSV export).

## Development
```bash
make init        # set COOKIE_SECURE=false for http://localhost
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build postgres redis api worker beat
cd frontend && npm install && npm run dev        # http://localhost:5173
docker compose exec api python -m app.cli seed-demo
docker compose exec api alembic revision --autogenerate -m "change"
```

## Offline / isolated servers
Build where internet (or internal mirrors via `--build-arg PIP_INDEX_URL=` / `NPM_REGISTRY=`) is available, then either run `make save`, copy the archive and `make load`, or set `REGISTRY=harbor.alshaya.eg.local/infra` and run `make build push`.

## Operations
| Task | Command |
|---|---|
| Scale workers | `docker compose up -d --scale worker=3` |
| Backup | `docker compose exec postgres pg_dump -U poscc poscc \| gzip > poscc-$(date +%F).sql.gz` |
| Restore | `gunzip -c file.sql.gz \| docker compose exec -T postgres psql -U poscc poscc` |
| Upgrade | `git pull && make build && make up` |

**Checklist:** strong `SECRET_KEY` · TLS + `COOKIE_SECURE=true` · restrict `ALLOWED_HOSTS` · remove `INITIAL_ADMIN_PASSWORD` · secrets `chmod 600` · port 8080 reachable only from the proxy · scheduled `pg_dump`.
