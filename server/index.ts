import {
  ALLOWED_ORIGINS_DEFAULT,
  loadServerConfig,
  type ServerConfig,
} from './config.js'
import { GameServer } from './GameServer.js'

// Re-export for tests
export { ALLOWED_ORIGINS_DEFAULT, loadServerConfig, type ServerConfig }

async function main(): Promise<void> {
  const config = loadServerConfig()
  const server = new GameServer(config)
  await server.start()

  const shutdown = async (signal: string) => {
    console.log(`[server] ${signal} received, shutting down…`)
    await server.shutdown()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err: unknown) => {
  console.error('[server] fatal', err)
  process.exit(1)
})
