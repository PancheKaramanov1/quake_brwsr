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

export const DEFAULT_CLIENT_DIST = 'dist'

export interface ServerConfig {
  host: string
  port: number
  publicUrl: string
  wsPath: string
  clientDist: string
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
  /** When true, trust X-Forwarded-For was historically used for logging only (never for auth). Ignored for privacy-safe logs. */
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

/**
 * Strict port parse: integer string only, range 1–65535.
 * Rejects decimals, negatives, empty, and non-numeric values.
 */
export function parseListenPort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') {
    return fallback
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid listen port: ${raw}`)
  }
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid listen port: ${raw}`)
  }
  return port
}

/** Prefer Railway PORT, then SERVER_PORT, then local default 8080. */
export function resolveListenPort(env: NodeJS.ProcessEnv): number {
  const raw = env.PORT ?? env.SERVER_PORT
  if (raw === undefined || raw === '') {
    return DEFAULT_SERVER_PORT
  }
  return parseListenPort(raw, DEFAULT_SERVER_PORT)
}

export function normalizePublicUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`Invalid public URL: ${raw}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid public URL protocol: ${parsed.protocol}`)
  }
  if (!parsed.hostname) {
    throw new Error(`Invalid public URL: ${raw}`)
  }
  parsed.pathname = ''
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

export function resolvePublicUrl(
  env: NodeJS.ProcessEnv,
  host: string,
  port: number,
): string {
  if (env.PUBLIC_SERVER_URL && env.PUBLIC_SERVER_URL.trim() !== '') {
    return normalizePublicUrl(env.PUBLIC_SERVER_URL)
  }
  const railwayDomain = env.RAILWAY_PUBLIC_DOMAIN?.trim()
  if (railwayDomain) {
    const hostOnly = railwayDomain.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
    return normalizePublicUrl(`https://${hostOnly}`)
  }
  const displayHost = host === '0.0.0.0' ? 'localhost' : host
  return normalizePublicUrl(`http://${displayHost}:${port}`)
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = resolveListenPort(env)
  const host = env.SERVER_HOST ?? DEFAULT_SERVER_HOST
  const isProduction = env.NODE_ENV === 'production'
  const allowedOrigins = parseOrigins(env.ALLOWED_ORIGINS)

  if (isProduction && allowedOrigins.includes('*')) {
    throw new Error('Refusing production start with ALLOWED_ORIGINS=*')
  }
  if (isProduction && (!env.ALLOWED_ORIGINS || env.ALLOWED_ORIGINS.trim() === '')) {
    throw new Error('Refusing production start with empty ALLOWED_ORIGINS')
  }
  if (isProduction && allowedOrigins.length === 0) {
    throw new Error('Refusing production start with empty ALLOWED_ORIGINS')
  }

  const publicUrl = resolvePublicUrl(env, host, port)

  const config: ServerConfig = {
    host,
    port,
    publicUrl,
    wsPath: env.WS_PATH ?? DEFAULT_WS_PATH,
    clientDist: (env.CLIENT_DIST ?? DEFAULT_CLIENT_DIST).trim() || DEFAULT_CLIENT_DIST,
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
  if (config.wsPath.includes('?') || config.wsPath.includes('#')) {
    throw new Error('WS_PATH must be a path only')
  }

  return config
}
