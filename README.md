# Quake BRWSR — Browser FPS

TypeScript / Vite / Babylon.js first-person shooter with an optional **server-authoritative multiplayer** free-for-all mode.

## Features

- Single-player arena (legacy local AI boxes)
- Multiplayer FFA (up to 12 players) over WebSockets
- Shared fixed-tick simulation (60 Hz) with client prediction and remote interpolation
- Server-authoritative rockets, damage, death, respawn, score, and match timer
- Complex multi-zone map (`reactor-atrium-v1`) with shared AABB collision
- One-process production hosting: Vite client + WebSocket server on the same origin

## Controls

| Input | Action |
| ----- | ------ |
| WASD | Move |
| Mouse | Look (pointer lock) |
| Left click / F | Fire rocket |
| Space | Jump |
| Shift | Dash |
| Tab | Scoreboard (multiplayer) |
| F3 | Perf overlay (multiplayer) |

## Quick start (development)

```bash
npm install

# Terminal 1 — dedicated server
npm run server:dev

# Terminal 2 — Vite client (http://localhost:3000)
npm run dev
```

Open the client, choose **Multiplayer**, set a display name, and join. On localhost the client discovers `http://localhost:8080`.

### Single-player only

Choose **Single Player** from the main menu (no server required).

## Local production (one process)

```bash
npm ci
npm run build
npm run server:build
NODE_ENV=production \
ALLOWED_ORIGINS=http://localhost:8080 \
PUBLIC_SERVER_URL=http://localhost:8080 \
PORT=8080 \
npm run server:start
```

Then open `http://localhost:8080/` — static client and `ws://…/ws` share that origin.

## Scripts

| Script | Purpose |
| ------ | ------- |
| `npm run dev` | Vite client |
| `npm run build` | Typecheck + client production build |
| `npm run server:dev` | Headless game server (watch) |
| `npm run server:build` | Bundle server to `dist-server/` |
| `npm run server:start` | Run production server bundle |
| `npm run test` | All Vitest suites |
| `npm run test:integration` | Client/server integration |
| `npm run test:load` | 12-player load test |

## Configuration

Copy `.env.example` to `.env`. Important variables:

- `PORT` / `SERVER_PORT` (Railway injects `PORT` — do not set it manually there)
- `ALLOWED_ORIGINS` (required exact origins in production; no `*`)
- `PUBLIC_SERVER_URL` (or rely on `RAILWAY_PUBLIC_DOMAIN`)
- `MAX_PLAYERS`, `MATCH_DURATION_SECONDS`, `SCORE_LIMIT`

## Railway

Deploy as **one service, one replica**, Dockerfile builder, healthcheck `/health`. See:

- [Deployment](docs/browser-multiplayer-deployment.md)
- [Railway audit](docs/railway-deployment-audit.md)
- [Railway implementation](docs/railway-deployment-implementation.md)

```text
Do not manually create PORT.
Railway injects PORT.
```

No Supabase, database, Redis, or volume — all match state is in memory.

## Documentation

- [Architecture](docs/browser-multiplayer-architecture.md)
- [Protocol](docs/browser-multiplayer-protocol.md)
- [Development](docs/browser-multiplayer-development.md)
- [Deployment](docs/browser-multiplayer-deployment.md)
- [Testing](docs/browser-multiplayer-testing.md)
- [Security](docs/browser-multiplayer-security.md)
- [Map design](docs/multiplayer-map-design.md)
- [Final report](docs/browser-multiplayer-final-report.md)

## Docker (one service)

```bash
docker build -t browser-fps-railway .

docker run --rm \
  -e PORT=8080 \
  -e NODE_ENV=production \
  -e ALLOWED_ORIGINS=http://127.0.0.1:8080 \
  -e PUBLIC_SERVER_URL=http://127.0.0.1:8080 \
  -p 8080:8080 \
  browser-fps-railway
```

Health: `GET /health` · Ready: `GET /ready` · Status: `GET /status` · Alias: `GET /server-status` · Metrics: `GET /metrics`
