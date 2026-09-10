# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
