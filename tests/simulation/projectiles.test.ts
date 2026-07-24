import { describe, expect, it } from 'vitest'
import {
  ROCKET_HIT_RADIUS,
  ROCKET_LIFETIME,
  ROCKET_SPEED,
  TICK_DT,
} from '../../src/shared/simulation/constants.js'
import { aabbFromCenterSize, vec3 } from '../../src/shared/simulation/math.js'
import type { ProjectileState } from '../../src/shared/simulation/weapons.js'
import {
  checkProjectilePlayerHit,
  stepProjectile,
} from '../../src/shared/simulation/weapons.js'

function makeRocket(overrides: Partial<ProjectileState> = {}): ProjectileState {
  return {
    id: 1,
    ownerId: 1,
    position: vec3(0, 2, 0),
    velocity: vec3(0, 0, ROCKET_SPEED),
    age: 0,
    alive: true,
    damage: 100,
    splashRadius: 5,
    ...overrides,
  }
}

describe('projectiles', () => {
  it('moves and ages each step', () => {
    const p = makeRocket({ velocity: vec3(0, 0, ROCKET_SPEED) })
    const z0 = p.position.z

    const impact = stepProjectile(p, [], 100, 0, TICK_DT)

    expect(impact).toBeNull()
    expect(p.alive).toBe(true)
    expect(p.age).toBeCloseTo(TICK_DT, 8)
    expect(p.position.z).toBeGreaterThan(z0)
  })

  it('expires when lifetime is reached', () => {
    const p = makeRocket({
      age: ROCKET_LIFETIME - TICK_DT * 0.5,
      velocity: vec3(0, 0, 0),
      position: vec3(0, 5, 0),
    })

    const impact = stepProjectile(p, [], 100, 0, TICK_DT)

    expect(impact).not.toBeNull()
    expect(p.alive).toBe(false)
    expect(impact!.hitPlayerId).toBeNull()
  })

  it('impacts the floor', () => {
    const p = makeRocket({
      position: vec3(0, 0.05, 0),
      velocity: vec3(0, -20, 0),
    })

    const impact = stepProjectile(p, [], 100, 0, TICK_DT)

    expect(impact).not.toBeNull()
    expect(p.alive).toBe(false)
    expect(p.position.y).toBe(0)
    expect(impact!.hitPlayerId).toBeNull()
  })

  it('impacts a wall AABB', () => {
    const wall = aabbFromCenterSize(0, 2, 5, 4, 4, 1)
    const p = makeRocket({
      position: vec3(0, 2, 4.5),
      velocity: vec3(0, 0, ROCKET_SPEED),
    })

    const impact = stepProjectile(p, [wall], 100, 0, TICK_DT)

    expect(impact).not.toBeNull()
    expect(p.alive).toBe(false)
    expect(impact!.hitPlayerId).toBeNull()
  })

  it('registers a player hit', () => {
    const p = makeRocket({
      position: vec3(0, 1, 0),
      velocity: vec3(0, 0, 0),
    })
    const targetPos = vec3(0, 1, ROCKET_HIT_RADIUS * 0.5)

    const impact = checkProjectilePlayerHit(p, 2, targetPos, true)

    expect(impact).not.toBeNull()
    expect(impact!.hitPlayerId).toBe(2)
    expect(p.alive).toBe(false)
  })

  it('prevents duplicate impacts once alive is false', () => {
    const p = makeRocket({
      position: vec3(0, 1, 0),
      velocity: vec3(0, 0, 0),
    })

    const first = checkProjectilePlayerHit(p, 2, vec3(0, 1, 0.2), true)
    expect(first).not.toBeNull()
    expect(p.alive).toBe(false)

    const secondPlayer = checkProjectilePlayerHit(p, 3, vec3(0, 1, 0.2), true)
    expect(secondPlayer).toBeNull()

    const worldStep = stepProjectile(p, [], 100, 0, TICK_DT)
    expect(worldStep).toBeNull()
    expect(p.alive).toBe(false)
  })
})
