import { afterEach, describe, expect, it } from 'vitest'
import { GameServer } from '../../server/GameServer.js'
import { PROTOCOL_VERSION } from '../../src/shared/simulation/constants.js'
import { encodeMessage } from '../../src/shared/protocol/codec.js'
import { MessageType, RejectReason } from '../../src/shared/protocol/messages.js'
import {
  connectWs,
  createTestServerConfig,
  getFreePort,
  waitForMessageType,
  wsUrl,
  type WsClient,
} from '../helpers/wsTestUtils.js'

describe('GameServer integration', () => {
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

  it('accepts Hello, sends Welcome, snapshots for two clients, rejects when full, and shuts down', async () => {
    const port = await getFreePort()
    const config = createTestServerConfig({
      port,
      maxPlayers: 2,
      reconnectGraceMs: 100,
    })
    server = new GameServer(config)
    await server.start()

    const url = wsUrl(port)

    const client1 = await connectWs(url)
    clients.push(client1)
    client1.socket.send(
      encodeMessage(MessageType.Hello, {
        protocolVersion: PROTOCOL_VERSION,
        displayName: 'Alpha',
      }),
    )
    const welcome1 = await waitForMessageType(client1.socket, MessageType.Welcome, 3000)
    expect(welcome1.type).toBe(MessageType.Welcome)
    if (welcome1.type === MessageType.Welcome) {
      expect(welcome1.payload.playerId).toBeGreaterThan(0)
      expect(welcome1.payload.mapId.length).toBeGreaterThan(0)
    }

    const client2 = await connectWs(url)
    clients.push(client2)
    client2.socket.send(
      encodeMessage(MessageType.Hello, {
        protocolVersion: PROTOCOL_VERSION,
        displayName: 'Bravo',
      }),
    )
    const welcome2 = await waitForMessageType(client2.socket, MessageType.Welcome, 3000)
    expect(welcome2.type).toBe(MessageType.Welcome)

    const [snap1, snap2] = await Promise.all([
      waitForMessageType(client1.socket, MessageType.Snapshot, 5000),
      waitForMessageType(client2.socket, MessageType.Snapshot, 5000),
    ])
    expect(snap1.type).toBe(MessageType.Snapshot)
    expect(snap2.type).toBe(MessageType.Snapshot)
    if (snap1.type === MessageType.Snapshot) {
      expect(snap1.payload.players.length).toBeGreaterThanOrEqual(2)
    }

    const client3 = await connectWs(url)
    clients.push(client3)
    client3.socket.send(
      encodeMessage(MessageType.Hello, {
        protocolVersion: PROTOCOL_VERSION,
        displayName: 'Charlie',
      }),
    )
    const reject = await waitForMessageType(client3.socket, MessageType.Reject, 3000)
    expect(reject.type).toBe(MessageType.Reject)
    if (reject.type === MessageType.Reject) {
      expect(reject.payload.reason).toBe(RejectReason.Full)
    }

    await server.shutdown()
    server = null
  }, 20_000)

  it('exposes /status discovery and readiness semantics', async () => {
    const port = await getFreePort()
    server = new GameServer(
      createTestServerConfig({
        port,
        publicUrl: `http://127.0.0.1:${port}`,
        serverName: 'DiscoveryTest',
        region: 'ci',
      }),
    )
    await server.start()
    const ready = await fetch(`http://127.0.0.1:${port}/ready`)
    expect(ready.status).toBe(200)
    const readyBody = (await ready.json()) as { ready: boolean; simulationReady: boolean }
    expect(readyBody.ready).toBe(true)
    expect(readyBody.simulationReady).toBe(true)

    const statusRes = await fetch(`http://127.0.0.1:${port}/status`)
    expect(statusRes.status).toBe(200)
    const status = (await statusRes.json()) as {
      serverName: string
      region: string
      protocolVersion: number
      joinAvailable: boolean
      servers: unknown[]
    }
    expect(status.serverName).toBe('DiscoveryTest')
    expect(status.region).toBe('ci')
    expect(status.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(status.joinAvailable).toBe(true)
    expect(status.servers.length).toBe(1)

    await server.shutdown()
    server = null
  }, 15_000)
})
