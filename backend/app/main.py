import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.core.logging import configure_logging

configure_logging()
log = logging.getLogger("app")

app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    docs_url=f"{settings.api_prefix}/docs" if settings.is_dev else None,   # no public docs in production
    redoc_url=None,
    openapi_url=f"{settings.api_prefix}/openapi.json" if settings.is_dev else None,
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Cache-Control", "no-store")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    return response


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    errors = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": errors[0]["message"] if errors else "Invalid request", "errors": errors})


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})  # never leak stack traces


app.include_router(api_router, prefix=settings.api_prefix)
