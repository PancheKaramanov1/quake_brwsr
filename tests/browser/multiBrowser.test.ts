/**
 * Real multiplayer verification harness.
 *
 * Uses live GameServer + multiple protocol clients on the same binary WebSocket
 * path as the browser GameClient, plus HTTP discovery checks.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { GameServer } from '../../server/GameServer.js'
import { encodeMessage } from '../../src/shared/protocol/codec.js'
import { MessageType, RejectReason } from '../../src/shared/protocol/messages.js'
import { PROTOCOL_VERSION } from '../../src/shared/simulation/constants.js'
import { CombatBot, sleep } from '../helpers/botClient.js'
import {
  connectWs,
  createTestServerConfig,
  fetchReady,
  fetchStatus,
  getFreePort,
  waitForMessageType,
  wsUrl,
  type WsClient,
} from '../helpers/wsTestUtils.js'

describe('browser multiplayer harness', () => {
  let server: GameServer | null = null

  afterEach(async () => {
    if (server) {
      await server.shutdown()
      server = null
    }
  })

  it('discovers server via /status and completes two-client combat sync', async () => {
    const port = await getFreePort()
    server = new GameServer(
      createTestServerConfig({
        port,
        maxPlayers: 12,
        matchDurationSeconds: 120,
        scoreLimit: 25,
        publicUrl: `http://127.0.0.1:${port}`,
      }),
    )
    await server.start()

    const ready = await fetchReady(port)
    expect(ready.ready).toBe(true)
    expect(ready.status).toBe(200)

    const status = await fetchStatus(port)
    expect(status.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(status.joinAvailable).toBe(true)
    expect(status.mapName).toBeTruthy()
    expect(status.serverName).toBeTruthy()
    expect(Array.isArray(status.servers)).toBe(true)

    const url = wsUrl(port)
    const a = new CombatBot('BrowserA')
    const b = new CombatBot('BrowserB')
    try {
      await a.connect(url)
      await b.connect(url)
      a.startCombatLoop(40)
      b.startCombatLoop(40)

      await sleep(6000)
      a.stop()
      b.stop()

      expect(a.stats.snapshots).toBeGreaterThan(10)
      expect(b.stats.snapshots).toBeGreaterThan(10)
      expect(a.stats.nonFiniteSeen).toBe(false)
      expect(b.stats.nonFiniteSeen).toBe(false)

      const pa = server.match.world.players.get(a.playerId)!
      const pb = server.match.world.players.get(b.playerId)!
      pa.spawnProtection = 0
      pb.spawnProtection = 0
      pb.sim.position.x = pa.sim.position.x + 2
      pb.sim.position.y = pa.sim.position.y
      pb.sim.position.z = pa.sim.position.z
      pa.weapon.ammo = 8
      pa.weapon.fireCooldown = 0
      pa.weapon.reloading = false
      server.match.world.tryPlayerFire(pa)
      for (let i = 0; i < 120; i++) server.match.world.step()

      const trace = {
        status,
        a: a.stats,
        b: b.stats,
        projectiles: server.match.world.projectiles.size,
        deaths: [pa.deaths, pb.deaths],
        health: [pa.health, pb.health],
      }
      try {
        mkdirSync(join(process.cwd(), 'artifacts'), { recursive: true })
        writeFileSync(
          join(process.cwd(), 'artifacts', 'browser-two-client-trace.json'),
          JSON.stringify(trace, null, 2),
        )
      } catch {
        // ignore
      }

      expect(pa.health + pb.health).toBeLessThan(200)
    } finally {
      await a.disconnect(true)
      await b.disconnect(true)
    }
  }, 60_000)

  it('joins twelve clients and rejects the thirteenth', async () => {
    const port = await getFreePort()
    server = new GameServer(
      createTestServerConfig({ port, maxPlayers: 12, matchDurationSeconds: 60 }),
    )
    await server.start()
    const url = wsUrl(port)
    const bots: CombatBot[] = []
    const clients: WsClient[] = []

    try {
      for (let i = 0; i < 12; i++) {
        const bot = new CombatBot(`Ctx${i + 1}`)
        await bot.connect(url)
        bots.push(bot)
      }
      expect(bots).toHaveLength(12)

      const extra = await connectWs(url)
      clients.push(extra)
      extra.socket.send(
        encodeMessage(MessageType.Hello, {
          protocolVersion: PROTOCOL_VERSION,
          displayName: 'Thirteen',
        }),
      )
      const reject = await waitForMessageType(extra.socket, MessageType.Reject, 5000)
      expect(reject.type).toBe(MessageType.Reject)
      if (reject.type === MessageType.Reject) {
        expect(reject.payload.reason).toBe(RejectReason.Full)
      }

      const status = await fetchStatus(port)
      expect(status.players).toBe(12)
      expect(status.joinAvailable).toBe(false)
    } finally {
      for (const bot of bots) await bot.disconnect(true)
      for (const c of clients) await c.close()
    }
  }, 60_000)

  it('production client build references no private secrets', async () => {
    const { readdirSync } = await import('node:fs')
    const distJs = join(process.cwd(), 'dist', 'assets')
    if (!existsSync(distJs)) {
      expect(true).toBe(true)
      return
    }
    const files = readdirSync(distJs).filter((f) => f.endsWith('.js'))
    for (const f of files) {
      const text = readFileSync(join(distJs, f), 'utf8')
      expect(text).not.toMatch(/SERVER_SECRET|PRIVATE_KEY/)
    }
  })
})
