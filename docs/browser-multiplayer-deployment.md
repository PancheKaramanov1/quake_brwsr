# Browser Multiplayer Deployment

## Topology (required for Railway)

```text
Single Railway service
Single replica
No volume
No database
No Supabase
No Redis
Same-origin HTTPS/WSS
All game state in memory
Deploy/restart ends the current match
```

One Node process serves:

| Path | Role |
| ---- | ---- |
| `GET /` | Vite production client (`dist/`) |
| `GET /assets/*` | Hashed Vite assets |
| SPA `GET /*` | `index.html` for browser routes only |
| `GET /health` (`/healthz`) | Liveness |
| `GET /ready` (`/readyz`) | Readiness (503 while draining) |
| `GET /status` | Public match discovery |
| `GET /server-status` | Alias of `/status` |
| `GET /metrics` | Aggregate ops metrics (no PII) |
| `WS /ws` | Game protocol |

Reserved paths (`/ws`, `/health`, `/ready`, `/metrics`, `/status`, `/server-status`, `/api/*`, `/assets/*`) are never rewritten to `index.html`.

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

### Windows (PowerShell)

```powershell
npm ci
npm run build
npm run server:build
$env:NODE_ENV="production"
$env:ALLOWED_ORIGINS="http://localhost:8080"
$env:PUBLIC_SERVER_URL="http://localhost:8080"
$env:PORT="8080"
npm run server:start
```

Open `http://localhost:8080/`. Multiplayer uses same-origin `ws://localhost:8080/ws` automatically.

## Docker

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

Image contents: `dist/` + `dist-server/` + production `node_modules`, non-root user `game`, exec-form `CMD`. No hardcoded `PORT`, no Docker `HEALTHCHECK` on 8080 — Railway `/health` is authoritative.

## Railway dashboard settings

```text
Service count: 1
Replicas: 1
Root directory: repository root
Builder: Dockerfile
Dockerfile path: Dockerfile
Build command: blank
Start command: blank
Health-check path: /health
No volume
No database
No Redis
No Supabase
```

Config-as-code: root `railway.toml` (Dockerfile builder, `/health`, `overlapSeconds=0`, `drainingSeconds=20`).

### Variables after Railway generates the domain

```text
NODE_ENV=production
SERVER_HOST=0.0.0.0
ALLOWED_ORIGINS=https://YOUR-SERVICE.up.railway.app
PUBLIC_SERVER_URL=https://YOUR-SERVICE.up.railway.app
MAX_PLAYERS=12
SERVER_TICK_RATE=60
SNAPSHOT_RATE=20
MATCH_DURATION_SECONDS=600
SCORE_LIMIT=25
WS_PATH=/ws
SERVER_NAME=Reactor Atrium FFA
SERVER_REGION=railway
LOG_LEVEL=info
```

**Do not manually create `PORT`. Railway injects `PORT`.**

If `PUBLIC_SERVER_URL` is unset, the server derives `https://${RAILWAY_PUBLIC_DOMAIN}`.

## Client networking

- Production hostnames: same-origin `wss://` / `ws://` + `/ws` (no rebuild for custom domains).
- Local Vite on `localhost` / `127.0.0.1`: defaults to `ws://localhost:8080/ws`.
- Optional overrides: `VITE_GAME_SERVER_URL`, `VITE_GAME_SERVER_HTTP_URL` (dev only; never put secrets in `VITE_*`).
- Display names and server URLs are **not** stored in `localStorage`.

## Shutdown / redeploy

On SIGTERM the process:

1. Stops accepting connections (`/ready` → 503)
2. Broadcasts `The live server restarted, so this match has ended.`
3. Closes WebSockets with code `1012` (service restart)
4. Stops simulation and timers
5. Closes WSS + HTTP within a bounded deadline (force exit at 20s)

In-memory match state does not survive redeploy. Replicas must remain **1**.

## Optional nginx split-host (advanced)

Nginx splitting static client and game server onto different hostnames remains possible for advanced self-hosting, but is **not** required for Railway. Prefer the one-service same-origin model above.

## Operational notes

- One Node process = one FFA match.
- Prefer tick 60 Hz; watch `/metrics` under load.
- Reconnect tokens are process-local memory only (server + client); they die on restart.
- Application logs must not include IPs, display names, tokens, or raw payloads.
