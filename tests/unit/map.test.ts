import { describe, expect, it } from 'vitest'
import { ARENA_MAP, buildAABBs } from '../../src/shared/simulation/mapDefinition.js'
import { PLAYER_RADIUS } from '../../src/shared/simulation/constants.js'

describe('ARENA_MAP', () => {
  it('has at least 20 spawn points', () => {
    expect(ARENA_MAP.spawns.length).toBeGreaterThanOrEqual(20)
  })

  it('has at least 3 distinct spawn Y elevations (rounded)', () => {
    const elevations = new Set(ARENA_MAP.spawns.map((s) => Math.round(s.y)))
    expect(elevations.size).toBeGreaterThanOrEqual(3)
  })

  it('defines at least 6 zones', () => {
    expect(ARENA_MAP.zones.length).toBeGreaterThanOrEqual(6)
  })

  it('buildAABBs returns one AABB per collidable box', () => {
    const aabbs = buildAABBs(ARENA_MAP)
    const collidable = ARENA_MAP.boxes.filter((b) => b.collision !== false)
    expect(aabbs.length).toBe(collidable.length)
    expect(aabbs.length).toBeGreaterThan(0)
  })

  it('every MapBox has an explicit collision boolean', () => {
    for (const b of ARENA_MAP.boxes) {
      expect(typeof b.collision).toBe('boolean')
    }
  })

  it('spawn points are inside map bounds', () => {
    const hs = ARENA_MAP.bounds.halfSize
    for (const s of ARENA_MAP.spawns) {
      expect(Math.abs(s.x)).toBeLessThan(hs)
      expect(Math.abs(s.z)).toBeLessThan(hs)
      expect(s.y).toBeGreaterThanOrEqual(ARENA_MAP.bounds.floorY)
      expect(s.y).toBeLessThan(ARENA_MAP.bounds.ceilingY)
    }
  })

  it('has no duplicate spawn positions', () => {
    const keys = ARENA_MAP.spawns.map((s) => `${s.x.toFixed(2)},${s.y.toFixed(2)},${s.z.toFixed(2)}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('spawns have minimum separation', () => {
    const minSep = 3
    for (let i = 0; i < ARENA_MAP.spawns.length; i++) {
      for (let j = i + 1; j < ARENA_MAP.spawns.length; j++) {
        const a = ARENA_MAP.spawns[i]!
        const b = ARENA_MAP.spawns[j]!
        const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
        expect(d).toBeGreaterThanOrEqual(minSep)
      }
    }
  })

  it('AABBs are valid (min < max)', () => {
    for (const box of buildAABBs(ARENA_MAP)) {
      expect(box.minX).toBeLessThan(box.maxX)
      expect(box.minY).toBeLessThan(box.maxY)
      expect(box.minZ).toBeLessThan(box.maxZ)
    }
  })

  it('spawns have clearance from solid AABBs at body radius', () => {
    const aabbs = buildAABBs(ARENA_MAP)
    for (const s of ARENA_MAP.spawns) {
      const bodyY = s.y + 0.9
      let blocked = false
      for (const box of aabbs) {
        const isFloorLike = box.maxY - box.minY < 1.2 && box.maxY <= s.y + 0.2
        if (isFloorLike) continue
        const cx = Math.max(box.minX, Math.min(s.x, box.maxX))
        const cy = Math.max(box.minY, Math.min(bodyY, box.maxY))
        const cz = Math.max(box.minZ, Math.min(s.z, box.maxZ))
        const d = Math.hypot(s.x - cx, bodyY - cy, s.z - cz)
        if (d < PLAYER_RADIUS - 0.01 && box.maxY > s.y + 0.15) {
          blocked = true
        }
      }
      expect(blocked).toBe(false)
    }
  })

  it('zones cover spawn zone ids', () => {
    const zoneIds = new Set(ARENA_MAP.zones)
    for (const s of ARENA_MAP.spawns) {
      expect(zoneIds.has(s.zone)).toBe(true)
    }
  })

  it('client/server map identity is single source (id + spawn count)', () => {
    expect(ARENA_MAP.id).toBe('reactor-atrium-v2')
    expect(ARENA_MAP.spawns.length).toBeGreaterThanOrEqual(20)
  })
})
