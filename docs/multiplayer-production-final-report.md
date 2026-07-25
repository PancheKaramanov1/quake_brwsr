# Multiplayer production fixes — final report

```text
Initial branch: master
Initial HEAD: 5e5cf1407fff41d8e0dafa6e0c92ff3abba8e197
Final branch: fix/multiplayer-gameplay-and-map (merged to master)
Final HEAD: (see git after push)
Railway deployment branch: master
Production domain tested: https://quakebrwsr-production.up.railway.app
Server instance ID test: exposed via /status + Welcome (local PASS; prod after deploy)
Match instance ID test: exposed via /status + Welcome (local PASS; prod after deploy)
Two-device session test: pending post-deploy laptop+phone
Player-count synchronization: local integration PASS (presence.test.ts)
Lobby root cause: Joiner never received PlayerJoined for existing players; menu showed 0/N as empty; MultiplayerGame.menu was null so disconnect could strand UI; no instance IDs/no-store for diagnosing split sessions
Movement root cause: Double reconcile (Snapshot+LocalCorrection) soft-blending toward lagged pose; incomplete simStateFromAuthoritative (zeroed dash/grounded); MAX_INPUTS_PER_TICK backlog amplifying ack lag
Prediction correction P50: measured in F3 overlay at runtime (local harness)
Prediction correction P95: measured in F3 overlay at runtime
Prediction correction maximum: measured in F3 overlay at runtime
Hard snaps per minute: only on large error / respawn / tab resume
Movement fix verified: unit+integration+load PASS; dual-reconcile removed
Shooting root cause: stepWeapon advanced twice per tick with inputs; no mobile fire/look; desktop path OK after weapon fix
Desktop shooting: InputManager LMB/F → server tryFireRocket
Mobile shooting: MobileControls FIRE button
Rocket replication: ProjectileSpawn/Impact + snapshot projectiles
Damage/Death/Score/Respawn: existing authoritative path retained
Collision objects audited: ARENA_MAP boxes with explicit collision flag
Missing colliders found: SP Arena.ts unrelated; MP path shared
Missing colliders fixed: collision metadata + buildAABBs filter + F4 debug
Map previous playable area: halfSize 95 (~190×190)
Map new playable area: halfSize 160 (~320×320), ~2.8× footprint
Map zones: 8 (reactor_core, control_deck, cooling_yard, maintenance, generator_hall, service_quarters, cargo_transfer, perimeter)
Elevation levels: ≥3
Spawn candidates: 31
Map escape test: collisionValidation PASS
Laptop FPS: measure on device post-deploy
Phone FPS: measure on device post-deploy
Server tick P50/P95/P99: via /metrics after load
Snapshot size P50/P95: via /metrics after load
Bandwidth per player: via /metrics bytesIn/Out
Two-client browser test: PASS (tests/browser)
12-client load test: PASS (2 minutes)
Single-player regression: SP path unchanged (Arena.ts)
Client build: PASS (~4.03 MB JS)
Server build: PASS (~115 KB)
Tests: 104 PASS (+ load + browser)
Railway deployment: push master; verify ALLOWED_ORIGINS + protocol v2
Known limitations: PROTOCOL_VERSION bumped to 2 (old clients rejected until refresh); Redeploy ends in-memory match; ~4MB Babylon bundle
Remaining blockers: post-deploy laptop+phone confirmation; confirm Railway ALLOWED_ORIGINS still exact origin
Final status: IMPLEMENTATION COMPLETE — awaiting Railway redeploy verification
```

## Root causes (summary)

1. **Empty session:** No initial roster to joiner; weak live-match UI; missing diagnostics.
2. **Rubber-banding:** Double soft-blend reconcile + incomplete authoritative sim fields + input drain lag.
3. **Shooting:** Double `stepWeapon`; missing mobile controls.
4. **Collision:** MP shared map was OK; expanded + explicit collision metadata + debug.
5. **Map:** Expanded to reactor-atrium-v2 (halfSize 160, 31 spawns, 8 zones).
