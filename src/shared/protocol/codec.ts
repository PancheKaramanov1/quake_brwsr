/** Binary encode/decode for the versioned FPS WebSocket protocol. */

import {
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  DISPLAY_NAME_PATTERN,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
} from '../simulation/constants.js'
import {
  isMessageType,
  MatchPhase,
  MessageType,
  type ClientReadyPayload,
  type DamageEventPayload,
  type DeathEventPayload,
  type DecodedMessage,
  type DisconnectPayload,
  type EntityDestroyPayload,
  type EntitySpawnPayload,
  type HelloPayload,
  type InputCommandPayload,
  type JoinMatchPayload,
  type LocalCorrectionPayload,
  type MatchEndedPayload,
  type MatchStatePayload,
  type MessagePayloadMap,
  type PingPayload,
  type PlayerJoinedPayload,
  type PlayerLeftPayload,
  type PongPayload,
  type ProjectileImpactPayload,
  type ProjectileSpawnPayload,
  type ReconnectPayload,
  type RejectPayload,
  type RespawnEventPayload,
  type ScoreUpdatePayload,
  type ServerErrorPayload,
  type SnapshotPayload,
  type SnapshotPlayer,
  type SnapshotProjectile,
  type StandingEntry,
  type WelcomePayload,
  RejectReason,
} from './messages.js'

export const PROTOCOL_HEADER_BYTES = 4

const POS_SCALE = 100
const VEL_SCALE = 100
const ANGLE_SCALE = 32767 / Math.PI
const INT16_MIN = -32768
const INT16_MAX = 32767
const INT32_MIN = -2147483648
const INT32_MAX = 2147483647

const INPUT_JUMP = 1 << 0
const INPUT_CROUCH = 1 << 1
const INPUT_DASH = 1 << 2
const INPUT_SHOOT = 1 << 3
const INPUT_RELOAD = 1 << 4

export type DecodeErrorCode =
  | 'truncated'
  | 'oversized'
  | 'version_mismatch'
  | 'unknown_type'
  | 'malformed'
  | 'invalid_name'

export interface DecodeError {
  code: DecodeErrorCode
  message: string
}

export type DecodeResult = DecodedMessage | { ok: false; error: DecodeError }

function fail(code: DecodeErrorCode, message: string): DecodeResult {
  return { ok: false, error: { code, message } }
}

export function validateDisplayName(name: string): string | null {
  if (name.length < DISPLAY_NAME_MIN || name.length > DISPLAY_NAME_MAX) {
    return `Display name must be ${DISPLAY_NAME_MIN}–${DISPLAY_NAME_MAX} characters`
  }
  if (!DISPLAY_NAME_PATTERN.test(name)) {
    return 'Display name may only contain letters, numbers, spaces, _ and -'
  }
  return null
}

function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value | 0
}

function quantizePos(value: number): number {
  return clampInt(Math.round(value * POS_SCALE), INT32_MIN, INT32_MAX)
}

function dequantizePos(value: number): number {
  return value / POS_SCALE
}

function quantizeVel(value: number): number {
  return clampInt(Math.round(value * VEL_SCALE), INT16_MIN, INT16_MAX)
}

function dequantizeVel(value: number): number {
  return value / VEL_SCALE
}

function quantizeAngle(rad: number): number {
  return clampInt(Math.round(rad * ANGLE_SCALE), INT16_MIN, INT16_MAX)
}

function dequantizeAngle(value: number): number {
  return value / ANGLE_SCALE
}

function clampMoveAxis(value: number): number {
  if (value <= -1) return -1
  if (value >= 1) return 1
  return 0
}

function utf8ByteLength(str: string): number {
  let bytes = 0
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c < 0x80) bytes += 1
    else if (c < 0x800) bytes += 2
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

class Writer {
  private readonly view: DataView
  private readonly bytes: Uint8Array
  offset = 0

  constructor(capacity: number) {
    this.bytes = new Uint8Array(capacity)
    this.view = new DataView(this.bytes.buffer)
  }

  u8(v: number): void {
    this.view.setUint8(this.offset, v & 0xff)
    this.offset += 1
  }

  i8(v: number): void {
    this.view.setInt8(this.offset, v)
    this.offset += 1
  }

  u16(v: number): void {
    this.view.setUint16(this.offset, v & 0xffff, true)
    this.offset += 2
  }

  i16(v: number): void {
    this.view.setInt16(this.offset, v, true)
    this.offset += 2
  }

  u32(v: number): void {
    this.view.setUint32(this.offset, v >>> 0, true)
    this.offset += 4
  }

  i32(v: number): void {
    this.view.setInt32(this.offset, v, true)
    this.offset += 4
  }

  f32(v: number): void {
    this.view.setFloat32(this.offset, v, true)
    this.offset += 4
  }

  f64(v: number): void {
    this.view.setFloat64(this.offset, v, true)
    this.offset += 8
  }

  bool(v: boolean): void {
    this.u8(v ? 1 : 0)
  }

  /** u8 length + UTF-8 bytes (max 255). */
  str8(s: string): void {
    const encoded = new TextEncoder().encode(s)
    if (encoded.length > 255) {
      throw new RangeError(`String exceeds 255 bytes (${encoded.length})`)
    }
    this.u8(encoded.length)
    this.bytes.set(encoded, this.offset)
    this.offset += encoded.length
  }

  /** u16 length + UTF-8 bytes. */
  str16(s: string): void {
    const encoded = new TextEncoder().encode(s)
    if (encoded.length > 0xffff) {
      throw new RangeError(`String exceeds 65535 bytes (${encoded.length})`)
    }
    this.u16(encoded.length)
    this.bytes.set(encoded, this.offset)
    this.offset += encoded.length
  }

  finish(): Uint8Array {
    return this.bytes.subarray(0, this.offset)
  }
}

class Reader {
  private readonly view: DataView
  private readonly bytes: Uint8Array
  offset = 0
  readonly end: number

  constructor(buf: Uint8Array, start: number, end: number) {
    this.bytes = buf
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    this.offset = start
    this.end = end
  }

  remaining(): number {
    return this.end - this.offset
  }

  private need(n: number): boolean {
    return this.offset + n <= this.end
  }

  u8(): number | null {
    if (!this.need(1)) return null
    const v = this.view.getUint8(this.offset)
    this.offset += 1
    return v
  }

  i8(): number | null {
    if (!this.need(1)) return null
    const v = this.view.getInt8(this.offset)
    this.offset += 1
    return v
  }

  u16(): number | null {
    if (!this.need(2)) return null
    const v = this.view.getUint16(this.offset, true)
    this.offset += 2
    return v
  }

  i16(): number | null {
    if (!this.need(2)) return null
    const v = this.view.getInt16(this.offset, true)
    this.offset += 2
    return v
  }

  u32(): number | null {
    if (!this.need(4)) return null
    const v = this.view.getUint32(this.offset, true)
    this.offset += 4
    return v
  }

  i32(): number | null {
    if (!this.need(4)) return null
    const v = this.view.getInt32(this.offset, true)
    this.offset += 4
    return v
  }

  f32(): number | null {
    if (!this.need(4)) return null
    const v = this.view.getFloat32(this.offset, true)
    this.offset += 4
    return v
  }

  f64(): number | null {
    if (!this.need(8)) return null
    const v = this.view.getFloat64(this.offset, true)
    this.offset += 8
    return v
  }

  bool(): boolean | null {
    const v = this.u8()
    if (v === null) return null
    return v !== 0
  }

  str8(): string | null {
    const len = this.u8()
    if (len === null) return null
    if (!this.need(len)) return null
    const slice = this.bytes.subarray(this.offset, this.offset + len)
    this.offset += len
    return new TextDecoder().decode(slice)
  }

  str16(): string | null {
    const len = this.u16()
    if (len === null) return null
    if (!this.need(len)) return null
    const slice = this.bytes.subarray(this.offset, this.offset + len)
    this.offset += len
    return new TextDecoder().decode(slice)
  }
}

function estimatePayloadSize(type: MessageType, payload: MessagePayloadMap[MessageType]): number {
  switch (type) {
    case MessageType.Hello: {
      const p = payload as HelloPayload
      return 1 + 1 + utf8ByteLength(p.displayName)
    }
    case MessageType.JoinMatch: {
      const p = payload as JoinMatchPayload
      return 1 + utf8ByteLength(p.mapId)
    }
    case MessageType.ClientReady:
      return 0
    case MessageType.InputCommand:
      return 4 + 4 + 1 + 1 + 1 + 4 + 4
    case MessageType.Ping:
      return 8
    case MessageType.Reconnect: {
      const p = payload as ReconnectPayload
      return 1 + utf8ByteLength(p.sessionId) + 1 + utf8ByteLength(p.reconnectToken)
    }
    case MessageType.Disconnect: {
      const p = payload as DisconnectPayload
      return 1 + utf8ByteLength(p.reason)
    }
    case MessageType.Welcome: {
      const p = payload as WelcomePayload
      return (
        2 +
        1 +
        utf8ByteLength(p.sessionId) +
        1 +
        utf8ByteLength(p.reconnectToken) +
        2 +
        2 +
        1 +
        utf8ByteLength(p.mapId) +
        1 +
        utf8ByteLength(p.serverInstanceId) +
        1 +
        utf8ByteLength(p.matchInstanceId) +
        1 +
        utf8ByteLength(p.buildVersion)
      )
    }
    case MessageType.Reject: {
      const p = payload as RejectPayload
      return 1 + 2 + utf8ByteLength(p.message)
    }
    case MessageType.MatchState:
      return 1 + 2 + 2 + 1
    case MessageType.Snapshot: {
      const p = payload as SnapshotPayload
      // header + playerCount + players (33 B) + projCount + projectiles (22 B)
      return 4 + 4 + 1 + 2 + 2 + 1 + p.players.length * 33 + 1 + p.projectiles.length * 22
    }
    case MessageType.PlayerJoined: {
      const p = payload as PlayerJoinedPayload
      return 2 + 1 + utf8ByteLength(p.displayName)
    }
    case MessageType.PlayerLeft: {
      const p = payload as PlayerLeftPayload
      return 2 + 1 + utf8ByteLength(p.reason)
    }
    case MessageType.ProjectileSpawn:
      return 2 + 2 + 4 * 3 + 2 * 3
    case MessageType.ProjectileImpact:
      return 2 + 4 * 3
    case MessageType.DamageEvent:
      return 2 + 2 + 2 + 2
    case MessageType.DeathEvent:
      return 2 + 2 + 1
    case MessageType.RespawnEvent:
      return 2 + 4 * 3 + 2
    case MessageType.ScoreUpdate: {
      const p = payload as ScoreUpdatePayload
      return 1 + p.scores.length * 6
    }
    case MessageType.MatchEnded: {
      const p = payload as MatchEndedPayload
      let n = 1
      for (const s of p.standings) {
        n += 2 + 1 + utf8ByteLength(s.displayName) + 2 + 2 + 1
      }
      return n
    }
    case MessageType.Pong:
      return 8 + 8
    case MessageType.ServerError: {
      const p = payload as ServerErrorPayload
      return 2 + 2 + utf8ByteLength(p.message)
    }
    case MessageType.EntitySpawn:
      return 4 + 1 + 4 * 3
    case MessageType.EntityDestroy:
      return 4
    case MessageType.LocalCorrection:
      // tick, ack, pos×3, vel×3, yaw, pitch, flags, jumpVel, dashRem, dashCd, jumpCd, dashV×3
      return 4 + 4 + 4 * 3 + 2 * 3 + 2 + 2 + 1 + 2 + 2 + 2 + 2 + 2 * 3
    default: {
      const _exhaustive: never = type
      return _exhaustive
    }
  }
}

function writeSnapshotPlayer(w: Writer, p: SnapshotPlayer): void {
  w.u16(p.id)
  w.i32(quantizePos(p.x))
  w.i32(quantizePos(p.y))
  w.i32(quantizePos(p.z))
  w.i16(quantizeVel(p.vx))
  w.i16(quantizeVel(p.vy))
  w.i16(quantizeVel(p.vz))
  w.i16(quantizeAngle(p.yaw))
  w.i16(quantizeAngle(p.pitch))
  w.u8(clampInt(p.health, 0, 255))
  w.bool(p.alive)
  w.u8(clampInt(p.weapon, 0, 255))
  w.u8(clampInt(p.ammo, 0, 255))
  w.u8(p.flags & 0xff)
  w.u16(clampInt(p.kills, 0, 0xffff))
  w.u16(clampInt(p.deaths, 0, 0xffff))
}

function readSnapshotPlayer(r: Reader): SnapshotPlayer | null {
  const id = r.u16()
  const x = r.i32()
  const y = r.i32()
  const z = r.i32()
  const vx = r.i16()
  const vy = r.i16()
  const vz = r.i16()
  const yaw = r.i16()
  const pitch = r.i16()
  const health = r.u8()
  const alive = r.bool()
  const weapon = r.u8()
  const ammo = r.u8()
  const flags = r.u8()
  const kills = r.u16()
  const deaths = r.u16()
  if (
    id === null ||
    x === null ||
    y === null ||
    z === null ||
    vx === null ||
    vy === null ||
    vz === null ||
    yaw === null ||
    pitch === null ||
    health === null ||
    alive === null ||
    weapon === null ||
    ammo === null ||
    flags === null ||
    kills === null ||
    deaths === null
  ) {
    return null
  }
  return {
    id,
    x: dequantizePos(x),
    y: dequantizePos(y),
    z: dequantizePos(z),
    vx: dequantizeVel(vx),
    vy: dequantizeVel(vy),
    vz: dequantizeVel(vz),
    yaw: dequantizeAngle(yaw),
    pitch: dequantizeAngle(pitch),
    health,
    alive,
    weapon,
    ammo,
    flags,
    kills,
    deaths,
  }
}

function writeSnapshotProjectile(w: Writer, p: SnapshotProjectile): void {
  w.u16(p.id)
  w.u16(p.ownerId)
  w.i32(quantizePos(p.x))
  w.i32(quantizePos(p.y))
  w.i32(quantizePos(p.z))
  w.i16(quantizeVel(p.vx))
  w.i16(quantizeVel(p.vy))
  w.i16(quantizeVel(p.vz))
}

function readSnapshotProjectile(r: Reader): SnapshotProjectile | null {
  const id = r.u16()
  const ownerId = r.u16()
  const x = r.i32()
  const y = r.i32()
  const z = r.i32()
  const vx = r.i16()
  const vy = r.i16()
  const vz = r.i16()
  if (
    id === null ||
    ownerId === null ||
    x === null ||
    y === null ||
    z === null ||
    vx === null ||
    vy === null ||
    vz === null
  ) {
    return null
  }
  return {
    id,
    ownerId,
    x: dequantizePos(x),
    y: dequantizePos(y),
    z: dequantizePos(z),
    vx: dequantizeVel(vx),
    vy: dequantizeVel(vy),
    vz: dequantizeVel(vz),
  }
}

function encodePayload(type: MessageType, payload: MessagePayloadMap[MessageType], w: Writer): void {
  switch (type) {
    case MessageType.Hello: {
      const p = payload as HelloPayload
      w.u8(p.protocolVersion)
      w.str8(p.displayName)
      break
    }
    case MessageType.JoinMatch: {
      const p = payload as JoinMatchPayload
      w.str8(p.mapId)
      break
    }
    case MessageType.ClientReady: {
      const _p = payload as ClientReadyPayload
      void _p
      break
    }
    case MessageType.InputCommand: {
      const p = payload as InputCommandPayload
      w.u32(p.seq)
      w.u32(p.clientTick)
      w.i8(clampMoveAxis(p.moveX))
      w.i8(clampMoveAxis(p.moveY))
      let buttons = 0
      if (p.jump) buttons |= INPUT_JUMP
      if (p.crouch) buttons |= INPUT_CROUCH
      if (p.dash) buttons |= INPUT_DASH
      if (p.shoot) buttons |= INPUT_SHOOT
      if (p.reload) buttons |= INPUT_RELOAD
      w.u8(buttons)
      w.f32(p.yaw)
      w.f32(p.pitch)
      break
    }
    case MessageType.Ping: {
      const p = payload as PingPayload
      w.f64(p.clientTime)
      break
    }
    case MessageType.Reconnect: {
      const p = payload as ReconnectPayload
      w.str8(p.sessionId)
      w.str8(p.reconnectToken)
      break
    }
    case MessageType.Disconnect: {
      const p = payload as DisconnectPayload
      w.str8(p.reason)
      break
    }
    case MessageType.Welcome: {
      const p = payload as WelcomePayload
      w.u16(p.playerId)
      w.str8(p.sessionId)
      w.str8(p.reconnectToken)
      w.u16(p.tickRate)
      w.u16(p.snapshotRate)
      w.str8(p.mapId)
      w.str8(p.serverInstanceId)
      w.str8(p.matchInstanceId)
      w.str8(p.buildVersion)
      break
    }
    case MessageType.Reject: {
      const p = payload as RejectPayload
      w.u8(p.reason)
      w.str16(p.message)
      break
    }
    case MessageType.MatchState: {
      const p = payload as MatchStatePayload
      w.u8(p.phase)
      w.u16(clampInt(Math.round(p.timeRemaining), 0, 0xffff))
      w.u16(clampInt(p.scoreLimit, 0, 0xffff))
      w.u8(clampInt(p.playerCount, 0, 255))
      break
    }
    case MessageType.Snapshot: {
      const p = payload as SnapshotPayload
      w.u32(p.tick)
      w.u32(p.ackSeq)
      w.u8(p.phase)
      w.u16(clampInt(Math.round(p.timeRemaining), 0, 0xffff))
      w.u16(clampInt(p.scoreLimit, 0, 0xffff))
      w.u8(clampInt(p.players.length, 0, 255))
      for (const pl of p.players) writeSnapshotPlayer(w, pl)
      w.u8(clampInt(p.projectiles.length, 0, 255))
      for (const pr of p.projectiles) writeSnapshotProjectile(w, pr)
      break
    }
    case MessageType.PlayerJoined: {
      const p = payload as PlayerJoinedPayload
      w.u16(p.playerId)
      w.str8(p.displayName)
      break
    }
    case MessageType.PlayerLeft: {
      const p = payload as PlayerLeftPayload
      w.u16(p.playerId)
      w.str8(p.reason)
      break
    }
    case MessageType.ProjectileSpawn: {
      const p = payload as ProjectileSpawnPayload
      w.u16(p.id)
      w.u16(p.ownerId)
      w.i32(quantizePos(p.x))
      w.i32(quantizePos(p.y))
      w.i32(quantizePos(p.z))
      w.i16(quantizeVel(p.vx))
      w.i16(quantizeVel(p.vy))
      w.i16(quantizeVel(p.vz))
      break
    }
    case MessageType.ProjectileImpact: {
      const p = payload as ProjectileImpactPayload
      w.u16(p.id)
      w.i32(quantizePos(p.x))
      w.i32(quantizePos(p.y))
      w.i32(quantizePos(p.z))
      break
    }
    case MessageType.DamageEvent: {
      const p = payload as DamageEventPayload
      w.u16(p.victimId)
      w.u16(p.attackerId)
      w.u16(clampInt(Math.round(p.amount), 0, 0xffff))
      w.u16(clampInt(Math.round(p.remainingHealth), 0, 0xffff))
      break
    }
    case MessageType.DeathEvent: {
      const p = payload as DeathEventPayload
      w.u16(p.victimId)
      w.u16(p.killerId)
      w.u8(clampInt(p.weapon, 0, 255))
      break
    }
    case MessageType.RespawnEvent: {
      const p = payload as RespawnEventPayload
      w.u16(p.playerId)
      w.i32(quantizePos(p.x))
      w.i32(quantizePos(p.y))
      w.i32(quantizePos(p.z))
      w.i16(quantizeAngle(p.yaw))
      break
    }
    case MessageType.ScoreUpdate: {
      const p = payload as ScoreUpdatePayload
      w.u8(clampInt(p.scores.length, 0, 255))
      for (const s of p.scores) {
        w.u16(s.playerId)
        w.u16(clampInt(s.kills, 0, 0xffff))
        w.u16(clampInt(s.deaths, 0, 0xffff))
      }
      break
    }
    case MessageType.MatchEnded: {
      const p = payload as MatchEndedPayload
      w.u8(clampInt(p.standings.length, 0, 255))
      for (const s of p.standings) {
        w.u16(s.playerId)
        w.str8(s.displayName)
        w.u16(clampInt(s.kills, 0, 0xffff))
        w.u16(clampInt(s.deaths, 0, 0xffff))
        w.u8(clampInt(s.rank, 0, 255))
      }
      break
    }
    case MessageType.Pong: {
      const p = payload as PongPayload
      w.f64(p.clientTime)
      w.f64(p.serverTime)
      break
    }
    case MessageType.ServerError: {
      const p = payload as ServerErrorPayload
      w.u16(clampInt(p.code, 0, 0xffff))
      w.str16(p.message)
      break
    }
    case MessageType.EntitySpawn: {
      const p = payload as EntitySpawnPayload
      w.u32(p.entityId)
      w.u8(clampInt(p.entityType, 0, 255))
      w.i32(quantizePos(p.x))
      w.i32(quantizePos(p.y))
      w.i32(quantizePos(p.z))
      break
    }
    case MessageType.EntityDestroy: {
      const p = payload as EntityDestroyPayload
      w.u32(p.entityId)
      break
    }
    case MessageType.LocalCorrection: {
      const p = payload as LocalCorrectionPayload
      w.u32(p.tick)
      w.u32(p.ackSeq)
      w.i32(quantizePos(p.x))
      w.i32(quantizePos(p.y))
      w.i32(quantizePos(p.z))
      w.i16(quantizeVel(p.vx))
      w.i16(quantizeVel(p.vy))
      w.i16(quantizeVel(p.vz))
      w.i16(quantizeAngle(p.yaw))
      w.i16(quantizeAngle(p.pitch))
      let flags = 0
      if (p.grounded) flags |= 1
      if (p.alive) flags |= 2
      w.u8(flags)
      w.i16(quantizeVel(p.jumpVelocity))
      w.i16(quantizeVel(p.dashRemaining * 10))
      w.i16(quantizeVel(p.dashCooldown * 10))
      w.i16(quantizeVel(p.jumpCooldown * 10))
      w.i16(quantizeVel(p.dashVx))
      w.i16(quantizeVel(p.dashVy))
      w.i16(quantizeVel(p.dashVz))
      break
    }
    default: {
      const _exhaustive: never = type
      void _exhaustive
    }
  }
}

function decodePayload(type: MessageType, r: Reader): MessagePayloadMap[MessageType] | null {
  switch (type) {
    case MessageType.Hello: {
      const protocolVersion = r.u8()
      const displayName = r.str8()
      if (protocolVersion === null || displayName === null) return null
      return { protocolVersion, displayName }
    }
    case MessageType.JoinMatch: {
      const mapId = r.str8()
      if (mapId === null) return null
      return { mapId }
    }
    case MessageType.ClientReady:
      return {}
    case MessageType.InputCommand: {
      const seq = r.u32()
      const clientTick = r.u32()
      const moveX = r.i8()
      const moveY = r.i8()
      const buttons = r.u8()
      const yaw = r.f32()
      const pitch = r.f32()
      if (
        seq === null ||
        clientTick === null ||
        moveX === null ||
        moveY === null ||
        buttons === null ||
        yaw === null ||
        pitch === null
      ) {
        return null
      }
      return {
        seq,
        clientTick,
        moveX: clampMoveAxis(moveX),
        moveY: clampMoveAxis(moveY),
        jump: (buttons & INPUT_JUMP) !== 0,
        crouch: (buttons & INPUT_CROUCH) !== 0,
        dash: (buttons & INPUT_DASH) !== 0,
        shoot: (buttons & INPUT_SHOOT) !== 0,
        reload: (buttons & INPUT_RELOAD) !== 0,
        yaw,
        pitch,
      }
    }
    case MessageType.Ping: {
      const clientTime = r.f64()
      if (clientTime === null) return null
      return { clientTime }
    }
    case MessageType.Reconnect: {
      const sessionId = r.str8()
      const reconnectToken = r.str8()
      if (sessionId === null || reconnectToken === null) return null
      return { sessionId, reconnectToken }
    }
    case MessageType.Disconnect: {
      const reason = r.str8()
      if (reason === null) return null
      return { reason }
    }
    case MessageType.Welcome: {
      const playerId = r.u16()
      const sessionId = r.str8()
      const reconnectToken = r.str8()
      const tickRate = r.u16()
      const snapshotRate = r.u16()
      const mapId = r.str8()
      const serverInstanceId = r.str8()
      const matchInstanceId = r.str8()
      const buildVersion = r.str8()
      if (
        playerId === null ||
        sessionId === null ||
        reconnectToken === null ||
        tickRate === null ||
        snapshotRate === null ||
        mapId === null ||
        serverInstanceId === null ||
        matchInstanceId === null ||
        buildVersion === null
      ) {
        return null
      }
      return {
        playerId,
        sessionId,
        reconnectToken,
        tickRate,
        snapshotRate,
        mapId,
        serverInstanceId,
        matchInstanceId,
        buildVersion,
      }
    }
    case MessageType.Reject: {
      const reason = r.u8()
      const message = r.str16()
      if (reason === null || message === null) return null
      return { reason: reason as RejectReason, message }
    }
    case MessageType.MatchState: {
      const phase = r.u8()
      const timeRemaining = r.u16()
      const scoreLimit = r.u16()
      const playerCount = r.u8()
      if (phase === null || timeRemaining === null || scoreLimit === null || playerCount === null) {
        return null
      }
      return { phase: phase as MatchPhase, timeRemaining, scoreLimit, playerCount }
    }
    case MessageType.Snapshot: {
      const tick = r.u32()
      const ackSeq = r.u32()
      const phase = r.u8()
      const timeRemaining = r.u16()
      const scoreLimit = r.u16()
      const playerCount = r.u8()
      if (
        tick === null ||
        ackSeq === null ||
        phase === null ||
        timeRemaining === null ||
        scoreLimit === null ||
        playerCount === null
      ) {
        return null
      }
      const players: SnapshotPlayer[] = []
      for (let i = 0; i < playerCount; i++) {
        const pl = readSnapshotPlayer(r)
        if (pl === null) return null
        players.push(pl)
      }
      const projectileCount = r.u8()
      if (projectileCount === null) return null
      const projectiles: SnapshotProjectile[] = []
      for (let i = 0; i < projectileCount; i++) {
        const pr = readSnapshotProjectile(r)
        if (pr === null) return null
        projectiles.push(pr)
      }
      return {
        tick,
        ackSeq,
        phase: phase as MatchPhase,
        timeRemaining,
        scoreLimit,
        players,
        projectiles,
      }
    }
    case MessageType.PlayerJoined: {
      const playerId = r.u16()
      const displayName = r.str8()
      if (playerId === null || displayName === null) return null
      return { playerId, displayName }
    }
    case MessageType.PlayerLeft: {
      const playerId = r.u16()
      const reason = r.str8()
      if (playerId === null || reason === null) return null
      return { playerId, reason }
    }
    case MessageType.ProjectileSpawn: {
      const id = r.u16()
      const ownerId = r.u16()
      const x = r.i32()
      const y = r.i32()
      const z = r.i32()
      const vx = r.i16()
      const vy = r.i16()
      const vz = r.i16()
      if (
        id === null ||
        ownerId === null ||
        x === null ||
        y === null ||
        z === null ||
        vx === null ||
        vy === null ||
        vz === null
      ) {
        return null
      }
      return {
        id,
        ownerId,
        x: dequantizePos(x),
        y: dequantizePos(y),
        z: dequantizePos(z),
        vx: dequantizeVel(vx),
        vy: dequantizeVel(vy),
        vz: dequantizeVel(vz),
      }
    }
    case MessageType.ProjectileImpact: {
      const id = r.u16()
      const x = r.i32()
      const y = r.i32()
      const z = r.i32()
      if (id === null || x === null || y === null || z === null) return null
      return { id, x: dequantizePos(x), y: dequantizePos(y), z: dequantizePos(z) }
    }
    case MessageType.DamageEvent: {
      const victimId = r.u16()
      const attackerId = r.u16()
      const amount = r.u16()
      const remainingHealth = r.u16()
      if (victimId === null || attackerId === null || amount === null || remainingHealth === null) {
        return null
      }
      return { victimId, attackerId, amount, remainingHealth }
    }
    case MessageType.DeathEvent: {
      const victimId = r.u16()
      const killerId = r.u16()
      const weapon = r.u8()
      if (victimId === null || killerId === null || weapon === null) return null
      return { victimId, killerId, weapon }
    }
    case MessageType.RespawnEvent: {
      const playerId = r.u16()
      const x = r.i32()
      const y = r.i32()
      const z = r.i32()
      const yaw = r.i16()
      if (playerId === null || x === null || y === null || z === null || yaw === null) return null
      return {
        playerId,
        x: dequantizePos(x),
        y: dequantizePos(y),
        z: dequantizePos(z),
        yaw: dequantizeAngle(yaw),
      }
    }
    case MessageType.ScoreUpdate: {
      const count = r.u8()
      if (count === null) return null
      const scores: ScoreUpdatePayload['scores'] = []
      for (let i = 0; i < count; i++) {
        const playerId = r.u16()
        const kills = r.u16()
        const deaths = r.u16()
        if (playerId === null || kills === null || deaths === null) return null
        scores.push({ playerId, kills, deaths })
      }
      return { scores }
    }
    case MessageType.MatchEnded: {
      const count = r.u8()
      if (count === null) return null
      const standings: StandingEntry[] = []
      for (let i = 0; i < count; i++) {
        const playerId = r.u16()
        const displayName = r.str8()
        const kills = r.u16()
        const deaths = r.u16()
        const rank = r.u8()
        if (
          playerId === null ||
          displayName === null ||
          kills === null ||
          deaths === null ||
          rank === null
        ) {
          return null
        }
        standings.push({ playerId, displayName, kills, deaths, rank })
      }
      return { standings }
    }
    case MessageType.Pong: {
      const clientTime = r.f64()
      const serverTime = r.f64()
      if (clientTime === null || serverTime === null) return null
      return { clientTime, serverTime }
    }
    case MessageType.ServerError: {
      const code = r.u16()
      const message = r.str16()
      if (code === null || message === null) return null
      return { code, message }
    }
    case MessageType.EntitySpawn: {
      const entityId = r.u32()
      const entityType = r.u8()
      const x = r.i32()
      const y = r.i32()
      const z = r.i32()
      if (entityId === null || entityType === null || x === null || y === null || z === null) {
        return null
      }
      return {
        entityId,
        entityType,
        x: dequantizePos(x),
        y: dequantizePos(y),
        z: dequantizePos(z),
      }
    }
    case MessageType.EntityDestroy: {
      const entityId = r.u32()
      if (entityId === null) return null
      return { entityId }
    }
    case MessageType.LocalCorrection: {
      const tick = r.u32()
      const ackSeq = r.u32()
      const x = r.i32()
      const y = r.i32()
      const z = r.i32()
      const vx = r.i16()
      const vy = r.i16()
      const vz = r.i16()
      const yaw = r.i16()
      const pitch = r.i16()
      const flags = r.u8()
      const jumpVelocityQ = r.i16()
      const dashRemainingQ = r.i16()
      const dashCooldownQ = r.i16()
      const jumpCooldownQ = r.i16()
      const dashVx = r.i16()
      const dashVy = r.i16()
      const dashVz = r.i16()
      if (
        tick === null ||
        ackSeq === null ||
        x === null ||
        y === null ||
        z === null ||
        vx === null ||
        vy === null ||
        vz === null ||
        yaw === null ||
        pitch === null ||
        flags === null ||
        jumpVelocityQ === null ||
        dashRemainingQ === null ||
        dashCooldownQ === null ||
        jumpCooldownQ === null ||
        dashVx === null ||
        dashVy === null ||
        dashVz === null
      ) {
        return null
      }
      return {
        tick,
        ackSeq,
        x: dequantizePos(x),
        y: dequantizePos(y),
        z: dequantizePos(z),
        vx: dequantizeVel(vx),
        vy: dequantizeVel(vy),
        vz: dequantizeVel(vz),
        yaw: dequantizeAngle(yaw),
        pitch: dequantizeAngle(pitch),
        grounded: (flags & 1) !== 0,
        alive: (flags & 2) !== 0,
        jumpVelocity: dequantizeVel(jumpVelocityQ),
        dashRemaining: Math.max(0, dequantizeVel(dashRemainingQ) / 10),
        dashCooldown: Math.max(0, dequantizeVel(dashCooldownQ) / 10),
        jumpCooldown: Math.max(0, dequantizeVel(jumpCooldownQ) / 10),
        dashVx: dequantizeVel(dashVx),
        dashVy: dequantizeVel(dashVy),
        dashVz: dequantizeVel(dashVz),
      }
    }
    default: {
      const _exhaustive: never = type
      return _exhaustive
    }
  }
}

export function encodeMessage<T extends MessageType>(
  type: T,
  payload: MessagePayloadMap[T],
): Uint8Array {
  const estimated = estimatePayloadSize(type, payload)
  const capacity = PROTOCOL_HEADER_BYTES + estimated + 64
  const w = new Writer(capacity)

  // Reserve header
  w.offset = PROTOCOL_HEADER_BYTES
  encodePayload(type, payload, w)

  const total = w.offset
  const payloadLength = total - PROTOCOL_HEADER_BYTES
  if (total > MAX_MESSAGE_BYTES) {
    throw new RangeError(`Encoded message exceeds MAX_MESSAGE_BYTES (${total} > ${MAX_MESSAGE_BYTES})`)
  }

  const out = w.finish()
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  view.setUint8(0, PROTOCOL_VERSION)
  view.setUint8(1, type)
  view.setUint16(2, payloadLength, true)
  return out
}

export function decodeMessage(buf: Uint8Array): DecodeResult {
  if (buf.byteLength < PROTOCOL_HEADER_BYTES) {
    return fail('truncated', 'Buffer shorter than protocol header')
  }
  if (buf.byteLength > MAX_MESSAGE_BYTES) {
    return fail('oversized', `Buffer exceeds MAX_MESSAGE_BYTES (${buf.byteLength})`)
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const protocolVersion = view.getUint8(0)
  const typeRaw = view.getUint8(1)
  const payloadLength = view.getUint16(2, true)

  if (protocolVersion !== PROTOCOL_VERSION) {
    return fail(
      'version_mismatch',
      `Unsupported protocol version ${protocolVersion} (expected ${PROTOCOL_VERSION})`,
    )
  }

  const frameSize = PROTOCOL_HEADER_BYTES + payloadLength
  if (frameSize > MAX_MESSAGE_BYTES) {
    return fail('oversized', `Declared frame size ${frameSize} exceeds MAX_MESSAGE_BYTES`)
  }
  if (buf.byteLength < frameSize) {
    return fail('truncated', `Expected ${frameSize} bytes, got ${buf.byteLength}`)
  }

  if (!isMessageType(typeRaw)) {
    return fail('unknown_type', `Unknown message type ${typeRaw}`)
  }

  const reader = new Reader(buf, PROTOCOL_HEADER_BYTES, frameSize)
  const payload = decodePayload(typeRaw, reader)
  if (payload === null) {
    return fail('malformed', `Failed to decode payload for type ${typeRaw}`)
  }
  if (reader.remaining() !== 0) {
    return fail('malformed', `Trailing bytes in payload for type ${typeRaw}`)
  }

  if (typeRaw === MessageType.Hello) {
    const hello = payload as HelloPayload
    const nameError = validateDisplayName(hello.displayName)
    if (nameError !== null) {
      return fail('invalid_name', nameError)
    }
  }

  return { ok: true, type: typeRaw, payload } as DecodedMessage
}
