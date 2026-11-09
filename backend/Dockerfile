# syntax=docker/dockerfile:1.6
# Multi-target image: `api` (no Ansible) and `worker` (Ansible + ssh client).
ARG PYTHON_IMAGE=python:3.12-slim-bookworm

FROM ${PYTHON_IMAGE} AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
# Optional internal PyPI mirror for offline networks: --build-arg PIP_INDEX_URL=https://nexus.local/simple
ARG PIP_INDEX_URL
ARG PIP_TRUSTED_HOST
ENV PIP_INDEX_URL=${PIP_INDEX_URL} PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST}
RUN groupadd -g 1000 app && useradd -u 1000 -g app -m -s /usr/sbin/nologin app \
 && mkdir -p /data/uploads /data/runs && chown -R app:app /data
WORKDIR /app

FROM base AS api
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY --chown=app:app app ./app
COPY --chown=app:app alembic ./alembic
COPY --chown=app:app alembic.ini docker/entrypoint-api.sh ./
RUN chmod +x entrypoint-api.sh
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health')" || exit 1
ENTRYPOINT ["./entrypoint-api.sh"]

FROM base AS worker
RUN apt-get update && apt-get install -y --no-install-recommends openssh-client sshpass iputils-ping \
 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt requirements-worker.txt ./
RUN pip install -r requirements-worker.txt
COPY --chown=app:app app ./app
COPY --chown=app:app docker/entrypoint-worker.sh ./
RUN chmod +x entrypoint-worker.sh \
 && mkdir -p /ansible /ansible-staging /home/app/.ansible \
 && chown -R app:app /home/app /ansible-staging
USER app
ENTRYPOINT ["./entrypoint-worker.sh"]
CMD ["worker"]
