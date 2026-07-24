# Multiplayer Map Design

## Current map

| Field | Value |
| ----- | ----- |
| Id | `reactor-atrium-v1` |
| Display name | Reactor Atrium |
| Source of truth | `src/shared/simulation/mapDefinition.ts` (`ARENA_MAP`) |
| Bounds | half-size **95**, floor **0**, ceiling **40** |
| Collision | Axis-aligned boxes → `buildAABBs()` for shared sim |
| Mode fit | FFA up to **12** players |

Client presentation should follow the same box layout (or derive meshes from this definition) so visuals match server collision.

## Zones

| Zone | Role |
| ---- | ---- |
| `atrium` | Central multi-level platforms (y ≈ 1.5 / 6 / 11), pillars, cover, cardinal ramps |
| `tunnels` | Cross under atrium — low floor corridors and exits |
| `east_wing` / `west_wing` | Indoor rooms with ground + upper floors and cover |
| `rooftop` | High pads over wings and flanks |
| `courtyard` | Outer ring platforms + cover near boundary |
| `service` | Diagonal NW/SE service corridors |
| `connectors` | Links between wings, atrium, and vertical routes |

Outer **boundary** walls enclose the playable volume.

## Spawns

Twenty spawn points across zones (courtyard corners, wings, atrium mid/high, rooftops, tunnels, service, connectors). Yaw faces roughly **away from center** with a small offset so players do not all stare at each other.

Server combat uses `pickBestSpawn` (shared `combat.ts`) to prefer safer points when respawning.

## Single-player vs multiplayer map

| Mode | Map |
| ---- | --- |
| Multiplayer | Shared `ARENA_MAP` / `reactor-atrium-v1` (client + server) |
| Single-player | Legacy Babylon `Arena.ts` + AI enemies (intentional) |

Movement and rocket combat **constants** are unified via `src/shared/simulation/constants.ts` so damage/speed/fire-rate cannot silently drift. Full SP migration onto Reactor Atrium is deferred to avoid breaking enemy placements.

## Validation

`tests/unit/map.test.ts` asserts ≥16 spawns, ≥3 elevations, zone coverage, bounds, separation, AABB validity, and spawn clearance from solids.

## Design goals for this layout

- **Verticality** — ground, mid, and high fights; rocket splash punishes clustering on small pads
- **Multiple routes** — tunnels, connectors, and ramps reduce spawn camping
- **Cover density** — atrium/wing/courtyard cover boxes break long sightlines
- **Capacity** — enough distinct pads and wings for 12 FFA without constant pile-up in one room
- **Shared AABB** — every solid is an authorable box (`cx,cy,cz,w,h,d` + `kind` + `zone`); no mesh cooking required for netcode

Box `kind` values: `wall`, `platform`, `ramp`, `cover`, `structure`, `boundary` (gameplay currently treats them as solid AABBs; kind is for authoring/filtering).

## Editing the map

1. Change boxes/spawns in `mapDefinition.ts`.
2. Keep `id` stable (`reactor-atrium-v1`) or bump intentionally and update clients (`Welcome.mapId` / `JoinMatch`).
3. Run `tests/unit/map.test.ts` and movement/combat sims.
4. Playtest spawn unfairness and rocket sightlines at 8–12 players.

## Adding a new map (checklist)

1. New `MapDefinition` (or factory) with unique `id`, bounds, boxes, spawns, zones.
2. Wire server/world to select map (today defaults to `ARENA_MAP`).
3. Ensure client loads matching presentation geometry.
4. Protocol: clients already receive `mapId` in `Welcome`.
5. Add unit tests for AABB count/spawns and a quick movement smoke on the new colliders.

## Constraints to respect

- Player capsule approx: radius **0.3**, height **1.8** (`constants.ts`) — leave ledge depths and tunnel heights playable
- Rocket splash radius **5** — tiny rooms become lethal; intentional for FFA
- Stay within bounds half-size or update boundary boxes together
- Prefer data-driven boxes over one-off client-only meshes that the server cannot collide
