/** Remote player snapshot buffer with delayed interpolation. */

import { INTERP_DELAY_MS } from '../../shared/simulation/constants.js'
import type { SnapshotPlayer } from '../../shared/protocol/messages.js'

/** Max extrapolation past the newest snapshot (ms). */
const MAX_EXTRAPOLATION_MS = 120

/** If consecutive sample positions differ by more than this, snap (teleport). */
const TELEPORT_THRESHOLD = 8

export interface InterpolatedPlayer {
  id: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  yaw: number
  pitch: number
  health: number
  alive: boolean
  weapon: number
  ammo: number
  flags: number
  kills: number
  deaths: number
}

interface SnapshotFrame {
  tick: number
  time: number
  players: Map<number, SnapshotPlayer>
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpAngle(a: number, b: number, t: number): number {
  let delta = b - a
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return a + delta * t
}

function clonePlayer(p: SnapshotPlayer): SnapshotPlayer {
  return { ...p }
}

function toInterpolated(p: SnapshotPlayer): InterpolatedPlayer {
  return {
    id: p.id,
    x: p.x,
    y: p.y,
    z: p.z,
    vx: p.vx,
    vy: p.vy,
    vz: p.vz,
    yaw: p.yaw,
    pitch: p.pitch,
    health: p.health,
    alive: p.alive,
    weapon: p.weapon,
    ammo: p.ammo,
    flags: p.flags,
    kills: p.kills,
    deaths: p.deaths,
  }
}

function blendPlayers(a: SnapshotPlayer, b: SnapshotPlayer, t: number): InterpolatedPlayer {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dz = b.z - a.z
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (dist > TELEPORT_THRESHOLD) {
    return toInterpolated(t < 0.5 ? a : b)
  }
  return {
    id: b.id,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    vx: lerp(a.vx, b.vx, t),
    vy: lerp(a.vy, b.vy, t),
    vz: lerp(a.vz, b.vz, t),
    yaw: lerpAngle(a.yaw, b.yaw, t),
    pitch: lerp(a.pitch, b.pitch, t),
    health: t < 0.5 ? a.health : b.health,
    alive: t < 0.5 ? a.alive : b.alive,
    weapon: t < 0.5 ? a.weapon : b.weapon,
    ammo: t < 0.5 ? a.ammo : b.ammo,
    flags: t < 0.5 ? a.flags : b.flags,
    kills: t < 0.5 ? a.kills : b.kills,
    deaths: t < 0.5 ? a.deaths : b.deaths,
  }
}

function extrapolate(p: SnapshotPlayer, dtSec: number): InterpolatedPlayer {
  const clamped = Math.min(Math.max(dtSec, 0), MAX_EXTRAPOLATION_MS / 1000)
  return {
    id: p.id,
    x: p.x + p.vx * clamped,
    y: p.y + p.vy * clamped,
    z: p.z + p.vz * clamped,
    vx: p.vx,
    vy: p.vy,
    vz: p.vz,
    yaw: p.yaw,
    pitch: p.pitch,
    health: p.health,
    alive: p.alive,
    weapon: p.weapon,
    ammo: p.ammo,
    flags: p.flags,
    kills: p.kills,
    deaths: p.deaths,
  }
}

export class SnapshotInterpolator {
  private frames: SnapshotFrame[] = []
  private readonly maxFrames: number
  readonly delayMs: number
  underrunCount = 0
  extrapolationCount = 0

  constructor(delayMs = INTERP_DELAY_MS, maxFrames = 32) {
    this.delayMs = delayMs
    this.maxFrames = maxFrames
  }

  clear(): void {
    this.frames = []
  }

  get bufferSize(): number {
    return this.frames.length
  }

  get latestTick(): number {
    if (this.frames.length === 0) return 0
    return this.frames[this.frames.length - 1]!.tick
  }

  pushSnapshot(tick: number, time: number, players: SnapshotPlayer[]): void {
    // Drop older or duplicate ticks
    if (this.frames.length > 0 && tick <= this.frames[this.frames.length - 1]!.tick) {
      return
    }
    const map = new Map<number, SnapshotPlayer>()
    for (const p of players) {
      map.set(p.id, clonePlayer(p))
    }
    this.frames.push({ tick, time, players: map })
    while (this.frames.length > this.maxFrames) {
      this.frames.shift()
    }
  }

  /**
   * Sample remote players at renderTime − INTERP_DELAY_MS.
   * Limited velocity extrapolation when past the newest frame.
   */
  sample(renderTime: number): Map<number, InterpolatedPlayer> {
    const result = new Map<number, InterpolatedPlayer>()
    if (this.frames.length === 0) return result

    const target = renderTime - this.delayMs

    if (this.frames.length === 1) {
      const only = this.frames[0]!
      for (const p of only.players.values()) {
        result.set(p.id, toInterpolated(p))
      }
      return result
    }

    // Before first frame
    if (target <= this.frames[0]!.time) {
      this.underrunCount += 1
      for (const p of this.frames[0]!.players.values()) {
        result.set(p.id, toInterpolated(p))
      }
      return result
    }

    const newest = this.frames[this.frames.length - 1]!

    // Past newest → limited extrapolation
    if (target >= newest.time) {
      this.extrapolationCount += 1
      const dtSec = Math.min((target - newest.time) / 1000, MAX_EXTRAPOLATION_MS / 1000)
      for (const p of newest.players.values()) {
        result.set(p.id, extrapolate(p, dtSec))
      }
      return result
    }

    // Find surrounding frames
    let i = 0
    while (i < this.frames.length - 1 && this.frames[i + 1]!.time < target) {
      i += 1
    }
    const a = this.frames[i]!
    const b = this.frames[i + 1]!
    const span = b.time - a.time
    const t = span > 1e-6 ? (target - a.time) / span : 0

    const ids = new Set<number>([...a.players.keys(), ...b.players.keys()])
    for (const id of ids) {
      const pa = a.players.get(id)
      const pb = b.players.get(id)
      if (pa && pb) {
        result.set(id, blendPlayers(pa, pb, t))
      } else if (pb) {
        result.set(id, toInterpolated(pb))
      } else if (pa) {
        result.set(id, toInterpolated(pa))
      }
    }
    return result
  }
}
