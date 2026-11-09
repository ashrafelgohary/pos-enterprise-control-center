#!/bin/sh
set -e
echo "Applying database migrations..."
alembic upgrade head
python -m app.cli bootstrap
exec gunicorn app.main:app \
  -k uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --workers "${API_WORKERS:-4}" \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-*}" \
  --access-logfile - --timeout 120
