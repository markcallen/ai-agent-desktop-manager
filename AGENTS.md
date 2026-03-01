# AGENTS.md

This file provides guidance to Codex (CLI and app) for working in this repository.

## Installed agent rules

Read and follow these rule files in `.codex/rules/` when they apply:

- `.codex/rules/linting.md` — TypeScript linting specialist - implements comprehensive linting and code formatting for TypeScript/JavaScript projects
- `.codex/rules/local-dev-badges.md` — Add standard badges (CI, Release, License, GitHub Release, npm) to the top of README.md
- `.codex/rules/local-dev-env.md` — Local development environment specialist - reproducible dev setup, DX, and documentation
- `.codex/rules/local-dev-license.md` — License setup - ensure LICENSE file, package.json license field, and README reference (default MIT; overridable in AGENTS.md/CLAUDE.md)
- `.codex/rules/local-dev-mcp.md` — Optional: use GitHub MCP and issues MCP (Jira/Linear/GitHub) for local-dev context
- `.codex/rules/cicd.md` — CI/CD specialist - pipeline design, quality gates, and deployment
- `.codex/rules/observability.md` — Observability specialist - logging, tracing, metrics, and SLOs
- `.codex/rules/logging.md` — Centralized logging specialist - configures Pino with Fluentd for Node/Next.js, and pino-browser to /api/logs
