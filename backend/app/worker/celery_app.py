from celery import Celery

from app.core.config import settings
from app.core.logging import configure_logging

configure_logging()

celery_app = Celery("poscc", broker=settings.redis_url, backend=settings.redis_url, include=["app.worker.tasks"])
celery_app.conf.update(
    task_serializer="json", accept_content=["json"], result_serializer="json",
    task_acks_late=True,                 # job re-queued if a worker dies mid-run
    worker_prefetch_multiplier=1,        # long-running tasks: no hoarding
    task_reject_on_worker_lost=True,
    task_time_limit=settings.ansible_timeout_seconds + 300,
    result_expires=86400,
    broker_connection_retry_on_startup=True,
    task_routes={
        "app.worker.tasks.run_deployment": {"queue": "deployments"},
        "app.worker.tasks.health_checks": {"queue": "maintenance"},
        "app.worker.tasks.cleanup": {"queue": "maintenance"},
    },
    beat_schedule={
        **({"pos-health": {"task": "app.worker.tasks.health_checks",
                           "schedule": float(settings.health_check_interval_seconds)}}
           if settings.health_check_enabled else {}),
        "cleanup-artifacts": {"task": "app.worker.tasks.cleanup", "schedule": 86400.0},
    },
)
