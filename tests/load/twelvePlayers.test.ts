import { afterEach, describe, expect, it } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { GameServer } from '../../server/GameServer.js'
import { MessageType, RejectReason } from '../../src/shared/protocol/messages.js'
import { encodeMessage } from '../../src/shared/protocol/codec.js'
import { PROTOCOL_VERSION } from '../../src/shared/simulation/constants.js'
import { CombatBot, percentile, sleep } from '../helpers/botClient.js'
import {
  connectWs,
  createTestServerConfig,
  fetchMetrics,
  getFreePort,
  waitForMessageType,
  wsUrl,
} from '../helpers/wsTestUtils.js'

const PLAYER_COUNT = 12
/** Standard load: ≥ 2 minutes of active combat. */
const RUN_MS = Number(process.env.LOAD_RUN_MS ?? 120_000)

describe('twelve-player load (2 minutes)', () => {
  let server: GameServer | null = null
  const bots: CombatBot[] = []

  afterEach(async () => {
    while (bots.length > 0) {
      const b = bots.pop()
      if (b) await b.disconnect(true)
    }
    if (server) {
      await server.shutdown()
      server = null
    }
  })

  it(
    'runs 12 combat bots for 2 minutes without unexpected disconnects',
    async () => {
      const port = await getFreePort()
      const config = createTestServerConfig({
        port,
        maxPlayers: PLAYER_COUNT,
        matchDurationSeconds: 600,
        scoreLimit: 100,
        reconnectGraceMs: 2000,
      })
      server = new GameServer(config)
      await server.start()
      const url = wsUrl(port)

      const memStart = (await fetchMetrics(port)).heapUsed as number

      for (let i = 0; i < PLAYER_COUNT; i++) {
        const bot = new CombatBot(`Load${i + 1}`)
        await bot.connect(url)
        bots.push(bot)
      }
      expect(bots).toHaveLength(PLAYER_COUNT)
      expect(bots.every((b) => b.stats.welcomed)).toBe(true)

      // 13th rejected
      const extra = await connectWs(url, 5000)
      extra.socket.send(
        encodeMessage(MessageType.Hello, {
          protocolVersion: PROTOCOL_VERSION,
          displayName: 'Overflow',
        }),
      )
      const reject = await waitForMessageType(extra.socket, MessageType.Reject, 5000)
      expect(reject.type).toBe(MessageType.Reject)
      if (reject.type === MessageType.Reject) {
        expect(reject.payload.reason).toBe(RejectReason.Full)
      }
      await extra.close()

      for (const bot of bots) bot.startCombatLoop(50)
      await sleep(RUN_MS)
      for (const bot of bots) bot.stop()

      const metrics = await fetchMetrics(port)
      const memEnd = metrics.heapUsed as number
      const memPeak = metrics.heapUsedPeak as number

      const stillConnected = bots.filter((b) => b.client?.socket.readyState === 1).length
      expect(stillConnected).toBe(PLAYER_COUNT)
      expect(bots.some((b) => b.stats.nonFiniteSeen)).toBe(false)
      expect(bots.some((b) => b.stats.protocolErrors > 0)).toBe(false)

      const snapSizes = bots.flatMap((b) => b.stats.snapshotSizes)
      const report = {
        attempted: PLAYER_COUNT + 1,
        successful: PLAYER_COUNT,
        rejected: 1,
        unexpectedDisconnects: PLAYER_COUNT - stillConnected,
        tickP50: metrics.tickP50,
        tickP95: metrics.tickP95,
        tickP99: metrics.tickP99,
        tickMax: metrics.tickMax,
        tickOverruns: metrics.tickOverruns,
        snapshotSizeP50: percentile(snapSizes, 0.5),
        snapshotSizeP95: percentile(snapSizes, 0.95),
        snapshotSizeMax: percentile(snapSizes, 1),
        bytesOut: metrics.bytesOut,
        bytesIn: metrics.bytesIn,
        bandwidthPerClientBps:
          (Number(metrics.bytesOut) / (RUN_MS / 1000)) / PLAYER_COUNT,
        memStart,
        memEnd,
        memPeak,
        peakPendingInputs: metrics.peakPendingInputs,
        durationMs: RUN_MS,
      }

      try {
        mkdirSync(join(process.cwd(), 'artifacts'), { recursive: true })
        writeFileSync(
          join(process.cwd(), 'artifacts', 'load-report.json'),
          JSON.stringify(report, null, 2),
        )
      } catch {
        // ignore artifact write failures
      }

      // Memory should not explode unboundedly over 2 minutes
      expect(Number(memPeak)).toBeLessThan(Number(memStart) + 400 * 1024 * 1024)
      expect(Number(metrics.tickP95)).toBeLessThan(50)

      for (const bot of bots) await bot.disconnect(true)
    },
    RUN_MS + 60_000,
  )
})
