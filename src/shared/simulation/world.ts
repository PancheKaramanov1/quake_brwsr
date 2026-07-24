import {
  MATCH_DURATION_SECONDS,
  MAX_PLAYERS,
  PLAYER_EYE_OFFSET,
  SCORE_LIMIT,
  SNAPSHOT_INTERVAL_TICKS,
  TICK_DT,
} from './constants.js'
import {
  applyDamage,
  clearSpawnProtectionOnFire,
  createCombatPlayer,
  type CombatPlayer,
  pickBestSpawn,
  registerKill,
  registerSuicide,
  respawnPlayer,
  sortLeaderboard,
  stepRespawnTimers,
  type SpawnCandidate,
} from './combat.js'
import { ARENA_MAP, buildAABBs, type MapDefinition } from './mapDefinition.js'
import type { AABB, Vec3 } from './math.js'
import { cloneVec3, vec3, yawPitchToDirection } from './math.js'
import { inputFromAxes, stepPlayerMovement } from './playerMovement.js'
import {
  checkProjectilePlayerHit,
  computeSplashDamage,
  createWeaponState,
  eyePosition,
  type ImpactEvent,
  type ProjectileState,
  stepProjectile,
  stepWeapon,
  tryFireRocket,
  tryStartReload,
} from './weapons.js'
import { MatchPhase } from '../protocol/messages.js'

export interface WorldInput {
  playerId: number
  seq: number
  moveX: number
  moveY: number
  jump: boolean
  dash: boolean
  shoot: boolean
  reload: boolean
  yaw: number
  pitch: number
}

export interface WorldEvent {
  type: string
  data: Record<string, unknown>
}

export class GameWorld {
  readonly map: MapDefinition
  readonly colliders: AABB[]
  readonly players = new Map<number, CombatPlayer>()
  readonly projectiles = new Map<number, ProjectileState>()
  readonly events: WorldEvent[] = []

  tick = 0
  phase: MatchPhase = MatchPhase.Waiting
  timeRemaining = MATCH_DURATION_SECONDS
  matchDurationSeconds = MATCH_DURATION_SECONDS
  scoreLimit = SCORE_LIMIT
  countdownRemaining = 0
  nextPlayerId = 1
  nextProjectileId = 1
  private recentDeaths: Array<{ position: Vec3; age: number }> = []
  private recentSpawns: Array<{ spawnId: string; age: number }> = []
  private impactedProjectiles = new Set<number>()
  private recentDamage: Array<{ position: Vec3; age: number }> = []

  constructor(map: MapDefinition = ARENA_MAP) {
    this.map = map
    this.colliders = buildAABBs(map)
  }

  get spawnCandidates(): SpawnCandidate[] {
    return this.map.spawns.map((s) => ({
      id: s.id,
      position: vec3(s.x, s.y, s.z),
      yaw: s.yaw,
      zone: s.zone,
    }))
  }

  addPlayer(name: string, id?: number): CombatPlayer {
    if (this.players.size >= MAX_PLAYERS) {
      throw new Error('server_full')
    }
    const playerId = id ?? this.nextPlayerId++
    const spawn = this.chooseSpawn()
    const player = createCombatPlayer(playerId, name, spawn.position, spawn.yaw)
    this.players.set(playerId, player)
    this.recentSpawns.push({ spawnId: spawn.id, age: 0 })
    this.events.push({
      type: 'player_joined',
      data: { playerId, name },
    })
    return player
  }

  removePlayer(playerId: number): void {
    this.players.delete(playerId)
    this.events.push({ type: 'player_left', data: { playerId } })
  }

  chooseSpawn(): SpawnCandidate {
    const enemies = [...this.players.values()].map((p) => ({
      position: p.sim.position,
      alive: p.sim.alive,
    }))
    const rockets = [...this.projectiles.values()].map((p) => ({
      position: p.position,
      alive: p.alive,
    }))
    return pickBestSpawn(
      this.spawnCandidates,
      enemies,
      this.recentDeaths,
      this.recentSpawns,
      rockets,
      this.recentDamage,
    )
  }

  applyInput(cmd: WorldInput): void {
    const player = this.players.get(cmd.playerId)
    if (!player || !player.sim.alive || !player.connected) return

    const move = inputFromAxes(
      cmd.moveX,
      cmd.moveY,
      cmd.jump,
      cmd.dash,
      cmd.yaw,
      cmd.pitch,
    )
    stepPlayerMovement(
      player.sim,
      move,
      this.colliders,
      this.map.bounds.floorY,
      TICK_DT,
    )

    stepWeapon(player.weapon, TICK_DT)

    if (cmd.reload) {
      tryStartReload(player.weapon)
    }

    if (cmd.shoot) {
      this.tryPlayerFire(player)
    }
  }

  tryPlayerFire(player: CombatPlayer): void {
    if (!player.sim.alive) return
    clearSpawnProtectionOnFire(player)
    const origin = eyePosition(player.sim.position, PLAYER_EYE_OFFSET)
    const dir = vec3()
    yawPitchToDirection(player.sim.yaw, player.sim.pitch, dir)
    origin.x += dir.x * 0.8
    origin.y += dir.y * 0.8
    origin.z += dir.z * 0.8

    const result = tryFireRocket(
      player.weapon,
      player.id,
      this.nextProjectileId,
      origin,
      player.sim.yaw,
      player.sim.pitch,
    )
    if (result.ok && result.projectile) {
      this.nextProjectileId += 1
      this.projectiles.set(result.projectile.id, result.projectile)
      this.events.push({
        type: 'projectile_spawn',
        data: {
          id: result.projectile.id,
          ownerId: player.id,
          x: result.projectile.position.x,
          y: result.projectile.position.y,
          z: result.projectile.position.z,
          vx: result.projectile.velocity.x,
          vy: result.projectile.velocity.y,
          vz: result.projectile.velocity.z,
        },
      })
    }
  }

  step(): void {
    this.tick += 1
    this.ageLists(TICK_DT)

    if (this.phase === MatchPhase.Countdown) {
      this.countdownRemaining -= TICK_DT
      if (this.countdownRemaining <= 0) {
        this.phase = MatchPhase.Active
        this.timeRemaining = this.matchDurationSeconds
      }
    } else if (this.phase === MatchPhase.Active) {
      this.timeRemaining -= TICK_DT
      if (this.timeRemaining <= 0) {
        this.endMatch('timer')
      }
    }

    for (const player of this.players.values()) {
      if (player.sim.alive) {
        stepWeapon(player.weapon, TICK_DT)
      }
    }

    const ready = stepRespawnTimers(this.players.values(), TICK_DT)
    for (const id of ready) {
      this.doRespawn(id)
    }

    this.stepProjectiles()

    if (this.phase === MatchPhase.Active) {
      for (const p of this.players.values()) {
        if (p.score >= this.scoreLimit) {
          this.endMatch('score')
          break
        }
      }
    }
  }

  private stepProjectiles(): void {
    const toRemove: number[] = []
    for (const p of this.projectiles.values()) {
      let impact = stepProjectile(
        p,
        this.colliders,
        this.map.bounds.halfSize,
        this.map.bounds.floorY,
        TICK_DT,
      )
      if (!impact) {
        for (const player of this.players.values()) {
          impact = checkProjectilePlayerHit(
            p,
            player.id,
            player.sim.position,
            player.sim.alive,
          )
          if (impact) break
        }
      }
      if (impact) {
        this.handleImpact(impact)
        toRemove.push(p.id)
      } else if (!p.alive) {
        toRemove.push(p.id)
      }
    }
    for (const id of toRemove) {
      this.projectiles.delete(id)
    }
  }

  private handleImpact(impact: ImpactEvent): void {
    if (this.impactedProjectiles.has(impact.projectileId)) return
    this.impactedProjectiles.add(impact.projectileId)

    this.events.push({
      type: 'projectile_impact',
      data: {
        projectileId: impact.projectileId,
        ownerId: impact.ownerId,
        x: impact.point.x,
        y: impact.point.y,
        z: impact.point.z,
        hitPlayerId: impact.hitPlayerId,
      },
    })

    const targets = [...this.players.values()].map((pl) => ({
      id: pl.id,
      position: pl.sim.position,
      alive: pl.sim.alive,
    }))

    let splashHits = computeSplashDamage(
      impact.point,
      targets,
      undefined,
      undefined,
      impact.ownerId,
    )

    if (impact.hitPlayerId !== null) {
      const direct = splashHits.find((h) => h.playerId === impact.hitPlayerId)
      if (direct) {
        direct.damage = Math.max(direct.damage, 100)
      } else {
        splashHits = [
          ...splashHits,
          { playerId: impact.hitPlayerId, damage: 100 },
        ]
      }
    }

    for (const hit of splashHits) {
      const victim = this.players.get(hit.playerId)
      if (!victim) continue
      const result = applyDamage(victim, hit.damage, impact.ownerId)
      this.recentDamage.push({ position: cloneVec3(victim.sim.position), age: 0 })
      this.events.push({
        type: 'damage',
        data: {
          victimId: hit.playerId,
          attackerId: impact.ownerId,
          amount: hit.damage,
          health: result.healthAfter,
        },
      })
      if (result.killed) {
        this.recentDeaths.push({ position: cloneVec3(victim.sim.position), age: 0 })
        const attacker = this.players.get(impact.ownerId)
        if (attacker && attacker.id !== victim.id) {
          registerKill(attacker, this.tick)
        } else if (attacker && attacker.id === victim.id) {
          registerSuicide(victim)
        }
        this.events.push({
          type: 'death',
          data: {
            victimId: victim.id,
            attackerId: impact.ownerId,
            tick: this.tick,
          },
        })
      }
    }
  }

  doRespawn(playerId: number): void {
    const player = this.players.get(playerId)
    if (!player) return
    const spawn = this.chooseSpawn()
    respawnPlayer(player, spawn.position, spawn.yaw)
    this.recentSpawns.push({ spawnId: spawn.id, age: 0 })
    this.events.push({
      type: 'respawn',
      data: {
        playerId,
        x: spawn.position.x,
        y: spawn.position.y,
        z: spawn.position.z,
        yaw: spawn.yaw,
      },
    })
  }

  startCountdown(seconds: number): void {
    this.phase = MatchPhase.Countdown
    this.countdownRemaining = seconds
  }

  startMatch(): void {
    this.phase = MatchPhase.Active
    this.timeRemaining = this.matchDurationSeconds
  }

  endMatch(reason: string): void {
    this.phase = MatchPhase.Ending
    this.events.push({
      type: 'match_ended',
      data: {
        reason,
        standings: sortLeaderboard([...this.players.values()]),
      },
    })
    this.phase = MatchPhase.Results
  }

  restartMatch(): void {
    this.projectiles.clear()
    this.impactedProjectiles.clear()
    this.recentDeaths = []
    this.recentSpawns = []
    this.recentDamage = []
    this.tick = 0
    this.timeRemaining = this.matchDurationSeconds
    this.phase = MatchPhase.Countdown
    this.countdownRemaining = 5
    for (const p of this.players.values()) {
      p.kills = 0
      p.deaths = 0
      p.score = 0
      p.lastScoreTick = 0
      p.weapon = createWeaponState()
      const spawn = this.chooseSpawn()
      respawnPlayer(p, spawn.position, spawn.yaw)
    }
  }

  drainEvents(): WorldEvent[] {
    const out = this.events.splice(0, this.events.length)
    return out
  }

  shouldEmitSnapshot(): boolean {
    return this.tick % SNAPSHOT_INTERVAL_TICKS === 0
  }

  private ageLists(dt: number): void {
    for (const d of this.recentDeaths) d.age += dt
    for (const s of this.recentSpawns) s.age += dt
    for (const d of this.recentDamage) d.age += dt
    this.recentDeaths = this.recentDeaths.filter((d) => d.age < 10)
    this.recentSpawns = this.recentSpawns.filter((s) => s.age < 12)
    this.recentDamage = this.recentDamage.filter((d) => d.age < 6)
  }
}

export * from './constants.js'
export * from './math.js'
export * from './playerMovement.js'
export * from './weapons.js'
export * from './combat.js'
export * from './fixedTimestep.js'
export * from './mapDefinition.js'
