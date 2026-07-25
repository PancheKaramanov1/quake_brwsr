# Multiplayer Map Design

## Current map

| Field | Value |
| ----- | ----- |
| Id | `reactor-atrium-v2` |
| Display name | Reactor Atrium |
| Source of truth | `src/shared/simulation/mapDefinition.ts` (`ARENA_MAP`) |
| Bounds | half-size **160**, floor **0**, ceiling **40** (~2.8× footprint vs v1) |
| Collision | Axis-aligned boxes with explicit `collision` → `buildAABBs()` skips `collision: false` |
| Mode fit | FFA up to **12** players |

Client presentation should follow the same box layout (or derive meshes from this definition) so visuals match server collision.

## Zones

| Zone | Role |
| ---- | ---- |
| `reactor_core` | Central multi-level contested platforms (y ≈ 1.5 / 6 / 11), pillars, cover, cardinal ramps |
| `control_deck` | Elevated overlook pads and stair ramps |
| `cooling_yard` | Open mid-ring pads + berms for medium/long range |
| `maintenance` | Lower cross tunnels and branch corridors under the core |
| `generator_hall` | Large E/W interiors with columns and upper floors |
| `service_quarters` | Tight corner room clusters with partitions |
| `cargo_transfer` | Diagonal ramps, stacked cover, mid links |
| `perimeter` | Outer catwalk ring for rotation |

Outer **boundary** walls enclose the playable volume at half-size 160.

## Spawns

Twenty-four-plus spawn points across zones and elevations (ground / mid / high). Yaw faces roughly **away from center** with a small offset so players do not all stare at each other.

Server combat uses `pickBestSpawn` (shared `combat.ts`) to prefer safer points when respawning.

## Single-player vs multiplayer map

| Mode | Map |
| ---- | --- |
| Multiplayer | Shared `ARENA_MAP` / `reactor-atrium-v2` (client + server) |
| Single-player | Legacy Babylon `Arena.ts` + AI enemies (intentional) |

Movement and rocket combat **constants** are unified via `src/shared/simulation/constants.ts` so damage/speed/fire-rate cannot silently drift. Full SP migration onto Reactor Atrium is deferred to avoid breaking enemy placements.

## Validation

`tests/unit/map.test.ts` asserts ≥20 spawns, ≥3 elevations, ≥6 zones, zone coverage, bounds, separation, AABB validity, explicit `collision` flags, and spawn clearance from solids.

## Design goals for this layout

- **Verticality** — ground, mid, and high fights; rocket splash punishes clustering on small pads
- **Multiple routes** — maintenance, cargo links, and perimeter catwalks reduce spawn camping
- **Cover density** — core/hall/yard/cargo cover boxes break long sightlines
- **Capacity** — enough distinct pads and wings for 12 FFA without constant pile-up in one room
- **Shared AABB** — every solid is an authorable box (`cx,cy,cz,w,h,d` + `kind` + `zone` + `collision`); no mesh cooking required for netcode

Box `kind` values: `wall`, `platform`, `ramp`, `cover`, `structure`, `boundary` (gameplay currently treats collidable boxes as solid AABBs; kind is for authoring/filtering).

## Editing the map

1. Change boxes/spawns in `mapDefinition.ts`.
2. Keep `id` stable (`reactor-atrium-v2`) or bump intentionally and update clients (`Welcome.mapId` / `JoinMatch`).
3. Run `tests/unit/map.test.ts` and movement/combat sims.
4. Playtest spawn unfairness and rocket sightlines at 8–12 players.

## Adding a new map (checklist)

1. New `MapDefinition` (or factory) with unique `id`, bounds, boxes, spawns, zones.
2. Wire server/world to select map (today defaults to `ARENA_MAP`).
3. Ensure client loads matching presentation geometry.
4. Protocol: clients already receive `mapId` in `Welcome`.
5. Add unit tests for AABB count/spawns and a quick movement smoke on the new colliders.

## Constraints to respect

- Player capsule approx: radius **0.3**, height **1.8** (`constants.ts`) — leave ledge depths and tunnel heights playable; keep spawns clear of solids by ≥ radius + margin
- Rocket splash radius **5** — tiny rooms become lethal; intentional for FFA
- Stay within bounds half-size or update boundary boxes together
- Prefer data-driven boxes over one-off client-only meshes that the server cannot collide
