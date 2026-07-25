/** Shared arena geometry — no Babylon.js dependency. */

import { aabbFromCenterSize } from './math.js'

export interface MapBox {
  id: string
  cx: number
  cy: number
  cz: number
  w: number
  h: number
  d: number
  kind: 'wall' | 'platform' | 'ramp' | 'cover' | 'structure' | 'boundary'
  zone: string
  /** When false, visual-only (excluded from buildAABBs). Defaults to true for solids. */
  collision: boolean
}

export interface SpawnPointDef {
  id: string
  x: number
  y: number
  z: number
  yaw: number
  zone: string
}

export interface MapDefinition {
  id: string
  name: string
  bounds: { halfSize: number; floorY: number; ceilingY: number }
  boxes: MapBox[]
  spawns: SpawnPointDef[]
  zones: string[]
}

/** ~2.8× footprint vs v1 (halfSize 95 → 160). */
const HS = 160
const WALL_H = 20
const WALL_T = 3.5

function box(
  id: string,
  cx: number,
  cy: number,
  cz: number,
  w: number,
  h: number,
  d: number,
  kind: MapBox['kind'],
  zone: string,
  collision = true,
): MapBox {
  return { id, cx, cy, cz, w, h, d, kind, zone, collision }
}

function buildBoxes(): MapBox[] {
  const boxes: MapBox[] = []
  let n = 0
  const add = (
    prefix: string,
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    kind: MapBox['kind'],
    zone: string,
    collision = true,
  ): void => {
    boxes.push(box(`${prefix}_${n++}`, cx, cy, cz, w, h, d, kind, zone, collision))
  }

  // Outer boundary walls (N/S/E/W) — enclose halfSize
  add('bound', 0, WALL_H / 2, HS, HS * 2, WALL_H, WALL_T, 'boundary', 'perimeter')
  add('bound', 0, WALL_H / 2, -HS, HS * 2, WALL_H, WALL_T, 'boundary', 'perimeter')
  add('bound', HS, WALL_H / 2, 0, WALL_T, WALL_H, HS * 2, 'boundary', 'perimeter')
  add('bound', -HS, WALL_H / 2, 0, WALL_T, WALL_H, HS * 2, 'boundary', 'perimeter')

  // ── reactor_core: central multi-level contested ──────────────────────────
  const coreLevels: ReadonlyArray<{ y: number; size: number }> = [
    { y: 1.5, size: 36 },
    { y: 6, size: 24 },
    { y: 11, size: 14 },
  ]
  for (const { y, size } of coreLevels) {
    add('core_plat', 0, y, 0, size, 1.2, size, 'platform', 'reactor_core')
  }
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      add('core_col', sx * 14, 5, sz * 14, 3.5, 10, 3.5, 'structure', 'reactor_core')
      add('core_cover', sx * 9, 1.3, sz * 9, 4.5, 2.6, 1.8, 'cover', 'reactor_core')
    }
  }
  // Cardinal stepped ramps into core (ground → mid → high)
  const rampSteps = [
    { y: 2.5, dist: 28, w: 7, d: 5.5 },
    { y: 4.5, dist: 22, w: 6.5, d: 5 },
    { y: 6.5, dist: 17, w: 6, d: 4.5 },
    { y: 8.5, dist: 12, w: 5.5, d: 4 },
    { y: 10.5, dist: 7, w: 5, d: 3.5 },
  ] as const
  const dirs: ReadonlyArray<{ dx: number; dz: number; tag: string }> = [
    { dx: 1, dz: 0, tag: 'e' },
    { dx: -1, dz: 0, tag: 'w' },
    { dx: 0, dz: 1, tag: 'n' },
    { dx: 0, dz: -1, tag: 's' },
  ]
  for (const dir of dirs) {
    for (const step of rampSteps) {
      add(
        `core_ramp_${dir.tag}`,
        dir.dx * step.dist,
        step.y,
        dir.dz * step.dist,
        dir.dx !== 0 ? step.d : step.w,
        0.8,
        dir.dz !== 0 ? step.d : step.w,
        'ramp',
        'reactor_core',
      )
    }
  }

  // ── maintenance: lower tunnels under / around core ───────────────────────
  add('maint_floor', 0, 0.4, 0, 10, 0.8, 56, 'platform', 'maintenance')
  add('maint_floor', 0, 0.4, 0, 56, 0.8, 10, 'platform', 'maintenance')
  for (const sx of [-1, 1] as const) {
    add('maint_wall', sx * 6, 1.8, 0, 1.6, 3.2, 50, 'wall', 'maintenance')
    add('maint_wall', 0, 1.8, sx * 6, 50, 3.2, 1.6, 'wall', 'maintenance')
    add('maint_exit', sx * 38, 1.2, 0, 8, 2.4, 5, 'platform', 'maintenance')
    add('maint_exit', 0, 1.2, sx * 38, 5, 2.4, 8, 'platform', 'maintenance')
  }
  // Loop branches toward cooling yard / cargo
  add('maint_branch', 48, 0.4, 28, 24, 0.8, 8, 'platform', 'maintenance')
  add('maint_branch', -48, 0.4, -28, 24, 0.8, 8, 'platform', 'maintenance')
  add('maint_branch', 28, 0.4, -48, 8, 0.8, 24, 'platform', 'maintenance')
  add('maint_branch', -28, 0.4, 48, 8, 0.8, 24, 'platform', 'maintenance')

  // ── generator_hall: large interior with columns (E / W) ──────────────────
  for (const side of [
    { x: 85, zone: 'generator_hall' as const, tag: 'e' },
    { x: -85, zone: 'generator_hall' as const, tag: 'w' },
  ]) {
    const ox = side.x > 0 ? 1 : -1
    add(`gen_floor_${side.tag}`, side.x, 1.2, 0, 36, 1.2, 52, 'platform', side.zone)
    add(`gen_upper_${side.tag}`, side.x, 6.5, 0, 26, 1.2, 32, 'platform', side.zone)
    add(`gen_ceil_${side.tag}`, side.x, 11, 0, 36, 1, 52, 'structure', side.zone)
    add(`gen_wall_${side.tag}`, side.x + ox * 18, 5.5, 0, 2.5, 11, 52, 'wall', side.zone)
    add(`gen_wall_${side.tag}`, side.x, 5.5, 26, 36, 11, 2.5, 'wall', side.zone)
    add(`gen_wall_${side.tag}`, side.x, 5.5, -26, 36, 11, 2.5, 'wall', side.zone)
    // Large columns
    for (const z of [-16, 0, 16] as const) {
      add(`gen_col_${side.tag}`, side.x - ox * 6, 5, z, 4, 10, 4, 'structure', side.zone)
      add(`gen_cover_${side.tag}`, side.x - ox * 12, 1.6, z, 2.5, 3.2, 6, 'cover', side.zone)
    }
  }

  // ── control_deck: elevated pads / overlooks ──────────────────────────────
  for (const sx of [-1, 1] as const) {
    add('deck', sx * 85, 12, 0, 28, 1.2, 24, 'platform', 'control_deck')
    add('deck', sx * 55, 12, sx * 55, 16, 1.2, 16, 'platform', 'control_deck')
    add('deck_cover', sx * 85, 13.5, 8, 3.5, 2.8, 3.5, 'cover', 'control_deck')
  }
  add('deck', 0, 12, 70, 20, 1.2, 14, 'platform', 'control_deck')
  add('deck', 0, 12, -70, 20, 1.2, 14, 'platform', 'control_deck')
  // Stairs up to deck from generator / cargo
  for (const sx of [-1, 1] as const) {
    add('deck_ramp', sx * 68, 4, 0, 6, 0.8, 6, 'ramp', 'control_deck')
    add('deck_ramp', sx * 74, 8, 0, 5.5, 0.8, 5.5, 'ramp', 'control_deck')
    add('deck_ramp', sx * 80, 10.5, 0, 5, 0.8, 5, 'ramp', 'control_deck')
  }
  for (const sz of [-1, 1] as const) {
    add('deck_ramp', 0, 4, sz * 55, 6, 0.8, 6, 'ramp', 'control_deck')
    add('deck_ramp', 0, 8, sz * 62, 5.5, 0.8, 5.5, 'ramp', 'control_deck')
    add('deck_ramp', 0, 10.5, sz * 68, 5, 0.8, 5, 'ramp', 'control_deck')
  }

  // ── cooling_yard: open medium/long-range mid ring ────────────────────────
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const r = 105
    const cx = Math.cos(a) * r
    const cz = Math.sin(a) * r
    add('yard_plat', cx, 1.5, cz, 14, 1.2, 14, 'platform', 'cooling_yard')
    add('yard_cover', cx * 0.88, 1.5, cz * 0.88, 3.5, 3, 3.5, 'cover', 'cooling_yard')
  }
  // Low berms / sightline breakers in yard
  for (const sx of [-1, 1] as const) {
    add('yard_berm', sx * 70, 1.4, sx * 100, 18, 2.8, 3, 'cover', 'cooling_yard')
    add('yard_berm', sx * 100, 1.4, -sx * 70, 3, 2.8, 18, 'cover', 'cooling_yard')
  }

  // ── service_quarters: tight room clusters (corners) ──────────────────────
  for (const cluster of [
    { x: -95, z: 95, tag: 'nw', ox: 1, oz: -1 },
    { x: 95, z: -95, tag: 'se', ox: -1, oz: 1 },
    { x: 95, z: 95, tag: 'ne', ox: -1, oz: -1 },
    { x: -95, z: -95, tag: 'sw', ox: 1, oz: 1 },
  ] as const) {
    add(`sq_floor_${cluster.tag}`, cluster.x, 1.1, cluster.z, 28, 1.1, 28, 'platform', 'service_quarters')
    // Outer two walls solid; inward faces leave a doorway gap via split segments
    add(`sq_wall_${cluster.tag}`, cluster.x, 3.5, cluster.z - cluster.oz * 14, 28, 7, 2, 'wall', 'service_quarters')
    add(`sq_wall_${cluster.tag}`, cluster.x - cluster.ox * 14, 3.5, cluster.z, 2, 7, 24, 'wall', 'service_quarters')
    add(`sq_door_${cluster.tag}`, cluster.x + cluster.ox * 10, 3.5, cluster.z + cluster.oz * 14, 8, 7, 2, 'wall', 'service_quarters')
    add(`sq_door_${cluster.tag}`, cluster.x + cluster.ox * 14, 3.5, cluster.z - cluster.oz * 10, 2, 7, 8, 'wall', 'service_quarters')
    add(`sq_part_${cluster.tag}`, cluster.x - 4, 3, cluster.z, 1.5, 6, 12, 'wall', 'service_quarters')
    add(`sq_part_${cluster.tag}`, cluster.x + 5, 3, cluster.z + 4, 10, 6, 1.5, 'wall', 'service_quarters')
    add(`sq_cover_${cluster.tag}`, cluster.x + 6, 1.4, cluster.z - 6, 2.5, 2.8, 4, 'cover', 'service_quarters')
    add(`sq_upper_${cluster.tag}`, cluster.x, 6.2, cluster.z, 14, 1.1, 14, 'platform', 'service_quarters')
  }

  // ── cargo_transfer: ramps + stacked cover (NE–SW diagonals + mid links) ──
  add('cargo_plat', 55, 1.2, 55, 32, 1.2, 10, 'platform', 'cargo_transfer')
  add('cargo_plat', -55, 1.2, -55, 32, 1.2, 10, 'platform', 'cargo_transfer')
  add('cargo_plat', 55, 1.2, -55, 10, 1.2, 32, 'platform', 'cargo_transfer')
  add('cargo_plat', -55, 1.2, 55, 10, 1.2, 32, 'platform', 'cargo_transfer')
  add('cargo_mid', 55, 5.5, 55, 16, 1.2, 10, 'platform', 'cargo_transfer')
  add('cargo_mid', -55, 5.5, -55, 16, 1.2, 10, 'platform', 'cargo_transfer')
  add('cargo_stack', 48, 1.5, 62, 4, 3, 4, 'cover', 'cargo_transfer')
  add('cargo_stack', 62, 1.5, 48, 4, 3, 4, 'cover', 'cargo_transfer')
  add('cargo_stack', 48, 4.2, 62, 4, 2.5, 4, 'cover', 'cargo_transfer')
  add('cargo_stack', -48, 1.5, -62, 4, 3, 4, 'cover', 'cargo_transfer')
  add('cargo_stack', -62, 1.5, -48, 4, 3, 4, 'cover', 'cargo_transfer')
  add('cargo_stack', -48, 4.2, -62, 4, 2.5, 4, 'cover', 'cargo_transfer')
  for (const sx of [-1, 1] as const) {
    add('cargo_ramp', sx * 42, 3.2, sx * 42, 7, 0.8, 7, 'ramp', 'cargo_transfer')
    add('cargo_ramp', sx * 48, 7.5, sx * 48, 6, 0.8, 6, 'ramp', 'cargo_transfer')
  }
  // Links core ↔ halls
  for (const sx of [-1, 1] as const) {
    add('cargo_link', sx * 48, 1.5, 0, 18, 1.2, 10, 'platform', 'cargo_transfer')
    add('cargo_link', sx * 48, 6, 0, 12, 1.2, 8, 'platform', 'cargo_transfer')
  }
  for (const sz of [-1, 1] as const) {
    add('cargo_link', 0, 1.5, sz * 48, 10, 1.2, 18, 'platform', 'cargo_transfer')
    add('cargo_link', 0, 6, sz * 48, 8, 1.2, 12, 'platform', 'cargo_transfer')
  }

  // ── perimeter: catwalk / rotation ring near boundary ─────────────────────
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    const r = 140
    const cx = Math.cos(a) * r
    const cz = Math.sin(a) * r
    add('peri_walk', cx, 5.5, cz, 12, 1.1, 12, 'platform', 'perimeter')
    if (i % 2 === 0) {
      add('peri_cover', cx * 0.94, 6.8, cz * 0.94, 3, 2.5, 3, 'cover', 'perimeter')
    }
  }
  // Catwalk connectors between perimeter pads (low walls as rails)
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2
    const a1 = ((i + 1) / 12) * Math.PI * 2
    const mx = ((Math.cos(a0) + Math.cos(a1)) / 2) * 140
    const mz = ((Math.sin(a0) + Math.sin(a1)) / 2) * 140
    const span = Math.hypot(Math.cos(a1) - Math.cos(a0), Math.sin(a1) - Math.sin(a0)) * 140
    const angle = Math.atan2(Math.sin(a1) - Math.sin(a0), Math.cos(a1) - Math.cos(a0))
    const w = Math.abs(Math.cos(angle)) * span + Math.abs(Math.sin(angle)) * 4
    const d = Math.abs(Math.sin(angle)) * span + Math.abs(Math.cos(angle)) * 4
    add('peri_bridge', mx, 5.5, mz, Math.max(w, 6), 1.1, Math.max(d, 6), 'platform', 'perimeter')
  }
  // Access ramps from yard up to perimeter
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    add('peri_ramp', Math.cos(a) * 120, 3.2, Math.sin(a) * 120, 6, 0.8, 6, 'ramp', 'perimeter')
  }

  return boxes
}

function yawAwayFromCenter(x: number, z: number): number {
  return Math.atan2(x, z) + 0.35
}

function buildSpawns(): SpawnPointDef[] {
  // Clearance: keep PLAYER_RADIUS (0.3) + ~0.3 margin from solid volumes.
  const defs: ReadonlyArray<{
    id: string
    x: number
    y: number
    z: number
    zone: string
  }> = [
    // cooling_yard — open ground ring
    { id: 'spawn_yard_ne', x: 110, y: 0.9, z: 110, zone: 'cooling_yard' },
    { id: 'spawn_yard_nw', x: -110, y: 0.9, z: 110, zone: 'cooling_yard' },
    { id: 'spawn_yard_se', x: 110, y: 0.9, z: -110, zone: 'cooling_yard' },
    { id: 'spawn_yard_sw', x: -110, y: 0.9, z: -110, zone: 'cooling_yard' },
    { id: 'spawn_yard_n', x: 0, y: 0.9, z: 118, zone: 'cooling_yard' },
    { id: 'spawn_yard_e', x: 118, y: 0.9, z: 0, zone: 'cooling_yard' },

    // generator_hall (clear of 4×4 columns at ±16 / 0)
    { id: 'spawn_gen_e_g', x: 72, y: 1.9, z: 22, zone: 'generator_hall' },
    { id: 'spawn_gen_e_u', x: 90, y: 7.2, z: -10, zone: 'generator_hall' },
    { id: 'spawn_gen_w_g', x: -72, y: 1.9, z: -22, zone: 'generator_hall' },
    { id: 'spawn_gen_w_u', x: -90, y: 7.2, z: 10, zone: 'generator_hall' },

    // reactor_core mid / high (platforms 24 / 14; clear of corner columns)
    { id: 'spawn_core_mid_n', x: 0, y: 6.7, z: 16, zone: 'reactor_core' },
    { id: 'spawn_core_mid_s', x: 0, y: 6.7, z: -16, zone: 'reactor_core' },
    { id: 'spawn_core_high', x: 4, y: 11.7, z: 4, zone: 'reactor_core' },
    { id: 'spawn_core_mid_e', x: 16, y: 6.7, z: 0, zone: 'reactor_core' },

    // control_deck (clear of deck_cover at z≈±8)
    { id: 'spawn_deck_e', x: 85, y: 12.7, z: -12, zone: 'control_deck' },
    { id: 'spawn_deck_w', x: -85, y: 12.7, z: 12, zone: 'control_deck' },
    { id: 'spawn_deck_n', x: 10, y: 12.7, z: 70, zone: 'control_deck' },
    { id: 'spawn_deck_s', x: -10, y: 12.7, z: -70, zone: 'control_deck' },

    // maintenance tunnels (between side walls at |x| or |z| = 6)
    { id: 'spawn_maint_e', x: 30, y: 0.9, z: 7.5, zone: 'maintenance' },
    { id: 'spawn_maint_w', x: -30, y: 0.9, z: -7.5, zone: 'maintenance' },
    { id: 'spawn_maint_n', x: 7.5, y: 0.9, z: 30, zone: 'maintenance' },

    // service_quarters (clear of cover at cluster+(6,-6) and partitions)
    { id: 'spawn_sq_nw', x: -100, y: 1.8, z: 102, zone: 'service_quarters' },
    { id: 'spawn_sq_se', x: 100, y: 1.8, z: -88, zone: 'service_quarters' },
    { id: 'spawn_sq_ne_u', x: 92, y: 6.9, z: 98, zone: 'service_quarters' },

    // cargo_transfer (clear of stacked crates)
    { id: 'spawn_cargo_ne', x: 55, y: 1.9, z: 50, zone: 'cargo_transfer' },
    { id: 'spawn_cargo_sw', x: -55, y: 6.2, z: -48, zone: 'cargo_transfer' },
    { id: 'spawn_cargo_link_e', x: 48, y: 6.7, z: 5, zone: 'cargo_transfer' },

    // perimeter catwalk pads (r ≈ 140)
    { id: 'spawn_peri_0', x: 140, y: 6.2, z: 0, zone: 'perimeter' },
    { id: 'spawn_peri_1', x: -140, y: 6.2, z: 0, zone: 'perimeter' },
    { id: 'spawn_peri_2', x: 0, y: 6.2, z: 140, zone: 'perimeter' },
    { id: 'spawn_peri_3', x: 121, y: 6.2, z: 70, zone: 'perimeter' },
  ]

  return defs.map((s) => ({
    ...s,
    yaw: yawAwayFromCenter(s.x, s.z),
  }))
}

export const ARENA_MAP: MapDefinition = {
  id: 'reactor-atrium-v2',
  name: 'Reactor Atrium',
  bounds: { halfSize: HS, floorY: 0, ceilingY: 40 },
  boxes: buildBoxes(),
  spawns: buildSpawns(),
  zones: [
    'reactor_core',
    'control_deck',
    'cooling_yard',
    'maintenance',
    'generator_hall',
    'service_quarters',
    'cargo_transfer',
    'perimeter',
  ],
}

export function buildAABBs(map: MapDefinition): import('./math.js').AABB[] {
  return map.boxes
    .filter((b) => b.collision !== false)
    .map((b) => aabbFromCenterSize(b.cx, b.cy, b.cz, b.w, b.h, b.d))
}
