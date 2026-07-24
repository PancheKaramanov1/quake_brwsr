import { afterEach, describe, expect, it } from 'vitest'
import { GameServer } from '../../server/GameServer.js'
import { CombatBot, NETWORK_PROFILES, sleep } from '../helpers/botClient.js'
import { createTestServerConfig, getFreePort, wsUrl } from '../helpers/wsTestUtils.js'

describe('network impairment profiles', () => {
  let server: GameServer | null = null

  afterEach(async () => {
    if (server) {
      await server.shutdown()
      server = null
    }
  })

  for (const key of ['good', 'typical', 'poor', 'severe'] as const) {
    it(
      `remains functional under ${key} network`,
      async () => {
        const profile = NETWORK_PROFILES[key]
        const port = await getFreePort()
        server = new GameServer(
          createTestServerConfig({
            port,
            maxPlayers: 4,
            matchDurationSeconds: 120,
            scoreLimit: 50,
            reconnectGraceMs: 2000,
          }),
        )
        await server.start()
        const url = wsUrl(port)
        const bots: CombatBot[] = []

        try {
          for (let i = 0; i < 4; i++) {
            const bot = new CombatBot(`Net${key}${i}`, profile)
            await bot.connect(url)
            bots.push(bot)
            bot.startCombatLoop(50)
          }

          await sleep(8000)
          for (const bot of bots) bot.stop()

          const connected = bots.filter((b) => b.client?.socket.readyState === 1).length
          expect(connected).toBe(4)
          expect(bots.every((b) => b.stats.snapshots > 0)).toBe(true)
          expect(bots.some((b) => b.stats.nonFiniteSeen)).toBe(false)

          if (key !== 'severe') {
            expect(bots.reduce((n, b) => n + b.stats.protocolErrors, 0)).toBe(0)
          }
        } finally {
          for (const bot of bots) {
            await bot.disconnect(true)
          }
        }
      },
      30_000,
    )
  }
})
