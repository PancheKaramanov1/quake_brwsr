import {
  ALLOWED_ORIGINS_DEFAULT,
  loadServerConfig,
  type ServerConfig,
} from './config.js'
import { GameServer } from './GameServer.js'
import {
  SHUTDOWN_FORCE_EXIT_MS,
  SHUTDOWN_GRACE_MS,
} from '../src/shared/simulation/constants.js'

// Re-export for tests
export { ALLOWED_ORIGINS_DEFAULT, loadServerConfig, type ServerConfig }

async function main(): Promise<void> {
  const config = loadServerConfig()
  const server = new GameServer(config)
  await server.start()

  let shuttingDown = false

  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`shutdown_begin signal=${signal}`)

    let forceTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      console.error(`shutdown_force_exit after_ms=${SHUTDOWN_FORCE_EXIT_MS}`)
      process.exit(1)
    }, SHUTDOWN_FORCE_EXIT_MS)
    // Do not keep the event loop alive solely for the force timer.
    forceTimer.unref?.()

    const graceTimer = setTimeout(() => {
      console.warn(`shutdown_grace_elapsed_ms=${SHUTDOWN_GRACE_MS}`)
    }, SHUTDOWN_GRACE_MS)
    graceTimer.unref?.()

    try {
      await server.shutdown()
      if (forceTimer) {
        clearTimeout(forceTimer)
        forceTimer = null
      }
      clearTimeout(graceTimer)
      console.log('shutdown_complete')
      process.exit(0)
    } catch (err) {
      console.error('shutdown_error', err)
      if (forceTimer) {
        clearTimeout(forceTimer)
        forceTimer = null
      }
      clearTimeout(graceTimer)
      process.exit(1)
    }
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err: unknown) => {
  console.error('[server] fatal', err)
  process.exit(1)
})
