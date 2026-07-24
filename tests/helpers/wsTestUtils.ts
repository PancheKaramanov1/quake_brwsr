import net from 'node:net'
import type { ServerConfig } from '../../server/config.js'
import {
  CONNECTION_TIMEOUT_MS,
  DEFAULT_WS_PATH,
  HEARTBEAT_INTERVAL_MS,
  MATCH_DURATION_SECONDS,
  MAX_PLAYERS,
  RECONNECT_GRACE_MS,
  SCORE_LIMIT,
  SNAPSHOT_RATE,
  TICK_RATE,
} from '../../src/shared/simulation/constants.js'
import { decodeMessage } from '../../src/shared/protocol/codec.js'
import type { DecodedMessage } from '../../src/shared/protocol/messages.js'
import { MessageType } from '../../src/shared/protocol/messages.js'

export function createTestServerConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    publicUrl: 'http://127.0.0.1:0',
    wsPath: DEFAULT_WS_PATH,
    tickRate: TICK_RATE,
    snapshotRate: SNAPSHOT_RATE,
    maxPlayers: MAX_PLAYERS,
    matchDurationSeconds: MATCH_DURATION_SECONDS,
    scoreLimit: SCORE_LIMIT,
    allowedOrigins: ['*'],
    logLevel: 'error',
    reconnectGraceMs: Math.min(RECONNECT_GRACE_MS, 250),
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    connectionTimeoutMs: Math.max(CONNECTION_TIMEOUT_MS, 60_000),
    isProduction: false,
    serverName: 'Test Arena',
    region: 'test',
    trustProxy: false,
    ...overrides,
  }
}

/** Reserve an ephemeral free TCP port on 127.0.0.1 (Windows-safe). */
export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr === null || typeof addr === 'string') {
        server.close()
        reject(new Error('Failed to bind ephemeral port'))
        return
      }
      const { port } = addr
      server.close((err) => {
        if (err) reject(err)
        else resolve(port)
      })
    })
  })
}

export function wsUrl(port: number, path = DEFAULT_WS_PATH): string {
  return `ws://127.0.0.1:${port}${path}`
}

export type WsClient = {
  socket: import('ws').WebSocket
  close: () => Promise<void>
}

export async function connectWs(url: string, openTimeoutMs = 3000): Promise<WsClient> {
  const { default: WebSocket } = await import('ws')
  const socket = new WebSocket(url)
  socket.binaryType = 'nodebuffer'

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate()
      reject(new Error(`WebSocket open timeout (${openTimeoutMs}ms): ${url}`))
    }, openTimeoutMs)

    socket.once('open', () => {
      clearTimeout(timer)
      resolve()
    })
    socket.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })

  return {
    socket,
    close: () =>
      new Promise<void>((resolve) => {
        if (socket.readyState === WebSocket.CLOSED) {
          resolve()
          return
        }
        const done = (): void => resolve()
        socket.once('close', done)
        try {
          socket.close()
        } catch {
          resolve()
        }
        setTimeout(() => {
          try {
            socket.terminate()
          } catch {
            // ignore
          }
          resolve()
        }, 500)
      }),
  }
}

export function waitForMessageType(
  socket: import('ws').WebSocket,
  type: MessageType,
  timeoutMs = 5000,
): Promise<DecodedMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for message type ${type} (${timeoutMs}ms)`))
    }, timeoutMs)

    const onMessage = (raw: import('ws').RawData): void => {
      const buf =
        raw instanceof ArrayBuffer
          ? new Uint8Array(raw)
          : Buffer.isBuffer(raw)
            ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
            : Array.isArray(raw)
              ? new Uint8Array(Buffer.concat(raw))
              : new Uint8Array()

      const decoded = decodeMessage(buf)
      if (!decoded.ok) return
      if (decoded.type !== type) return
      cleanup()
      resolve(decoded)
    }

    const onClose = (): void => {
      cleanup()
      reject(new Error(`Socket closed while waiting for message type ${type}`))
    }

    const onError = (err: Error): void => {
      cleanup()
      reject(err)
    }

    const cleanup = (): void => {
      clearTimeout(timer)
      socket.off('message', onMessage)
      socket.off('close', onClose)
      socket.off('error', onError)
    }

    socket.on('message', onMessage)
    socket.once('close', onClose)
    socket.once('error', onError)
  })
}

export async function fetchMetrics(
  port: number,
): Promise<Record<string, number | string | Record<string, number>>> {
  const res = await fetch(`http://127.0.0.1:${port}/metrics`)
  if (!res.ok) {
    throw new Error(`GET /metrics failed: ${res.status}`)
  }
  return (await res.json()) as Record<string, number | string | Record<string, number>>
}

export async function fetchStatus(port: number): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${port}/status`)
  if (!res.ok) {
    throw new Error(`GET /status failed: ${res.status}`)
  }
  return (await res.json()) as Record<string, unknown>
}

export async function fetchReady(port: number): Promise<{ ready: boolean; status: number }> {
  const res = await fetch(`http://127.0.0.1:${port}/ready`)
  const body = (await res.json()) as { ready: boolean }
  return { ready: body.ready, status: res.status }
}

export function httpToWsUrl(httpUrl: string, wsPath = DEFAULT_WS_PATH): string {
  const u = new URL(httpUrl)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = wsPath
  u.search = ''
  u.hash = ''
  return u.toString()
}
