COMPOSE ?= docker compose
TAG ?= 1.0.0

.PHONY: init build up down ps logs migrate seed-demo save load push

init:            ## create .env + secret files
	./scripts/init-secrets.sh
build:           ## build all images
	$(COMPOSE) build
up:              ## start the stack
	$(COMPOSE) up -d
down:
	$(COMPOSE) down
ps:
	$(COMPOSE) ps
logs:
	$(COMPOSE) logs -f --tail=200 api worker
migrate:         ## apply DB migrations manually
	$(COMPOSE) exec api alembic upgrade head
seed-demo:       ## optional demo POS data (dev only)
	$(COMPOSE) exec api python -m app.cli seed-demo
save:            ## export images for an offline host
	docker save local/poscc-api:$(TAG) local/poscc-worker:$(TAG) local/poscc-web:$(TAG) postgres:16-alpine redis:7-alpine | gzip > poscc-images-$(TAG).tar.gz
load:
	gunzip -c poscc-images-$(TAG).tar.gz | docker load
push:            ## push to your internal registry (set REGISTRY in .env)
	$(COMPOSE) push api worker web
