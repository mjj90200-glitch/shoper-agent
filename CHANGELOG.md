# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Unified settings entry (`app/conf/settings.py`) with pure-function loading, explicit
  environment-variable overrides and two-phase validation.
- Startup validation that fails fast on missing `LLM_API_KEY`, `MYSQL_USER` or
  `MYSQL_PASSWORD`; error messages report variable names only, never values.
- `APP_ENV` environment variable (`dev` / `test` / `prod`, default `dev`).

### Changed

- Configuration is no longer loaded at import time; modules read config through
  `get_app_config()`, so tests do not depend on a local `.env` or injected CI variables.
- Replaced `${oc.env:...}` interpolation in `conf/app_config.yaml` with static defaults.
- Removed hardcoded test environment variables from the CI backend job.

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
