# Browser Multiplayer Testing

## Runner

```bash
npm test                 # unit + simulation + protocol + integration (excludes long load)
npm run test:unit        # unit + simulation + protocol
npm run test:integration # GameServer + WebSockets + reconnect + /status
npm run test:load        # 12-player combat ≥ 2 minutes
npm run test:soak        # complete match + restart (SOAK_FULL_MATCH=1 → 600s)
npm run test:network     # Good/Typical/Poor/Severe impairment profiles
npm run test:browser     # discovery + 2-client combat + 12/13 reject harness
npm run test:watch       # interactive
```

Long suites use `vitest.load.config.ts`. Artifacts land in `artifacts/` (gitignored).

Helpers: `tests/helpers/wsTestUtils.ts`, `tests/helpers/botClient.ts`.

## Suites

| Path | Coverage |
| ---- | -------- |
| `tests/unit/map.test.ts` | Spawns, zones, AABB validity, clearance, separation |
| `tests/simulation/*` | Movement, projectiles, combat, adversarial |
| `tests/protocol/*` | Codec + fuzz (empty/truncated/oversized/NaN floods) |
| `tests/integration/*` | Hello/Welcome, capacity, `/status`, reconnect |
| `tests/load/twelvePlayers.test.ts` | 12 bots, 2 min combat, 13th reject, metrics JSON |
| `tests/load/soak.test.ts` | Full match end + restart; set `SOAK_FULL_MATCH=1` for 600s |
| `tests/load/networkImpairment.test.ts` | Latency/jitter/loss/reorder/dup profiles |
| `tests/browser/multiBrowser.test.ts` | Discovery + combat sync + 12/13 |

## Manual checklist (2 browsers)

1. `npm run server:dev` and `npm run dev`
2. Multiplayer → Refresh → Join (no raw URL required)
3. Two clients combat; remotes interpolate; rockets/damage/score sync
4. Fill to 12 — thirteenth rejected clearly
5. Disconnect / reconnect within grace
6. Single-player still starts from main menu

## Metrics

```bash
curl -s http://localhost:8080/metrics
curl -s http://localhost:8080/status
```

Fields include tick P50/P95/P99/max, overruns, snapshot size percentiles, heap, reconnects, deaths, messagesByType (no tokens/IPs).

## Environment knobs

| Var | Effect |
| --- | ------ |
| `LOAD_RUN_MS` | Load test duration (default 120000) |
| `SOAK_MATCH_SECONDS` | Shortened soak match length when not full |
| `SOAK_FULL_MATCH=1` | True 600s match + restart |
