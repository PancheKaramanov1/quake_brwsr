import { describe, expect, it } from 'vitest'
import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
} from '../../src/shared/simulation/constants.js'
import {
  decodeMessage,
  encodeMessage,
  PROTOCOL_HEADER_BYTES,
  validateDisplayName,
} from '../../src/shared/protocol/codec.js'
import {
  MatchPhase,
  MessageType,
  type HelloPayload,
  type InputCommandPayload,
  type SnapshotPayload,
  type WelcomePayload,
} from '../../src/shared/protocol/messages.js'

function expectOk<T extends MessageType>(
  result: ReturnType<typeof decodeMessage>,
  type: T,
): Extract<ReturnType<typeof decodeMessage>, { ok: true; type: T }> {
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error('expected ok decode')
  }
  expect(result.type).toBe(type)
  return result as Extract<ReturnType<typeof decodeMessage>, { ok: true; type: T }>
}

describe('protocol codec', () => {
  it('round-trips Hello', () => {
    const payload: HelloPayload = {
      protocolVersion: PROTOCOL_VERSION,
      displayName: 'Player_One',
    }
    const encoded = encodeMessage(MessageType.Hello, payload)
    const decoded = expectOk(decodeMessage(encoded), MessageType.Hello)
    expect(decoded.payload).toEqual(payload)
  })

  it('round-trips Welcome', () => {
    const payload: WelcomePayload = {
      playerId: 7,
      sessionId: 'abc123session',
      reconnectToken: 'tok_456',
      tickRate: 60,
      snapshotRate: 20,
      mapId: 'reactor-atrium-v1',
    }
    const encoded = encodeMessage(MessageType.Welcome, payload)
    const decoded = expectOk(decodeMessage(encoded), MessageType.Welcome)
    expect(decoded.payload).toEqual(payload)
  })

  it('round-trips InputCommand including seq', () => {
    // Duplicate-seq handling is a client/server concern; encode/decode of seq must work.
    const payload: InputCommandPayload = {
      seq: 42,
      clientTick: 100,
      moveX: 1,
      moveY: -1,
      jump: true,
      crouch: false,
      dash: true,
      shoot: false,
      reload: true,
      yaw: 1.25,
      pitch: -0.35,
    }
    const encoded = encodeMessage(MessageType.InputCommand, payload)
    const decoded = expectOk(decodeMessage(encoded), MessageType.InputCommand)
    expect(decoded.payload.seq).toBe(42)
    expect(decoded.payload.clientTick).toBe(100)
    expect(decoded.payload.moveX).toBe(1)
    expect(decoded.payload.moveY).toBe(-1)
    expect(decoded.payload.jump).toBe(true)
    expect(decoded.payload.dash).toBe(true)
    expect(decoded.payload.reload).toBe(true)
    expect(decoded.payload.shoot).toBe(false)
    expect(decoded.payload.yaw).toBeCloseTo(1.25, 5)
    expect(decoded.payload.pitch).toBeCloseTo(-0.35, 5)
  })

  it('round-trips Snapshot (quantized fields)', () => {
    const payload: SnapshotPayload = {
      tick: 1200,
      ackSeq: 55,
      phase: MatchPhase.Active,
      timeRemaining: 500,
      scoreLimit: 25,
      players: [
        {
          id: 1,
          x: 10.5,
          y: 2.25,
          z: -3.75,
          vx: 1.5,
          vy: 0,
          vz: -2.25,
          yaw: 0.5,
          pitch: -0.1,
          health: 87,
          alive: true,
          weapon: 0,
          ammo: 6,
          flags: 0,
          kills: 3,
          deaths: 1,
        },
      ],
      projectiles: [
        {
          id: 9,
          ownerId: 1,
          x: 1.25,
          y: 2.5,
          z: 3.75,
          vx: 10,
          vy: -1,
          vz: 0,
        },
      ],
    }

    const encoded = encodeMessage(MessageType.Snapshot, payload)
    const decoded = expectOk(decodeMessage(encoded), MessageType.Snapshot)
    expect(decoded.payload.tick).toBe(1200)
    expect(decoded.payload.ackSeq).toBe(55)
    expect(decoded.payload.phase).toBe(MatchPhase.Active)
    expect(decoded.payload.players).toHaveLength(1)
    expect(decoded.payload.projectiles).toHaveLength(1)

    const pl = decoded.payload.players[0]
    expect(pl.id).toBe(1)
    expect(pl.x).toBeCloseTo(10.5, 2)
    expect(pl.y).toBeCloseTo(2.25, 2)
    expect(pl.z).toBeCloseTo(-3.75, 2)
    expect(pl.health).toBe(87)
    expect(pl.alive).toBe(true)
    expect(pl.kills).toBe(3)
    expect(pl.deaths).toBe(1)

    const pr = decoded.payload.projectiles[0]
    expect(pr.id).toBe(9)
    expect(pr.ownerId).toBe(1)
    expect(pr.x).toBeCloseTo(1.25, 2)
  })

  it('rejects invalid protocol version', () => {
    const encoded = encodeMessage(MessageType.Hello, {
      protocolVersion: PROTOCOL_VERSION,
      displayName: 'ValidName',
    })
    const bad = new Uint8Array(encoded)
    bad[0] = PROTOCOL_VERSION + 1

    const result = decodeMessage(bad)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('version_mismatch')
  })

  it('rejects truncated frames', () => {
    const encoded = encodeMessage(MessageType.Welcome, {
      playerId: 1,
      sessionId: 'sid',
      reconnectToken: 'tok',
      tickRate: 60,
      snapshotRate: 20,
      mapId: 'map',
    })
    const truncated = encoded.subarray(0, PROTOCOL_HEADER_BYTES + 2)
    const result = decodeMessage(truncated)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('truncated')
  })

  it('rejects oversized buffers', () => {
    const oversized = new Uint8Array(MAX_MESSAGE_BYTES + 1)
    oversized[0] = PROTOCOL_VERSION
    oversized[1] = MessageType.Ping
    // Declared payload length small so frameSize check isn't the only path
    new DataView(oversized.buffer).setUint16(2, 8, true)

    const result = decodeMessage(oversized)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('oversized')
  })

  it('rejects unknown message type', () => {
    const buf = new Uint8Array(PROTOCOL_HEADER_BYTES)
    buf[0] = PROTOCOL_VERSION
    buf[1] = 255
    new DataView(buf.buffer).setUint16(2, 0, true)

    const result = decodeMessage(buf)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('unknown_type')
  })

  it('validateDisplayName rejects empty, too long, and bad chars', () => {
    expect(validateDisplayName('')).not.toBeNull()
    expect(validateDisplayName('abcdefghijklmnopqrstuvwxyz')).not.toBeNull()
    expect(validateDisplayName('bad!name')).not.toBeNull()
    expect(validateDisplayName('ok_name-1')).toBeNull()
  })
})
