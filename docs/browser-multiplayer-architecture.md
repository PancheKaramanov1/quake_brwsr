# Browser Multiplayer Architecture

## Overview

`quake_brwsr` is a browser FPS with a **dedicated authoritative Node server** and a **Babylon.js client**. Gameplay rules live in a shared, renderer-free simulation used by both sides. Netcode is **server-authoritative** with client prediction, reconciliation, and remote interpolation — not deterministic lockstep.

| Setting | Value |
| ------- | ----- |
| Protocol | Version **1**, binary frames over WebSocket |
| Tick | **60 Hz** |
| Snapshots | **20 Hz** |
| Max players | **12** |
| Mode | Free-for-all (FFA) |
| Map | `reactor-atrium-v1` |
| Weapon | Rocket only |

## Layout

```text
src/shared/simulation/   Pure sim: movement, weapons, combat, map AABBs, world tick
src/shared/protocol/     Message types + binary codec
src/shared/network/      Transport interface
src/client/              Multiplayer client (menu, net, prediction, interpolation)
server/                  Dedicated game server (HTTP + WS, match, security)
src/Game.ts etc.         Offline single-player (Babylon + AI); MP uses shared sim
tests/                   Unit, protocol, integration, load
```

## Runtime roles

```text
[Browser]
  Input → InputCommand (60 Hz)
  ClientPrediction (shared movement)
  Babylon render + remote Interpolation
  HUD / MultiplayerMenu
        │  WebSocket /ws
        ▼
[GameServer]
  Origin check, rate limits, decode
  MatchInstance → GameWorld (shared sim @ 60 Hz)
  Snapshots @ 20 Hz + combat events
  /health /ready /metrics
```

| Component | Responsibility |
| --------- | -------------- |
| Browser client | Input sampling, local prediction, render, remote interp, UI |
| Shared simulation | Movement, rocket fire/flight/splash, damage, death/respawn, FFA score |
| Dedicated server | Authority, tick loop, validation, fan-out snapshots/events |
| Protocol codec | Versioned binary encode/decode (`PROTOCOL_VERSION = 1`) |
| Static host | Vite `dist/` for the client (separate from the game server) |

## Authority

| System | Client | Server |
| ------ | ------ | ------ |
| Movement | Predicts with shared `stepPlayerMovement` | Owns pose; reconciles via snapshot `ackSeq` / `LocalCorrection` |
| Aim | Local camera | Applied on fire / stored in snapshots |
| Rockets | Optional local VFX | Owns fire rate, ammo, spawn, flight, impact, splash |
| Health / death / respawn / score | Display from events + snapshots | Owns all |
| Match phase / timers | Display | Owns (`MatchPhase`, duration, score limit) |

## Shared simulation

Key modules under `src/shared/simulation/`:

- `constants.ts` — tick rates, limits, movement/weapon tunables
- `mapDefinition.ts` — `ARENA_MAP` (`reactor-atrium-v1`) + `buildAABBs`
- `playerMovement.ts` — kinematic step vs AABB colliders
- `weapons.ts` — rocket state, fire, projectile step, splash
- `combat.ts` — damage, kills, respawn, spawn pick, leaderboard
- `world.ts` — `GameWorld` tick: inputs → movement → weapons → combat → match rules
- `fixedTimestep.ts` — accumulator helper for fixed `TICK_DT`

Collision is **shared AABB** from the map definition (no Havok on the MP path).

## Client net path

| Module | Role |
| ------ | ---- |
| `BrowserTransport` | WebSocket adapter for `Transport` |
| `GameClient` | Handshake, send inputs, dispatch messages |
| `NetworkSim` / `MultiplayerGame` | Wire net + prediction + Babylon presentation |
| `prediction.ts` | Pending input buffer; replay on server ack |
| `interpolation.ts` | Snapshot buffer with ~100 ms delay (`INTERP_DELAY_MS`) |

Offline single-player remains available via the main menu (`Game` + AI enemies). Multiplayer omits PvE enemies.

## Server path

| Module | Role |
| ------ | ---- |
| `server/index.ts` | Boot, config, graceful shutdown |
| `GameServer.ts` | HTTP endpoints + `WebSocketServer` on `WS_PATH` |
| `MatchInstance.ts` | Sessions, tick, snapshots, reconnect grace |
| `ClientConnection.ts` | Per-socket send/close + rate limiter |
| `RateLimiter` / `SecurityLogger` | Abuse controls and structured security logs |

One process hosts **one in-memory FFA match** (no separate matchmaking service).

## Match lifecycle

Phases: `Waiting` → `Countdown` → `Active` → `Ending` → `Results` → `Restarting`.

Defaults (overridable via env / config): match duration **600 s**, score limit **25**, respawn delay **3 s**, spawn protection **2 s**, min players to start **1**.

## Related docs

- [Protocol](./browser-multiplayer-protocol.md)
- [Development](./browser-multiplayer-development.md)
- [Deployment](./browser-multiplayer-deployment.md)
- [Testing](./browser-multiplayer-testing.md)
- [Security](./browser-multiplayer-security.md)
- [Map design](./multiplayer-map-design.md)
