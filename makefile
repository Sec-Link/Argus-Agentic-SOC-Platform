# Makefile
.PHONY: rebuild redeploy clean

rebuild:
	docker-compose up --build -d

redeploy:
	docker-compose down && docker-compose up --build -d

clean:
	docker-compose down --volumes --rmi all

clean-rebuild:
	docker-compose down --volumes --rmi all && docker-compose up --build -d

logs:
	docker-compose logs -f

restart:
	docker-compose restart

build-dev:
	docker-compose -f docker-compose.dev.yml up --build -d

build-prod:
	docker-compose -f docker-compose.prod.yml up --build -d

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
restart-dev:
	docker-compose -f docker-compose.dev.yml restart
restart-prod:
	docker-compose -f docker-compose.prod.yml restart