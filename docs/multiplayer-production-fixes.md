# Multiplayer production fixes — implementation ledger

## Baseline

| Field | Value |
| ----- | ----- |
| Initial branch | `master` |
| Initial HEAD | `5e5cf1407fff41d8e0dafa6e0c92ff3abba8e197` |
| Work branch | `fix/multiplayer-gameplay-and-map` |
| Railway deployment branch | `master` |
| Production domain | `https://quakebrwsr-production.up.railway.app` |
| WSS | `wss://quakebrwsr-production.up.railway.app/ws` |

## Production reproduction (pre-fix)

### `/status` (2026-07-25)

- HTTP 200, `matchState: Active`, `players: 0`, `joinAvailable: true`
- `publicUrl` / CORS origin match Railway domain
- **No** `Cache-Control: no-store`
- **No** `serverInstanceId` / `matchInstanceId`
- Protocol was `1` (bumped to `2` in this fix)

### Root causes

1. **Presence:** Joiner got Welcome only — no roster of existing players; menu UX; menu not wired into MultiplayerGame on disconnect.
2. **Rubber-band:** Double reconcile; incomplete authoritative sim state; input backlog.
3. **Shooting:** Double `stepWeapon`; no mobile controls.
4. **Collision/map:** MP shared OK; expanded to v2 with collision metadata.
5. **QoL:** Mobile controls, connection copy, F3/F4 diagnostics.

## Files changed

- `server/GameServer.ts`, `server/match/MatchInstance.ts`, `server/instanceIds.ts`
- `src/shared/protocol/*`, `src/shared/simulation/{constants,world,mapDefinition}.ts`
- `src/client/{MultiplayerGame,main,net/prediction,ui/MultiplayerMenu,ui/MobileControls}.ts`
- Tests: `presence`, `collisionValidation`, codec/map/staticHosting updates
- Docs: ledger + final report + map design

## Test results

- `npm run typecheck` PASS
- `npm run test` 104 PASS
- `npm run test:load` PASS (12 players / 2 min)
- `npm run test:browser` PASS (3)
- `npm run build` PASS
- `npm run server:build` PASS

## Map changes

- `reactor-atrium-v1` → `reactor-atrium-v2`
- halfSize 95 → 160 (~2.8× footprint)
- 31 spawns, 8 zones, 215 collidable boxes

## Remaining limitations

- Protocol v2 requires clients to load the new build (old tabs rejected)
- Redeploy ends in-memory match
- Post-deploy laptop+phone verification still required after Railway finishes build

## Final deployment SHA

(Filled after push.)
