# Development

This document covers local development for CUI. User-facing setup and feature screenshots live in [README.md](README.md).

## Prerequisites

- Node.js with npm
- A TRAEX-compatible environment available to the API process

Install dependencies from the repository root:

```sh
npm install
```

## Development Server

Start the web and API workspaces together:

```sh
npm run dev
```

The development web app runs at `http://localhost:5173/` by default. The Vite app proxies API requests to the backend.

## Production Preview

Build all workspaces and start from copied production artifacts:

```sh
npm run build
npm run start
```

`npm run build` writes normal workspace build outputs under `apps/*/dist`.

`npm run start` copies the latest web and API build outputs into `prod/web` and `prod/api`, then starts the service from those copied artifacts.

The production preview web app runs at `http://localhost:5173` and proxies API requests to the backend at `http://localhost:3000`.

Use a different web port:

```sh
npm run start -- --port 5174
```

Use a different API port:

```sh
npm run start -- --api-port 3001
```

## Local Data

`npm run start` stores production-preview data under the project root `prod/` directory by default:

- Session data: `prod/data/sessions.json`
- API logs: `prod/logs/`

Override those paths when needed:

```sh
npm run start -- --store-path prod/data/local-sessions.json --log-dir prod/local-logs
```

Development mode uses the API store defaults unless overridden through the environment.

## Scripts

```sh
npm run dev
npm run start
npm run start -- --port 5174
npm run start -- --store-path prod/data/local-sessions.json --log-dir prod/local-logs
npm run build
npm run typecheck
npm run test:unit
npm run test:e2e
npm run test:e2e:ui
```

## Testing

Run unit tests:

```sh
npm run test:unit
```

Run end-to-end tests:

```sh
npm run test:e2e
```

End-to-end tests use separate default ports: Playwright starts the web app at `http://localhost:5174` and points its API proxy at `http://localhost:3001`.

Override those with environment variables when needed:

```sh
PLAYWRIGHT_TEST_PORT=5175 PLAYWRIGHT_TEST_API_PORT=3002 npm run test:e2e
```

Use `PLAYWRIGHT_TEST_BASE_URL` when testing against an already-running web app.

## Generated API Types

When API schemas change, regenerate OpenAPI output and the web client types:

```sh
npm run openapi:generate
```

## Pull Requests

Commit messages should follow the Angular convention, for example:

```text
feat(scope): add review context expansion
fix(api): handle empty sessions
```

Before creating a pull request, rebase the current branch onto `origin/main` to reduce conflict risk:

```sh
git fetch origin
git rebase origin/main
```
