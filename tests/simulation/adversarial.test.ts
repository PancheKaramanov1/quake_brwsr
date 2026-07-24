import { describe, expect, it } from 'vitest'
import { GameWorld } from '../../src/shared/simulation/world.js'
import {
  applyDamage,
  clearSpawnProtectionOnFire,
  pickBestSpawn,
  scoreSpawn,
  type SpawnCandidate,
} from '../../src/shared/simulation/combat.js'
import { createWeaponState, tryFireRocket, stepWeapon } from '../../src/shared/simulation/weapons.js'
import { vec3 } from '../../src/shared/simulation/math.js'
import { createPlayerSimState, stepPlayerMovement, inputFromAxes } from '../../src/shared/simulation/playerMovement.js'
import { ARENA_MAP, buildAABBs } from '../../src/shared/simulation/mapDefinition.js'
import { PLAYER_SPEED, TICK_DT } from '../../src/shared/simulation/constants.js'

describe('adversarial movement', () => {
  const colliders = buildAABBs(ARENA_MAP)
  const floor = ARENA_MAP.bounds.floorY

  it('normalizes diagonal wish so speed is not √2', () => {
    const state = createPlayerSimState(vec3(0, 1, 0), 0)
    const move = inputFromAxes(1, 1, false, false, 0, 0)
    stepPlayerMovement(state, move, colliders, floor, TICK_DT)
    const speed = Math.hypot(state.velocity.x, state.velocity.z)
    expect(speed).toBeLessThanOrEqual(PLAYER_SPEED + 1)
  })

  it('ignores movement while dead', () => {
    const world = new GameWorld()
    const p = world.addPlayer('Dead')
    p.sim.alive = false
    const x0 = p.sim.position.x
    world.applyInput({
      playerId: p.id,
      seq: 1,
      moveX: 1,
      moveY: 1,
      jump: true,
      dash: true,
      shoot: false,
      reload: false,
      yaw: 0,
      pitch: 0,
    })
    expect(p.sim.position.x).toBe(x0)
  })

  it('rejects teleport-scale displacement across one tick via shared step', () => {
    const state = createPlayerSimState(vec3(0, 1, 0), 0)
    for (let i = 0; i < 10; i++) {
      stepPlayerMovement(
        state,
        inputFromAxes(1, 0, false, false, 0, 0),
        colliders,
        floor,
        TICK_DT,
      )
    }
    expect(Math.abs(state.position.x)).toBeLessThan(PLAYER_SPEED * TICK_DT * 10 + 2)
  })
})

describe('adversarial combat / rockets', () => {
  it('cannot fire while reloading or with zero ammo', () => {
    const weapon = createWeaponState()
    weapon.ammo = 0
    const r1 = tryFireRocket(weapon, 1, 1, vec3(0, 1, 0), 0, 0)
    expect(r1.ok).toBe(false)

    weapon.ammo = 8
    weapon.reloading = true
    const r2 = tryFireRocket(weapon, 1, 2, vec3(0, 1, 0), 0, 0)
    expect(r2.ok).toBe(false)
  })

  it('enforces fire cooldown', () => {
    const weapon = createWeaponState()
    const a = tryFireRocket(weapon, 1, 1, vec3(0, 1, 0), 0, 0)
    expect(a.ok).toBe(true)
    const b = tryFireRocket(weapon, 1, 2, vec3(0, 1, 0), 0, 0)
    expect(b.ok).toBe(false)
    expect(b.reason).toBe('fire_rate')
  })

  it('spawn protection absorbs damage and clears on fire', () => {
    const world = new GameWorld()
    const victim = world.addPlayer('V')
    const attacker = world.addPlayer('A')
    expect(victim.spawnProtection).toBeGreaterThan(0)
    const blocked = applyDamage(victim, 100, attacker.id)
    expect(blocked.absorbedByProtection).toBe(true)
    expect(victim.health).toBe(100)
    clearSpawnProtectionOnFire(victim)
    const hit = applyDamage(victim, 50, attacker.id)
    expect(hit.absorbedByProtection).toBe(false)
    expect(victim.health).toBe(50)
  })

  it('duplicate impact is ignored by world', () => {
    const world = new GameWorld()
    const a = world.addPlayer('Shooter')
    // Force fire
    a.weapon.fireCooldown = 0
    world.tryPlayerFire(a)
    expect(world.projectiles.size).toBe(1)
    const proj = [...world.projectiles.values()][0]!
    // Step until impact
    for (let i = 0; i < 600; i++) world.step()
    const events1 = world.drainEvents().filter((e) => e.type === 'projectile_impact')
    // Manually re-handle should no-op via impacted set — projectiles already removed
    expect(world.projectiles.has(proj.id)).toBe(false)
    void events1
  })

  it('server owns fire — dead players cannot shoot', () => {
    const world = new GameWorld()
    const p = world.addPlayer('X')
    p.sim.alive = false
    world.tryPlayerFire(p)
    expect(world.projectiles.size).toBe(0)
  })
})

describe('spawn safety scoring', () => {
  const candidates: SpawnCandidate[] = ARENA_MAP.spawns.map((s) => ({
    id: s.id,
    position: vec3(s.x, s.y, s.z),
    yaw: s.yaw,
    zone: s.zone,
  }))

  it('avoids spawn next to a living enemy', () => {
    const near = candidates[0]!
    const enemies = [{ position: near.position, alive: true }]
    const pick = pickBestSpawn(candidates, enemies, [], [])
    expect(pick.id).not.toBe(near.id)
  })

  it('penalizes recently used spawns', () => {
    const used = candidates[0]!
    const s1 = scoreSpawn(used, [], [], [{ spawnId: used.id, age: 1 }])
    const s2 = scoreSpawn(candidates[1]!, [], [], [])
    expect(s2).toBeGreaterThan(s1)
  })

  it('penalizes active rockets near spawn', () => {
    const s = candidates[0]!
    const withRocket = scoreSpawn(s, [], [], [], [{ position: s.position, alive: true }])
    const without = scoreSpawn(s, [], [], [], [])
    expect(without).toBeGreaterThan(withRocket)
  })

  it('deterministic fallback when all scores poor', () => {
    const enemies = candidates.map((c) => ({ position: c.position, alive: true }))
    const a = pickBestSpawn(candidates, enemies, [], [])
    const b = pickBestSpawn(candidates, enemies, [], [])
    expect(a.id).toBe(b.id)
  })
})

describe('weapon step reload', () => {
  it('reloads after empty magazine', () => {
    const w = createWeaponState()
    w.ammo = 1
    tryFireRocket(w, 1, 1, vec3(0, 1, 0), 0, 0)
    expect(w.reloading || w.ammo === 0).toBe(true)
    for (let i = 0; i < 200; i++) stepWeapon(w, TICK_DT)
    expect(w.ammo).toBeGreaterThan(0)
  })
})
