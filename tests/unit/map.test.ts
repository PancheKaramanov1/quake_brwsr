import { describe, expect, it } from 'vitest'
import { ARENA_MAP, buildAABBs } from '../../src/shared/simulation/mapDefinition.js'

describe('ARENA_MAP', () => {
  it('has at least 16 spawn points', () => {
    expect(ARENA_MAP.spawns.length).toBeGreaterThanOrEqual(16)
  })

  it('has at least 3 distinct spawn Y elevations (rounded)', () => {
    const elevations = new Set(ARENA_MAP.spawns.map((s) => Math.round(s.y)))
    expect(elevations.size).toBeGreaterThanOrEqual(3)
  })

  it('defines at least 6 zones', () => {
    expect(ARENA_MAP.zones.length).toBeGreaterThanOrEqual(6)
  })

  it('buildAABBs returns one AABB per box', () => {
    const aabbs = buildAABBs(ARENA_MAP)
    expect(aabbs.length).toBe(ARENA_MAP.boxes.length)
    expect(aabbs.length).toBeGreaterThan(0)
  })
})
