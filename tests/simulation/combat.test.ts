import { describe, expect, it } from 'vitest'
import {
  ROCKET_AMMO_CAPACITY,
  ROCKET_FIRE_INTERVAL,
  ROCKET_RELOAD_TIME,
  TICK_DT,
} from '../../src/shared/simulation/constants.js'
import {
  applyDamage,
  createCombatPlayer,
  respawnPlayer,
  sortLeaderboard,
} from '../../src/shared/simulation/combat.js'
import { vec3 } from '../../src/shared/simulation/math.js'
import {
  computeSplashDamage,
  createWeaponState,
  stepWeapon,
  tryFireRocket,
  tryStartReload,
} from '../../src/shared/simulation/weapons.js'

describe('combat', () => {
  it('damage reduces health', () => {
    const victim = createCombatPlayer(1, 'victim', vec3(0, 1, 0))
    victim.spawnProtection = 0

    const result = applyDamage(victim, 35, 2)

    expect(result.killed).toBe(false)
    expect(result.absorbedByProtection).toBe(false)
    expect(result.healthAfter).toBe(65)
    expect(victim.health).toBe(65)
    expect(victim.sim.alive).toBe(true)
  })

  it('kills at 0 health', () => {
    const victim = createCombatPlayer(1, 'victim', vec3(0, 1, 0))
    victim.spawnProtection = 0

    const result = applyDamage(victim, 100, 2)

    expect(result.killed).toBe(true)
    expect(result.healthAfter).toBe(0)
    expect(victim.health).toBe(0)
    expect(victim.sim.alive).toBe(false)
    expect(victim.deaths).toBe(1)
  })

  it('spawn protection absorbs damage', () => {
    const victim = createCombatPlayer(1, 'victim', vec3(0, 1, 0))
    expect(victim.spawnProtection).toBeGreaterThan(0)

    const result = applyDamage(victim, 80, 2)

    expect(result.absorbedByProtection).toBe(true)
    expect(result.killed).toBe(false)
    expect(result.healthAfter).toBe(100)
    expect(victim.health).toBe(100)
    expect(victim.sim.alive).toBe(true)
  })

  it('splash damage falls off with distance via computeSplashDamage', () => {
    const center = vec3(0, 1, 0)
    const hits = computeSplashDamage(
      center,
      [
        { id: 1, position: vec3(0, 1, 0), alive: true },
        { id: 2, position: vec3(2.5, 1, 0), alive: true },
        { id: 3, position: vec3(10, 1, 0), alive: true },
      ],
      50,
      5,
    )

    const near = hits.find((h) => h.playerId === 1)
    const mid = hits.find((h) => h.playerId === 2)
    const far = hits.find((h) => h.playerId === 3)

    expect(near?.damage).toBe(50)
    expect(mid?.damage).toBeGreaterThan(0)
    expect(mid!.damage).toBeLessThan(near!.damage)
    expect(far).toBeUndefined()
  })

  it('leaderboard sorts by score, then deaths, then id', () => {
    const a = createCombatPlayer(3, 'a', vec3())
    const b = createCombatPlayer(1, 'b', vec3())
    const c = createCombatPlayer(2, 'c', vec3())
    const d = createCombatPlayer(4, 'd', vec3())

    a.score = 5
    a.deaths = 2
    a.lastScoreTick = 10

    b.score = 5
    b.deaths = 1
    b.lastScoreTick = 10

    c.score = 5
    c.deaths = 1
    c.lastScoreTick = 10

    d.score = 3
    d.deaths = 0
    d.lastScoreTick = 10

    const board = sortLeaderboard([a, b, c, d])
    expect(board.map((e) => e.id)).toEqual([1, 2, 3, 4])
  })

  it('respawn restores health and alive', () => {
    const player = createCombatPlayer(1, 'p', vec3(0, 1, 0))
    player.spawnProtection = 0
    applyDamage(player, 100, null)
    expect(player.sim.alive).toBe(false)

    respawnPlayer(player, vec3(5, 2, -3), 1.2)

    expect(player.sim.alive).toBe(true)
    expect(player.health).toBe(player.maxHealth)
    expect(player.sim.position).toEqual(vec3(5, 2, -3))
    expect(player.sim.yaw).toBe(1.2)
    expect(player.respawnTimer).toBe(0)
    expect(player.spawnProtection).toBeGreaterThan(0)
  })

  it('weapon fire rate, ammo, and reload via tryFireRocket / stepWeapon', () => {
    const weapon = createWeaponState()
    expect(weapon.ammo).toBe(ROCKET_AMMO_CAPACITY)

    const first = tryFireRocket(weapon, 1, 1, vec3(0, 1, 0), 0, 0)
    expect(first.ok).toBe(true)
    expect(weapon.ammo).toBe(ROCKET_AMMO_CAPACITY - 1)
    expect(weapon.fireCooldown).toBeCloseTo(ROCKET_FIRE_INTERVAL, 5)

    const blocked = tryFireRocket(weapon, 1, 2, vec3(0, 1, 0), 0, 0)
    expect(blocked.ok).toBe(false)
    expect(blocked.reason).toBe('fire_rate')

    let t = 0
    while (weapon.fireCooldown > 0 && t < 2) {
      stepWeapon(weapon, TICK_DT)
      t += TICK_DT
    }
    expect(weapon.fireCooldown).toBe(0)

    const second = tryFireRocket(weapon, 1, 3, vec3(0, 1, 0), 0, 0)
    expect(second.ok).toBe(true)

    // Drain remaining ammo
    weapon.fireCooldown = 0
    while (weapon.ammo > 0) {
      const r = tryFireRocket(weapon, 1, 100 + weapon.ammo, vec3(0, 1, 0), 0, 0)
      expect(r.ok).toBe(true)
      weapon.fireCooldown = 0
    }
    expect(weapon.ammo).toBe(0)
    expect(weapon.reloading).toBe(true)

    const empty = tryFireRocket(weapon, 1, 200, vec3(0, 1, 0), 0, 0)
    expect(empty.ok).toBe(false)
    expect(empty.reason).toBe('reloading')

    let reloadT = 0
    while (weapon.reloading && reloadT < ROCKET_RELOAD_TIME + 1) {
      stepWeapon(weapon, TICK_DT)
      reloadT += TICK_DT
    }
    expect(weapon.reloading).toBe(false)
    expect(weapon.ammo).toBe(ROCKET_AMMO_CAPACITY)

    // Manual reload path after partial spend
    tryFireRocket(weapon, 1, 300, vec3(0, 1, 0), 0, 0)
    weapon.fireCooldown = 0
    expect(tryStartReload(weapon)).toBe(true)
    expect(weapon.reloading).toBe(true)
  })
})
