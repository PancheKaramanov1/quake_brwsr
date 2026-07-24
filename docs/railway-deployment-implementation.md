# Railway Deployment Implementation Ledger

**Started:** 2026-07-24  
**Task:** Implement every required fix from `docs/railway-deployment-audit.md`

## Baseline

| Field | Value |
| ----- | ----- |
| Initial branch | `feat/browser-multiplayer-hardening` |
| Initial HEAD | `d86b798305fd47a331af032ef90a085d0e47bb97` |
| Audited HEAD | `d86b798305fd47a331af032ef90a085d0e47bb97` |
| Audited HEAD matched | YES |
| Working tree at start | `?? docs/railway-deployment-audit.md` only |

## Decisions

1. Single Railway service / single replica / in-memory match only — no DB, Redis, Supabase, or volume.
2. Port precedence: `PORT` → `SERVER_PORT` → `8080`, strict integer 1–65535.
3. Public URL: `PUBLIC_SERVER_URL` → `https://${RAILWAY_PUBLIC_DOMAIN}` → local fallback.
4. Static client served from Node via `server/staticAssets.ts`; SPA fallback excludes API/WS paths.
5. Production WebSocket defaults to same-origin `wss://` / `ws://` + `/ws`.
6. No `localStorage` / `sessionStorage` / cookies for multiplayer identity or server URL.
7. Shutdown uses message `The live server restarted, so this match has ended.` and close code `1012`.
8. Graceful shutdown target &lt;10s; force-exit deadline 20s.
9. Security logs use process-local connection IDs; never raw IPs, names, tokens, or payloads.
10. Production Vite source maps disabled; Docker also deletes any `*.map`.

## Files created

- `server/staticAssets.ts`
- `src/client/net/serverUrls.ts`
- `railway.toml`
- `docs/railway-deployment-implementation.md`
- `docs/railway-deployment-final-report.md`
- `tests/unit/config.test.ts`
- `tests/unit/serverUrls.test.ts`
- `tests/unit/securityLogger.test.ts`
- `tests/unit/ephemeralIdentity.test.ts`
- `tests/integration/staticHosting.test.ts`
- `tests/integration/productionHttp.test.ts`

## Files modified

- `server/config.ts`, `server/GameServer.ts`, `server/index.ts`
- `server/security/SecurityLogger.ts`, `server/network/ClientConnection.ts`
- `server/match/MatchInstance.ts`
- `src/shared/simulation/constants.ts`
- `src/client/ui/MultiplayerMenu.ts`, `src/client/MultiplayerGame.ts`, `src/client/net/GameClient.ts`
- `vite.config.ts`, `Dockerfile`, `.dockerignore`, `.env.example`
- `README.md`, `docs/browser-multiplayer-deployment.md`, `docs/railway-deployment-audit.md`
- `tests/helpers/wsTestUtils.ts`

## Validation commands and results

| Command | Result |
| ------- | ------ |
| `npm run test:unit` | PASS (86 tests) |
| `npm run test:integration` | PASS (10 tests) |
| `npm run test` | PASS (96 tests) |
| `npm run test:load` | PASS (12 players / 2 min) |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS — `dist/` ~4.02 MB; **0** `.map` files; main JS 4018.69 KB / gzip 931.22 KB |
| `npm run server:build` | PASS — `dist-server/index.js` ~103.1 KB |
| `docker --version` | **UNAVAILABLE** — `docker` not recognized on this host |

## Remaining blockers

- Docker build/runtime/SIGTERM smoke must be run on a Docker-capable machine before go-live (see final report checklist).
- Live Railway project deploy is out of scope for this implementation pass.

## Final Railway settings

See `docs/railway-deployment-final-report.md`.
