# CUI

CUI is a coding agents UI designed for better collaboration between humans and AI.

## Development

```sh
npm install
npm run build
npm run start
```

The production preview web app runs at `http://localhost:5173` and proxies API requests to the backend at `http://localhost:3000`.
Use `npm run start -- --port 5174` to start the web app on a different port.
Use `npm run start -- --api-port 3001` to start the API on a different port.
`npm run start` stores production data under the project root `prod/` directory by default: session data in `prod/data/sessions.json` and API logs in `prod/logs/`. Override those with `npm run start -- --store-path <path> --log-dir <path>` when needed.

End-to-end tests use separate default ports: Playwright starts the web app at `http://localhost:5174` and points its API proxy at `http://localhost:3001`. Override those with `PLAYWRIGHT_TEST_PORT`, `PLAYWRIGHT_TEST_API_PORT`, or `PLAYWRIGHT_TEST_BASE_URL` when needed.

## Scripts

```sh
npm run dev
npm run start
npm run start -- --port 5174
npm run start -- --store-path prod/data/local-sessions.json --log-dir prod/local-logs
npm run build
npm run typecheck
npm run test:e2e
```
