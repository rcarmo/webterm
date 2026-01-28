.PHONY: help install install-dev lint format test coverage check clean clean-all build build-all bundle bundle-watch bundle-clean typecheck bump-patch

PYTHON ?= python3
PIP ?= $(PYTHON) -m pip

# Static assets
STATIC_JS_DIR = src/webterm/static/js
TERMINAL_JS = $(STATIC_JS_DIR)/terminal.js
TERMINAL_TS = $(STATIC_JS_DIR)/terminal.ts
GHOSTTY_WASM = $(STATIC_JS_DIR)/ghostty-vt.wasm

help:
	@echo "Build targets:"
	@echo "  build-all    - Full reproducible build (clean + deps + bundle + install)"
	@echo "  build        - Build frontend (typecheck + bundle)"
	@echo "  build-fast   - Build frontend without typecheck"
	@echo "  bundle       - Alias for build"
	@echo "  bundle-watch - Watch mode for development"
	@echo "  typecheck    - Run TypeScript type checking"
	@echo ""
	@echo "Python targets:"
	@echo "  install      - Install package in editable mode"
	@echo "  install-dev  - Install with dev dependencies"
	@echo "  lint         - Run ruff linter"
	@echo "  format       - Format code with ruff"
	@echo "  test         - Run pytest"
	@echo "  coverage     - Run pytest with coverage"
	@echo "  check        - Run lint + coverage"
	@echo ""
	@echo "Clean targets:"
	@echo "  clean        - Remove Python cache files"
	@echo "  bundle-clean - Remove frontend build artifacts"
	@echo "  clean-all    - Remove everything (clean + bundle-clean)"

# =============================================================================
# Full reproducible build
# =============================================================================

build-all: clean-all node_modules build install-dev check
	@echo "Build complete!"

# =============================================================================
# Python targets
# =============================================================================

install:
	$(PIP) install -e .

install-dev:
	$(PIP) install -e .
	$(PIP) install pytest pytest-asyncio pytest-cov pytest-timeout ruff

lint:
	ruff check src tests

format:
	ruff format src tests

test:
	pytest

coverage:
	pytest --cov=src/webterm --cov-report=term-missing

check: lint coverage

# =============================================================================
# Frontend build targets (requires Bun: https://bun.sh)
# All frontend commands MUST go through bun run to ensure consistency
# =============================================================================

# Install node dependencies (creates bun.lock if missing)
node_modules: package.json
	bun install
	@touch node_modules

# TypeScript type checking
typecheck: node_modules
	bun run typecheck

# Main build target - typecheck + bundle + copy WASM
build: node_modules
	bun run build

# Fast build without typecheck (for rapid iteration)
build-fast: node_modules
	bun run build:fast
	@test -f $(GHOSTTY_WASM) || bun run copy-wasm

# Alias for build
bundle: build

# Watch mode for development
bundle-watch: node_modules
	@test -f $(GHOSTTY_WASM) || bun run copy-wasm
	bun run watch

# =============================================================================
# Clean targets
# =============================================================================

clean:
	rm -rf .pytest_cache .coverage htmlcov .ruff_cache __pycache__ src/**/__pycache__

bundle-clean:
	rm -rf node_modules bun.lock $(TERMINAL_JS) $(GHOSTTY_WASM)

clean-all: clean bundle-clean

# =============================================================================
# Version management
# =============================================================================

# Bump patch version (e.g., 0.5.3 -> 0.5.4)
bump-patch:
	@OLD=$$(grep -Po '(?<=^version = ")[^"]+' pyproject.toml); \
	MAJOR=$$(echo $$OLD | cut -d. -f1); \
	MINOR=$$(echo $$OLD | cut -d. -f2); \
	PATCH=$$(echo $$OLD | cut -d. -f3); \
	NEW="$$MAJOR.$$MINOR.$$((PATCH + 1))"; \
	sed -i "s/^version = \"$$OLD\"/version = \"$$NEW\"/" pyproject.toml; \
	echo "Bumped version: $$OLD -> $$NEW"
