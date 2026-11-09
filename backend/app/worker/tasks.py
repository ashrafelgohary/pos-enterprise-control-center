import logging

from app.core.config import settings
from app.db.session import session_scope
from app.services import deployment_service, health_service
from app.services.ansible_service import AnsibleService
from app.worker.celery_app import celery_app

log = logging.getLogger(__name__)


@celery_app.task(name="app.worker.tasks.run_deployment", bind=True)
def run_deployment(self, job_id: int, result_ids: list[int] | None = None) -> None:
    log.info("deployment job %s picked up (task %s)", job_id, self.request.id)
    deployment_service.execute(session_scope, job_id, result_ids)


@celery_app.task(name="app.worker.tasks.health_checks", ignore_result=True)
def health_checks() -> dict:
    return health_service.run_health_checks()


@celery_app.task(name="app.worker.tasks.cleanup", ignore_result=True)
def cleanup() -> int:
    return AnsibleService.cleanup_old_runs(settings.keep_run_artifacts_days)
