# Railway Deployment Final Report

```text
Initial branch: feat/browser-multiplayer-hardening
Initial HEAD: d86b798305fd47a331af032ef90a085d0e47bb97
Audited HEAD matched: YES
Final branch: feat/browser-multiplayer-hardening
Final HEAD: 810f0484c79257a25e14a66c72531c5874270a5e
Working tree: clean after implementation commits

Railway PORT support: YES (PORT → SERVER_PORT → 8080; strict 1–65535)
Host binding: YES (default 0.0.0.0)
Node serves Vite: YES (server/staticAssets.ts + CLIENT_DIST)
Same-origin WebSocket: YES (production page origin → wss:/ws)
WebSocket path: /ws (default WS_PATH)
SPA fallback: YES (excludes /ws,/health,/ready,/metrics,/status,/server-status,/api/*,/assets/*)
Static caching: YES (index.html no-cache; /assets/* immutable)
Path traversal protection: YES
Server-status alias: YES (/server-status ≡ /status)
Persistent browser identity removed: YES (no mp_display_name / mp_server_url writes)
Reconnect token persistence: memory-only (cleared on restart message / code 1012)
Raw IP logging removed: YES (process-local connection ids only)
Production source maps: DISABLED (vite production + Docker find delete; dist/**/*.map count=0)
Shutdown notification: YES ("The live server restarted, so this match has ended.")
Graceful shutdown deadline: YES (grace warn 10s; force exit 20s)
Client build: PASS (~4.02 MB total; main JS 4018.69 KB / gzip 931.22 KB)
Server build: PASS (dist-server/index.js ~103.1 KB)
Lint: PASS
Type check: PASS
Tests: PASS (96)
Load test: PASS (12 players / 2 minutes)
Docker build: UNAVAILABLE (docker CLI not installed on this host)
Docker runtime: UNAVAILABLE
Docker health: UNAVAILABLE
Docker WebSocket: UNAVAILABLE
SIGTERM test: PARTIAL (integration covers notify + code 1012 + /ready 503; container SIGTERM pending Docker)
Railway config-as-code: YES (railway.toml)
Supabase: NOT ADDED
Database: NOT ADDED
Redis: NOT ADDED
Railway Volume: NOT ADDED
Required replicas: 1
Maximum players: 12

Known limitations:
- ~4 MB Babylon client bundle (cold load); no unrelated bundle optimization in this pass
- Redeploy always ends the in-memory match
- Docker smoke not executed on this authoring host

Deployment blockers:
- Mandatory Docker verification checklist still open on a Docker-capable machine
- Live Railway domain + ALLOWED_ORIGINS/PUBLIC_SERVER_URL still require dashboard setup after first deploy

Final go/no-go: GO WITH REQUIRED FIXES
(Required remaining ops fix: run Docker smoke + first Railway deploy variable wiring)
```

## Mandatory Docker verification checklist

Run on a host with Docker CLI:

```bash
docker build -t browser-fps-railway .

docker run --name browser-fps-test \
  -e PORT=8080 \
  -e NODE_ENV=production \
  -e ALLOWED_ORIGINS=http://127.0.0.1:8080 \
  -e PUBLIC_SERVER_URL=http://127.0.0.1:8080 \
  -p 8080:8080 \
  browser-fps-railway
```

Verify:

- `GET http://127.0.0.1:8080/` → 200 HTML
- `GET /health`, `/ready`, `/status`, `/server-status`
- `WS ws://127.0.0.1:8080/ws` with allowed Origin
- `docker stop --time 25 browser-fps-test` → restart message / sockets close / exit before deadline
- New container start has empty match (no surviving state)

Unavailable command on implementation host:

```text
docker --version
→ The term 'docker' is not recognized ...
```

## Exact Railway variables

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

Do not manually create `PORT`. Railway injects `PORT`.

## Exact Railway dashboard settings

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
