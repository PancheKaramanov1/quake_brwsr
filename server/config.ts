import {
  CONNECTION_TIMEOUT_MS,
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_NAME,
  DEFAULT_SERVER_PORT,
  DEFAULT_SERVER_REGION,
  DEFAULT_WS_PATH,
  HEARTBEAT_INTERVAL_MS,
  MATCH_DURATION_SECONDS,
  MAX_PLAYERS,
  RECONNECT_GRACE_MS,
  SCORE_LIMIT,
  SNAPSHOT_RATE,
  TICK_RATE,
} from '../src/shared/simulation/constants.js'

export const ALLOWED_ORIGINS_DEFAULT = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
]

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
  serverName: string
  region: string
  /** When true, trust X-Forwarded-For for logging only (never for auth). */
  trustProxy: boolean
}

function parseOrigins(raw: string | undefined): string[] {
  if (!raw || raw.trim() === '') return [...ALLOWED_ORIGINS_DEFAULT]
  if (raw.trim() === '*') return ['*']
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

function requireFinitePositive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid config ${name}=${value}`)
  }
  return value
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.SERVER_PORT ?? DEFAULT_SERVER_PORT)
  const host = env.SERVER_HOST ?? DEFAULT_SERVER_HOST
  const isProduction = env.NODE_ENV === 'production'
  const allowedOrigins = parseOrigins(env.ALLOWED_ORIGINS)

  if (isProduction && allowedOrigins.includes('*')) {
    throw new Error('Refusing production start with ALLOWED_ORIGINS=*')
  }
  if (isProduction && allowedOrigins.length === 0) {
    throw new Error('Refusing production start with empty ALLOWED_ORIGINS')
  }

  const config: ServerConfig = {
    host,
    port: requireFinitePositive('SERVER_PORT', port),
    publicUrl: env.PUBLIC_SERVER_URL ?? `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`,
    wsPath: env.WS_PATH ?? DEFAULT_WS_PATH,
    tickRate: requireFinitePositive('SERVER_TICK_RATE', Number(env.SERVER_TICK_RATE ?? TICK_RATE)),
    snapshotRate: requireFinitePositive('SNAPSHOT_RATE', Number(env.SNAPSHOT_RATE ?? SNAPSHOT_RATE)),
    maxPlayers: requireFinitePositive('MAX_PLAYERS', Number(env.MAX_PLAYERS ?? MAX_PLAYERS)),
    matchDurationSeconds: requireFinitePositive(
      'MATCH_DURATION_SECONDS',
      Number(env.MATCH_DURATION_SECONDS ?? MATCH_DURATION_SECONDS),
    ),
    scoreLimit: requireFinitePositive('SCORE_LIMIT', Number(env.SCORE_LIMIT ?? SCORE_LIMIT)),
    allowedOrigins,
    logLevel: (env.LOG_LEVEL as ServerConfig['logLevel']) ?? 'info',
    reconnectGraceMs: requireFinitePositive(
      'RECONNECT_GRACE_MS',
      Number(env.RECONNECT_GRACE_MS ?? RECONNECT_GRACE_MS),
    ),
    heartbeatIntervalMs: requireFinitePositive(
      'HEARTBEAT_INTERVAL_MS',
      Number(env.HEARTBEAT_INTERVAL_MS ?? HEARTBEAT_INTERVAL_MS),
    ),
    connectionTimeoutMs: requireFinitePositive(
      'CONNECTION_TIMEOUT_MS',
      Number(env.CONNECTION_TIMEOUT_MS ?? CONNECTION_TIMEOUT_MS),
    ),
    isProduction,
    serverName: (env.SERVER_NAME ?? DEFAULT_SERVER_NAME).slice(0, 64),
    region: (env.SERVER_REGION ?? DEFAULT_SERVER_REGION).slice(0, 32),
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
  }

  if (config.maxPlayers > MAX_PLAYERS) {
    throw new Error(`MAX_PLAYERS cannot exceed protocol cap ${MAX_PLAYERS}`)
  }
  if (config.tickRate > 120 || config.tickRate < 10) {
    throw new Error('SERVER_TICK_RATE must be between 10 and 120')
  }
  if (config.wsPath[0] !== '/') {
    throw new Error('WS_PATH must start with /')
  }

  return config
}
