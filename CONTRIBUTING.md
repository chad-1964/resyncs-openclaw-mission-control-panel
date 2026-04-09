# Contributing to Mission Control for OpenClaw

First off — thank you for considering contributing. Whether it's a bug fix, new feature, documentation improvement, or just a typo correction, every contribution helps make Mission Control better for the entire OpenClaw community.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [How to Contribute](#how-to-contribute)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)

## Code of Conduct

This project follows a simple rule: **be respectful.** We're all here to build something useful. Harassment, trolling, or unconstructive behavior won't be tolerated. Be the kind of contributor you'd want on your own project.

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/chad-1964/resyncs-openclaw-mission-control-panel.git
   cd mission-control-openclaw
   ```
3. **Create a branch** for your work:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Setup

### Prerequisites

- Node.js 20+ (22.x LTS recommended)
- npm 10+
- One of: MariaDB 10.11+, MySQL 8+, PostgreSQL 15+, or SQLite (bundled)
- Docker + Docker Compose (optional, for containerized development)

### Local Development (Recommended for Quick Iteration)

```bash
npm install
cp .env.example .env
# Edit .env — set STORAGE_MODE=memory for quick dev without a DB server
npm run dev
```

This starts the dev server at `http://localhost:3000` with hot reload.

### Docker Development

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up
```

### Running Tests

```bash
npm test              # Run full test suite
npm run test:watch    # Watch mode for development
npm run test:coverage # Generate coverage report
```

## Project Structure

```
mission-control-openclaw/
├── client/              # React frontend
│   ├── src/
│   │   ├── components/  # Reusable UI components
│   │   ├── pages/       # Page-level components
│   │   ├── hooks/       # Custom React hooks
│   │   ├── utils/       # Frontend utilities
│   │   └── styles/      # CSS / styling
│   └── public/          # Static assets
├── server/              # Express backend
│   ├── routes/          # API route handlers
│   ├── middleware/       # Express middleware
│   ├── services/        # Business logic
│   ├── models/          # Database models
│   ├── migrations/      # Database migrations
│   └── utils/           # Server utilities
├── installer/           # One-click installer scripts
├── docs/                # Documentation
├── tests/               # Test files
├── docker-compose.yml   # Production Docker config
├── docker-compose.dev.yml # Development Docker config
└── .env.example         # Environment variable template
```

## How to Contribute

### Types of Contributions We Welcome

- **Bug fixes** — Found something broken? Fix it and submit a PR.
- **Features** — Check the [Roadmap](README.md#roadmap) or open issues tagged `enhancement` for ideas.
- **Documentation** — Better docs help everyone. Typo fixes, clarifications, new guides — all welcome.
- **Tests** — More test coverage is always appreciated.
- **Translations** — Help make Mission Control accessible in more languages.
- **Database adapters** — Support for additional database engines.

### What's Off-Limits in the Free Core

The following features are part of the Pro tiers and should not be implemented in the open-source core:

- Multi-user / team management
- Hermes self-learning integration
- Plugin architecture and plugin marketplace
- Per-user budget controls and approval workflows

If you're unsure whether something belongs in the core or Pro tier, open an issue to discuss before starting work.

## Pull Request Process

1. **Update documentation** if your change affects how users interact with Mission Control.
2. **Add tests** for new functionality.
3. **Run the full test suite** and make sure everything passes:
   ```bash
   npm test
   npm run lint
   ```
4. **Write a clear PR description** explaining what changed and why.
5. **Reference any related issues** using `Fixes #123` or `Closes #123`.
6. **Keep PRs focused.** One feature or fix per PR. Large, multi-purpose PRs are harder to review and more likely to stall.

### PR Review

- A maintainer will review your PR within a few days.
- You may be asked to make changes — that's normal and not a rejection.
- Once approved, a maintainer will merge your PR.

## Coding Standards

### General

- Use **ES modules** (`import`/`export`), not CommonJS (`require`).
- Use `async/await` over raw Promises or callbacks.
- Always use the `apiRequest()` helper for API calls — never raw `fetch()`.
- **Hash-based routing only** — do not convert to path-based routing.

### Naming

- **Files**: `kebab-case.js`
- **Components**: `PascalCase.jsx`
- **Functions / variables**: `camelCase`
- **Constants**: `UPPER_SNAKE_CASE`
- **Database columns**: `snake_case`

### Frontend

- React functional components only — no class components.
- Keep components focused and composable.
- Use the existing UI component library before adding new dependencies.

### Backend

- All routes go through the Express router in `server/routes/`.
- Database queries go through the model layer — no raw SQL in route handlers.
- All new endpoints need input validation middleware.
- Migrations must be **idempotent** — safe to run multiple times.

### Commits

Write clear, descriptive commit messages:

```
feat: add PostgreSQL connection pooling
fix: resolve encrypted key decryption on SQLite
docs: update Docker setup instructions
chore: bump Node.js minimum to 20.x
```

Use conventional commit prefixes: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, `style`.

## Reporting Bugs

[Open a bug report](https://github.com/chad-1964/resyncs-openclaw-mission-control-panel/issues/new?template=bug_report.md) and include:

- **What happened** vs. **what you expected**
- **Steps to reproduce**
- **Environment details** — OS, Node.js version, database type and version, browser
- **Logs** — relevant error output from the console or PM2 logs

## Requesting Features

[Open a feature request](https://github.com/chad-1964/resyncs-openclaw-mission-control-panel/issues/new?template=feature_request.md) and describe:

- **The problem** you're trying to solve
- **Your proposed solution**
- **Alternatives** you've considered
- Whether this belongs in the **free core** or **Pro tier**

---

Thanks for contributing. Every PR, issue, and suggestion makes Mission Control better for the OpenClaw community.
