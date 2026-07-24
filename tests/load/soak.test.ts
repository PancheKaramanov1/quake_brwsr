import { afterEach, describe, expect, it } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { GameServer } from '../../server/GameServer.js'
import { MatchPhase, MessageType } from '../../src/shared/protocol/messages.js'
import { encodeMessage } from '../../src/shared/protocol/codec.js'
import { CombatBot, percentile, sleep } from '../helpers/botClient.js'
import {
  createTestServerConfig,
  fetchMetrics,
  getFreePort,
  wsUrl,
} from '../helpers/wsTestUtils.js'

const PLAYER_COUNT = 12
/**
 * Full-match soak: default uses a shortened but complete match lifecycle.
 * Set SOAK_FULL_MATCH=1 for a true 600s match (+ restart overhead).
 */
const FULL = process.env.SOAK_FULL_MATCH === '1'
const MATCH_SECONDS = FULL ? 600 : Number(process.env.SOAK_MATCH_SECONDS ?? 30)
const RESULTS_WAIT_MS = 9000
const TIMEOUT_MS = (MATCH_SECONDS * 2 + 240) * 1000 + RESULTS_WAIT_MS

describe('full-match soak + restart', () => {
  let server: GameServer | null = null
  const bots: CombatBot[] = []
  const pingTimers: Array<ReturnType<typeof setInterval>> = []

  afterEach(async () => {
    for (const t of pingTimers) clearInterval(t)
    pingTimers.length = 0
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
    `completes a ${MATCH_SECONDS}s match with 12 bots and one restart`,
    async () => {
      const port = await getFreePort()
      server = new GameServer(
        createTestServerConfig({
          port,
          maxPlayers: PLAYER_COUNT,
          matchDurationSeconds: MATCH_SECONDS,
          scoreLimit: 999,
          reconnectGraceMs: 5000,
          connectionTimeoutMs: 120_000,
        }),
      )
      await server.start()
      const url = wsUrl(port)
      const memStart = (await fetchMetrics(port)).heapUsed as number

      for (let i = 0; i < PLAYER_COUNT; i++) {
        const bot = new CombatBot(`Soak${i + 1}`)
        await bot.connect(url)
        bots.push(bot)
        bot.startCombatLoop(FULL ? 100 : 50)
        pingTimers.push(
          setInterval(() => {
            if (bot.client?.socket.readyState === 1) {
              bot.client.socket.send(
                encodeMessage(MessageType.Ping, { clientTime: Date.now() }),
              )
            }
          }, 3000),
        )
      }

      // Wall clock may exceed sim duration if the event loop is busy; allow 2× slack.
      const deadline = Date.now() + (MATCH_SECONDS * 2 + 120) * 1000
      while (Date.now() < deadline) {
        const m = await fetchMetrics(port)
        if (Number(m.matchCompletions) >= 1) break
        if (bots.filter((b) => b.stats.matchEnded >= 1).length >= PLAYER_COUNT - 1) break
        // If timer nearly elapsed in sim, keep waiting briefly for MatchEnded fan-out
        if (Number(m.timeRemaining) <= 0 && String(m.phase) !== 'Active') {
          await sleep(2000)
          break
        }
        await sleep(1000)
      }
      const metricsMid = await fetchMetrics(port)
      const endedClients = bots.filter((b) => b.stats.matchEnded >= 1).length
      expect(Number(metricsMid.matchCompletions)).toBeGreaterThanOrEqual(1)
      expect(endedClients).toBeGreaterThanOrEqual(PLAYER_COUNT - 1)

      const agreeing = bots.filter((b) => b.standingsHash.length > 0)
      const standingsAgree =
        agreeing.length < 2 || new Set(agreeing.map((b) => b.standingsHash)).size === 1
      expect(standingsAgree).toBe(true)

      const restartDeadline = Date.now() + RESULTS_WAIT_MS + 20_000
      while (Date.now() < restartDeadline) {
        if (
          bots.some(
            (b) =>
              b.stats.lastPhase === MatchPhase.Countdown ||
              b.stats.lastPhase === MatchPhase.Active ||
              b.stats.matchRestartSeen >= 1,
          )
        ) {
          break
        }
        await sleep(500)
      }

      expect(
        bots.some(
          (b) =>
            b.stats.lastPhase === MatchPhase.Countdown ||
            b.stats.lastPhase === MatchPhase.Active ||
            b.stats.matchRestartSeen >= 1,
        ),
      ).toBe(true)

      const still = bots.filter((b) => b.client?.socket.readyState === 1).length
      expect(still).toBeGreaterThanOrEqual(PLAYER_COUNT - 1)
      expect(bots.some((b) => b.stats.nonFiniteSeen)).toBe(false)

      await sleep(3000)

      const metrics = await fetchMetrics(port)
      const snapSizes = bots.flatMap((b) => b.stats.snapshotSizes)
      let snapMax = 0
      for (const s of snapSizes) if (s > snapMax) snapMax = s
      const report = {
        matchSeconds: MATCH_SECONDS,
        fullMatch: FULL,
        matchCompletions: metrics.matchCompletions,
        unexpectedDisconnects: Math.max(0, PLAYER_COUNT - still),
        tickP50: metrics.tickP50,
        tickP95: metrics.tickP95,
        tickP99: metrics.tickP99,
        tickMax: metrics.tickMax,
        tickOverruns: metrics.tickOverruns,
        snapshotSizeP50: percentile(snapSizes, 0.5),
        snapshotSizeP95: percentile(snapSizes, 0.95),
        snapshotSizeMax: snapMax,
        bytesOut: metrics.bytesOut,
        bandwidthPerClientBps:
          Number(metrics.bytesOut) / Math.max(1, MATCH_SECONDS) / PLAYER_COUNT,
        memStart,
        memEnd: metrics.heapUsed,
        memPeak: metrics.heapUsedPeak,
        standingsAgree,
        playerDeaths: metrics.playerDeaths,
        endedClients,
      }
      try {
        mkdirSync(join(process.cwd(), 'artifacts'), { recursive: true })
        writeFileSync(
          join(process.cwd(), 'artifacts', FULL ? 'soak-full-report.json' : 'soak-report.json'),
          JSON.stringify(report, null, 2),
        )
      } catch {
        // ignore
      }

      expect(Number(metrics.matchCompletions)).toBeGreaterThanOrEqual(1)
      expect(Number(metrics.tickP95)).toBeLessThan(50)

      for (const t of pingTimers) clearInterval(t)
      pingTimers.length = 0
      for (const bot of bots) await bot.disconnect(true)
      bots.length = 0
    },
    TIMEOUT_MS,
  )
})
