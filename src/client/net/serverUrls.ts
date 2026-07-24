/**
 * Resolve multiplayer HTTP and WebSocket endpoints.
 * Production (non-localhost page) defaults to same-origin — no rebuild for custom domains.
 */

export const LOCAL_DEV_WS_URL = 'ws://localhost:8080/ws'
export const LOCAL_DEV_HTTP_BASE = 'http://localhost:8080'

export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
}

export function normalizeWsPath(path: string): string {
  if (!path || path === '/') return '/ws'
  return path.startsWith('/') ? path : `/${path}`
}

export interface LocationLike {
  protocol: string
  host: string
  hostname: string
  origin: string
}

export interface ServerUrlEnv {
  VITE_GAME_SERVER_URL?: string
  VITE_GAME_SERVER_HTTP_URL?: string
}

/**
 * Default WebSocket URL for the multiplayer client.
 * Precedence: explicit VITE override → same-origin production → local server :8080.
 */
export function resolveDefaultServerUrl(
  location: LocationLike,
  env: ServerUrlEnv = {},
  wsPath = '/ws',
): string {
  const envUrl = env.VITE_GAME_SERVER_URL
  if (typeof envUrl === 'string' && envUrl.length > 0) {
    return envUrl
  }
  if (!isLocalHostname(location.hostname)) {
    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${wsProtocol}//${location.host}${normalizeWsPath(wsPath)}`
  }
  return LOCAL_DEV_WS_URL
}

/**
 * Default HTTP base for /status discovery.
 */
export function resolveDefaultHttpBase(
  location: LocationLike,
  env: ServerUrlEnv = {},
): string {
  const envHttp = env.VITE_GAME_SERVER_HTTP_URL
  if (typeof envHttp === 'string' && envHttp.length > 0) {
    return envHttp.replace(/\/$/, '')
  }
  const envWs = env.VITE_GAME_SERVER_URL
  if (typeof envWs === 'string' && envWs.length > 0) {
    try {
      const u = new URL(envWs)
      u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:'
      u.pathname = ''
      u.search = ''
      u.hash = ''
      return u.toString().replace(/\/$/, '')
    } catch {
      // fall through
    }
  }
  if (!isLocalHostname(location.hostname)) {
    return location.origin.replace(/\/$/, '')
  }
  return LOCAL_DEV_HTTP_BASE
}

export function wsUrlFromPublicStatus(
  status: Record<string, unknown>,
  fallbackHttpBase: string,
  fallbackWsUrl: string,
): string {
  const publicUrl = String(status.publicUrl ?? fallbackHttpBase)
  const wsPath = normalizeWsPath(String(status.wsPath ?? '/ws'))
  try {
    const u = new URL(publicUrl)
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
    u.pathname = wsPath
    u.search = ''
    u.hash = ''
    return u.toString()
  } catch {
    return fallbackWsUrl
  }
}

/** One-time privacy cleanup of legacy multiplayer localStorage keys. */
export function clearLegacyMultiplayerStorage(storage: Storage | null | undefined): void {
  if (!storage) return
  try {
    storage.removeItem('mp_display_name')
    storage.removeItem('mp_server_url')
  } catch {
    // ignore quota / private mode
  }
}
