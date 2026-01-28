# Copilot Development Instructions

## Makefile Usage (MANDATORY)

Always use the Makefile for development tasks. Never run raw `pytest`, `ruff`, or `bun` commands directly.

### Quick Reference

| Task | Command | Description |
|------|---------|-------------|
| Run tests | `make test` | Run pytest |
| Run linter | `make lint` | Run ruff linter |
| Format code | `make format` | Auto-format with ruff |
| Full check | `make check` | Run lint + coverage |
| Coverage report | `make coverage` | Run pytest with coverage |
| Build frontend | `make build` | TypeScript typecheck + bundle |
| Quick frontend build | `make build-fast` | Bundle without typecheck |
| Watch mode | `make bundle-watch` | Frontend dev with auto-rebuild |
| Install dev deps | `make install-dev` | Install package + dev dependencies |
| Clean build | `make build-all` | Full reproducible build from scratch |
| See all targets | `make help` | Show all available commands |

### Development Workflow

1. **Before making changes**: Run `make check` to establish baseline
2. **After making changes**: Run `make check` to verify no regressions
3. **Frontend changes**: Use `make build` or `make build-fast`
4. **Full rebuild**: Use `make build-all` (cleans everything first)

### Clean Targets

- `make clean` - Remove Python cache files only
- `make bundle-clean` - Remove frontend build artifacts (node_modules, etc.)
- `make clean-all` - Remove everything

### Version Management

- `make bump-patch` - Bump patch version and create git tag

## Testing Guidelines

- Aim for good test coverage
- Review tests periodically to consolidate/parameterize and remove redundancy
- Use fixtures from `tests/conftest.py` instead of duplicating setup code
- Prefer parameterized tests for similar test cases

## Code Style

- Do not use heredocs or random shell commands
- Prefer `make` and ecosystem tools (pip, bun) over manual operations
- Debug issues systematically - search for and review documentation as needed
