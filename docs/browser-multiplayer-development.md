# Browser Multiplayer Development

## Prerequisites

- **Node.js 20+** (Dockerfile uses `node:20-alpine`)
- npm (lockfile present)

## Quick start (local MP)

```bash
# Terminal 1 — game server
cp .env.example .env   # optional; defaults work for localhost
npm install
npm run server:dev

# Terminal 2 — Vite client (port 3000)
npm run dev
```

1. Open `http://localhost:3000`
2. Choose **Multiplayer**, set display name
3. Server URL default: `ws://localhost:8080/ws` (`VITE_GAME_SERVER_URL`)

For two players, open a second browser window/profile against the same URL.

## Scripts

| Script | Purpose |
| ------ | ------- |
| `npm run dev` | Vite client on **port 3000** |
| `npm run build` | Typecheck client + Vite production build → `dist/` |
| `npm run preview` | Serve built client |
| `npm run server:dev` | `tsx watch server/index.ts` |
| `npm run server:build` | Bundle server → `dist-server/index.js` (esbuild ESM) |
| `npm run server:start` | Run `node dist-server/index.js` |
| `npm test` | All Vitest suites |
| `npm run test:unit` | Unit + simulation + protocol |
| `npm run test:integration` | Live `GameServer` + WS clients |
| `npm run test:load` | 12-player load (longer timeout) |
| `npm run typecheck` | Client + server `tsc --noEmit` |

## Environment

Copy from `.env.example`. Important vars:

| Variable | Default / notes |
| -------- | --------------- |
| `SERVER_HOST` | `0.0.0.0` |
| `SERVER_PORT` | `8080` |
| `WS_PATH` | `/ws` |
| `MAX_PLAYERS` | `12` |
| `SERVER_TICK_RATE` | `60` |
| `SNAPSHOT_RATE` | `20` |
| `MATCH_DURATION_SECONDS` | `600` |
| `SCORE_LIMIT` | `25` |
| `ALLOWED_ORIGINS` | localhost:3000 / 5173 (comma list, or `*`) |
| `VITE_GAME_SERVER_URL` | `ws://localhost:8080/ws` (client build-time) |

Server loads env via `server/config.ts`. Vite only exposes `VITE_*` to the client.

## Project map for day-to-day work

| Change | Likely files |
| ------ | ------------ |
| Movement / feel | `src/shared/simulation/playerMovement.ts`, `constants.ts` |
| Rockets / ammo | `src/shared/simulation/weapons.ts`, `combat.ts` |
| Map / collision | `src/shared/simulation/mapDefinition.ts` |
| Protocol fields | `messages.ts` + `codec.ts` + tests |
| Tick / snapshots / sessions | `server/match/MatchInstance.ts` |
| Client connect / UI | `src/client/ui/MultiplayerMenu.ts`, `MultiplayerGame.ts` |
| Prediction / interp | `src/client/net/prediction.ts`, `interpolation.ts` |

Keep sim modules free of Babylon and DOM so the server can import them.

## Offline vs multiplayer

- **Single-player:** main menu → existing `Game` / AI arena (local only).
- **Multiplayer:** `MultiplayerGame` + shared sim + server. No PvE enemies on the MP path.

## Debugging tips

- Health: `GET http://localhost:8080/health`
- Ready: `GET http://localhost:8080/ready`
- Metrics: `GET http://localhost:8080/metrics` (tick percentiles, players, bytes, phase)
- Protocol round-trip: `tests/protocol/codec.test.ts`
- Watch security logs: `[security]` lines for origin rejects, rate limits, tick skew

## Conventions

- Shared code uses `.js` extensions in imports (NodeNext / ESM).
- Prefer fixed `TICK_DT` for gameplay; leave particles/VFX on the client.
- Bump `PROTOCOL_VERSION` and reject old clients when the wire format changes.
