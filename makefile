# Makefile
# Repository prefix, including the namespace; do not include a URL scheme.
IMAGE_REGISTRY ?= docker.io/library
export IMAGE_REGISTRY

.PHONY: rebuild redeploy clean
.PHONY: build-dev build-prod
.PHONY: build-backend-dev build-backend-prod build-frontend-dev build-frontend-prod
.PHONY: stop-dev stop-prod start-dev start-prod

build-dev:
	@printf '%s\n' 'WARNING: argus_backend_app will be cleared and replaced. Pause all Prefect workers using it first.'
	docker-compose -f docker-compose.dev.yml build backend backend-app-init frontend
	docker-compose -f docker-compose.dev.yml stop backend
	docker-compose -f docker-compose.dev.yml up -d db
	docker-compose -f docker-compose.dev.yml run --rm --no-deps backend-app-init
	docker-compose -f docker-compose.dev.yml up -d --no-deps --force-recreate backend frontend

build-prod:
	@printf '%s\n' 'WARNING: argus_backend_app will be cleared and replaced. Pause all Prefect workers using it first.'
	docker-compose -f docker-compose.prod.yml build backend backend-app-init frontend
	docker-compose -f docker-compose.prod.yml stop backend
	docker-compose -f docker-compose.prod.yml up -d db
	docker-compose -f docker-compose.prod.yml run --rm --no-deps backend-app-init
	docker-compose -f docker-compose.prod.yml up -d --no-deps --force-recreate backend frontend

# Partial updates require the other services to be running already.
build-backend-dev:
	@printf '%s\n' 'WARNING: argus_backend_app will be cleared and replaced. Pause all Prefect workers using it first.'
	docker-compose -f docker-compose.dev.yml build backend backend-app-init
	docker-compose -f docker-compose.dev.yml stop backend
	docker-compose -f docker-compose.dev.yml run --rm --no-deps backend-app-init
	docker-compose -f docker-compose.dev.yml up -d --no-deps --no-build --force-recreate backend

build-backend-prod:
	@printf '%s\n' 'WARNING: argus_backend_app will be cleared and replaced. Pause all Prefect workers using it first.'
	docker-compose -f docker-compose.prod.yml build backend backend-app-init
	docker-compose -f docker-compose.prod.yml stop backend
	docker-compose -f docker-compose.prod.yml run --rm --no-deps backend-app-init
	docker-compose -f docker-compose.prod.yml up -d --no-deps --no-build --force-recreate backend

build-frontend-dev:
	docker-compose -f docker-compose.dev.yml build frontend
	docker-compose -f docker-compose.dev.yml up -d --no-deps --no-build --force-recreate frontend

build-frontend-prod:
	docker-compose -f docker-compose.prod.yml build frontend
	docker-compose -f docker-compose.prod.yml up -d --no-deps --no-build --force-recreate frontend

redeploy-dev:
	docker-compose -f docker-compose.dev.yml down && docker-compose -f docker-compose.dev.yml up --build -d

redeploy-prod:
	docker-compose -f docker-compose.prod.yml down && docker-compose -f docker-compose.prod.yml up --build -d

clean-dev:
	docker-compose -f docker-compose.dev.yml down --volumes --rmi all

clean-prod:
	docker-compose -f docker-compose.prod.yml down --volumes --rmi all

clean-rebuild-dev:
	docker-compose -f docker-compose.dev.yml down --volumes --rmi all && docker-compose -f docker-compose.dev.yml up --build -d

clean-rebuild-prod:
	docker-compose -f docker-compose.prod.yml down --volumes --rmi all && docker-compose -f docker-compose.prod.yml up --build -d

logs-dev:
	docker-compose -f docker-compose.dev.yml logs -f
logs-prod:
	docker-compose -f docker-compose.prod.yml logs -f

stop-dev:
	docker-compose -f docker-compose.dev.yml stop

stop-prod:
	docker-compose -f docker-compose.prod.yml stop

# Resume application services only; never restart the destructive initializer.
start-dev:
	docker-compose -f docker-compose.dev.yml start db backend frontend

start-prod:
	docker-compose -f docker-compose.prod.yml start db backend frontend

restart-dev:
	docker-compose -f docker-compose.dev.yml restart
restart-prod:
	docker-compose -f docker-compose.prod.yml restart
