# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Quality metrics: successful-query P50/P95 latency, failure classification by stable
  error code, and per-step (LangGraph node) timing captured from SSE progress events;
  audit schema migrated to v2 in place.
- Evaluation suite expanded from 30 to 80 scenarios / 85 turns covering fuzzy phrasing,
  multi-turn references, empty results, out-of-scope refusals, per-account authorization
  (regional manager / analyst) and prompt-injection cases; the evaluator supports
  per-case credentials.
- Application containerization: backend image (uv + python 3.14, health self-check) and
  frontend multi-stage image (nginx with SPA fallback and SSE-aware `/api` proxy); the
  Compose `app` profile starts the full stack with one command while the default
  `up -d` behavior stays infrastructure-only.
- Deployment guide (`docs/deployment.md`), delivery materials with architecture /
  LangGraph / ER / sequence diagrams and a STAR narrative (`docs/delivery/`).
- Infrastructure host/port environment variables (`QDRANT_HOST`, `EMBEDDING_HOST/PORT`,
  `ES_HOST/PORT`) so the containerized backend can address services by name.
- Health endpoints: `/health/live` (process liveness) and `/health/ready` (per-dependency
  checks for MySQL/Qdrant/Elasticsearch/Embedding aggregated as healthy/degraded/unavailable).
- Unified REST error envelope (`code`/`message`/`request_id`/`details` with a compatible
  `detail` field) and `X-Request-ID` response header for request tracing.
- Stable SSE error events: known errors keep safe messages, unknown ones return generic text.
- Versioned SQLite migrations (`app/db/migrations.py`) with a `schema_migrations` ledger;
  legacy databases upgrade in place preserving data.
- Frontend unit tests with Vitest and Testing Library, wired into the unified quality gate
  and CI; covers SSE streams, cancellation, 401 expiry, auth hook and event reduction.
- Unified settings entry (`app/conf/settings.py`) with pure-function loading, explicit
  environment-variable overrides and two-phase validation.
- Startup validation that fails fast on missing `LLM_API_KEY`, `MYSQL_USER` or
  `MYSQL_PASSWORD`; error messages report variable names only, never values.
- `APP_ENV` environment variable (`dev` / `test` / `prod`, default `dev`).

### Changed

- Frontend `App.tsx` reduced from 1012 to 247 lines: auth/session/stream/analysis state moved
  into dedicated hooks, presentation split into workspace components; behaviour unchanged.
- Configuration is no longer loaded at import time; modules read config through
  `get_app_config()`, so tests do not depend on a local `.env` or injected CI variables.
- Replaced `${oc.env:...}` interpolation in `conf/app_config.yaml` with static defaults.
- Removed hardcoded test environment variables from the CI backend job.
- SQLite table access consolidated into repositories under `app/repositories/sqlite/`;
  services keep transaction and business-rule orchestration only.

### Fixed

- Pinned `asyncmy` at 0.2.14 in the lockfile so fresh clones install prebuilt cp314
  Windows wheels instead of failing a source build.
- Replaced `urlopen` with `httpx` plus target-URL validation in the evaluation script
  to resolve SSRF findings.

## [0.2.0] - 2026-09-10

### Added

- GitHub Actions quality gates for backend lint, backend tests and frontend builds.
- A single local quality-check entry point.
- Environment-based MySQL configuration shared by the app and Docker Compose.

### Changed

- Made the uv lockfile independent from an ignored local workspace.
- Excluded local verification artifacts and generated dependencies from Git.

[Unreleased]: https://github.com/mjj90200-glitch/shoper-agent/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/mjj90200-glitch/shoper-agent/releases/tag/v0.2.0
