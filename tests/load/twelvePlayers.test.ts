import { afterEach, describe, expect, it } from 'vitest'
import { GameServer } from '../../server/GameServer.js'
import { PROTOCOL_VERSION } from '../../src/shared/simulation/constants.js'
import { encodeMessage } from '../../src/shared/protocol/codec.js'
import { MessageType } from '../../src/shared/protocol/messages.js'
import {
  connectWs,
  createTestServerConfig,
  fetchMetrics,
  getFreePort,
  waitForMessageType,
  wsUrl,
  type WsClient,
} from '../helpers/wsTestUtils.js'

const PLAYER_COUNT = 12
const RUN_MS = 3000
const INPUT_INTERVAL_MS = 50

describe('twelve-player load', () => {
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

  it('welcomes 12 clients sending inputs for ~3s without crashing', async () => {
    const port = await getFreePort()
    const config = createTestServerConfig({
      port,
      maxPlayers: PLAYER_COUNT,
      reconnectGraceMs: 100,
    })
    server = new GameServer(config)
    await server.start()

    const url = wsUrl(port)
    const welcomed: boolean[] = []

    for (let i = 0; i < PLAYER_COUNT; i++) {
      const client = await connectWs(url, 5000)
      clients.push(client)
      client.socket.send(
        encodeMessage(MessageType.Hello, {
          protocolVersion: PROTOCOL_VERSION,
          displayName: `P${i + 1}`,
        }),
      )
      const welcome = await waitForMessageType(client.socket, MessageType.Welcome, 5000)
      expect(welcome.type).toBe(MessageType.Welcome)
      welcomed.push(true)
    }

    expect(welcomed).toHaveLength(PLAYER_COUNT)
    expect(welcomed.every(Boolean)).toBe(true)

    // Sync clientTick to server tick so inputs are not rejected for skew.
    const syncSnap = await waitForMessageType(clients[0].socket, MessageType.Snapshot, 5000)
    expect(syncSnap.type).toBe(MessageType.Snapshot)
    const baseTick = syncSnap.type === MessageType.Snapshot ? syncSnap.payload.tick : 0

    const start = Date.now()
    const timers: ReturnType<typeof setInterval>[] = []

    for (let i = 0; i < clients.length; i++) {
      const client = clients[i]
      let seq = 1
      const timer = setInterval(() => {
        if (client.socket.readyState !== 1) return
        const elapsedTicks = Math.floor(((Date.now() - start) / 1000) * 60)
        client.socket.send(
          encodeMessage(MessageType.InputCommand, {
            seq: seq++,
            clientTick: baseTick + elapsedTicks,
            moveX: i % 2 === 0 ? 1 : -1,
            moveY: 1,
            jump: false,
            crouch: false,
            dash: false,
            shoot: false,
            reload: false,
            yaw: (i / PLAYER_COUNT) * Math.PI * 2,
            pitch: 0,
          }),
        )
      }, INPUT_INTERVAL_MS)
      timers.push(timer)
    }

    await new Promise<void>((resolve) => setTimeout(resolve, RUN_MS))
    for (const t of timers) clearInterval(t)

    const metrics = await fetchMetrics(port)
    expect(metrics.players).toBe(PLAYER_COUNT)
    expect(Number(metrics.tickCount)).toBeGreaterThan(0)

    console.log('[load] tick metrics', {
      tickCount: metrics.tickCount,
      tickP50: metrics.tickP50,
      tickP95: metrics.tickP95,
      tickMax: metrics.tickMax,
      players: metrics.players,
      avgSnapshotBytes: metrics.avgSnapshotBytes,
      bytesIn: metrics.bytesIn,
      bytesOut: metrics.bytesOut,
      phase: metrics.phase,
    })

    for (const c of clients) {
      await c.close()
    }
    clients.length = 0

    await server.shutdown()
    server = null
  }, 60_000)
})
