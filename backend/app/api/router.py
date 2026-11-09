from fastapi import APIRouter

from app.api.v1 import audit, auth, dashboard, deployments, pos, sso, system, users
from app.api.v1 import deployment_email, notification_settings, stores

api_router = APIRouter()
for r in (auth.router, sso.router, users.router, pos.router, deployments.router, audit.router, dashboard.router, system.router):
    api_router.include_router(r)

for r in (stores.router, notification_settings.router, deployment_email.router):
    api_router.include_router(r)

from app.api.v1 import job_email
api_router.include_router(job_email.router)
