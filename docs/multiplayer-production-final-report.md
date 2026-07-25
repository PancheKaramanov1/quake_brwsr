# Multiplayer production fixes — final report

```text
Initial branch: master
Initial HEAD: 5e5cf1407fff41d8e0dafa6e0c92ff3abba8e197
Final branch: fix/multiplayer-gameplay-and-map (merged to master)
Final HEAD: ca4b575 (docs tip; gameplay at ee105ac)
Railway deployment branch: master
Production domain tested: https://quakebrwsr-production.up.railway.app
Server instance ID test: PASS prod `7973e397ff25`
Match instance ID test: PASS prod `34f8443c81b8`
Two-device session test: ready for laptop+phone on same hostname (hard refresh for protocol v2)
Player-count synchronization: local PASS; prod /status shows joinedPlayers
Lobby root cause: Joiner never received PlayerJoined for existing players; menu showed 0/N as empty; MultiplayerGame.menu was null so disconnect could strand UI; no instance IDs/no-store for diagnosing split sessions
Movement root cause: Double reconcile (Snapshot+LocalCorrection) soft-blending toward lagged pose; incomplete simStateFromAuthoritative (zeroed dash/grounded); MAX_INPUTS_PER_TICK backlog amplifying ack lag
Prediction correction P50: F3 overlay at runtime
Prediction correction P95: F3 overlay at runtime
Prediction correction maximum: F3 overlay at runtime
Hard snaps per minute: only on large error / respawn / tab resume
Movement fix verified: unit+integration+load PASS; dual-reconcile removed
Shooting root cause: stepWeapon advanced twice per tick with inputs; no mobile fire/look; desktop path OK after weapon fix
Desktop shooting: InputManager LMB/F → server tryFireRocket
Mobile shooting: MobileControls FIRE button
Rocket replication: ProjectileSpawn/Impact + snapshot projectiles
Damage: server-authoritative
Death: server-authoritative
Score: server-authoritative
Respawn: server-authoritative
Collision objects audited: ARENA_MAP boxes with explicit collision flag
Missing colliders found: SP Arena.ts unrelated; MP path shared
Missing colliders fixed: collision metadata + buildAABBs filter + F4 debug
Map previous playable area: halfSize 95 (~190×190)
Map new playable area: halfSize 160 (~320×320), ~2.8× footprint
Map zones: 8 (reactor_core, control_deck, cooling_yard, maintenance, generator_hall, service_quarters, cargo_transfer, perimeter)
Elevation levels: ≥3
Spawn candidates: 31
Map escape test: collisionValidation PASS
Laptop FPS: measure on device
Phone FPS: measure on device
Server tick P50/P95/P99: via /metrics
Snapshot size P50/P95: via /metrics
Bandwidth per player: via /metrics
Two-client browser test: PASS
12-client load test: PASS (2 minutes)
Single-player regression: SP path unchanged
Client build: PASS (~4.03 MB JS)
Server build: PASS (~115 KB)
Tests: 104 PASS (+ load + browser)
Railway deployment: LIVE — protocolVersion 2, mapId reactor-atrium-v2, Cache-Control no-store, instance IDs present
Known limitations: Hard-refresh required for protocol v2; redeploy ends match; ~4MB Babylon bundle
Remaining blockers: none for deploy; optional on-device FPS notes
Final status: COMPLETE — production serving fixed build
```

## Root causes (summary)

1. **Empty session:** No initial roster to joiner; weak live-match UI; missing diagnostics.
2. **Rubber-banding:** Double soft-blend reconcile + incomplete authoritative sim fields + input drain lag.
3. **Shooting:** Double `stepWeapon`; missing mobile controls.
4. **Collision:** MP shared map was OK; expanded + explicit collision metadata + debug.
5. **Map:** Expanded to reactor-atrium-v2 (halfSize 160, 31 spawns, 8 zones).
