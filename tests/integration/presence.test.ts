/**
 * Presence / session synchronization integration tests.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { GameServer } from '../../server/GameServer.js'
import { encodeMessage, decodeMessage } from '../../src/shared/protocol/codec.js'
import { MessageType, type DecodedMessage } from '../../src/shared/protocol/messages.js'
import { PROTOCOL_VERSION } from '../../src/shared/simulation/constants.js'
import {
  connectWs,
  createTestServerConfig,
  fetchStatus,
  getFreePort,
  waitForMessageType,
  wsUrl,
  type WsClient,
} from '../helpers/wsTestUtils.js'

function collectUntil(
  socket: import('ws').WebSocket,
  predicate: (msg: DecodedMessage) => boolean,
  timeoutMs = 5000,
): Promise<DecodedMessage[]> {
  return new Promise((resolve, reject) => {
    const got: DecodedMessage[] = []
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out collecting messages (${timeoutMs}ms); got ${got.map((m) => m.type).join(',')}`))
    }, timeoutMs)

    const onMessage = (raw: import('ws').RawData): void => {
      const buf = Buffer.isBuffer(raw)
        ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
        : raw instanceof ArrayBuffer
          ? new Uint8Array(raw)
          : new Uint8Array()
      const decoded = decodeMessage(buf)
      if (!decoded.ok) return
      got.push(decoded)
      if (predicate(decoded)) {
        cleanup()
        resolve(got)
      }
    }

    const cleanup = (): void => {
      clearTimeout(timer)
      socket.off('message', onMessage)
    }

    socket.on('message', onMessage)
  })
}

describe('live session presence', () => {
  let server: GameServer | null = null
  const clients: WsClient[] = []

  afterEach(async () => {
    for (const c of clients) {
      try {
        c.socket.close()
      } catch {
        /* ignore */
      }
    }
    clients.length = 0
    if (server) {
      await server.shutdown()
      server = null
    }
  })

  it('two clients share instance ids, see each other, and status matches count', async () => {
    const port = await getFreePort()
    server = new GameServer(createTestServerConfig({ port, maxPlayers: 12 }))
    await server.start()

    const status0 = await fetchStatus(port)
    expect(status0.serverInstanceId).toBeTruthy()
    expect(status0.matchInstanceId).toBeTruthy()
    expect(status0.buildVersion).toBeTruthy()
    expect(status0.players).toBe(0)
    expect(status0.protocolVersion).toBe(PROTOCOL_VERSION)

    const statusRes = await fetch(`http://127.0.0.1:${port}/status`)
    expect(statusRes.headers.get('cache-control')).toBe('no-store')

    const url = wsUrl(port)
    const a = await connectWs(url)
    clients.push(a)
    a.socket.send(
      encodeMessage(MessageType.Hello, {
        protocolVersion: PROTOCOL_VERSION,
        displayName: 'Alpha',
      }),
    )
    const welcomeA = await waitForMessageType(a.socket, MessageType.Welcome, 3000)
    expect(welcomeA.type).toBe(MessageType.Welcome)
    if (welcomeA.type !== MessageType.Welcome) return
    expect(welcomeA.payload.serverInstanceId).toBe(status0.serverInstanceId)
    expect(welcomeA.payload.matchInstanceId).toBe(status0.matchInstanceId)

    const b = await connectWs(url)
    clients.push(b)

    const aJoinedPromise = waitForMessageType(a.socket, MessageType.PlayerJoined, 5000)
    const bBatchPromise = collectUntil(
      b.socket,
      (m) => m.type === MessageType.PlayerJoined,
      5000,
    )

    b.socket.send(
      encodeMessage(MessageType.Hello, {
        protocolVersion: PROTOCOL_VERSION,
        displayName: 'Bravo',
      }),
    )

    const bBatch = await bBatchPromise
    const welcomeB = bBatch.find((m) => m.type === MessageType.Welcome)
    const roster = bBatch.find((m) => m.type === MessageType.PlayerJoined)
    expect(welcomeB?.type).toBe(MessageType.Welcome)
    expect(roster?.type).toBe(MessageType.PlayerJoined)
    if (welcomeB?.type === MessageType.Welcome) {
      expect(welcomeB.payload.serverInstanceId).toBe(welcomeA.payload.serverInstanceId)
      expect(welcomeB.payload.matchInstanceId).toBe(welcomeA.payload.matchInstanceId)
    }
    if (roster?.type === MessageType.PlayerJoined) {
      expect(roster.payload.playerId).toBe(welcomeA.payload.playerId)
      expect(roster.payload.displayName).toContain('Alpha')
    }

    const joined = await aJoinedPromise
    expect(joined.type).toBe(MessageType.PlayerJoined)
    if (joined.type === MessageType.PlayerJoined) {
      expect(joined.payload.displayName).toContain('Bravo')
    }

    const status2 = await fetchStatus(port)
    expect(status2.players).toBe(2)
    expect(status2.joinedPlayers).toBe(2)
    expect(status2.serverInstanceId).toBe(status0.serverInstanceId)
    expect(status2.matchInstanceId).toBe(status0.matchInstanceId)
    expect(server.match.matchInstanceId).toBe(status0.matchInstanceId)
  })

  it('rejects a thirteenth joined player', async () => {
    const port = await getFreePort()
    server = new GameServer(createTestServerConfig({ port, maxPlayers: 12 }))
    await server.start()
    const url = wsUrl(port)

    for (let i = 0; i < 12; i++) {
      const c = await connectWs(url)
      clients.push(c)
      c.socket.send(
        encodeMessage(MessageType.Hello, {
          protocolVersion: PROTOCOL_VERSION,
          displayName: `P${i}`,
        }),
      )
      await waitForMessageType(c.socket, MessageType.Welcome, 5000)
    }

    const extra = await connectWs(url)
    clients.push(extra)
    extra.socket.send(
      encodeMessage(MessageType.Hello, {
        protocolVersion: PROTOCOL_VERSION,
        displayName: 'Overflow',
      }),
    )
    const reject = await waitForMessageType(extra.socket, MessageType.Reject, 5000)
    expect(reject.type).toBe(MessageType.Reject)

    const status = await fetchStatus(port)
    expect(status.players).toBe(12)
  })

  it('creates only one match instance per process', async () => {
    const port = await getFreePort()
    server = new GameServer(createTestServerConfig({ port }))
    await server.start()
    const id1 = server.match.matchInstanceId
    const status = await fetchStatus(port)
    expect(status.matchInstanceId).toBe(id1)
  })
})
