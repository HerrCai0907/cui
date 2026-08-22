# CUI

CUI is a coding agents UI designed for better collaboration between humans and AI.

## Development

```sh
npm install
npm run build
npm run start
```

The web app runs at `http://localhost:5173` and proxies API requests to the backend at `http://localhost:3000`.
Use `npm run start -- --port 5174` to start the web app on a different port.
Use `npm run start -- --api-port 3001` to start the API on a different port.

## Scripts

```sh
npm run dev
npm run start
npm run start -- --port 5174
npm run build
npm run typecheck
npm run test:e2e
```
