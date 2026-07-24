import {
  RESPAWN_DELAY_SECONDS,
  SPAWN_PROTECTION_SECONDS,
  TICK_DT,
} from './constants.js'
import type { Vec3 } from './math.js'
import { distanceVec3, distanceXZ } from './math.js'
import type { PlayerSimState } from './playerMovement.js'
import { createPlayerSimState } from './playerMovement.js'
import type { WeaponState } from './weapons.js'
import { createWeaponState } from './weapons.js'

export interface CombatPlayer {
  id: number
  name: string
  sim: PlayerSimState
  weapon: WeaponState
  health: number
  maxHealth: number
  kills: number
  deaths: number
  score: number
  lastScoreTick: number
  respawnTimer: number
  spawnProtection: number
  connected: boolean
}

export function createCombatPlayer(
  id: number,
  name: string,
  spawn: Vec3,
  yaw = 0,
): CombatPlayer {
  return {
    id,
    name,
    sim: createPlayerSimState(spawn, yaw),
    weapon: createWeaponState(),
    health: 100,
    maxHealth: 100,
    kills: 0,
    deaths: 0,
    score: 0,
    lastScoreTick: 0,
    respawnTimer: 0,
    spawnProtection: SPAWN_PROTECTION_SECONDS,
    connected: true,
  }
}

export interface DamageResult {
  killed: boolean
  healthAfter: number
  absorbedByProtection: boolean
}

export function applyDamage(
  victim: CombatPlayer,
  amount: number,
  _attackerId: number | null,
): DamageResult {
  if (!victim.sim.alive) {
    return { killed: false, healthAfter: 0, absorbedByProtection: false }
  }
  if (victim.spawnProtection > 0) {
    return {
      killed: false,
      healthAfter: victim.health,
      absorbedByProtection: true,
    }
  }
  victim.health = Math.max(0, victim.health - amount)
  if (victim.health <= 0) {
    victim.sim.alive = false
    victim.deaths += 1
    victim.respawnTimer = RESPAWN_DELAY_SECONDS
    victim.spawnProtection = 0
    return { killed: true, healthAfter: 0, absorbedByProtection: false }
  }
  return { killed: false, healthAfter: victim.health, absorbedByProtection: false }
}

export function registerKill(attacker: CombatPlayer, tick: number): void {
  attacker.kills += 1
  attacker.score += 1
  attacker.lastScoreTick = tick
}

export function registerSuicide(player: CombatPlayer): void {
  player.score = Math.max(0, player.score - 1)
}

export function stepRespawnTimers(players: Iterable<CombatPlayer>, dt = TICK_DT): number[] {
  const ready: number[] = []
  for (const p of players) {
    if (p.spawnProtection > 0) {
      p.spawnProtection = Math.max(0, p.spawnProtection - dt)
    }
    if (!p.sim.alive && p.respawnTimer > 0) {
      p.respawnTimer -= dt
      if (p.respawnTimer <= 0) {
        p.respawnTimer = 0
        ready.push(p.id)
      }
    }
  }
  return ready
}

export function respawnPlayer(
  player: CombatPlayer,
  spawn: Vec3,
  yaw: number,
): void {
  player.sim = createPlayerSimState(spawn, yaw)
  player.weapon = createWeaponState()
  player.health = player.maxHealth
  player.sim.alive = true
  player.respawnTimer = 0
  player.spawnProtection = SPAWN_PROTECTION_SECONDS
}

export function clearSpawnProtectionOnFire(player: CombatPlayer): void {
  player.spawnProtection = 0
}

export interface SpawnCandidate {
  id: string
  position: Vec3
  yaw: number
  zone: string
}

export function scoreSpawn(
  spawn: SpawnCandidate,
  enemies: ReadonlyArray<{ position: Vec3; alive: boolean }>,
  recentDeaths: ReadonlyArray<{ position: Vec3; age: number }>,
  recentSpawns: ReadonlyArray<{ spawnId: string; age: number }>,
  rockets: ReadonlyArray<{ position: Vec3; alive: boolean }> = [],
  recentDamage: ReadonlyArray<{ position: Vec3; age: number }> = [],
): number {
  let score = 1000
  for (const e of enemies) {
    if (!e.alive) continue
    const d = distanceVec3(spawn.position, e.position)
    if (d < 8) score -= 500
    else if (d < 20) score -= 200
    else if (d < 40) score -= 50
    // Crude LOS: same-ish height and close XZ
    if (d < 50 && Math.abs(spawn.position.y - e.position.y) < 3) {
      score -= 80
    }
  }
  for (const death of recentDeaths) {
    if (death.age < 5 && distanceXZ(spawn.position, death.position) < 15) {
      score -= 150
    }
  }
  for (const rs of recentSpawns) {
    if (rs.spawnId === spawn.id && rs.age < 8) {
      score -= 300
    }
  }
  for (const rocket of rockets) {
    if (!rocket.alive) continue
    if (distanceVec3(spawn.position, rocket.position) < 12) {
      score -= 220
    }
  }
  for (const dmg of recentDamage) {
    if (dmg.age < 4 && distanceXZ(spawn.position, dmg.position) < 12) {
      score -= 100
    }
  }
  // Slight preference for zone diversity when recently used same zone via spawn id prefix
  return score
}

export function pickBestSpawn(
  candidates: readonly SpawnCandidate[],
  enemies: ReadonlyArray<{ position: Vec3; alive: boolean }>,
  recentDeaths: ReadonlyArray<{ position: Vec3; age: number }>,
  recentSpawns: ReadonlyArray<{ spawnId: string; age: number }>,
  rockets: ReadonlyArray<{ position: Vec3; alive: boolean }> = [],
  recentDamage: ReadonlyArray<{ position: Vec3; age: number }> = [],
): SpawnCandidate {
  if (candidates.length === 0) {
    throw new Error('no_spawn_candidates')
  }
  let best = candidates[0]!
  let bestScore = -Infinity
  for (const c of candidates) {
    const s = scoreSpawn(c, enemies, recentDeaths, recentSpawns, rockets, recentDamage)
    if (s > bestScore || (s === bestScore && c.id < best.id)) {
      bestScore = s
      best = c
    }
  }
  return best
}

export interface LeaderboardEntry {
  id: number
  name: string
  kills: number
  deaths: number
  score: number
}

export function sortLeaderboard(players: readonly CombatPlayer[]): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = players.map((p) => ({
    id: p.id,
    name: p.name,
    kills: p.kills,
    deaths: p.deaths,
    score: p.score,
  }))
  entries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.deaths !== b.deaths) return a.deaths - b.deaths
    const pa = players.find((p) => p.id === a.id)!
    const pb = players.find((p) => p.id === b.id)!
    if (pb.lastScoreTick !== pa.lastScoreTick) return pb.lastScoreTick - pa.lastScoreTick
    return a.id - b.id
  })
  return entries
}
