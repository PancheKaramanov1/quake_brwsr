# Railway Deployment Audit — Browser Multiplayer FPS

**Audit date:** 2026-07-24  
**Implementation status:** Required fixes implemented — see `docs/railway-deployment-implementation.md` and `docs/railway-deployment-final-report.md`.  
**Scope (original audit):** Read-only repository + official Railway documentation audit. No Railway resources created during the audit itself.

> **Post-implementation note (2026-07-24):** The blockers listed in this audit (Railway `PORT`, static Vite hosting, same-origin WS, Dockerfile, privacy logging, shutdown UX, `railway.toml`) have been addressed in code. Treat section 1’s “Ready for Railway today? **No**” as the **pre-fix** audit verdict. Use the final report for the current go/no-go.

Official Railway documentation pages cited below were checked on **2026-07-24** from `docs.railway.com`.

---

## 1. Executive recommendation

| Question | Answer |
| -------- | ------ |
| Ready for Railway today? | **No** |
| One Railway service viable? | **Yes** (best model for this repo after required fixes) |
| Client + server on one domain? | **Not yet** — must be implemented; topology is correct |
| Supabase needed? | **No** |
| Database needed? | **No** |
| Railway Volume needed? | **No** |
| Redis needed? | **No** |
| Replica count | **Exactly 1** |
| Go/no-go | **GO WITH REQUIRED FIXES** |

**Main deployment blockers (must fix before claiming ready):**

1. Production Node process does **not** serve the Vite client (`dist/`). Current Dockerfile is server-only.
2. Server listens on `SERVER_PORT` (default `8080`) and **ignores Railway-injected `PORT`**.
3. Browser multiplayer defaults to `ws://localhost:8080/ws`, not same-origin `wss://` + `/ws`.
4. No `railway.toml` / `railway.json`; Docker `HEALTHCHECK` hardcodes port `8080`.
5. Client does not clearly surface a live-server-restart message (shutdown broadcasts `"Server shutting down"`; UI shows generic disconnect).

**Topology verdict:** One Railway service, one replica, one public domain serving HTTPS client assets + WSS `/ws` from a single Node listener is the correct deployment model for this in-memory 12-player FFA. Do **not** add a second service, database, Redis, or volume unless product requirements change.

---

## 2. Current repository deployment inventory

| Area | Current implementation | Evidence | Status | Required change |
| ---- | ---------------------- | -------- | ------ | --------------- |
| Branch | `feat/browser-multiplayer-hardening` | `git branch --show-current` | Verified (repo) | Deploy from this branch (or merge); reported `feat/browser-multiplayer` is outdated |
| HEAD | `d86b798305fd47a331af032ef90a085d0e47bb97` | `git rev-parse HEAD` | Verified (repo) | Do not treat reported `652ea4fd…` as current tip |
| Reported SHA match | `652ea4fde6bbb01cc5e68a7c6aae6f330166bfc0` exists in history, ≠ HEAD | `git cat-file -t` + log | Verified (repo) | Update external docs that cite old SHA |
| Working tree | Clean on audit host after baseline check | `git status -sb` | Verified (repo) | Keep clean before deploy |
| Package manager | npm + lockfile | `package-lock.json`, `npm --version` 10.8.2 | Verified (repo) | Use `npm ci` in Docker |
| Node version | Local `v20.20.2`; Docker `node:20-alpine`; no root `engines` | `node --version`, `Dockerfile` L2/L11, `package.json` | Verified (repo) | Pin via Dockerfile; optional `engines.node` |
| Client build | `npm run build` → `dist/` | `package.json` L8, `vite.config.ts` L8–11 | Verified (repo) | Include in production image |
| Server build | `npm run server:build` → `dist-server/index.js` | `package.json` L11 | Verified (repo) | Keep; already in Dockerfile |
| Production start | `npm run server:start` / `node dist-server/index.js` | `package.json` L12, `Dockerfile` L23 | Verified (repo) | Keep exec-form CMD |
| Dockerfile | Multi-stage **server-only** | `Dockerfile` L1–23 | Blocker | Rebuild to include client + static serve |
| `.dockerignore` | Excludes client sources / Vite / `index.html` | `.dockerignore` L14–27 | Blocker for one-service image | Rewrite so client build context is available |
| Railway config-as-code | Absent | No `railway.toml` / `railway.json` | Missing | Add `railway.toml` only |
| HTTP + WS listener | Shared `http.Server` + `WebSocketServer({ server })` | `server/GameServer.ts` L21–52 | Ready | Keep |
| Static / SPA | None; unknown paths → 404 | `GameServer.handleHttp` L167–168 | Blocker | Serve `dist/` + SPA fallback excluding API/WS |
| Port binding | `SERVER_PORT` / `SERVER_HOST` (`0.0.0.0`) | `server/config.ts` L58–73 | Partial | Prefer `PORT` then `SERVER_PORT` then `8080` |
| WS client URL | `VITE_*` or `ws://localhost:8080/ws` | `MultiplayerMenu.ts` L28–48 | Blocker | Same-origin production default |
| Discovery | `GET /status` (+ `/api/servers`) | `GameServer.ts` L148–158 | OK | Optional `/server-status` alias |
| Health / ready | `/health`, `/ready` | `GameServer.ts` L130–146 | Ready | Railway healthcheck → `/health` |
| Metrics | `/metrics` | `GameServer.ts` L160–165 | Ready | Keep public but non-identifying |
| Persistence | In-memory match only | `MatchInstance` sessions Map; no DB deps | Ready | Do not add storage |
| Privacy gaps | IP in security logs; `localStorage` names/URL | `SecurityLogger.ts` L8–14; `MultiplayerMenu.ts` L289–356 | Fix | Aggregate logs; memory-only names |
| Docker build on audit host | Docker CLI not installed | `docker --version` failed | Unverified on host | Validate on a Docker-capable machine before go-live |

---

## 3. Proposed Railway topology

```text
Internet
   │
   │ HTTPS / WSS  (Railway edge TLS)
   ▼
Railway public domain  (e.g. https://YOUR-SERVICE.up.railway.app)
   │
   ▼
Single Railway service  (Replicas: 1, no volume, no DB, no Redis)
   │
   └── One Node process  (dist-server/index.js)
         ├── GET /                  Vite index.html
         ├── GET /assets/*          hashed JS (and maps if shipped)
         ├── GET /*                 SPA fallback → index.html (non-API)
         ├── GET /health            liveness 200
         ├── GET /ready             readiness 200/503
         ├── GET /metrics           aggregate ops metrics
         ├── GET /status            public match info (canonical)
         ├── GET /server-status     recommended alias → same as /status
         └── WS  /ws                one in-memory 12-player FFA match
```

**Why this is best for this repository**

- Match state is process-local (`MatchInstance`). Multiple replicas would split players into isolated worlds (**Verified (repo)** + **Verified (Railway docs):** [Scaling](https://docs.railway.com/deployments/scaling) — public traffic randomly distributed; sticky sessions not supported).
- HTTP and WebSocket already share one listener (**Verified (repo):** `GameServer.start`).
- Railway public networking terminates TLS and supports WebSockets over HTTP/1.1 (**Verified (Railway docs):** [Specs & Limits](https://docs.railway.com/networking/public-networking/specs-and-limits), checked 2026-07-24).
- Existing deployment doc’s nginx split-host model works but is heavier than needed for a temporary single-match demo. One service matches product constraints (stateless, temporary, one origin).

**Do not use:** Vite `npm run dev` in production; separate public ports; second Railway service for static files (unless a concrete blocker remains after static serving is implemented — none found).

---

## 4. Build artifact findings

### Commands run (audit host, 2026-07-24)

| Step | Exit | Duration |
| ---- | ---: | -------- |
| `npm ci` | 0 | ~14.4 s |
| `npm run build` | 0 | ~20.0 s (Vite ~14.8 s) |
| `npm run server:build` | 0 | ~0.7 s |
| `docker build` | N/A | Docker CLI absent — **unverified on this host** |

### Client (`npm run build`)

| Item | Value | Evidence |
| ---- | ----- | -------- |
| Output dir | `dist/` | `vite.config.ts` L8–10 |
| Entry HTML | `dist/index.html` (~2.6 KB / gzip ~0.89 KB) | Vite build log |
| Main bundle | `dist/assets/index-ba55d462.js` (~3,923 KB / gzip ~931 KB) | Vite build log |
| Source map | `dist/assets/index-ba55d462.js.map` (~14,545 KB) | `sourcemap: true` in `vite.config.ts` L11 |
| Total under `dist/` | ~18.5 MB (dominated by `.map`) | PowerShell size sum |
| Hashed filenames | Yes (`index-<hash>.js`) | Build output |
| `public/` folder | None | Repo search |
| Asset path base | `/` (default Vite `base`) | `vite.config.ts` (no `base` override) |
| Collision with server | No — `dist/` vs `dist-server/` | Distinct outdirs |

**Production path concern:** Serving under Railway domain root is fine with `base: '/'`. Refresh on deep client routes needs SPA fallback (not implemented in Node today). Large Babylon bundle (~4 MB JS) will dominate cold load; source maps should not ship to public clients unless intentionally debugging.

### Server (`npm run server:build`)

| Item | Value | Evidence |
| ---- | ----- | -------- |
| Output | `dist-server/index.js` (~93.5 KB) | esbuild log |
| Format | ESM bundle, `--packages=external` | `package.json` L11 |
| Runtime deps | Must install production `node_modules` (`ws`, etc.) | Dockerfile L15–16 |
| TS at runtime | No — compiled JS only | esbuild outfile |
| Entry / start | `node dist-server/index.js` | `package.json` L12; `Dockerfile` L23 |

### Current Dockerfile artifact gap

Current image copies **only** `dist-server/` (**Verified (repo):** `Dockerfile` L17). It never runs `npm run build` and never contains `dist/`. Production container therefore **cannot** serve the browser client.

### DevDependencies at runtime

Runtime image uses `npm ci --omit=dev` (**Verified (repo):** `Dockerfile` L16). That is correct for the **server-only** image. A one-service image must still run Vite/esbuild in a **build** stage (devDependencies available there), then copy only `dist/`, `dist-server/`, and production `node_modules`.

---

## 5. HTTP and WebSocket routing

| Route | Protocol | Purpose | Public | Sensitive data |
| ----- | -------- | ------- | -----: | -------------: |
| `/` | HTTP | Intended: Vite client (not implemented) | Yes | None if static only |
| `/assets/*` | HTTP | Intended: hashed assets (not implemented) | Yes | Source maps if present |
| SPA fallback `/*` | HTTP | Intended: `index.html` for non-API (not implemented) | Yes | None |
| `/health`, `/healthz` | HTTP | Liveness `{ status, uptimeMs }` | Yes | No |
| `/ready`, `/readyz` | HTTP | Readiness (accepting + network + sim) | Yes | No player PII |
| `/status`, `/api/servers` | HTTP | Public match discovery | Yes | Aggregate counts, map name, region — no tokens/IPs |
| `/server-status` | HTTP | **Missing** — topology name; use `/status` today | — | — |
| `/metrics` | HTTP | Tick/bandwidth/heap aggregates | Yes | Comment claims no tokens/IPs/names — verify on change |
| `/ws` | WebSocket | Game protocol (default `WS_PATH`) | Yes | Binary game traffic |
| Other | HTTP | `404 Not found` | Yes | Plain text |

**Listener model (Verified (repo)):** One `http.createServer` + `WebSocketServer({ server: this.httpServer, path: wsPath })` in `GameServer.start` (`server/GameServer.ts` L21–52). Single port. Suitable for one Railway public domain.

**Origin checks (Verified (repo)):** `verifyClient` uses `ALLOWED_ORIGINS`; empty Origin rejected in production; production refuses `ALLOWED_ORIGINS=*` or empty (`server/config.ts` L64–68, `GameServer.ts` L30–42).

---

## 6. Statelessness verification

| Storage mechanism | Present | Used | Permitted | Action |
| ----------------- | ------: | ---: | --------: | ------ |
| Supabase | No | No | No | Do not add |
| PostgreSQL | No | No | No | Do not add |
| SQLite | No | No | No | Do not add |
| Redis | No | No | No | Do not add |
| Railway Volume | No | No | No | Do not attach |
| Server filesystem match saves | No in `server/` | No | No | Keep none |
| Test artifact `writeFileSync` | Yes in load/browser tests only | Tests | N/A for prod | Keep out of image via `.dockerignore` |
| In-memory match / sessions | Yes | Yes | Yes | Keep |
| In-memory reconnect tokens (server) | Yes | Yes | Yes (short-lived) | Keep; die on restart |
| In-memory reconnect tokens (client) | Yes (`GameClient` fields) | Yes | Yes | Keep; do not persist |
| `localStorage` display name | Yes `mp_display_name` | Yes | **No** (persists name after process end / across visits) | Remove or use session memory only |
| `localStorage` server URL | Yes `mp_server_url` | Yes | Prefer no | Remove for same-origin prod |
| `sessionStorage` / IndexedDB / cookies | Not found for MP | No | — | Keep unused |
| Application IP logging | Yes `addr=` in `SecurityLogger` | Yes | **No** (full IP) | Hash/redact or drop |
| Permanent accounts / bans / leaderboards | No | No | No | Keep none |
| Analytics event store | No | No | No | Keep none |

**Conclusion:** Server match data is correctly ephemeral. Browser `localStorage` name persistence and IP logging are the primary policy violations relative to the product constraints.

---

## 7. Required code changes

Do **not** implement in this audit. Exact change matrix for the next implementation prompt:

### R1 — Read Railway `PORT`

| Field | Value |
| ----- | ----- |
| File | `server/config.ts` |
| Symbol | `loadServerConfig` |
| Current | `Number(env.SERVER_PORT ?? DEFAULT_SERVER_PORT)` (L59) |
| Required | `env.PORT ?? env.SERVER_PORT ?? DEFAULT_SERVER_PORT`; validate integer 1–65535 |
| Reason | Railway injects `PORT` and healthchecks use it (**Verified (Railway docs):** [Healthchecks](https://docs.railway.com/deployments/healthchecks), [Deploy a WebSocket Application with Socket.IO](https://docs.railway.com/guides/socketio)) |
| Test | Unit: config prefers `PORT`; integration: listen on injected port |

### R2 — Keep bind `0.0.0.0`

| Field | Value |
| ----- | ----- |
| File | `server/config.ts`, `src/shared/simulation/constants.ts` |
| Symbol | `SERVER_HOST` / `DEFAULT_SERVER_HOST` |
| Current | Default `0.0.0.0` — already correct |
| Required | Keep; document do not set `127.0.0.1` in Railway |
| Reason | Container must accept edge traffic |
| Test | Assert host in config unit test |

### R3 — Serve Vite `dist/` from Node + SPA fallback

| Field | Value |
| ----- | ----- |
| File | `server/GameServer.ts` (new helper e.g. `server/static.ts`) |
| Symbol | `handleHttp` |
| Current | API routes only; else 404 |
| Required | Resolve files under configurable `CLIENT_DIST` (default `dist`); MIME types; deny `..`; no dotfile serve; long-cache hashed `/assets/*`; no-cache `index.html`; SPA fallback to `index.html` **only** for `GET`/`HEAD` non-file paths; never fallback for `/ws`, `/health`, `/ready`, `/status`, `/server-status`, `/metrics`, `/api/*` |
| Reason | One-service same-origin topology |
| Test | Integration: `GET /` 200 HTML; `GET /assets/...` 200; unknown API still 404; WS upgrade unaffected |

### R4 — `/server-status` alias

| Field | Value |
| ----- | ----- |
| File | `server/GameServer.ts` |
| Symbol | `handleHttp` |
| Current | `/status` only |
| Required | Treat `/server-status` identical to `/status` |
| Reason | Match intended public topology without breaking clients using `/status` |
| Test | Integration fetch both |

### R5 — Same-origin WebSocket URL

| Field | Value |
| ----- | ----- |
| File | `src/client/ui/MultiplayerMenu.ts` |
| Symbol | `defaultServerUrl`, `defaultHttpBase` |
| Current | `VITE_GAME_SERVER_URL` else `ws://localhost:8080/ws` |
| Required | If `VITE_*` set, use it (dev override). Else if `window.location.hostname` not localhost/127.0.0.1, use `${wss|ws}//${host}/ws` and matching HTTP base from page origin. Else keep localhost:8080 for split-port local dev |
| Reason | Players must not paste raw WS URLs on Railway |
| Test | Unit/jsdom: production host → `wss://host/ws`; localhost → `ws://localhost:8080/ws` |

### R6 — Client restart / shutdown messaging

| Field | Value |
| ----- | ----- |
| File | `server/match/MatchInstance.ts`, `src/client/MultiplayerGame.ts`, `src/client/ui/MultiplayerMenu.ts` |
| Symbol | `notifyShutdown`; `bindNet` `ServerError` / `Disconnect` handlers |
| Current | Broadcast `"Server shutting down"`; client Disconnect → `"Disconnected — reconnect from Multiplayer"`; `ServerError` not handled in UI switch |
| Required | Server message: `The live server restarted, so this match has ended.`; client displays that text on `ServerError` and on disconnect after shutdown |
| Reason | Honest UX — matches cannot survive process replacement |
| Test | Integration: SIGTERM path or `notifyShutdown` → client sees message |

### R7 — Stop persisting names / URLs in `localStorage`

| Field | Value |
| ----- | ----- |
| File | `src/client/ui/MultiplayerMenu.ts` |
| Symbol | join handlers L289–356 |
| Current | `mp_display_name`, `mp_server_url` in `localStorage` |
| Required | Keep name in component/page memory only for the tab; do not write `localStorage` (or use non-persistent fields only) |
| Reason | Product: no storage of player names after process/tab ends |
| Test | Assert no `localStorage` writes for those keys |

### R8 — Privacy-safe logging

| Field | Value |
| ----- | ----- |
| File | `server/security/SecurityLogger.ts`, `server/GameServer.ts` |
| Symbol | `rejectedConnection`, `invalidMessage`, connection `addr` |
| Current | Logs `addr=<ip>` |
| Required | Log reason codes / aggregate counters only; omit raw IP (or one-way truncate/hash if ops insist — prefer omit) |
| Reason | No application storage/logging of complete IPs |
| Test | Grep/assert log lines lack IPv4/IPv6 patterns in security logger unit test |

### R9 — `PUBLIC_SERVER_URL` for same-origin

| Field | Value |
| ----- | ----- |
| File | `server/config.ts` |
| Symbol | `publicUrl` |
| Current | `PUBLIC_SERVER_URL` or `http://localhost:port` when host is `0.0.0.0` |
| Required | Prefer `PUBLIC_SERVER_URL`; else if `RAILWAY_PUBLIC_DOMAIN` set, `https://${RAILWAY_PUBLIC_DOMAIN}`; else current fallback |
| Reason | `/status` → `wsUrlFromStatus` must advertise correct public WSS URL (**Verified (Railway docs):** `RAILWAY_PUBLIC_DOMAIN` in [Variables Reference](https://docs.railway.com/variables/reference)) |
| Test | Config unit with `RAILWAY_PUBLIC_DOMAIN` |

### R10 — Production source maps

| Field | Value |
| ----- | ----- |
| File | `vite.config.ts` and/or Dockerfile |
| Symbol | `build.sourcemap` |
| Current | `true` — ships ~14.5 MB `.map` |
| Required | `sourcemap: false` for production (or omit `*.map` from image) |
| Reason | Size, attack surface, deploy time |
| Test | `dist/` contains no `.map` after production build |

### R11 — Dockerfile + `.dockerignore` + `railway.toml`

See sections 8–10. Tests: local `docker build` + `docker run -e PORT=8080 -e ALLOWED_ORIGINS=...` smoke; Railway deploy checklist in §16.

### R12 — Graceful shutdown deadline

| Field | Value |
| ----- | ----- |
| File | `server/index.ts`, `server/GameServer.ts` |
| Symbol | `shutdown` |
| Current | SIGTERM → `server.shutdown()` → `process.exit(0)`; no forced deadline if close hangs |
| Required | Bound graceful period (e.g. 10–20 s) then force exit; align with Railway `drainingSeconds` |
| Reason | **Verified (Railway docs):** [Deployment Teardown](https://docs.railway.com/deployments/deployment-teardown) — SIGTERM then SIGKILL after drain window |
| Test | Fake hung close → force exit within bound |

---

## 8. Proposed Dockerfile

**Choice:** Prefer an **improved Dockerfile** over Railpack.  
**Justification:** Repository already has a working multi-stage Dockerfile pattern; one-service needs both Vite and esbuild builds with reproducible `npm ci`; Railpack would need equivalent custom build/start commands and is easier to misconfigure for dual artifacts. Railway uses a root `Dockerfile` automatically (**Verified (Railway docs):** [Dockerfiles](https://docs.railway.com/builds/dockerfiles), checked 2026-07-24).

**Do not apply yet.** Recommended complete file:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
RUN npm run build
RUN npm run server:build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S game && adduser -S game -G game
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
# Prefer omitting source maps from the runtime image even if Vite emitted them
RUN find ./dist -name '*.map' -delete
RUN chown -R game:game /app
USER game
# Railway injects PORT; do not rely on EXPOSE for routing.
# Prefer Railway healthcheckPath=/health over a hardcoded HEALTHCHECK port.
CMD ["node", "dist-server/index.js"]
```

**Notes**

- Exec-form `CMD` so PID 1 is Node and receives SIGTERM (**Probable** best practice; aligns with graceful shutdown in `server/index.ts`).
- Remove hardcoded `HEALTHCHECK` against `:8080` (current `Dockerfile` L21–22) — conflicts with Railway `PORT` (**Verified (Railway docs):** [Healthchecks](https://docs.railway.com/deployments/healthchecks)).
- `EXPOSE` optional; Railway does not require it for public networking.

---

## 9. Proposed `.dockerignore`

**Do not apply yet.** Recommended complete content:

```gitignore
node_modules
npm-debug.log*
dist
dist-server
.git
.github
.gitignore
.env
.env.*
!.env.example
coverage
*.md
docs
tests
artifacts
playwright-report
test-results
.vscode
.idea
.cursor
*.log
.tmp
.temp
.railway
Dockerfile*
!Dockerfile
.dockerignore
vitest.config.ts
vitest.load.config.ts
**/results.json
```

**Do not exclude:** `src/`, `server/`, `index.html`, `vite.config.ts`, `tsconfig*.json`, `package.json`, `package-lock.json` — required for client+server build.

Current `.dockerignore` excludes client sources and Vite entry (**Verified (repo):** L14–27) — incompatible with the proposed one-service Dockerfile.

---

## 10. Proposed Railway config-as-code

**Format:** Use **only** `railway.toml` (JSON equivalent allowed by Railway; pick one).  
**Verified (Railway docs):** [Config as Code](https://docs.railway.com/config-as-code) and [Config as Code reference](https://docs.railway.com/config-as-code/reference) — supports `railway.toml` or `railway.json`; code overrides dashboard for that deployment; checked 2026-07-24.

**Do not invent unsupported fields.** Standalone `numReplicas` was **not** listed on the official Config as Code reference page checked 2026-07-24 (only `multiRegionConfig.*.numReplicas`). Therefore **Replicas = 1 must be set in the Railway dashboard** ([Scaling](https://docs.railway.com/deployments/scaling)).

**Do not apply yet.** Recommended `railway.toml`:

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
# In-memory match cannot survive replacement; avoid overlapping two live matches.
overlapSeconds = "0"
# Allow shutdown notify + WS close before SIGKILL.
drainingSeconds = "20"
```

**Intentionally omitted**

- `startCommand` — Dockerfile `CMD` is authoritative.
- `buildCommand` — Dockerfile runs builds.
- `preDeployCommand` — no migrations/DB.
- Multi-region / replica blocks — would violate single-match architecture.

**Dashboard critical constraint (not fully expressible in verified TOML fields):** Replicas = **1**.

---

## 11. Railway variables

### Matrix

| Variable | Required | Example | Secret | Railway-provided | Purpose | Validation |
| -------- | -------: | ------- | -----: | ---------------: | ------- | ---------- |
| `PORT` | Auto | (assigned) | No | Yes (injected) | Listen port | App must read it (after R1) |
| `RAILWAY_PUBLIC_DOMAIN` | Auto | `xxx.up.railway.app` | No | Yes | Derive public HTTPS URL | Use for `PUBLIC_SERVER_URL` fallback (R9) |
| `NODE_ENV` | Yes | `production` | No | No (set in image/env) | Prod guards | Must be `production` |
| `SERVER_HOST` | Optional | `0.0.0.0` | No | No | Bind address | Must be `0.0.0.0` |
| `SERVER_PORT` | Optional | leave unset | No | No | Local override only | Do not set fixed prod port on Railway |
| `PUBLIC_SERVER_URL` | Recommended until R9 | `https://YOUR-SERVICE.up.railway.app` | No | No | `/status` advertisement | HTTPS, no trailing slash issues |
| `WS_PATH` | Optional | `/ws` | No | No | WS path | Must start with `/` |
| `ALLOWED_ORIGINS` | Yes | `https://YOUR-SERVICE.up.railway.app` | No | No | WS origin allowlist | Exact origin; no `*` in prod |
| `MAX_PLAYERS` | Yes | `12` | No | No | Cap | ≤ protocol max 12 |
| `MAX_MATCHES` | N/A | — | — | — | Not implemented | Do not invent; process = 1 match |
| `SERVER_TICK_RATE` | Optional | `60` | No | No | Sim Hz | 10–120 |
| `SNAPSHOT_RATE` | Optional | `20` | No | No | Snapshot Hz | >0 |
| `MATCH_DURATION_SECONDS` | Optional | `600` | No | No | Match length | >0 |
| `SCORE_LIMIT` | Optional | `25` | No | No | Score end | >0 |
| `RECONNECT_GRACE_MS` | Optional | `15000` | No | No | In-memory reconnect window | >0 |
| `HEARTBEAT_INTERVAL_MS` | Optional | `2000` | No | No | Heartbeat | >0 |
| `CONNECTION_TIMEOUT_MS` | Optional | `10000` | No | No | Hello timeout | >0 |
| `SERVER_NAME` | Optional | `Reactor Atrium FFA` | No | No | Public status | ≤64 chars |
| `SERVER_REGION` | Optional | `us-west2` | No | No | Public status | ≤32 chars |
| `LOG_LEVEL` | Optional | `info` | No | No | Logging | enum |
| `TRUST_PROXY` | Optional | `true` | No | No | XFF for logging only | Prefer `false` after R8 removes IP logs |
| `CLIENT_DIST` | Optional | `dist` | No | No | Static root (after R3) | Directory exists |
| `VITE_GAME_SERVER_URL` | No in same-origin prod | — | No | No | Build-time WS override | Do not bake secrets; omit for same-origin |
| `VITE_GAME_SERVER_HTTP_URL` | No in same-origin prod | — | No | No | Build-time HTTP override | Omit for same-origin |

### Copy-ready Railway variable set (placeholders)

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
TRUST_PROXY=false
```

### Do **not** create

- Any `DATABASE_URL`, Supabase keys, Redis URL, volume mount vars for app data  
- Manually fixed production `PORT` unless debugging target-port edge cases ([Healthchecks](https://docs.railway.com/deployments/healthchecks) notes manual `PORT` only when not listening on injected port / target ports)  
- Secret values in `VITE_*`  
- `ALLOWED_ORIGINS=*`

### Railway provides automatically (selected)

From [Variables Reference](https://docs.railway.com/variables/reference) (checked 2026-07-24): `RAILWAY_PUBLIC_DOMAIN`, `RAILWAY_PRIVATE_DOMAIN`, `RAILWAY_PROJECT_*`, `RAILWAY_ENVIRONMENT_*`, `RAILWAY_SERVICE_*`, `RAILWAY_REPLICA_*`, `RAILWAY_DEPLOYMENT_ID`, git vars when GitHub-deployed, etc. Plus injected service `PORT` per [Healthchecks](https://docs.railway.com/deployments/healthchecks) / [Socket.IO guide](https://docs.railway.com/guides/socketio).

---

## 12. Exact Railway dashboard procedure

UI labels may vary slightly; sequence follows current docs: [Public Networking](https://docs.railway.com/networking/public-networking), [Domains](https://docs.railway.com/networking/domains), [Dockerfiles](https://docs.railway.com/builds/dockerfiles), [Healthchecks](https://docs.railway.com/deployments/healthchecks), [Scaling](https://docs.railway.com/deployments/scaling), [Restart Policy](https://docs.railway.com/deployments/restart-policy), [Deployment Teardown](https://docs.railway.com/deployments/deployment-teardown), GitHub autodeploy docs linked from Socket.IO guide. Checked **2026-07-24**.

### A. Repository preparation

1. Complete required fixes (section 7 / 19) and commit on the deployment branch.
2. Confirm GitHub remote is the intended FPS repository.
3. Confirm branch: `feat/browser-multiplayer-hardening` (or successor after merge).
4. Confirm root `Dockerfile` path (default detection).
5. Confirm no `.env` secrets committed (`!.env.example` only).
6. Locally: `npm ci && npm run lint && npm run typecheck && npm run test && npm run build && npm run server:build`.
7. On a Docker host: `docker build -t browser-fps-railway .` and smoke-run (section 16).

### B. Create the Railway project

1. Open [Railway](https://railway.com) and sign in.
2. **New Project**.
3. Choose **Deploy from GitHub repo** (label may read “GitHub Repo”).
4. Select the FPS repository; authorize if prompted.
5. Select branch `feat/browser-multiplayer-hardening` (or configured production branch).
6. Confirm Railway creates one service from the repo root.
7. If prompted for database/Redis templates — **skip / decline**.

### C. Build settings

1. Open the service → **Settings**.
2. **Root Directory:** leave empty / `/` (monorepo root not required).
3. **Builder:** Dockerfile (auto-detected when root `Dockerfile` exists — logs show `Using detected Dockerfile!` per [Dockerfiles](https://docs.railway.com/builds/dockerfiles)).
4. **Dockerfile path:** blank if root `Dockerfile`, or set to `Dockerfile` via config-as-code.
5. **Build command / Start command:** leave blank when Dockerfile defines build + `CMD`.
6. Optional **Watch Paths:** e.g. `src/**`, `server/**`, `package.json`, `Dockerfile` to reduce noise deploys.

### D. Variables

1. Open **Variables**.
2. Add the copy-ready set from section 11 using placeholder domain first.
3. Do **not** set `PORT` manually.
4. Do **not** add database/Supabase/Redis variables.
5. After domain generation (E), update `ALLOWED_ORIGINS` and `PUBLIC_SERVER_URL` to the real `https://…` origin.

### E. Networking

1. Settings → **Networking** → **Public Networking**.
2. Click **Generate Domain** ([Public Networking](https://docs.railway.com/networking/public-networking) quick start).
3. Confirm HTTPS on the generated `*.up.railway.app` (or current Railway domain suffix).
4. Target port: rely on Railway `PORT` injection after R1 — do not hardcode 8080 as the only listen port.
5. Confirm WebSocket path will be `wss://YOUR-SERVICE.up.railway.app/ws` (edge supports websockets — [Specs & Limits](https://docs.railway.com/networking/public-networking/specs-and-limits)).
6. Optional custom domain later (section 13).
7. Update `ALLOWED_ORIGINS` / `PUBLIC_SERVER_URL` to match.

### F. Health check

1. Settings → healthcheck path: `/health` (or rely on `railway.toml`).
2. Timeout: `300` seconds default is acceptable ([Healthchecks](https://docs.railway.com/deployments/healthchecks)).
3. Expect HTTP **200** JSON `{ "status": "ok", ... }`.
4. Test after deploy: `curl -sS https://YOUR-SERVICE.up.railway.app/health`.
5. Note: Railway healthchecks originate from hostname `healthcheck.railway.app` — not applicable to WS Origin allowlist (HTTP health does not send browser Origin).

### G. Scaling and resources

1. Set **Replicas = 1** (critical).
2. Do not enable multi-region replicas.
3. No horizontal autoscaling beyond 1.
4. **No volume**.
5. **No database / Redis plugin**.
6. No Supabase.
7. Pick one region close to initial players.
8. Resource limits: use plan defaults unless UI exposes explicit caps you need.

### H. Deployment

1. Trigger deploy (push or **Deploy**).
2. Watch **Build** logs for Dockerfile detection + `npm ci` / builds.
3. Watch **Deploy** logs for `[server] listening on…`.
4. Confirm healthcheck passes and deployment becomes Active.
5. Open generated domain in a browser.
6. Verify `/health`, `/ready`, `/status` (and `/server-status` after R4).
7. Verify page loads game UI from `/`.
8. Open two browsers → join FFA → move/shoot.
9. Attempt 13th connection → reject full.
10. Trigger redeploy → confirm clients see restart message (after R6).

### I. GitHub auto-deploy

1. With GitHub connected, pushes to the selected branch typically auto-deploy (**Probable** per product docs; confirm in project service settings).
2. **Risk:** Every deploy SIGTERMs the old process → **active match ends**.
3. Recommended discipline for live playtests: disable auto-deploy or deploy only between sessions; warn players.
4. Overlap seconds should stay `0` so two processes do not briefly host divergent matches.

### J. Rollback

1. Open service → **Deployments**.
2. Identify last known-good deployment (build SHA / timestamp).
3. Use Railway’s redeploy/rollback control for that deployment (UI: redeploy previous image — exact button label may vary; do not invent names beyond “redeploy prior deployment”).
4. Players: connections drop; in-memory match is gone; new empty match after new process starts.
5. Sessions cannot survive rollback.

---

## 13. Domain and WebSocket configuration

### Generated domain (required for first deploy)

1. Generate domain in Public Networking.
2. Placeholder form: `https://YOUR-SERVICE.up.railway.app`.
3. Client (after R5): `wss://YOUR-SERVICE.up.railway.app/ws`.
4. Set `ALLOWED_ORIGINS=https://YOUR-SERVICE.up.railway.app`.
5. Set `PUBLIC_SERVER_URL=https://YOUR-SERVICE.up.railway.app` (until R9 auto-derives from `RAILWAY_PUBLIC_DOMAIN`).
6. Test HTTPS page load and WSS upgrade; no mixed content (`ws://` on HTTPS page is forbidden by browsers).

### Custom domain (optional)

Per [Domains](https://docs.railway.com/networking/domains) / [Public Networking](https://docs.railway.com/networking/public-networking) (checked 2026-07-24):

1. Add custom domain in service networking settings.
2. Create DNS records Railway displays — docs state **CNAME and TXT are both required** for custom domains.
3. Wait for certificate (issuance typically within an hour; may retry up to 72 hours per [Specs & Limits](https://docs.railway.com/networking/public-networking/specs-and-limits)).
4. Update `ALLOWED_ORIGINS` to include `https://custom.example` (and temporarily keep generated origin during transition).
5. Same-origin WS continues to work from `window.location` after R5 without rebuild.
6. Test `https://` and `wss://` on the custom host.
7. Remove obsolete generated origin from allowlist when transition complete (optional).

**Do not hardcode** a guessed Railway subdomain in git.

---

## 14. Health, readiness, and shutdown

### `/health` (liveness)

| Item | Behavior |
| ---- | -------- |
| Codes | Always **200** when HTTP stack responds (`GameServer.ts` L130–133) |
| Body | `{ status: "ok", uptimeMs }` |
| Cost | Cheap — no sim work |
| Railway use | **Recommended healthcheck path** — least fragile |

### `/ready` (readiness)

| Item | Behavior |
| ---- | -------- |
| Codes | **200** if `accepting && networkReady && match.isSimulationReady && http/wss non-null`; else **503** |
| Body | `{ ready, accepting, networkReady, simulationReady }` |
| Full match | Does **not** fail merely because match is full (`isReady` ignores player count) |
| Use | Ops / drain observation; optional secondary check — **not** preferred as Railway deploy healthcheck (can flap during shutdown) |

### Metrics / status

- `/metrics` — aggregate tick/bandwidth/heap; must remain free of tokens/IPs/names.
- `/status` — public match info including `joinAvailable`, `players`, `maxPlayers`, `wsPath`, `publicUrl`.

### Shutdown sequence (current → required)

**Current (Verified (repo)):**

1. `SIGINT`/`SIGTERM` → `GameServer.shutdown` (`server/index.ts` L16–23).
2. `accepting=false`; `networkReady=false`.
3. `notifyShutdown` broadcasts `ServerError` `"Server shutting down"`; closes sockets `1001`.
4. `match.stop()`; close WSS; close HTTP.

**Required additions:** client-facing copy in R6; bounded force-exit in R12; Railway `drainingSeconds=20`.

**Railway teardown facts (Verified (Railway docs):** [Deployment Teardown](https://docs.railway.com/deployments/deployment-teardown)): new deploy activates; previous gets SIGTERM then SIGKILL after drain; overlap can keep old deploy alive briefly — **set overlap to 0** for this architecture. Draining **cannot** preserve in-memory match across processes.

---

## 15. Privacy and logging

### Current violations

| Issue | Evidence | Severity |
| ----- | -------- | -------- |
| IP addresses in logs | `SecurityLogger.rejectedConnection` / `invalidMessage` with `addr=`; `GameServer.onConnection` captures remote / XFF | High vs product rules |
| Display names in `localStorage` | `MultiplayerMenu.ts` `mp_display_name` | Medium |
| Server URL in `localStorage` | `mp_server_url` | Low–Medium |
| Source maps public | Vite `sourcemap: true` | Medium (size + source exposure) |
| Shutdown UX unclear | Generic disconnect string | Medium UX |

### Allowed log examples (target)

```text
server_started
match_started player_count=8
match_ended duration_seconds=600
connection_rejected reason=origin
connection_rejected reason=server_full
protocol_error message_type=4
```

### Disallowed

```text
player_name=…
ip=…
reconnect_token=…
complete_packet=…
chat_message=…
```

### `/metrics`

Currently aggregate-only by design (`GameServer.ts` L163–164 comment). Re-verify after any metrics change.

### Railway log capture

Stdout/stderr are captured by Railway ops logging (**Assumption** based on platform behavior; treat application logs as potentially retained by the platform — therefore never print tokens/IPs/names).

---

## 16. Validation checklist

### Pre-deployment (local)

```bash
npm ci
npm run lint
npm run typecheck
npm run test
npm run test:load
npm run build
npm run server:build
docker build -t browser-fps-railway .
docker run --rm -e PORT=8080 -e NODE_ENV=production \
  -e ALLOWED_ORIGINS=http://127.0.0.1:8080 \
  -e PUBLIC_SERVER_URL=http://127.0.0.1:8080 \
  -p 8080:8080 browser-fps-railway
```

Then verify:

| Check | Expect |
| ----- | ------ |
| `GET /health` | 200 |
| `GET /ready` | 200 |
| `GET /status` / `/server-status` | 200 JSON, safe fields |
| `GET /` | 200 HTML (after R3) |
| `GET /assets/*` | 200 |
| `WS /ws` | Upgrade OK with allowed Origin |
| SIGTERM | Shutdown message; sockets close; process exits |

### Post-deployment (Railway)

- [ ] Generated page loads over HTTPS  
- [ ] No mixed-content console errors  
- [ ] Assets 200  
- [ ] `/health` 200  
- [ ] `/ready` expected 200  
- [ ] `/status` safe public info  
- [ ] WSS `/ws` upgrade succeeds  
- [ ] Two browsers play  
- [ ] Twelve clients connect; thirteenth rejected  
- [ ] Redeploy ends session cleanly with clear message  
- [ ] New empty session after restart  
- [ ] No volume / DB / Redis attached  
- [ ] Replicas remain 1  
- [ ] No persistent match/score data  

**Audit host note:** Docker steps were **not** executed here (CLI missing). Mark Docker verification mandatory on a Docker-capable machine before go-live.

---

## 17. Rollback procedure

1. Railway project → service → **Deployments** list.
2. Locate last healthy deployment (green / Active historically; note git SHA from `RAILWAY_GIT_COMMIT_SHA` if present).
3. Redeploy that deployment image via Railway UI (exact control label may vary — use official deployment history redeploy).
4. Confirm healthcheck `/health` 200 on the rolled-back revision.
5. Communicate to players: match state was lost; reconnect to a new live match.
6. If rollback is bad: redeploy newer fix forward rather than oscillating during a playtest.

**Players always experience session loss** on rollback — in-memory architecture.

---

## 18. Risk register

| Risk | Probability | Impact | Evidence | Mitigation |
| ---- | ----------- | ------ | -------- | ---------- |
| Server binds wrong host | Low | Critical | Defaults `0.0.0.0` already | Never set `127.0.0.1` on Railway |
| Server ignores Railway `PORT` | **High** | Critical | `SERVER_PORT` only (`config.ts` L59) | R1 |
| Vite dev server in production | Low | Critical | Dockerfile uses `node dist-server` | Keep Dockerfile CMD; never `vite` |
| Hardcoded localhost WS URL | **High** | Critical | `MultiplayerMenu.ts` L47 | R5 |
| Static assets missing from container | **High** | Critical | Dockerfile server-only | §8 Dockerfile |
| SPA fallback intercepts API/WS | Medium after R3 | High | Not implemented yet | Explicit path exclusions in R3 |
| Deploy kills active match | **High** | High (expected) | In-memory + teardown docs | Warn players; overlap=0; R6 message |
| Multiple replicas split matches | Medium if mis-set | Critical | Scaling: random LB, no sticky sessions | Dashboard Replicas=1 |
| Origin validation blocks Railway domain | **High** if var wrong | High | Prod allowlist exact match | Set `ALLOWED_ORIGINS` after domain exists |
| Origin validation too permissive | Medium | High | Prod refuses `*` already | Keep refusal; no wildcards |
| Health healthy too early | Low | Medium | `/health` does not require sim | Prefer `/health`; optionally gate on `/ready` only if stable |
| Docker CMD blocks SIGTERM | Low | High | Exec-form Node CMD | Keep JSON `CMD`; no shell wrapper |
| Logs expose player info | **High** | High | IP logging today | R8 |
| Volume/DB added accidentally | Medium | High | Dashboard templates | Explicit refuse in procedure |
| Mixed-content failure | **High** if `ws://` on HTTPS | Critical | Browser policy | Same-origin `wss:` R5 |
| Large assets slow deploy/load | **High** | Medium | ~4 MB JS + 14 MB maps | Disable maps R10; future code-split |
| Config drift vs docs | Medium | Medium | No railway.toml today | Add `railway.toml`; keep this audit updated |
| Docker unverified on author host | **High** | Medium | CLI missing | Mandatory Docker smoke elsewhere |

---

## 19. Exact implementation sequence

Dependency-ordered steps for the **next** Cursor implementation prompt. Each step: files → expected result → validation → rollback.

### Step 1 — Port + public URL config

- **Files:** `server/config.ts`, `.env.example`, unit tests under `tests/`
- **Result:** Prefers `PORT`; optional `RAILWAY_PUBLIC_DOMAIN` → `publicUrl`
- **Validate:** `npm run test:unit` (add config cases)
- **Rollback:** Revert commit

### Step 2 — Static file serving + `/server-status`

- **Files:** `server/GameServer.ts`, new `server/staticAssets.ts` (or similar), integration tests
- **Result:** `/` and `/assets/*` work from `dist/`; SPA safe; `/server-status` alias
- **Validate:** `npm run test:integration`; manual `npm run build && npm run server:start`
- **Rollback:** Revert commit

### Step 3 — Same-origin client URL + remove localStorage PII

- **Files:** `src/client/ui/MultiplayerMenu.ts`, client tests if present
- **Result:** Production uses page origin; no `mp_display_name` / `mp_server_url` persistence
- **Validate:** `npm run test` + manual menu join against local static serve
- **Rollback:** Revert commit

### Step 4 — Shutdown message + client UI handling

- **Files:** `server/match/MatchInstance.ts`, `src/client/MultiplayerGame.ts`, `src/client/ui/MultiplayerMenu.ts`
- **Result:** Players see: `The live server restarted, so this match has ended.`
- **Validate:** Integration or manual SIGTERM against two clients
- **Rollback:** Revert commit

### Step 5 — Privacy logging + bounded shutdown

- **Files:** `server/security/SecurityLogger.ts`, `server/GameServer.ts`, `server/index.ts`
- **Result:** No raw IPs; shutdown force-exit within drain budget
- **Validate:** Unit tests on logger; manual SIGTERM timing
- **Rollback:** Revert commit

### Step 6 — Vite sourcemaps off for production

- **Files:** `vite.config.ts`
- **Result:** No `.map` in `dist/`
- **Validate:** `npm run build` and list `dist/assets`
- **Rollback:** Revert config

### Step 7 — Dockerfile + `.dockerignore`

- **Files:** `Dockerfile`, `.dockerignore`
- **Result:** Image contains `dist` + `dist-server`; runs on `PORT`
- **Validate:** `docker build` + `docker run` smoke (section 16)
- **Rollback:** Restore previous Dockerfile from git

### Step 8 — `railway.toml`

- **Files:** `railway.toml` (new)
- **Result:** Dockerfile builder + `/health` + drain/overlap/restart policy
- **Validate:** Railway deploy preview / deployment settings show file-sourced icons ([Config as Code](https://docs.railway.com/config-as-code))
- **Rollback:** Delete file / revert

### Step 9 — Docs sync

- **Files:** `docs/browser-multiplayer-deployment.md`, README pointers
- **Result:** One-service Railway path documented; nginx remains optional advanced
- **Validate:** Doc review only
- **Rollback:** Revert docs

### Step 10 — Railway dry-run deploy

- **Files:** none (ops)
- **Result:** Live domain passes section 16 post-deploy checklist
- **Validate:** Full checklist
- **Rollback:** Redeploy previous Railway deployment (section 17)

---

## 20. Final go/no-go assessment

```text
GO WITH REQUIRED FIXES
```

**Why not GO:** Production cannot serve the client from the current image/process; Railway `PORT` is ignored; WebSocket defaults point at localhost; Docker healthcheck hardcodes 8080; privacy/UX gaps remain; Docker image not verified on this host.

**Why not NO-GO:** Architecture already matches the intended temporary FFA product (authoritative in-memory match, shared HTTP/WS listener, health/ready/status/metrics, graceful SIGTERM hook, no database). One-service Railway topology is feasible with a bounded, well-specified fix list (section 7 / 19).

**Supabase / DB / Redis / Volume / multi-replica:** Explicitly **rejected** for this version.

---

## Final status block

```text
Railway audit status: COMPLETE
Audit date: 2026-07-24
Official Railway documentation verified: YES (Config as Code, Config as Code reference, Dockerfiles, Healthchecks, Deployment Teardown, Restart Policy, Scaling, Public Networking, Specs & Limits, Domains, Variables Reference, Deploy a WebSocket Application with Socket.IO)
Repository branch: feat/browser-multiplayer-hardening
Repository HEAD: d86b798305fd47a331af032ef90a085d0e47bb97
Reported implementation SHA matches: NO (reported 652ea4fde6bbb01cc5e68a7c6aae6f330166bfc0 ≠ HEAD; SHA exists in history)
Working tree clean: YES (at audit completion on this host)
Package manager: npm (package-lock.json); npm 10.8.2
Node version: v20.20.2 local; Dockerfile node:20-alpine; no root engines field
Client build: PASS (npm run build → dist/; ~20s; ~3.9MB JS + ~14.5MB map)
Server build: PASS (npm run server:build → dist-server/index.js ~93.5KB; <1s)
Docker build: UNVERIFIED (Docker CLI not installed on audit host)
One-service deployment viable: YES (after required fixes)
Node serves Vite production build: NO (blocker)
HTTP and WebSocket share one listener: YES
Server reads Railway PORT: NO (reads SERVER_PORT only; blocker)
Server binds to 0.0.0.0: YES (default)
Production WebSocket uses same origin: NO (blocker; localhost / VITE_* today)
WebSocket path: /ws (default WS_PATH)
Health path: /health (/healthz)
Readiness path: /ready (/readyz)
Metrics path: /metrics
Server-status path: MISSING (use /status; add /server-status alias)
SPA fallback correct: NO (not implemented)
Dockerfile ready: NO (server-only; hardcoded healthcheck port)
Dockerignore ready: NO (excludes client build inputs)
Railway config-as-code ready: NO (absent; proposed railway.toml documented)
Supabase required: NO
Database required: NO
Redis required: NO
Railway Volume required: NO
Replica count: 1 (critical dashboard constraint)
Maximum active matches: 1 per process
Maximum players: 12
Persistent application data: NONE on server; browser localStorage name/URL violation present
Reconnect token storage: in-memory only (server + client fields) — OK; keep out of localStorage
Production origin configuration: ALLOWED_ORIGINS required exact Railway HTTPS origin; rejects * in production
Graceful shutdown ready: PARTIAL (SIGTERM path exists; message/UX/deadline incomplete)
Privacy-safe logging: NO (IPs logged today)
Generated domain procedure documented: YES
Custom domain procedure documented: YES
Rollback procedure documented: YES
Critical blockers: (1) no static client in Node/Docker (2) ignore Railway PORT (3) non-same-origin WS defaults (4) Docker healthcheck :8080 (5) no railway.toml
High-priority fixes: shutdown UX copy; remove localStorage PII; stop IP logging; disable source maps; PUBLIC_SERVER_URL/RAILWAY_PUBLIC_DOMAIN; /server-status alias; Docker smoke on capable host
Go/no-go: GO WITH REQUIRED FIXES
```

---

## Appendix A — Context claim verification

| Reported claim | Verified result |
| -------------- | --------------- |
| TypeScript + Vite + Babylon.js client | YES |
| Node authoritative server | YES |
| Binary WebSockets | YES (`ws`) |
| Up to 12-player FFA | YES (`MAX_PLAYERS`) |
| Tick 60 Hz / snapshot 20 Hz | YES defaults |
| `npm run build` / `server:build` / `server:dev` | YES |
| WS `/ws`, `/health`, `/ready`, `/metrics` | YES |
| `/server-status` | NO — implemented as `/status` |
| Branch `feat/browser-multiplayer` | NO — current `feat/browser-multiplayer-hardening` |
| Commit `652ea4fd…` | NO — not HEAD |

## Appendix B — Official Railway documentation index (checked 2026-07-24)

| Page title | URL |
| ---------- | --- |
| Config as Code | https://docs.railway.com/config-as-code |
| Config as Code (reference) | https://docs.railway.com/config-as-code/reference |
| Dockerfiles | https://docs.railway.com/builds/dockerfiles |
| Healthchecks | https://docs.railway.com/deployments/healthchecks |
| Deployment Teardown | https://docs.railway.com/deployments/deployment-teardown |
| Restart Policy | https://docs.railway.com/deployments/restart-policy |
| Scaling | https://docs.railway.com/deployments/scaling |
| Public Networking | https://docs.railway.com/networking/public-networking |
| Specs & Limits | https://docs.railway.com/networking/public-networking/specs-and-limits |
| Domains | https://docs.railway.com/networking/domains |
| Variables Reference | https://docs.railway.com/variables/reference |
| Deploy a WebSocket Application with Socket.IO | https://docs.railway.com/guides/socketio |
