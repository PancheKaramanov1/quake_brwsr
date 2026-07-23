import { describe, expect, it } from 'vitest'
import {
  PLAYER_SPEED,
  TICK_DT,
} from '../../src/shared/simulation/constants.js'
import { FixedTimestep } from '../../src/shared/simulation/fixedTimestep.js'
import type { MoveInput } from '../../src/shared/simulation/playerMovement.js'
import {
  createPlayerSimState,
  stepPlayerMovement,
} from '../../src/shared/simulation/playerMovement.js'
import { cloneVec3, vec3 } from '../../src/shared/simulation/math.js'

function idleInput(overrides: Partial<MoveInput> = {}): MoveInput {
  return {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    dash: false,
    yaw: 0,
    pitch: 0,
    ...overrides,
  }
}

/** Horizontal displacement length (XZ). */
function horizDelta(
  before: { x: number; z: number },
  after: { x: number; z: number },
): number {
  const dx = after.x - before.x
  const dz = after.z - before.z
  return Math.sqrt(dx * dx + dz * dz)
}

describe('player movement', () => {
  it('advances position with forward input', () => {
    const state = createPlayerSimState(vec3(0, 0.9, 0), 0)
    const start = cloneVec3(state.position)

    stepPlayerMovement(state, idleInput({ forward: true }), [], 0, TICK_DT)

    expect(state.position.z).toBeGreaterThan(start.z)
    expect(horizDelta(start, state.position)).toBeCloseTo(PLAYER_SPEED * TICK_DT, 5)
  })

  it('jump leaves ground then lands', () => {
    const state = createPlayerSimState(vec3(0, 0.9, 0), 0)
    expect(state.grounded).toBe(true)

    stepPlayerMovement(state, idleInput({ jump: true }), [], 0, TICK_DT)
    expect(state.grounded).toBe(false)
    expect(state.jumpVelocity).toBeGreaterThan(0)

    let landed = false
    for (let i = 0; i < 120; i++) {
      stepPlayerMovement(state, idleInput(), [], 0, TICK_DT)
      if (state.grounded) {
        landed = true
        break
      }
    }

    expect(landed).toBe(true)
    expect(state.jumpVelocity).toBe(0)
  })

  it('same inputs and dt produce the same result (determinism)', () => {
    const run = (): ReturnType<typeof createPlayerSimState> => {
      const state = createPlayerSimState(vec3(1.5, 0.9, -2), 0.25)
      const sequence: MoveInput[] = [
        idleInput({ forward: true, yaw: 0.25 }),
        idleInput({ forward: true, right: true, yaw: 0.25 }),
        idleInput({ jump: true, yaw: 0.25 }),
        idleInput({ forward: true, yaw: 0.4 }),
        idleInput({ yaw: 0.4 }),
        idleInput({ backward: true, yaw: 0.4 }),
      ]
      for (const input of sequence) {
        stepPlayerMovement(state, input, [], 0, TICK_DT)
      }
      for (let i = 0; i < 40; i++) {
        stepPlayerMovement(state, idleInput({ yaw: 0.4 }), [], 0, TICK_DT)
      }
      return state
    }

    const a = run()
    const b = run()

    expect(a.position).toEqual(b.position)
    expect(a.velocity).toEqual(b.velocity)
    expect(a.yaw).toBe(b.yaw)
    expect(a.pitch).toBe(b.pitch)
    expect(a.jumpVelocity).toBe(b.jumpVelocity)
    expect(a.grounded).toBe(b.grounded)
    expect(a.dashRemaining).toBe(b.dashRemaining)
    expect(a.dashCooldown).toBe(b.dashCooldown)
    expect(a.jumpCooldown).toBe(b.jumpCooldown)
  })

  it('FixedTimestep runs the expected step count', () => {
    const ts = new FixedTimestep(TICK_DT, 8)
    let steps = 0
    const executed = ts.advance(TICK_DT * 3, () => {
      steps += 1
    })
    expect(executed).toBe(3)
    expect(steps).toBe(3)

    steps = 0
    const capped = ts.advance(TICK_DT * 100, () => {
      steps += 1
    })
    expect(capped).toBe(8)
    expect(steps).toBe(8)
  })

  it('limits per-tick displacement to PLAYER_SPEED (speed hack resistance)', () => {
    const state = createPlayerSimState(vec3(0, 0.9, 0), 0)
    const start = cloneVec3(state.position)

    // Wish direction is always normalized internally; even "max" forward cannot exceed speed*dt.
    stepPlayerMovement(state, idleInput({ forward: true }), [], 0, TICK_DT)

    const moved = horizDelta(start, state.position)
    expect(moved).toBeLessThanOrEqual(PLAYER_SPEED * TICK_DT + 1e-9)
    expect(moved).toBeCloseTo(PLAYER_SPEED * TICK_DT, 5)

    // Speed along XZ from reported velocity is also capped.
    const speed = Math.sqrt(state.velocity.x ** 2 + state.velocity.z ** 2)
    expect(speed).toBeLessThanOrEqual(PLAYER_SPEED + 1e-6)
  })
})
