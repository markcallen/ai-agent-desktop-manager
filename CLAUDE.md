# CLAUDE.md

This file provides guidance to Claude Code for working in this repository.

## Installed agent rules

Created by [Ballast](https://github.com/everydaydevopsio/ballast) v5.4.2. Do not edit this section.

Read and follow these rule files in `.claude/rules/` when they apply:

- `.claude/rules/local-dev-badges.md` — Add standard badges (CI, Release, License, GitHub Release, npm) to the top of README.md
- `.claude/rules/local-dev-env.md` — Local development environment specialist - reproducible dev setup, DX, and documentation
- `.claude/rules/local-dev-license.md` — License setup - ensure LICENSE file, package.json license field, and README reference (default MIT; overridable in AGENTS.md/CLAUDE.md)
- `.claude/rules/local-dev-mcp.md` — Optional: use GitHub MCP and issues MCP (Jira/Linear/GitHub) for local-dev context
- `.claude/rules/docs.md` — Documentation specialist - GitHub Markdown docs by default, or maintain existing Docusaurus sites with publish-docs automation
- `.claude/rules/cicd.md` — CI/CD specialist - pipeline design, quality gates, and deployment
- `.claude/rules/observability.md` — Observability specialist - logging, tracing, metrics, and SLOs
- `.claude/rules/publishing-apps.md` — App publishing specialist - npmjs for Node apps, PyPI for Python apps, GitHub Releases for Go apps
- `.claude/rules/publishing-libraries.md` — Library publishing specialist - npmjs for TypeScript, PyPI for Python, GitHub tags/releases for Go
- `.claude/rules/publishing-sdks.md` — SDK publishing specialist - npmjs for TypeScript SDKs, PyPI for Python SDKs, GitHub tags/releases for Go SDKs
- `.claude/rules/typescript-linting.md` — TypeScript linting specialist - implements comprehensive linting and code formatting for TypeScript/JavaScript projects
- `.claude/rules/typescript-logging.md` — Centralized logging specialist - configures Pino with Fluentd for Node/Next.js, and pino-browser to /api/logs
- `.claude/rules/typescript-testing.md` — Testing specialist - sets up Jest (default) or Vitest for Vite projects, 50% coverage, and test step in build GitHub Action
