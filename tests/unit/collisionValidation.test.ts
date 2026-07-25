/** Collision / map definition validation. */
import { describe, expect, it } from 'vitest'
import { ARENA_MAP, buildAABBs } from '../../src/shared/simulation/mapDefinition.js'
import { PLAYER_RADIUS } from '../../src/shared/simulation/constants.js'
import { pointInAABB, type AABB } from '../../src/shared/simulation/math.js'
import { stepPlayerMovement, createPlayerSimState, inputFromAxes } from '../../src/shared/simulation/playerMovement.js'

describe('collision validation', () => {
  it('every solid box has a collider and unique ids', () => {
    const ids = new Set<string>()
    for (const b of ARENA_MAP.boxes) {
      expect(b.w * b.h * b.d).toBeGreaterThan(0)
      expect(Number.isFinite(b.cx + b.cy + b.cz)).toBe(true)
      expect(ids.has(b.id)).toBe(false)
      ids.add(b.id)
    }
    const solids = ARENA_MAP.boxes.filter((b) => b.collision !== false)
    expect(buildAABBs(ARENA_MAP).length).toBe(solids.length)
  })

  it('spawns are outside solid volumes', () => {
    const aabbs = buildAABBs(ARENA_MAP)
    for (const s of ARENA_MAP.spawns) {
      for (const box of aabbs) {
        const inflated: AABB = {
          minX: box.minX - PLAYER_RADIUS,
          maxX: box.maxX + PLAYER_RADIUS,
          minY: box.minY,
          maxY: box.maxY,
          minZ: box.minZ - PLAYER_RADIUS,
          maxZ: box.maxZ + PLAYER_RADIUS,
        }
        // Feet near floor of spawn — only fail if fully inside solid
        expect(pointInAABB({ x: s.x, y: s.y + 0.9, z: s.z }, inflated)).toBe(false)
      }
    }
  })

  it('player cannot cross outer boundary from inside', () => {
    const aabbs = buildAABBs(ARENA_MAP)
    const hs = ARENA_MAP.bounds.halfSize
    const state = createPlayerSimState({ x: hs - 5, y: 1, z: 0 }, 0)
    for (let i = 0; i < 120; i++) {
      stepPlayerMovement(
        state,
        inputFromAxes(1, 0, false, false, Math.PI / 2, 0),
        aabbs,
        ARENA_MAP.bounds.floorY,
      )
    }
    expect(Math.abs(state.position.x)).toBeLessThan(hs + 1)
    expect(Math.abs(state.position.z)).toBeLessThan(hs + 1)
  })

  it('map supports 12-player FFA scale', () => {
    expect(ARENA_MAP.bounds.halfSize).toBeGreaterThanOrEqual(140)
    expect(ARENA_MAP.zones.length).toBeGreaterThanOrEqual(6)
    expect(ARENA_MAP.spawns.length).toBeGreaterThanOrEqual(20)
  })
})
