import { afterEach, describe, expect, it } from 'vitest'
import { GameServer } from '../../server/GameServer.js'
import { encodeMessage } from '../../src/shared/protocol/codec.js'
import { MessageType } from '../../src/shared/protocol/messages.js'
import { PROTOCOL_VERSION } from '../../src/shared/simulation/constants.js'
import {
  connectWs,
  createTestServerConfig,
  getFreePort,
  waitForMessageType,
  wsUrl,
  type WsClient,
} from '../helpers/wsTestUtils.js'

describe('reconnect correctness', () => {
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

  it('reconnects with token, preserves score, replaces old socket', async () => {
    const port = await getFreePort()
    server = new GameServer(
      createTestServerConfig({ port, reconnectGraceMs: 3000, scoreLimit: 50 }),
    )
    await server.start()
    const url = wsUrl(port)

    const c1 = await connectWs(url)
    clients.push(c1)
    c1.socket.send(
      encodeMessage(MessageType.Hello, {
        protocolVersion: PROTOCOL_VERSION,
        displayName: 'Recon',
      }),
    )
    const welcome = await waitForMessageType(c1.socket, MessageType.Welcome, 5000)
    expect(welcome.type).toBe(MessageType.Welcome)
    if (welcome.type !== MessageType.Welcome) return
    const { sessionId, reconnectToken, playerId } = welcome.payload

    // Force a kill score via server world
    const player = server.match.world.players.get(playerId)
    expect(player).toBeTruthy()
    if (player) {
      player.score = 3
      player.kills = 3
    }

    // New socket reconnects
    const c2 = await connectWs(url)
    clients.push(c2)
    c2.socket.send(
      encodeMessage(MessageType.Reconnect, {
        sessionId,
        reconnectToken,
      }),
    )
    const welcome2 = await waitForMessageType(c2.socket, MessageType.Welcome, 5000)
    expect(welcome2.type).toBe(MessageType.Welcome)
    if (welcome2.type === MessageType.Welcome) {
      expect(welcome2.payload.playerId).toBe(playerId)
    }

    const still = server.match.world.players.get(playerId)
    expect(still?.score).toBe(3)
    expect(still?.kills).toBe(3)
    expect(server.match.world.players.size).toBe(1)

    // Bad token rejected
    const c3 = await connectWs(url)
    clients.push(c3)
    c3.socket.send(
      encodeMessage(MessageType.Reconnect, {
        sessionId,
        reconnectToken: '0'.repeat(32),
      }),
    )
    const reject = await waitForMessageType(c3.socket, MessageType.Reject, 5000)
    expect(reject.type).toBe(MessageType.Reject)
  })

  it('rejects reconnect after grace expiry', async () => {
    const port = await getFreePort()
    server = new GameServer(
      createTestServerConfig({ port, reconnectGraceMs: 200 }),
    )
    await server.start()
    const url = wsUrl(port)
    const c1 = await connectWs(url)
    clients.push(c1)
    c1.socket.send(
      encodeMessage(MessageType.Hello, {
        protocolVersion: PROTOCOL_VERSION,
        displayName: 'Expire',
      }),
    )
    const welcome = await waitForMessageType(c1.socket, MessageType.Welcome, 5000)
    expect(welcome.type).toBe(MessageType.Welcome)
    if (welcome.type !== MessageType.Welcome) return
    const { sessionId, reconnectToken } = welcome.payload
    await c1.close()
    await new Promise((r) => setTimeout(r, 500))

    const c2 = await connectWs(url)
    clients.push(c2)
    c2.socket.send(
      encodeMessage(MessageType.Reconnect, { sessionId, reconnectToken }),
    )
    const reject = await waitForMessageType(c2.socket, MessageType.Reject, 5000)
    expect(reject.type).toBe(MessageType.Reject)
  })
})
