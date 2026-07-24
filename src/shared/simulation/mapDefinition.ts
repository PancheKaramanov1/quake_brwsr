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

const HS = 95
const WALL_H = 18
const WALL_T = 3

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
): MapBox {
  return { id, cx, cy, cz, w, h, d, kind, zone }
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
  ): void => {
    boxes.push(box(`${prefix}_${n++}`, cx, cy, cz, w, h, d, kind, zone))
  }

  // Outer boundary walls (N/S/E/W)
  add('bound', 0, WALL_H / 2, HS, HS * 2, WALL_H, WALL_T, 'boundary', 'courtyard')
  add('bound', 0, WALL_H / 2, -HS, HS * 2, WALL_H, WALL_T, 'boundary', 'courtyard')
  add('bound', HS, WALL_H / 2, 0, WALL_T, WALL_H, HS * 2, 'boundary', 'courtyard')
  add('bound', -HS, WALL_H / 2, 0, WALL_T, WALL_H, HS * 2, 'boundary', 'courtyard')

  // Central atrium multi-level platforms (y ~1.5, 6, 11)
  const atriumLevels: ReadonlyArray<{ y: number; size: number }> = [
    { y: 1.5, size: 28 },
    { y: 6, size: 18 },
    { y: 11, size: 10 },
  ]
  for (const { y, size } of atriumLevels) {
    add('atrium_plat', 0, y, 0, size, 1.2, size, 'platform', 'atrium')
  }

  // Atrium corner pillars + mid cover
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      add('atrium_col', sx * 12, 4, sz * 12, 3, 8, 3, 'structure', 'atrium')
      add('atrium_cover', sx * 8, 1.2, sz * 8, 4, 2.4, 1.5, 'cover', 'atrium')
    }
  }

  // Stepped ramps from ground → mid → high (four cardinals)
  const rampSteps = [
    { y: 2.5, dist: 22, w: 6, d: 5 },
    { y: 4.5, dist: 18, w: 5.5, d: 4.5 },
    { y: 6.5, dist: 14, w: 5, d: 4 },
    { y: 8.5, dist: 10, w: 4.5, d: 3.5 },
    { y: 10.5, dist: 6, w: 4, d: 3 },
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
        `ramp_${dir.tag}`,
        dir.dx * step.dist,
        step.y,
        dir.dz * step.dist,
        dir.dx !== 0 ? step.d : step.w,
        0.8,
        dir.dz !== 0 ? step.d : step.w,
        'ramp',
        'atrium',
      )
    }
  }

  // Cross tunnels under atrium (floors + side walls + exits)
  add('tunnel_floor', 0, 0.4, 0, 8, 0.8, 40, 'platform', 'tunnels')
  add('tunnel_floor', 0, 0.4, 0, 40, 0.8, 8, 'platform', 'tunnels')
  for (const sx of [-1, 1] as const) {
    add('tunnel_wall', sx * 5, 1.8, 0, 1.5, 3.2, 36, 'wall', 'tunnels')
    add('tunnel_wall', 0, 1.8, sx * 5, 36, 3.2, 1.5, 'wall', 'tunnels')
    add('tunnel_exit', sx * 28, 1.2, 0, 6, 2.4, 4, 'platform', 'tunnels')
    add('tunnel_exit', 0, 1.2, sx * 28, 4, 2.4, 6, 'platform', 'tunnels')
  }

  // East / west wing indoor rooms (hollow: floors + walls)
  for (const side of [
    { x: 55, zone: 'east_wing', tag: 'e' },
    { x: -55, zone: 'west_wing', tag: 'w' },
  ] as const) {
    const ox = side.x > 0 ? 1 : -1
    add(`wing_floor_${side.tag}`, side.x, 1.2, 0, 22, 1.2, 34, 'platform', side.zone)
    add(`wing_upper_${side.tag}`, side.x, 6.5, 0, 16, 1.2, 20, 'platform', side.zone)
    add(`wing_ceil_${side.tag}`, side.x, 10, 0, 22, 1, 34, 'structure', side.zone)
    for (const z of [-12, 0, 12] as const) {
      add(`wing_cover_${side.tag}`, side.x - ox * 6, 1.5, z, 2, 3, 5, 'cover', side.zone)
    }
    add(`wing_wall_${side.tag}`, side.x + ox * 11, 5, 0, 2, 10, 34, 'wall', side.zone)
    add(`wing_wall_${side.tag}`, side.x, 5, 17, 22, 10, 2, 'wall', side.zone)
    add(`wing_wall_${side.tag}`, side.x, 5, -17, 22, 10, 2, 'wall', side.zone)
  }

  // Rooftop pads above wings + atrium flanks
  for (const sx of [-1, 1] as const) {
    add('roof', sx * 55, 11.5, 0, 18, 1.2, 18, 'platform', 'rooftop')
    add('roof', sx * 35, 11.5, sx * 35, 12, 1.2, 12, 'platform', 'rooftop')
    add('roof_cover', sx * 55, 13, 6, 3, 2.5, 3, 'cover', 'rooftop')
  }
  add('roof', 0, 11.5, 45, 14, 1.2, 10, 'platform', 'rooftop')
  add('roof', 0, 11.5, -45, 14, 1.2, 10, 'platform', 'rooftop')

  // Courtyard ring platforms + cover
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const r = 70
    const cx = Math.cos(a) * r
    const cz = Math.sin(a) * r
    add('court_plat', cx, 1.5, cz, 10, 1.2, 10, 'platform', 'courtyard')
    add('court_cover', cx * 0.85, 1.4, cz * 0.85, 3, 2.8, 3, 'cover', 'courtyard')
  }

  // Service corridors (NW / SE diagonals)
  add('service_plat', 40, 1.2, -40, 28, 1.2, 8, 'platform', 'service')
  add('service_plat', -40, 1.2, 40, 28, 1.2, 8, 'platform', 'service')
  add('service_plat', 40, 5.5, -40, 12, 1.2, 8, 'platform', 'service')
  add('service_plat', -40, 5.5, 40, 12, 1.2, 8, 'platform', 'service')
  add('service_wall', 40, 3, -44, 26, 4, 1.5, 'wall', 'service')
  add('service_wall', -40, 3, 44, 26, 4, 1.5, 'wall', 'service')
  add('service_cover', 48, 1.5, -40, 2.5, 3, 4, 'cover', 'service')
  add('service_cover', -48, 1.5, 40, 2.5, 3, 4, 'cover', 'service')

  // Connectors linking wings ↔ atrium ↔ rooftop stairs
  for (const sx of [-1, 1] as const) {
    add('conn', sx * 32, 1.5, 0, 14, 1.2, 8, 'platform', 'connectors')
    add('conn', sx * 32, 6, 0, 10, 1.2, 6, 'platform', 'connectors')
    add('conn_ramp', sx * 42, 3.5, 0, 6, 0.8, 5, 'ramp', 'connectors')
    add('conn_ramp', sx * 48, 8.5, 0, 5, 0.8, 5, 'ramp', 'connectors')
  }
  for (const sz of [-1, 1] as const) {
    add('conn', 0, 1.5, sz * 32, 8, 1.2, 14, 'platform', 'connectors')
    add('conn', 0, 6, sz * 32, 6, 1.2, 10, 'platform', 'connectors')
  }

  return boxes
}

function yawAwayFromCenter(x: number, z: number): number {
  // Face outward (away from origin); slight offset so spawns don't stare at each other.
  return Math.atan2(x, z) + 0.35
}

function buildSpawns(): SpawnPointDef[] {
  const defs: ReadonlyArray<{
    id: string
    x: number
    y: number
    z: number
    zone: string
  }> = [
    // Ground ring
    { id: 'spawn_court_ne', x: 62, y: 0.9, z: 62, zone: 'courtyard' },
    { id: 'spawn_court_nw', x: -62, y: 0.9, z: 62, zone: 'courtyard' },
    { id: 'spawn_court_se', x: 62, y: 0.9, z: -62, zone: 'courtyard' },
    { id: 'spawn_court_sw', x: -62, y: 0.9, z: -62, zone: 'courtyard' },
    // Wings
    { id: 'spawn_east_g', x: 48, y: 0.9, z: 22, zone: 'east_wing' },
    { id: 'spawn_east_u', x: 52, y: 7.1, z: -8, zone: 'east_wing' },
    { id: 'spawn_west_g', x: -48, y: 0.9, z: -22, zone: 'west_wing' },
    { id: 'spawn_west_u', x: -52, y: 7.1, z: 8, zone: 'west_wing' },
    // Atrium mid / high
    { id: 'spawn_atr_mid_n', x: 0, y: 6.6, z: 14, zone: 'atrium' },
    { id: 'spawn_atr_mid_s', x: 0, y: 6.6, z: -14, zone: 'atrium' },
    { id: 'spawn_atr_high', x: 6, y: 11.6, z: 0, zone: 'atrium' },
    // Rooftop
    { id: 'spawn_roof_e', x: 55, y: 12.1, z: 4, zone: 'rooftop' },
    { id: 'spawn_roof_w', x: -55, y: 12.1, z: -4, zone: 'rooftop' },
    { id: 'spawn_roof_n', x: 4, y: 12.1, z: 45, zone: 'rooftop' },
    // Tunnels / service / connectors — offset from solid volumes
    { id: 'spawn_tunnel_e', x: 22, y: 0.9, z: 6, zone: 'tunnels' },
    { id: 'spawn_tunnel_w', x: -22, y: 0.9, z: -6, zone: 'tunnels' },
    { id: 'spawn_svc_se', x: 36, y: 0.9, z: -50, zone: 'service' },
    { id: 'spawn_svc_nw', x: -40, y: 6.1, z: 40, zone: 'service' },
    { id: 'spawn_conn_e', x: 32, y: 6.6, z: 0, zone: 'connectors' },
    { id: 'spawn_conn_s', x: 8, y: 0.9, z: -36, zone: 'connectors' },
  ]

  return defs.map((s) => ({
    ...s,
    yaw: yawAwayFromCenter(s.x, s.z),
  }))
}

export const ARENA_MAP: MapDefinition = {
  id: 'reactor-atrium-v1',
  name: 'Reactor Atrium',
  bounds: { halfSize: HS, floorY: 0, ceilingY: 40 },
  boxes: buildBoxes(),
  spawns: buildSpawns(),
  zones: [
    'atrium',
    'rooftop',
    'tunnels',
    'east_wing',
    'west_wing',
    'courtyard',
    'service',
    'connectors',
  ],
}

export function buildAABBs(map: MapDefinition): import('./math.js').AABB[] {
  return map.boxes.map((b) => aabbFromCenterSize(b.cx, b.cy, b.cz, b.w, b.h, b.d))
}
