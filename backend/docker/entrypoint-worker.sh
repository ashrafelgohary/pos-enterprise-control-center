#!/bin/sh
set -e
case "$1" in
  worker)
    exec celery -A app.worker.celery_app worker -Q deployments,maintenance \
      --concurrency "${WORKER_CONCURRENCY:-4}" --loglevel "${LOG_LEVEL:-INFO}" -n "worker@%h" ;;
  beat)
    exec celery -A app.worker.celery_app beat --loglevel "${LOG_LEVEL:-INFO}" -s /tmp/celerybeat-schedule ;;
  *)
    exec "$@" ;;
esac
