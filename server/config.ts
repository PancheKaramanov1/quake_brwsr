import {
  CONNECTION_TIMEOUT_MS,
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  DEFAULT_WS_PATH,
  HEARTBEAT_INTERVAL_MS,
  MATCH_DURATION_SECONDS,
  MAX_PLAYERS,
  RECONNECT_GRACE_MS,
  SCORE_LIMIT,
  SNAPSHOT_RATE,
  TICK_RATE,
} from '../src/shared/simulation/constants.js'

export const ALLOWED_ORIGINS_DEFAULT = ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000']

export interface ServerConfig {
  host: string
  port: number
  publicUrl: string
  wsPath: string
  tickRate: number
  snapshotRate: number
  maxPlayers: number
  matchDurationSeconds: number
  scoreLimit: number
  allowedOrigins: string[]
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  reconnectGraceMs: number
  heartbeatIntervalMs: number
  connectionTimeoutMs: number
  isProduction: boolean
}

function parseOrigins(raw: string | undefined): string[] {
  if (!raw || raw.trim() === '') return [...ALLOWED_ORIGINS_DEFAULT]
  if (raw.trim() === '*') return ['*']
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.SERVER_PORT ?? DEFAULT_SERVER_PORT)
  const host = env.SERVER_HOST ?? DEFAULT_SERVER_HOST
  const isProduction = env.NODE_ENV === 'production'
  return {
    host,
    port,
    publicUrl: env.PUBLIC_SERVER_URL ?? `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`,
    wsPath: env.WS_PATH ?? DEFAULT_WS_PATH,
    tickRate: Number(env.SERVER_TICK_RATE ?? TICK_RATE),
    snapshotRate: Number(env.SNAPSHOT_RATE ?? SNAPSHOT_RATE),
    maxPlayers: Number(env.MAX_PLAYERS ?? MAX_PLAYERS),
    matchDurationSeconds: Number(env.MATCH_DURATION_SECONDS ?? MATCH_DURATION_SECONDS),
    scoreLimit: Number(env.SCORE_LIMIT ?? SCORE_LIMIT),
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
    logLevel: (env.LOG_LEVEL as ServerConfig['logLevel']) ?? 'info',
    reconnectGraceMs: Number(env.RECONNECT_GRACE_MS ?? RECONNECT_GRACE_MS),
    heartbeatIntervalMs: Number(env.HEARTBEAT_INTERVAL_MS ?? HEARTBEAT_INTERVAL_MS),
    connectionTimeoutMs: Number(env.CONNECTION_TIMEOUT_MS ?? CONNECTION_TIMEOUT_MS),
    isProduction,
  }
}
