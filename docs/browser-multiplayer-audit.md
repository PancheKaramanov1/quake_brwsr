# Browser Multiplayer Audit

**Repository:** `quake_brwsr`  
**Audit date:** 2026-07-23  
**Scope:** Full repository inspection for browser playability and online multiplayer readiness  
**Method:** Source-of-truth is code; documentation conflicts are called out explicitly  
**Constraint:** Audit only — no multiplayer implementation, dependency changes, or refactors performed during this audit

---

## 1. Executive summary

### Current project state

`quake_brwsr` is a small **TypeScript / Vite / Babylon.js** first-person shooter that already runs in a modern browser. It is **not** a native C/C++ custom engine, not an id Tech / Quake source port, and not an Emscripten project. The codebase is approximately 17 tracked project files with all gameplay in `src/` (nine TypeScript modules plus config/HTML).

Verified gameplay today: local single-player against AI box enemies in a procedurally built “temple” arena; Quake-inspired keyboard/mouse movement; one rocket weapon with splash; dash and jump; HTML HUD.

### Browser readiness

**High.** A browser client already exists (`index.html` → `src/main.ts` → Babylon `Engine` on a canvas). No WebAssembly port of a native engine is required for a minimal browser build. Remaining browser work is hardening (tab suspension, input, packaging, cleanup of debug paths), not “port to WebGL.”

### Multiplayer readiness

**Very low.** There is no networking, no protocol, no dedicated server, no serialization suitable for replication, no fixed simulation tick, no authoritative game state, and no player death/respawn loop. Simulation is tightly coupled to Babylon meshes, the FreeCamera, DOM UI, and wall-clock timers.

### Overall feasibility

**Feasible** to reach a playable browser multiplayer prototype **without rewriting the entire project**, provided simulation is extracted from presentation and a dedicated authoritative server is added. Feasibility of a polished competitive product depends on product decisions (player count, security bar, regions) that are not encoded in source.

### Most serious blockers

1. **Simulation coupled to rendering/DOM** (`Player`, `WeaponSystem`, `Enemy`, `Game`) — blocks headless server reuse.
2. **No networking stack** — blocks any multiplayer.
3. **Variable-timestep + `Date.now()` gameplay timing** — movement/fire rates are frame- and wall-clock-dependent.
4. **Fully client-authoritative state** — trivial to cheat if networked as-is.
5. **Incomplete combat loop** — infinite ammo; player health can reach 0 with no death/respawn; arena collision is mostly visual.

### Recommended direction

1. Keep Babylon.js as the **browser presentation** layer.
2. Extract a **renderer-free shared simulation** (movement, projectiles, damage, match rules) for client prediction and Node dedicated server.
3. Use **server-authoritative** simulation with client-side prediction, reconciliation, and remote interpolation — **not** deterministic lockstep.
4. Prototype transport: **WebSockets**; production: keep WebSockets until measured HOL/latency pain, then evaluate **WebRTC data channels** (unreliable/unordered) behind a transport abstraction.
5. Do not re-enable Havok for netcode until ownership of simulation is clear; current kinematic code is easier to share server-side.

### Confidence level

**High** for technology inventory, architecture coupling, absence of networking, and browser-already-present conclusion (direct file evidence).  
**Medium** for performance/bandwidth numeric estimates (no profiling data in repo).  
**Medium** for production hosting topology (product/ops decisions open).

---

## 2. Verified technology inventory

| Area | Current implementation | Evidence | Browser impact | Multiplayer impact |
| ---- | ---------------------- | -------- | -------------- | ------------------ |
| Languages | TypeScript (ES2020), HTML, CSS | `tsconfig.json`; `src/*.ts`; `index.html` | Native browser target | Shared TS possible for client+server |
| Package manager | npm (`package-lock.json`) | `package.json`, `package-lock.json` | Standard | Server can share monorepo packages |
| Build | Vite 4 + `tsc` | `package.json` scripts; `vite.config.ts` | `dist/` static hostable | Client build only today |
| Entry (HTML) | Canvas + HUD shell | `index.html` L80–102 | Ready | HUD is local DOM |
| Entry (app) | `main()` creates `Game` | `src/main.ts` L4–24 | Ready | Must add connect/session flow |
| Engine/renderer | Babylon.js `Engine`/`Scene` | `src/Game.ts` L22–31, L212–214 | WebGL via Babylon | Presentation-only should remain client |
| Physics lib | `@babylonjs/havok` declared, **disabled** | `src/Game.ts` L72–78; commented impostors in Player/Arena/Weapon/Enemy | WASM unused at runtime | Do not depend on Havok for first MP |
| Movement | Custom kinematic + flat ground | `src/Player.ts` L74–222 | Works in browser | Needs fixed tick + server validation |
| Input | Keyboard + mouse + Pointer Lock | `src/InputManager.ts` | Browser APIs OK | Sample as commands, not direct authority |
| Weapons | Rocket projectiles + particles | `src/WeaponSystem.ts` | Particles client-side | Projectiles need server ownership |
| AI / PvE | Enemy boxes, max 12 | `src/Enemy.ts`, `src/EnemyManager.ts` | Local only | PvP MP may replace or keep as bots |
| Arena | Procedural meshes + lights | `src/Arena.ts` | No external assets | Need shared collision representation |
| Audio | None | No audio imports/files | N/A | Add later as presentation |
| Networking | None | Repo-wide search: no sockets/WebRTC | N/A | **Must build** |
| Server | None | No server package/scripts | N/A | **Must build** |
| Serialization | Local TS interfaces only | `src/types.ts` | N/A | Mesh-tied types not networkable as-is |
| Auth/identity | None | No auth code | N/A | Guest IDs for proto; tokens later |
| Tests/CI | None | No test files; no `.github/workflows` | Unknown build health | Need harness before MP |
| Deployment | Vite `preview` / static `dist/` | `vite.config.ts`; README | Static hosting OK | Game servers separate |
| Docs | README only; drifts from code | `README.md` vs `InputManager`/`Game.initPhysics` | Misleading setup | Treat code as truth |

**Assumption (labeled):** Exact `npm run build` success was not executed during this audit in a clean install; scripts and sources strongly indicate a standard Vite browser build. Native build status: **N/A** (no native target).

---

## 3. Architecture overview

### 3.1 Repository map

| Path | Purpose |
| ---- | ------- |
| `/` | npm/Vite/TS config, HTML shell, README |
| `src/` | All game logic modules |
| `src/main.ts` | Bootstrap, visibility pause, dispose |
| `src/Game.ts` | Orchestration, loop, shooting, UI |
| `src/Player.ts` | Camera, movement, health/ammo state |
| `src/InputManager.ts` | Input sampling + pointer lock |
| `src/WeaponSystem.ts` | Rockets, collision stubs, explosions |
| `src/Arena.ts` | World geometry, lighting, spawn points |
| `src/Enemy.ts` | AI enemy + enemy projectiles |
| `src/EnemyManager.ts` | Spawn/cap, hit checks |
| `src/types.ts` | Shared interfaces |
| `docs/` | Audit documentation (this file) |
| `node_modules/` | Ignored; not committed |
| `dist/` | Build output (ignored) |

**Absent:** `engine/`, `server/`, `third_party/`, `assets/`, `tests/`, CI, shaders as source files, networking packages.

### 3.2 Runtime flow (startup → active match)

**Verified initialization order** (`main.ts` → `Game`):

1. Resolve `#gameCanvas` (`main.ts` L7–10).
2. `new Game(canvas)` constructs `Engine`, `Scene`, `InputManager`, `WeaponSystem`, `Arena`, `Player` (`Game.ts` L22–40).
3. `await game.init()`:
   - `initPhysics()` — currently no-op (`Game.ts` L72–78).
   - `createWorld()` — `EnemyManager` from arena spawn points; set active camera; fog (`Game.ts` L80–94).
   - `setupGameLoop()` — register `engine.runRenderLoop` (`Game.ts` L96–108).
   - `setupWindowResize()` (`Game.ts` L216–219).
4. `game.start()` sets `isRunning = true` (`Game.ts` L222–225).
5. Visibility handler stops/starts loop (`main.ts` L30–36).
6. `beforeunload` calls `dispose()` (`main.ts` L39–41).

**There is no match state machine** (lobby → countdown → live → end). “Active match” equals continuous single-player arena with enemy respawn.

**Main loop** (`Game.ts` L99–108, L111–138):

1. If `!isRunning`, return.
2. Compute variable `deltaTime` from `performance.now()`.
3. `update(deltaTime)`:
   - Read input (`InputManager.getInputState` — clears one-shots).
   - `player.update`.
   - If shoot → `handleShooting` (ammo check + `fireRocket`).
   - `weaponSystem.update`.
   - Splash → `enemyManager.checkSplashDamage`.
   - `enemyManager.update`.
   - `updateUI` (DOM).
4. `render()` → `scene.render()`.

**Fixed vs variable timestep:** Variable only. No accumulator, no tick rate.

**Physics update order:** Havok disabled. Manual gravity/integration in `Player.applyGravityAndJump`, `WeaponSystem.updateProjectiles`, `Enemy.updateProjectiles`.

**Input sampling:** Event-driven into `InputState`; consumed once per render frame. Mouse deltas zeroed after read (`InputManager.ts` L115–133).

**Entity create/destroy:** Enemies spawned by `EnemyManager`; rockets created/disposed by `WeaponSystem`; enemy death schedules `setTimeout` dispose (`Enemy.ts` L323–325). No entity ID system.

**Level loading:** Synchronous procedural construction in `Arena` constructor — no async asset loading.

**Audio:** None.

**Collision:** Player: Y clamp to ground level 2 (`Player.ts` L210–221) — **does not collide with platforms/walls**. Rockets: Y≤0 or |x|/|z|>85 (`WeaponSystem.ts` L161–175). Enemy projectiles: age/Y/bounds (`Enemy.ts` L245–246). Hits: distance checks (`EnemyManager.ts` L87–100, L143–165).

**Weapon firing:** F key or LMB one-shot → `Game.handleShooting` → `player.consumeAmmo()` (always true) → `weaponSystem.fireRocket` with 500ms `Date.now()` gate.

**Damage:** Enemy `takeDamage`; player `takeDamage` clamps at 0 — **no death**. Splash damages enemies only (player self-splash not applied).

**Player death/respawn:** Not implemented.

**AI:** Patrol / chase / shoot with `Math.random` and `Date.now` cooldowns (`Enemy.ts`).

**Game-state transitions:** Start/stop/dispose only.

**Cleanup:** `Game.dispose` disposes weapons, enemies, arena, scene, engine (`Game.ts` L232–256). Player dispose not explicitly called.

### 3.3 Runtime dependency map

```text
main.ts
  └─ Game
       ├─ Babylon Engine / Scene          (rendering)
       ├─ InputManager                    (DOM events)
       ├─ Player ── FreeCamera + Mesh     (sim + presentation)
       ├─ WeaponSystem ── Mesh/Particles  (sim + presentation)
       ├─ Arena ── Mesh + Lights          (world + presentation)
       ├─ EnemyManager
       │    └─ Enemy ── Mesh + projectiles (AI + presentation)
       └─ DOM HUD (#healthValue, etc.)
```

**Game-state ownership (today):** Entirely inside the single browser process; `Player.state` and enemy health are local mutable fields. `window.game` exposes the instance for debugging (`main.ts` L26–27).

**Platform dependencies:** Browser DOM, Pointer Lock, `performance.now`, `Date.now`, `requestAnimationFrame` (via Babylon render loop). No Node APIs in client code.

### 3.4 Coupling concerns (multiplayer-critical)

| Coupling | Evidence | Why it matters |
| -------- | -------- | -------------- |
| Sim ↔ camera | `Player` owns `FreeCamera` | Server cannot host FreeCamera |
| Sim ↔ mesh | Rockets/enemies are meshes | Serialization/replication needs plain state |
| Sim ↔ DOM | `Game.updateUI` | Headless server has no DOM |
| Timing ↔ wall clock | `Date.now()` fire/dash/jump/AI | Desync + cheatable timestamps |
| Timing ↔ frame rate | `deltaTime` movement | Different FPS ⇒ different outcomes |
| RNG unseeded | `Math.random` spawn/patrol/spread | Non-reproducible |

---

## 4. Browser compatibility findings

**Fact:** This project already targets browsers. Findings below are production/hardening issues, not “cannot run.”

| Finding | Severity | Evidence | Why it matters | Recommended action |
| ------- | -------- | -------- | -------------- | ------------------ |
| Browser build already present | Info | `index.html`, Vite, Babylon Engine | Minimal browser milestone largely done | Treat Phase 1 as harden/package, not port |
| Tab visibility stops simulation | High (for MP) | `main.ts` L30–36 | Background tabs freeze local sim; bad for net prediction/clock | Keep rendering optional; never freeze input send / net receive on `visibilitychange` |
| Variable timestep gameplay | High | `Game.ts` L102–106; Player/Weapons use `deltaTime` | Frame pacing differs across devices | Fixed sim tick (e.g. 60 Hz) + render interpolation |
| Havok dependency unused | Medium | `Game.ts` L72–78; `vite.config.ts` exclude | Bundle weight / confusion if re-enabled | Keep disabled for MP path; remove or isolate later |
| Pointer Lock required for look | Medium | `InputManager.ts` L88–93, L111–113 | Mobile/unsupported browsers fail look | Document desktop-first; add fallback later |
| No touch/gamepad | Medium | InputManager keyboard/mouse only | Mobile not playable | Product decision; desktop default |
| Debug globals / log spam | Low–Medium | `window.game`; many `console.log` | Info leak / jank | Strip in production builds |
| README vs code (flight/Havok/controls) | Medium (docs) | README vs `InputManager` L103; `Game.initPhysics` | Wrong expectations | Fix docs to match code |
| No Cross-Origin Isolation / SAB | Low today | No SharedArrayBuffer usage | Only matters if multithreading WASM physics later | Not needed for first MP |
| Procedural assets only | Positive | `Arena.ts` mesh builders | Small download; fast load | Keep for prototype; add CDN assets later |
| WebGPU not used | Info | Babylon Engine default WebGL path | Fine for FPS prototype | Stay on WebGL2 via Babylon unless profiling demands WebGPU |
| No Emscripten project config | Info | No emcc flags/shell | N/A — not a C++ port | Do not invent WASM port work |

### Browser API compatibility assessment

| API / concern | Assessment |
| ------------- | ---------- |
| WebAssembly | Only via optional Havok; not required for current gameplay |
| Emscripten | Not applicable as project toolchain |
| WebGL 2 | Required by design (README + Babylon); viable |
| WebGPU | Not used; optional future |
| Web Audio | Unused |
| Pointer Lock | Used; required for mouse look |
| Fullscreen | Unused |
| Gamepad | Unused |
| Browser storage | Unused |
| Workers / SAB | Unused |
| Tab throttling | **Handled incorrectly** for MP (hard stop) |
| Asset caching | Vite hashed assets in production; no custom SW |

---

## 5. Multiplayer readiness findings

| Finding | Severity | Evidence | Why it matters | Recommended action |
| ------- | -------- | -------- | -------------- | ------------------ |
| No transport/protocol | Critical | No network code in repo | Cannot connect players | Add transport abstraction + WebSocket prototype |
| No dedicated server | Critical | Client-only `Game` | Nowhere for authority | Node headless sim process |
| Sim tied to Babylon/DOM | Critical | Player/Weapon/Enemy/Game | Server cannot import modules as-is | Extract pure sim package |
| Variable dt + wall clock | Critical | `performance.now` / `Date.now` usage | Divergence, speed hacks | Fixed tick + server time |
| Client owns all state | Critical | Local health/ammo/positions | Cheating trivial | Server authority matrix |
| No serialization | High | `Projectile.mesh` in `types.ts` | Cannot snapshot entities | Plain DTOs + binary/JSON schema |
| Unseeded RNG | High | `Enemy`/`EnemyManager` `Math.random` | Non-deterministic spawns/AI | Seeded RNG on server; clients don't sim AI unless predicted |
| No player death/respawn | High | `Player.takeDamage` only clamps | Incomplete FPS loop | Server match rules |
| Infinite ammo | High | `Player.consumeAmmo` L262–266 | Economy not real | Server ammo/fire rate |
| Arena collision incomplete | High | Player ground Y=2 only; platforms visual | Movement validation hard | Shared collision world (AABB/mesh) |
| Rocket↔geometry incomplete | High | Bounds/Y only; no platform hits | Wrong explosions | Server-side ray/sweep vs arena colliders |
| Enemy projectile private access | Medium | `EnemyManager` casts `as any` | Fragile API | Public accessors / shared projectile list |
| No tests/CI | High | No test files | Regressions during MP | Add sim + protocol tests early |
| Visibility pause | High | `main.ts` | Breaks MP session behavior | Decouple net from render pause |
| `setTimeout` VFX/cleanup | Medium | Explosion/enemy death timers | Not tick-aligned | Presentation-only timers OK; gameplay timers on tick |
| Debug shoot logs every frame path | Low | Game/Weapon/Input logs | Perf noise | Gate behind debug flag |
| PvE enemies as MP entities | Product | max 12 enemies | Bandwidth/CPU if replicated | Prototype = players only; bots optional later |

### Simulation / determinism

- **Fixed tick:** No.
- **Frame rate affects gameplay:** Yes — movement and projectile integration use per-frame `deltaTime`.
- **Physics deterministic:** Havok off; manual Euler integration with floats — not deterministic across machines even if ticks matched.
- **RNG:** Unseeded `Math.random`.
- **Serialization/restore/replay:** Not present.
- **Render separated from sim:** No.

**Recommended model:** Server-authoritative player/weapon/damage with client-side prediction for local movement and possibly local rocket presentation; snapshot replication + remote interpolation. **Deterministic lockstep is not appropriate** for this FPS: floating-point integration, non-deterministic RNG, incomplete collision, and expected jitter/latency make lockstep fragile and slow to recover; bandwidth savings do not outweigh complexity here.

### Networking inventory (Phase 6)

| Component | Present? | Used? | Complete? | Browser-compatible? | Disposition |
| --------- | -------- | ----- | --------- | ------------------- | ----------- |
| Sockets / WebSocket / WebRTC | No | — | — | — | Create new |
| HTTP game APIs | No | — | — | — | Optional for auth/matchmaking later |
| Packet defs / RPC / replication | No | — | — | — | Create new |
| Lobby / matchmaking / accounts | No | — | — | — | Later phases |
| Dedicated server | No | — | — | — | Create new |
| Replay / determinism harness | No | — | — | — | Optional after authority works |

### Security / anti-cheat (summary)

Any networked client could currently invent position, fire rate, ammo, damage, and scores if trusted. Server must validate movement bounds, fire timing, projectile spawn, hits, and match score. Practical anti-cheat = authority + validation + rate limits; do not promise client-side anti-tamper in browsers.

### Testing readiness

No unit, integration, protocol, browser automation, or load tests exist. Architecture does not yet support headless sim tests because sim is mesh-bound.

---

## 6. Reusable foundations

| System | What is reusable | Required changes | Risks | Confidence |
| ------ | ---------------- | ---------------- | ----- | ---------- |
| Vite browser client shell | HTML canvas, Vite build, Babylon bootstrap | Add net client; stop freezing on hide | Bundle size of Babylon | High |
| `InputState` shape | Compact command-like booleans + mouse deltas | Add sequence #, client time, aim angles as commands | One-shot shoot/dash semantics | High |
| Player movement tuning | Speeds, dash, jump numbers in `Player` config | Move to shared sim; fixed dt; collision | Current ground model too naive for arena | High |
| Rocket config | Damage, splash, speed, fireRate in `WeaponConfig` | Server-owned fire; separate VFX | Gravity on rockets; incomplete collision | High |
| Arena layout data | Platform/wall/spawn coordinates in `Arena` | Extract collider + spawn data without meshes | Duplicated geometry defs if not extracted carefully | Medium |
| Spawn points API | `Arena.getSpawnPoints()` | Share with server match spawn | Random offsets need seeded RNG | High |
| Enemy AI (optional) | Patrol/chase/shoot logic | Server-only if bots used; strip meshes | RNG; not needed for 2-player slice | Medium |
| Types module | Conceptual state fields | Replace `Mesh` in `Projectile` with IDs + vec3 | Breaking change to local types | High |
| UI HUD markup | Health/ammo/crosshair | Drive from replicated state | DOM coupling in Game | High |

**Not reusable as-is for server:** `Game` render loop ownership, `FreeCamera` player, particle systems, DOM `updateUI`, Havok integration stubs, `window.game`.

---

## 7. Required new systems

Only systems justified by repository gaps:

1. **Shared simulation library** — pure TS: tick, movement, projectiles, damage, match rules; no Babylon/DOM.
2. **Browser platform/presentation layer** — Babylon rendering of sim state; input → commands.
3. **Browser build hardening** — production flags, visibility policy, optional dependency trim.
4. **Network transport abstraction** — `connect/send/onMessage/close`; WebSocket adapter first.
5. **Multiplayer protocol** — framing, versioning, input cmds, snapshots, events.
6. **Dedicated server target** — Node process running shared sim at fixed tick.
7. **Authoritative simulation layer** — server owns world; clients predict locally.
8. **Replication system** — entity spawn/despawn, snapshots, interest (later).
9. **Prediction + reconciliation** — local player; server corrections.
10. **Remote interpolation / jitter buffer** — other players/projectiles.
11. **Lag compensation** — rewind buffer for hitscan later; rockets use present-time server sim initially.
12. **Match lifecycle** — join, spawn, death, respawn, score, end (minimal).
13. **Identity** — ephemeral guest IDs for proto; tokens later.
14. **Security validation** — movement/fire/ammo/rate limits/message size.
15. **Observability** — structured logs, tick timing metrics.
16. **Multiplayer test harness** — sim unit tests, protocol tests, loss/latency injection.

**Not required for first slice:** WebRTC signaling, matchmaking service, accounts DB, voice, cosmetics, Havok, WebGPU.

---

## 8. Recommended target architecture

### Components

```text
[Browser Client]                    [Dedicated Game Server]
  InputManager -> CommandQueue         Transport (WS)
  NetClient (Transport)         <----> Session / Match
  Prediction (shared sim)              Authoritative Sim (shared)
  Babylon Renderer <-- snapshots       Snapshot builder
  Interpolation (remotes)              Validation / anti-cheat
  HUD <-- events                       Logs / metrics

[Static Host]  serves Vite dist (HTML/JS/WASM if any)

[Later] Matchmaking / Auth / TURN (only if WebRTC)
```

### Roles

| Piece | Role |
| ----- | ---- |
| Browser client | Input, prediction, render, interpolation, UI |
| Shared simulation | Single source of movement/weapon/damage rules |
| Dedicated server | Authority, tick, snapshots, validation |
| Transport | WebSocket prototype; swappable |
| Protocol | Versioned binary or compact JSON→binary |
| Match/session | In-process for prototype; service later |
| Static assets | CDN/static host for client |
| Authentication | Guest for proto; JWT/match tickets for prod |
| Deployment | Static site + containerized game servers |
| Logging/metrics | Server tick time, CCU, bandwidth, errors |

### Default assumptions (until product overrides)

- Dedicated servers only (no peer hosting).
- Target ~8 players for design; prototype at 2.
- Desktop Chrome/Firefox/Edge first.
- No mobile requirement for v1.
- Rockets remain primary weapon; hitscan lag-comp deferred.

---

## 9. Transport recommendation

### Prototype choice: **WebSockets (TLS in deployed environments)**

**Reasons for this repository:**

- Clients are already browsers; native UDP unavailable.
- Zero existing netcode — WS is simplest to implement, debug, and proxy.
- Dedicated server model maps cleanly to WS connections.
- Operationally cheap (no ICE/TURN).

**Trade-offs:**

- Reliable ordered TCP ⇒ **head-of-line blocking**; loss stalls subsequent packets.
- Slightly higher latency variance than unreliable datagrams under loss.

### Production choice: **Start with WebSockets; upgrade path to WebRTC data channels**

Keep WebSockets until profiling shows HOL/loss issues at target player count. If needed, add WebRTC **unreliable unordered** data channels for input/snapshots, retaining WS or HTTPS for signaling/control.

**WebTransport:** Only revisit if deployment targets (HTTP/3 infrastructure + browser baseline) are explicitly supported; not realistic as first choice given current zero-ops footprint.

### Fallback

- Primary: WebSocket.
- Fallback for strict corporate networks: still WebSocket on 443 (usually works).
- If WS blocked oddly: same-origin WS behind HTTPS reverse proxy.

### Abstraction

Game code depends on:

```text
interface Transport {
  connect(url): Promise<void>
  send(bytes | message): void
  onMessage(handler): void
  close(): void
  readonly rtt?: number
}
```

**Conditions that could change recommendation:** Measured >X% loss with unacceptable FPS feel at 8–16 players; availability of managed WebRTC/TURN; requirement for UDP-like semantics from day one for competitive ranking.

---

## 10. Multiplayer authority matrix

| System | Client predicts | Server validates | Server owns | Replication method |
| ------ | --------------: | ---------------: | ----------: | ------------------ |
| Player movement | Yes | Yes (speed/accel/collision) | Yes (canonical pos) | Snapshot + correction |
| Aim (yaw/pitch) | Yes (local camera) | Soft (fire direction on shot) | Fire-time aim on server | Input cmd / snapshot aim |
| Weapon fire request | Optimistic VFX | Yes (rate, ammo, alive) | Yes | Event + projectile spawn |
| Ammo | Optimistic UI | Yes | Yes | Snapshot / event |
| Reloading | Optimistic UI | Yes | Yes | Snapshot (when implemented) |
| Projectiles | Optional local predict | Spawn rules | Yes | Snapshot or event spawn + pos |
| Hits / splash | No (wait or predict damage FX) | Yes | Yes | Damage/death events |
| Damage | No | Yes | Yes | Events |
| Health | Speculative UI only | Yes | Yes | Snapshot |
| Death | Local ragdoll/FX after event | Yes | Yes | Death event |
| Respawn | No | Yes | Yes | Respawn event + snapshot |
| Pickups | Optimistic FX | Distance/timing | Yes | Snapshot / events |
| Match score | No | Yes | Yes | Snapshot / score event |
| Round state | No | Yes | Yes | Match-state messages |
| Interactive objects | Optimistic FX | Range/state | Yes | Snapshot |
| Enemy AI (if kept) | No | N/A | Yes | Snapshot (or omit in PvP proto) |

---

## 11. Risk register

| Risk | Probability | Impact | Evidence | Mitigation | Blocking phase |
| ---- | ----------- | ------ | -------- | ---------- | -------------- |
| Sim/render split larger than expected | Medium | High | Mesh-centric modules | Extract incrementally; start with movement+rockets | Phase 0–2 |
| Incomplete collision breaks validation | High | High | Player Y=2 only | Build shared AABB world from Arena data | Phase 2–4 |
| Variable dt baked into feel | High | Medium | Movement uses frame dt | Retune on fixed tick | Phase 0 |
| WS HOL blocking hurts FPS feel | Medium | Medium | TCP semantics | Jitter buffer; later WebRTC | Phase 5–6 |
| Cheatable client if authority delayed | High | High | All state local | Never trust client state | Phase 3–4 |
| Tab throttle desyncs | High | Medium | `visibilitychange` stop | Always process net; pause render only | Phase 1 / 4 |
| No tests → silent desync | High | High | Zero tests | Sim+protocol tests before feature growth | Phase 0 / 3 |
| Havok re-enable derails shared sim | Medium | Medium | Disabled physics everywhere | Keep kinematic for MP v1 | Phase 0 |
| Scope creep (matchmaking/auth) | Medium | Medium | Empty product surface | Vertical slice gate | Phase 4 |
| Babylon version/perf on low-end | Medium | Medium | Full `@babylonjs/core` | Profile; reduce effects | Phase 6 |
| Secrets in repo | Low | High | None found in source | Keep `.env` ignored; no keys in client | Ongoing |
| Enemy `as any` fragility | Medium | Low | `EnemyManager.ts` L145–148 | Public API | Phase 0 cleanup if touching |

---

## 12. Phased implementation roadmap

Phases adapted to evidence: **browser already works**; prioritize sim isolation and server.

### Phase 0: Stabilize and measure

- **Goal:** Reproducible baseline; document actual controls; isolate sim from presentation.
- **Entry criteria:** Audit accepted; repo builds with documented Node version.
- **Systems affected:** `Player`, `WeaponSystem`, types; docs; optional profiling hooks.
- **Likely files:** `src/Player.ts`, `src/WeaponSystem.ts`, `src/types.ts`, `README.md`; new `src/sim/*`.
- **Deliverables:** Fixed-tick sim sketch; movement/rocket pure functions; README matches code; basic FPS counter.
- **Tests:** Unit tests for movement integration and fire-rate gating on fixed dt.
- **Exit criteria:** Sim step callable without `Scene`; single-player still playable via adapter.
- **Dependencies:** None.
- **Risks:** Behavior change when switching to fixed tick.
- **Effort:** Large.

### Phase 1: Minimal browser harden (not “first WebGL”)

- **Goal:** Production-shaped client: clean logs, visibility policy, build verified.
- **Entry criteria:** Phase 0 sim adapter works in client.
- **Systems affected:** `main.ts`, `Game.ts`, Vite build.
- **Likely files:** `src/main.ts`, `src/Game.ts`, `vite.config.ts`, `index.html`.
- **Deliverables:** `npm run build` artifact; no `window.game` in prod; visibility does not kill net-ready loop.
- **Tests:** Smoke open `dist` in browser; manual playthrough.
- **Exit criteria:** Dist playable; documented browser matrix.
- **Dependencies:** Phase 0.
- **Risks:** Low.
- **Effort:** Small–medium.

### Phase 2: Headless server

- **Goal:** Node process runs shared sim without Babylon/DOM.
- **Entry criteria:** Pure sim package exists.
- **Systems affected:** New `server/`; shared `sim/`.
- **Likely files:** new `server/index.ts`, `sim/world.ts`, package scripts.
- **Deliverables:** Server ticks at fixed rate; one local bot or dummy player advances.
- **Tests:** Headless sim soak (N ticks); movement regression tests.
- **Exit criteria:** Server runs without GPU/window.
- **Dependencies:** Phase 0.
- **Risks:** Collision world incomplete.
- **Effort:** Large.

### Phase 3: Networking foundation

- **Goal:** Transport + protocol + connection lifecycle.
- **Entry criteria:** Server tick loop exists.
- **Systems affected:** New net modules client+server.
- **Likely files:** `src/net/*`, `server/net/*`, protocol schema.
- **Deliverables:** WS connect; hello/accept; input + snapshot messages; version field.
- **Tests:** Protocol round-trip; fuzz malformed frames; disconnect cleanup.
- **Exit criteria:** One client receives snapshots of dummy state.
- **Dependencies:** Phase 2.
- **Risks:** Premature binary optimization.
- **Effort:** Medium–large.

### Phase 4: Basic multiplayer

- **Goal:** Two browser clients, authoritative movement + rockets + damage/death/respawn.
- **Entry criteria:** Protocol messages stable.
- **Systems affected:** Player spawn, weapons, match rules; remove/repurpose local enemy MP path.
- **Likely files:** `Game.ts`, `Player` adapter, `WeaponSystem` VFX-only, `server/match.ts`.
- **Deliverables:** 2-player join; move; remote interpolate; rocket hurt; die; respawn; score stub.
- **Tests:** Two-client integration (automated headless clients preferred).
- **Exit criteria:** Acceptance criteria in §13 met without prediction polish.
- **Dependencies:** Phase 3.
- **Risks:** Feel “laggy” without prediction.
- **Effort:** Very large.

### Phase 5: Responsive FPS networking

- **Goal:** Prediction, reconciliation, jitter buffer; optional lag comp for future hitscan.
- **Entry criteria:** Basic MP stable.
- **Systems affected:** Client prediction; server corrections; snapshot buffering.
- **Likely files:** `src/net/prediction.ts`, server history buffer.
- **Deliverables:** Smooth local move; correction without rubber-banding extremes; loss tolerance demo.
- **Tests:** Simulated 50–100ms RTT + 5% loss; reconciliation unit tests.
- **Exit criteria:** Playable feel at ~80ms RTT.
- **Dependencies:** Phase 4.
- **Risks:** Correction bugs; rocket prediction complexity.
- **Effort:** Very large.

### Phase 6: Browser deployment

- **Goal:** Hosted static client + remote game server + TLS.
- **Entry criteria:** Local MP works.
- **Systems affected:** Deploy configs, CORS/origin checks, env config.
- **Likely files:** deploy docs, server env, Vite `base` if needed.
- **Deliverables:** Public URL client; WSS game server; health check.
- **Tests:** Cross-browser manual; reconnect after network blip.
- **Exit criteria:** Two machines play over internet.
- **Dependencies:** Phase 4 (Phase 5 preferred).
- **Risks:** Origin/TLS misconfig.
- **Effort:** Medium.

### Phase 7: Production hardening

- **Goal:** Auth, rate limits, metrics, load/soak, abuse controls.
- **Entry criteria:** Deployed prototype.
- **Systems affected:** Auth service, server validation, observability.
- **Deliverables:** Guest→account path; bans; dashboards; load test results.
- **Tests:** Load (target CCU), soak 24h, security checklist.
- **Exit criteria:** Operable under stated player count with monitoring.
- **Dependencies:** Phase 6.
- **Risks:** Overbuilding auth before fun.
- **Effort:** Very large.

---

## 13. Recommended first implementation slice

**Smallest vertical slice proving the architecture:**

1. Browser client loads current temple arena **presentation**.
2. Browser client connects to **one local** authoritative Node server over **WebSocket**.
3. **Two** players can join the same match.
4. Players can **move** (WASD + jump + look); server owns positions.
5. Remote players **interpolate** smoothly.
6. **One rocket** weapon works; server owns fire timing, projectile sim, splash, damage.
7. Server owns **death and respawn** (implement these rules — they do not exist for the player today).
8. Dev tools can simulate **latency and packet loss** on the client or proxy.
9. Explicitly **out of scope:** matchmaking, accounts, cosmetics, Havok, hitscan lag-comp, delta compression, mobile, bots replication.

### Acceptance criteria

- [ ] Two browsers on one machine connect to `ws://localhost:<port>`.
- [ ] Each sees the other move with ≤100ms visual delay at localhost (interpolation on).
- [ ] Firing a rocket damages the other player only when server confirms; health reaches 0 ⇒ death ⇒ respawn at spawn point within configured delay.
- [ ] Client cannot set `health` or `position` by calling exposed JS and have it stick on server.
- [ ] Disconnect removes player entity for the peer within one timeout period.
- [ ] Automated test: protocol connect + 100 input ticks + snapshot decode.
- [ ] Single-player offline mode either preserved via stub server or clearly deferred (document choice).

---

## 14. Questions requiring product decisions

| Decision | Why it matters | Suggested default |
| -------- | -------------- | ----------------- |
| Target player count | Bandwidth, interest management | 8 design / 2 prototype |
| Target browsers | Input/WebGL/WS matrix | Latest Chrome, Firefox, Edge desktop |
| Mobile browser support | Touch controls, performance | Not in v1 |
| Game modes | Match state machine | Free-for-all deathmatch |
| Keep PvE enemies in MP? | CPU/bandwidth | No for first slice |
| Account requirements | Auth complexity | Guests for proto |
| Matchmaking | Extra service | Manual room/code or single local server |
| Regional hosting | Latency | Single region until demand |
| Acceptable latency | Netcode investment | ≤80ms RTT “good”; ≤120ms playable |
| Competitive vs casual security | Validation depth | Casual+server authority first |
| Peer hosting vs dedicated | Cheat/NAT | Dedicated only |
| Persistent progression | DB | None for proto |
| Spectators | Extra replication views | Later |
| Replays | Extra storage/sim | Later |
| Voice chat | WebRTC A/V | Later / third party |

---

## 15. Immediate next actions

Dependency-ordered, highest value first:

1. **Fix documentation drift**  
   - Why: Prevent wrong Havok/flight assumptions.  
   - Modules: `README.md`.  
   - Result: Docs match `InputManager` / disabled physics.  
   - Verify: README controls = F/Click shoot; no claim Havok active.

2. **Extract shared vector/state DTOs without Babylon Mesh**  
   - Why: Network + server prerequisite.  
   - Modules: new `src/sim/types.ts` (or `shared/`).  
   - Result: `PlayerPose`, `ProjectileState` plain data.  
   - Verify: Types compile with `dom` lib optional for server tsconfig.

3. **Implement fixed-timestep movement function**  
   - Why: Authority and prediction need stable steps.  
   - Modules: from `Player.ts` logic → `sim/movement.ts`.  
   - Result: `stepMovement(state, input, dt)` pure.  
   - Verify: Unit test same inputs ⇒ same positions.

4. **Extract rocket integration + splash math**  
   - Why: Server must own projectiles.  
   - Modules: from `WeaponSystem.ts` → `sim/projectiles.ts`.  
   - Result: No Mesh in sim update.  
   - Verify: Unit test flight and splash falloff.

5. **Build minimal AABB collision from Arena constants**  
   - Why: Movement validation and rocket hits need world.  
   - Modules: `Arena.ts` data → `sim/arenaColliders.ts`.  
   - Result: Server/client share colliders.  
   - Verify: Tests for ground/platform standing.

6. **Add Vitest (or similar) and CI smoke**  
   - Why: MP will break silently without tests.  
   - Modules: new test config; GitHub Action optional.  
   - Result: `npm test` runs sim tests.  
   - Verify: CI green on push.

7. **Sketch Node server tick loop (no net yet)**  
   - Why: Prove headless path.  
   - Modules: `server/`.  
   - Result: Logs tick index at 60 Hz with dummy players.  
   - Verify: Runs in terminal without canvas.

8. **Define protocol v0 message list + JSON codec**  
   - Why: Unblocks transport work.  
   - Modules: `shared/protocol.ts`.  
   - Result: Connect/Input/Snapshot/Damage/Death/Respawn types.  
   - Verify: Round-trip encode/decode tests.

9. **Add WebSocket transport behind interface**  
   - Why: First connect path.  
   - Modules: `src/net/`, `server/net/`.  
   - Result: Client receives empty snapshot heartbeat.  
   - Verify: Browser + server log handshake.

10. **Implement 2-player authoritative move + rocket vertical slice**  
    - Why: Proves architecture end-to-end.  
    - Modules: client adapters + server match.  
    - Result: §13 acceptance criteria.  
    - Verify: Manual 2-browser test + integration test.

---

## Appendix A: Protocol inventory (design only — not implemented)

### Client → server

| Message | Required data / systems |
| ------- | ----------------------- |
| Connect request | Protocol version, guest display name |
| Authentication | Token (later) |
| Join match | Match/room id |
| Input command | seq, dt/tick, move bits, jump/dash/shoot edges, aim yaw/pitch |
| Fire command | May be edge in input; or explicit with aim |
| Reload / weapon switch | When ammo model exists |
| Interaction | Future |
| Chat | Future |
| Ping | Client send time |
| Disconnect | Graceful close |

### Server → client

| Message | Required data / systems |
| ------- | ----------------------- |
| Connection accepted/rejected | Player id, reason |
| Match state | Lobby/live/end |
| Initial world state | Map id, seed, players |
| Entity spawn/destroy | id, type, pose |
| Snapshot | tick, ack input seq, poses, projectiles, health |
| Damage / death / respawn | ids, amounts, attacker |
| Score update | Frags |
| Server correction | Pose override |
| Round transition | Timers |
| Error / Pong | Codes; RTT |

**Encoding recommendation:** JSON for prototype control + snapshots until size hurts; then binary with quantized positions. Always version messages. Validate sizes and rates on server.

---

## Appendix B: Bandwidth estimates (labeled estimates — not measured)

**Assumptions:** 60 Hz input, 20 Hz snapshots, ~40 bytes/player pose quantized, 8 bytes header, 2 projectiles avg × 20 bytes, no delta compression, WebSocket framing ~ overhead small.

| Players | Snapshot payload est. | @20 Hz | + inputs @60 Hz (~12 B) | Rough total / client |
| ------- | --------------------- | ------ | ----------------------- | -------------------- |
| 4 | ~200 B | ~4 KB/s | ~0.7 KB/s | ~5 KB/s |
| 8 | ~400 B | ~8 KB/s | ~0.7 KB/s | ~9 KB/s |
| 16 | ~800 B | ~16 KB/s | ~0.7 KB/s | ~17 KB/s |

Server aggregate scales with clients × snapshot fanout (interest management needed above ~16).  
**Not measured:** actual Babylon frame time, heap, or `dist/` size in this audit.

**Likely bottlenecks:** main-thread JS sim+render; rocket particle spam; lack of pooling; server single-thread tick; later serialization cost.

---

## Appendix C: FPS gameplay networking notes

### Movement

Present: walk, jump, dash, air via gravity; no crouch/slide/stairs/moving platforms; no real world collision.  
**Server must run** movement + collision. **Client may predict** same code. Knockback/teleport when added = server events.

### Weapons

Only rockets (projectile + splash). Config mentions reload but unused; ammo infinite.  
**Server owns** fire rate, ammo (when real), projectile spawn/impact/splash/damage.  
**Client** may play muzzle/trail locally on predicted fire, corrected on reject.

### Lag compensation

No history buffer today. For rockets: **present-time server simulation** is appropriate. Hitscan (if added later) needs rewind; not required for first slice.

### Health / match

Health/damage exist partially; death/respawn/score/rounds/pickups/doors/destructibles **absent**. All must be server-owned when added.

---

## Appendix D: Server hosting sketch

**Prototype:** Static Vite client on localhost; one Node game server; no DB; guest names.  
**Production:** CDN/static host; containerized game servers; TLS terminator; optional matchmaking; auth service; logs/metrics; regional deploy; health checks.  
Distinguish: prototype needs only client + game server + WSS.

**Headless requirements:** Run without window/renderer/audio/input/GPU/UI. Needs map colliders + sim; not full Babylon scene. Current code **cannot** do this without extraction.

---

## Appendix E: Identity & security (brief)

**Now:** none.  
**Dev identity:** UUID per connection + display name string.  
**Prod:** session tokens, expiry, match tickets, origin checks on WS, rate limits, no trust of client ids for authority.  
**Browser:** XSS risk if HUD ever injects strings — treat names as text. No secrets in client bundle.

**Cheat surface if client trusted:** position, velocity, fire rate, ammo, health, damage, score, timestamps, claimed latency.  
**Mitigations:** server sim + validation + caps; not “anti-cheat binary” on web.

---

## Appendix F: Reliability edge cases

| Case | Current behavior | Needed |
| ---- | ---------------- | ------ |
| Tab switch | Game stops | Keep net alive; define pause policy |
| High latency / loss | N/A | Interpolation, prediction, timeouts |
| Disconnect | Page unload dispose | Server timeout + entity remove + reconnect policy |
| Version mismatch | N/A | Protocol version reject |
| Unsupported browser | May fail WebGL/pointer lock | Feature detect + message |
| Memory pressure | Unknown | Cap particles/enemies; pooling |

---

## Appendix G: Testing strategy

**Before multiplayer feature work:** unit tests for shared sim (movement, projectiles, splash), protocol encode/decode.  
**Layers:** (1) unit (2) sim (3) protocol (4) client/server integration (5) browser smoke (6) load (7) soak.  
**Missing today:** all layers.

---

## Appendix H: Code quality (MP-relevant debt only)

- Modular files exist but **no engine/game split** and **no sim/render split**.
- Global debug `window.game`.
- Mutable arrays of meshes as game state.
- `as any` for enemy projectiles.
- Dead Havok paths and unused deps (`@babylonjs/gui`, `loaders`, `materials` appear unused in `src` imports).
- Error handling is try/catch around init/dispose; little validation.
- No configuration system beyond hardcoded class fields.
- Threading: single-threaded browser main loop only.

Debt worth paying for MP: sim extraction, tick, protocol, tests. Unrelated style refactors: defer.

---

## Final audit summary

```text
Audit status: COMPLETE
Repository inspected: YES (all tracked source/config/docs; 17 project files)
Current native build status: N/A (no native target)
Current test status: NONE (no automated tests/CI found)
Browser build exists: YES (Vite + Babylon.js + index.html)
Headless server exists: NO
Networking exists: NO
Authoritative simulation exists: NO
Estimated browser-port difficulty: SMALL (already browser-native; harden only)
Estimated multiplayer difficulty: VERY LARGE (sim split + server + netcode + authority)
Recommended prototype transport: WebSockets
Recommended production transport: WebSockets first; WebRTC data channels if measured need
Recommended first milestone: 2-player local WS server — move, interpolate, rocket, damage, respawn
Critical blockers:
  - Simulation coupled to Babylon meshes/camera/DOM
  - No networking or dedicated server
  - Variable timestep and wall-clock gameplay timing
  - Fully client-authored state
High-priority risks:
  - Incomplete world collision vs visual arena
  - Tab visibility freezing loop
  - No test harness during netcode development
  - Scope creep into auth/matchmaking before vertical slice
Open product decisions:
  - Player count, mobile support, game modes, accounts, regions,
    competitive bar, bot inclusion, spectators/voice/replays
```

---

*End of audit. Code was not modified beyond adding this document. Another developer should be able to begin Phase 0 using §12–§15 without repeating the repository inspection.*

---

## Implementation status (2026-07-23)

Multiplayer implementation for this audit’s recommended direction landed on branch **`feat/browser-multiplayer`**. The original findings above are preserved as the pre-implementation baseline.

Completed relative to the audit roadmap:

- Shared renderer-free simulation under `src/shared/simulation` (fixed 60 Hz tick, AABB collision, rockets, combat, FFA match rules)
- Versioned binary protocol (`PROTOCOL_VERSION = 1`) in `src/shared/protocol`
- Dedicated authoritative Node server in `server/` (WebSocket `/ws`, health/ready/metrics)
- Browser multiplayer client in `src/client/` with prediction, reconciliation, and remote interpolation
- Map `reactor-atrium-v1` sized for up to 12 FFA players
- Automated unit, protocol, integration, and 12-player load tests; Docker server image and deployment docs

See also: [architecture](./browser-multiplayer-architecture.md), [protocol](./browser-multiplayer-protocol.md), [development](./browser-multiplayer-development.md), [deployment](./browser-multiplayer-deployment.md), [testing](./browser-multiplayer-testing.md), [security](./browser-multiplayer-security.md), [map design](./multiplayer-map-design.md).
