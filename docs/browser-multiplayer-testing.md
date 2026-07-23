# Browser Multiplayer Testing

## Runner

Vitest (`vitest.config.ts`), Node environment, includes `tests/**/*.test.ts`.

```bash
npm test                 # everything
npm run test:unit        # unit + simulation + protocol
npm run test:integration # GameServer + real WebSockets
npm run test:load        # 12-player soak (~3s inputs; 120s timeout)
npm run test:watch       # interactive
```

Helpers: `tests/helpers/wsTestUtils.ts` (free port, connect, wait for message type, metrics fetch).

## Suites

| Path | What it covers |
| ---- | -------------- |
| `tests/unit/smoke.test.ts` | Harness smoke |
| `tests/unit/map.test.ts` | Map id, spawns, AABB build |
| `tests/simulation/movement.test.ts` | Fixed-tick movement / collision |
| `tests/simulation/projectiles.test.ts` | Rocket flight / lifetime |
| `tests/simulation/combat.test.ts` | Damage, splash, kill/respawn scoring |
| `tests/protocol/codec.test.ts` | Encode/decode round-trips, version/size errors |
| `tests/integration/server.test.ts` | Hello → Welcome, snapshots for 2 clients, full reject, shutdown |
| `tests/load/twelvePlayers.test.ts` | 12 concurrent clients sending inputs; server stays up; metrics readable |

## What to run when changing code

| Change | Minimum tests |
| ------ | ------------- |
| Movement / colliders | `tests/simulation/movement.test.ts`, map unit |
| Weapons / splash | `projectiles` + `combat` |
| Wire format | `tests/protocol/codec.test.ts` |
| Sessions / Hello / capacity | `tests/integration/server.test.ts` |
| Tick / fan-out / capacity | `npm run test:load` |

## Manual checklist (2 browsers)

1. `npm run server:dev` and `npm run dev`
2. Two clients join with different names; both appear in snapshots / scene
3. Move, jump, dash — remotes interpolate; local feel predicts
4. Rocket damage, death, respawn (~3 s), score update
5. Fill server (`MAX_PLAYERS`) — next Hello gets `Reject` / Full
6. Kill server or network — reconnect within grace or clean leave
7. Wrong `protocolVersion` → version mismatch reject

## Metrics during load

```bash
curl -s http://localhost:8080/metrics
```

Useful fields: `players`, `tickP50` / `tickP95` / `tickMax`, `avgSnapshotBytes`, `bytesIn` / `bytesOut`, `errors`.

## Gaps (known)

- No browser E2E (Playwright/Cypress) in-repo yet
- No automated latency/loss injection suite (manual or proxy)
- Load test is short (~3 s), not a 24h soak

Add regression tests next to any new sim or protocol field before relying on manual play.
