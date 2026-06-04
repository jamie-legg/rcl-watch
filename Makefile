SHELL := /bin/bash

MATCH_ID ?= 69b85ba1c5015455ee9b0412
PORT ?= 3000
BASE_URL ?= http://localhost:$(PORT)
LOG_API := $(BASE_URL)/api/logs/$(MATCH_ID)
WATCH_URL := $(BASE_URL)/watch/$(MATCH_ID)

.DEFAULT_GOAL := help

.PHONY: help install dev build start lint check release-check audit clean clean-cache cache-demo smoke-api smoke-page smoke

help: ## Show available targets.
	@awk 'BEGIN {FS = ":.*## "; printf "\nwatch utilities\n\n"} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install npm dependencies from package-lock.json.
	npm ci

dev: ## Start the Next.js dev server. Override PORT=3001 if needed.
	npm run dev -- --port $(PORT)

build: ## Create a production Next.js build.
	npm run build

start: ## Start the production server after make build.
	npm run start -- --port $(PORT)

lint: ## Run ESLint.
	npm run lint

check: lint build ## Run the main local verification suite.

release-check: install check audit ## Fresh install, lint, build, and dependency audit before release.

audit: ## Run npm's dependency audit.
	npm audit

clean: ## Remove generated Next.js build artifacts.
	rm -rf .next out

clean-cache: ## Remove locally cached match-log API responses.
	rm -rf .cache/match-logs

cache-demo: ## Fetch the demo match through the app cache API.
	curl --fail --silent --show-error "$(LOG_API)" --output /tmp/watch-match-$(MATCH_ID).json
	@printf "cached bytes: "
	@wc -c /tmp/watch-match-$(MATCH_ID).json | awk '{print $$1}'

smoke-api: ## Verify the cached log API responds for MATCH_ID.
	@headers=$$(mktemp); body=$$(mktemp); \
	curl --fail --silent --show-error -D "$$headers" "$(LOG_API)" --output "$$body"; \
	printf "api bytes: "; wc -c "$$body" | awk '{print $$1}'; \
	awk 'tolower($$0) ~ /^x-watch-cache:/ || $$0 ~ /^HTTP\//' "$$headers"; \
	rm -f "$$headers" "$$body"

smoke-page: ## Verify the watch page responds for MATCH_ID.
	@headers=$$(mktemp); body=$$(mktemp); \
	curl --fail --silent --show-error -D "$$headers" "$(WATCH_URL)" --output "$$body"; \
	printf "page bytes: "; wc -c "$$body" | awk '{print $$1}'; \
	awk '$$0 ~ /^HTTP\//' "$$headers"; \
	rm -f "$$headers" "$$body"

smoke: smoke-api smoke-page ## Run API and page smoke checks against a running server.
