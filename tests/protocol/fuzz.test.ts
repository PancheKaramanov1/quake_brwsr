import { afterEach, describe, expect, it } from 'vitest'
import { GameServer } from '../../server/GameServer.js'
import { encodeMessage, decodeMessage } from '../../src/shared/protocol/codec.js'
import { MessageType } from '../../src/shared/protocol/messages.js'
import { PROTOCOL_VERSION } from '../../src/shared/simulation/constants.js'
import {
  connectWs,
  createTestServerConfig,
  fetchMetrics,
  getFreePort,
  waitForMessageType,
  wsUrl,
  type WsClient,
} from '../helpers/wsTestUtils.js'

describe('protocol fuzz / adversarial packets', () => {
  let server: GameServer | null = null
  const clients: WsClient[] = []

  afterEach(async () => {
    while (clients.length > 0) {
      const c = clients.pop()
      if (c) await c.close()
    }
    if (server) {
      await server.shutdown()
      server = null
    }
  })

  async function boot(): Promise<number> {
    const port = await getFreePort()
    server = new GameServer(createTestServerConfig({ port, reconnectGraceMs: 200 }))
    await server.start()
    return port
  }

  it('survives empty, truncated, oversized, and unknown packets', async () => {
    const port = await boot()
    const url = wsUrl(port)
    const client = await connectWs(url)
    clients.push(client)

    client.socket.send(new Uint8Array(0))
    client.socket.send(new Uint8Array([1]))
    client.socket.send(new Uint8Array([1, 99, 0, 10]))
    client.socket.send(new Uint8Array(70_000).fill(1))
    await new Promise((r) => setTimeout(r, 200))

    const c2 = await connectWs(url)
    clients.push(c2)
    c2.socket.send(
      encodeMessage(MessageType.Hello, {
        protocolVersion: PROTOCOL_VERSION,
        displayName: 'FuzzOk',
      }),
    )
    const welcome = await waitForMessageType(c2.socket, MessageType.Welcome, 5000)
    expect(welcome.type).toBe(MessageType.Welcome)

    const metrics = await fetchMetrics(port)
    expect(Number(metrics.errors) + Number(metrics.invalidMessages)).toBeGreaterThan(0)
  })

  it('rejects unsupported protocol version and invalid names', async () => {
    const port = await boot()
    const url = wsUrl(port)
    const c = await connectWs(url)
    clients.push(c)
    c.socket.send(
      encodeMessage(MessageType.Hello, {
        protocolVersion: 255,
        displayName: 'X',
      }),
    )
    const reject = await waitForMessageType(c.socket, MessageType.Reject, 5000)
    expect(reject.type).toBe(MessageType.Reject)

    const c2 = await connectWs(url)
    clients.push(c2)
    // Invalid names fail at codec decode — server records invalid_message, no crash
    c2.socket.send(
      encodeMessage(MessageType.Hello, {
        protocolVersion: PROTOCOL_VERSION,
        displayName: '!!!bad!!!',
      }),
    )
    await new Promise((r) => setTimeout(r, 300))
    const metrics = await fetchMetrics(port)
    expect(Number(metrics.invalidMessages)).toBeGreaterThan(0)
    // Valid join still works
    const c3 = await connectWs(url)
    clients.push(c3)
    c3.socket.send(
      encodeMessage(MessageType.Hello, {
        protocolVersion: PROTOCOL_VERSION,
        displayName: 'GoodName',
      }),
    )
    const welcome = await waitForMessageType(c3.socket, MessageType.Welcome, 5000)
    expect(welcome.type).toBe(MessageType.Welcome)
  })

  it('ignores NaN / extreme input floods without crashing', async () => {
    const port = await boot()
    const url = wsUrl(port)
    const c = await connectWs(url)
    clients.push(c)
    c.socket.send(
      encodeMessage(MessageType.Hello, {
        protocolVersion: PROTOCOL_VERSION,
        displayName: 'Flood',
      }),
    )
    await waitForMessageType(c.socket, MessageType.Welcome, 5000)
    const snap = await waitForMessageType(c.socket, MessageType.Snapshot, 5000)
    const tick = snap.type === MessageType.Snapshot ? snap.payload.tick : 0

    for (let i = 0; i < 200; i++) {
      if (c.socket.readyState !== 1) break
      c.socket.send(
        encodeMessage(MessageType.InputCommand, {
          seq: i + 1,
          clientTick: tick + 1,
          moveX: i % 2 === 0 ? Number.NaN : 99,
          moveY: Number.POSITIVE_INFINITY,
          jump: true,
          crouch: false,
          dash: true,
          shoot: true,
          reload: false,
          yaw: Number.NaN,
          pitch: 1e9,
        }),
      )
    }
    await new Promise((r) => setTimeout(r, 500))
    const metrics = await fetchMetrics(port)
    expect(metrics.phase).toBeTruthy()
    const health = await fetch(`http://127.0.0.1:${port}/health`)
    expect(health.ok).toBe(true)
  })

  it('codec decode rejects garbage without throwing', () => {
    const samples = [
      new Uint8Array(0),
      new Uint8Array([0, 0, 0, 0]),
      new Uint8Array([255, 255, 255, 255, 1, 2, 3]),
      new Uint8Array([PROTOCOL_VERSION, 200, 0, 2, 1, 2]),
    ]
    for (const s of samples) {
      const r = decodeMessage(s)
      expect(typeof r.ok).toBe('boolean')
    }
  })
})
