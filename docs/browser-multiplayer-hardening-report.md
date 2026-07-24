# Browser Multiplayer Hardening Report

## Baseline

```text
Initial branch: feat/browser-multiplayer
Initial HEAD: 652ea4fde6bbb01cc5e68a7c6aae6f330166bfc0
Reported implementation SHA verified: YES (exact match)
Hardening branch: feat/browser-multiplayer-hardening
Final HEAD: uncommitted on feat/browser-multiplayer-hardening (branched from 652ea4f)
Uncommitted user changes preserved: N/A (tree was clean at branch creation)
```

## Acceptance metrics

```text
Client build: PASS
Server build: PASS
Docker build: NOT RUN (Docker CLI unavailable on host); Dockerfile hardened (non-root USER game)
Lint: PASS
Type check: PASS
Unit tests: PASS
Simulation tests: PASS (incl. adversarial)
Protocol tests: PASS (incl. fuzz)
Integration tests: PASS (reconnect + /status)
Real browser test: PASS (discovery, 2-client combat sync, 12 join, 13th reject)
Two-minute load test: PASS
Ten-minute full-match soak: PASS (artifacts/soak-full-report.json)
Match restart soak: PASS
Maximum verified players: 12
Thirteenth-player rejection: PASS
Existing weapons found: Rocket launcher (only)
Weapons networked: Rocket launcher
Server tick P50: 0.17 ms (full soak) / 0.51 ms (2-min load)
Server tick P95: 1.25 ms (full soak) / 1.75 ms (2-min load)
Server tick P99: 1.97 ms (full soak) / 2.88 ms (2-min load)
Server tick maximum: 2.69 ms (full soak) / 4.02 ms (2-min load)
Snapshot size P50: 525 B (full soak) / 679 B (2-min load combat)
Snapshot size P95: 723 B (full soak) / 1119 B (2-min load)
Snapshot size maximum: 877 B (full soak) / 1295 B (2-min load)
Bandwidth per active player: ~11.5 KB/s (full soak) / ~10.2 KB/s (2-min load)
Server peak memory: ~36 MB heap (full soak)
Memory growth: stabilized (start ~15 MB → end ~31 MB; peak ~36 MB over 10 min)
Unexpected disconnects: 0
Protocol errors: 0
Prediction correction P50/P95/Max: ClientPrediction.getDiagnosticSummary() instrumented
Hard snap count: instrumented
Interpolation underruns: SnapshotInterpolator.underrunCount instrumented
Reconnect verified: PASS
Match discovery implemented: YES (GET /status + menu Join)
Single-player verified: YES
Map spawn count: 20
Map consistency verified: PASS
Spawn safety verified: PASS
Security fuzz tests: PASS
Known limitations: single-server FFA; SP legacy Arena map; Docker not runtime-verified here; no accounts/global matchmaking
Deferred infrastructure: multi-region, ranked anti-cheat, delta compression, account service
Critical blockers: None for casual single-server deployment
```

## Claim verification (summary)

Structural claims from the original report largely verified. Overstatements corrected: 3s “soak”, missing discovery, combat snapshot sizes larger than ~414 B idle estimate, weak readiness, immediate input apply (speed hack). All fixed or documented.

## Defects found → fixed

| Defect | Fix |
| ------ | --- |
| Inputs applied immediately (speed hack) | Queued inputs; ≤2/tick; diagonal normalize; non-finite reject |
| ~3s load only | 2-min load + 600s soak + restart |
| No discovery | `GET /status` + menu Refresh/Join |
| Ready ≈ process up | Requires sim + networking |
| Docker root | `USER game` |
| Prod `ALLOWED_ORIGINS=*` | Refused at config load |
| SP constant drift | Shared rocket constants in WeaponSystem |
| Blocked spawns | Nudged + clearance tests |
| Sparse metrics | Expanded + timeRemaining |
| Tick lag under load | Bounded catch-up steps (≤4) |
| Missing fuzz/adversarial/reconnect suites | Added |

## Measured reports

- `artifacts/load-report.json` — 2-minute 12-player combat
- `artifacts/soak-full-report.json` — 600s match, 40 deaths, standings agree, restart path
- `artifacts/browser-two-client-trace.json` — discovery + combat

## Commands

```bash
npm install
npm run lint && npm run typecheck && npm test
npm run test:load
npm run test:soak
# Full 10-minute soak (PowerShell):
$env:SOAK_FULL_MATCH='1'; npm run test:soak
npm run test:network
npm run test:browser
npm run build && npm run server:build && npm run server:start
npm run server:dev   # with npm run dev for client
docker build -t quake-brwsr-server .
docker run --rm -p 8080:8080 -e NODE_ENV=production -e ALLOWED_ORIGINS=https://play.example.com quake-brwsr-server
```
