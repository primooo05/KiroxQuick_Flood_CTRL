# Setup

## Prerequisites

- Node.js (developed on Node 24) and npm.
- A Mapbox account and a public access token (`pk....`).

## Install & run

```bash
npm install
cp .env.example ..env.local
# edit ..env.local and set VITE_MAPBOX_ACCESS_TOKEN to your real token
npm run dev
```

The Vite dev server runs on http://localhost:5173.

## Environment

- `.env.example` (committed) holds the placeholder `VITE_MAPBOX_ACCESS_TOKEN=your_mapbox_access_token_here`.
- `.env.local` (gitignored) holds your real token. Never commit it. `.env`, `.env.local`, and `.env.*.local` are all ignored.
- The token is read via `import.meta.env.VITE_MAPBOX_ACCESS_TOKEN` and applied to the map at construction.

Windy Webcams API v3 is integrated through the Node camera proxy. Set `WINDY_WEBCAMS_API_KEY` in `.env.local`; it is read by the server and must never use a `VITE_` prefix. `npm run dev` starts the Vite app and local proxy together. Production runs `npm run build` followed by `npm start` in a Node 24 environment. Camera metadata requests follow the map viewport; open image popups renew one webcam's signed URL every seven minutes, and the proxy caches viewport results for five minutes. Follow Windy's image URL validity, attribution, advertising, and usage terms.

## Quality checks

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run format
```

## Troubleshooting

- **Blank map / config-incomplete message:** no valid token in `.env.local`. Set `VITE_MAPBOX_ACCESS_TOKEN` and restart the dev server.
- **Tiles fail to load with a valid token:** confirm the token is a public token and that your Mapbox account/billing allows the requested styles/tiles.
- **Build chunk-size advisory:** expected — the Mapbox GL JS vendor chunk exceeds the default warning threshold. It does not fail the build.
