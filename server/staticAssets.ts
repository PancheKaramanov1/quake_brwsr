import fs from 'node:fs'
import path from 'node:path'
import type http from 'node:http'

/** Paths that must never be claimed by SPA fallback. */
export const RESERVED_HTTP_PREFIXES = [
  '/ws',
  '/health',
  '/healthz',
  '/ready',
  '/readyz',
  '/metrics',
  '/status',
  '/server-status',
  '/api/',
] as const

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
}

export type StaticServeResult =
  | { kind: 'served' }
  | { kind: 'not_found' }
  | { kind: 'forbidden' }
  | { kind: 'method_not_allowed' }
  | { kind: 'skipped' }

function isReservedPath(urlPath: string): boolean {
  if (urlPath === '/api' || urlPath.startsWith('/api/')) return true
  for (const prefix of RESERVED_HTTP_PREFIXES) {
    if (prefix.endsWith('/')) {
      if (urlPath === prefix.slice(0, -1) || urlPath.startsWith(prefix)) return true
    } else if (urlPath === prefix || urlPath.startsWith(`${prefix}/`)) {
      return true
    }
  }
  return false
}

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

function cacheControlFor(urlPath: string, filePath: string): string {
  const base = path.basename(filePath)
  if (base === 'index.html' || urlPath === '/' || urlPath === '/index.html') {
    return 'no-cache'
  }
  if (urlPath.startsWith('/assets/') && /\.[a-f0-9]{8,}\./i.test(base)) {
    return 'public, max-age=31536000, immutable'
  }
  if (urlPath.startsWith('/assets/')) {
    return 'public, max-age=31536000, immutable'
  }
  return 'public, max-age=300'
}

/**
 * Resolve a URL path under clientRoot. Returns null if traversal / dotfile / escape.
 */
export function resolveSafeClientPath(
  clientRoot: string,
  urlPath: string,
): string | null {
  if (!urlPath.startsWith('/')) return null
  if (urlPath.includes('\0')) return null

  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }

  if (decoded.includes('\0')) return null
  if (decoded.split('/').some((seg) => seg.startsWith('.'))) return null

  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\//, '')
  const rootResolved = path.resolve(clientRoot)
  const candidate = path.resolve(rootResolved, relative)
  const rel = path.relative(rootResolved, candidate)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  if (rel.split(path.sep).some((seg) => seg.startsWith('.'))) return null
  return candidate
}

function sendFile(
  res: http.ServerResponse,
  filePath: string,
  urlPath: string,
  method: string,
  extraHeaders: Record<string, string>,
): void {
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...extraHeaders })
    res.end('Not found')
    return
  }

  // Never serve source maps in production static hosting.
  if (filePath.endsWith('.map')) {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...extraHeaders })
    res.end('Not found')
    return
  }

  const headers: Record<string, string | number> = {
    'Content-Type': mimeFor(filePath),
    'Content-Length': stat.size,
    'Cache-Control': cacheControlFor(urlPath, filePath),
    ...extraHeaders,
  }

  if (method === 'HEAD') {
    res.writeHead(200, headers)
    res.end()
    return
  }

  res.writeHead(200, headers)
  fs.createReadStream(filePath).pipe(res)
}

export interface StaticAssetOptions {
  clientDist: string
  /** Working directory used to resolve relative CLIENT_DIST. */
  cwd?: string
  extraHeaders?: Record<string, string>
}

/**
 * Attempt to serve a Vite production asset or SPA fallback.
 * Returns `skipped` for reserved API/WS paths so the caller can handle them.
 */
export function tryServeStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: StaticAssetOptions,
): StaticServeResult {
  const method = (req.method ?? 'GET').toUpperCase()
  const urlPath = (req.url ?? '/').split('?')[0] ?? '/'

  if (isReservedPath(urlPath)) {
    return { kind: 'skipped' }
  }

  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, {
      'Content-Type': 'text/plain',
      Allow: 'GET, HEAD',
      ...(options.extraHeaders ?? {}),
    })
    res.end('Method Not Allowed')
    return { kind: 'method_not_allowed' }
  }

  const cwd = options.cwd ?? process.cwd()
  const clientRoot = path.resolve(cwd, options.clientDist)

  if (!fs.existsSync(clientRoot) || !fs.statSync(clientRoot).isDirectory()) {
    return { kind: 'not_found' }
  }

  const extra = options.extraHeaders ?? {}

  // Exact file under dist (including /index.html and /assets/*)
  const filePath = resolveSafeClientPath(clientRoot, urlPath === '/' ? '/index.html' : urlPath)
  if (filePath === null) {
    res.writeHead(403, { 'Content-Type': 'text/plain', ...extra })
    res.end('Forbidden')
    return { kind: 'forbidden' }
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    // Missing assets must 404 — never SPA-fallback hashed asset misses.
    if (urlPath.startsWith('/assets/') || path.extname(urlPath) !== '') {
      sendFile(res, filePath, urlPath, method, extra)
      return { kind: 'served' }
    }
    sendFile(res, filePath, urlPath, method, extra)
    return { kind: 'served' }
  }

  // Asset or extensioned path missing → 404 (no SPA)
  if (urlPath.startsWith('/assets/') || path.extname(urlPath) !== '') {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...extra })
    res.end('Not found')
    return { kind: 'not_found' }
  }

  // Browser navigation SPA fallback
  const indexPath = path.join(clientRoot, 'index.html')
  if (!fs.existsSync(indexPath) || !fs.statSync(indexPath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...extra })
    res.end('Not found')
    return { kind: 'not_found' }
  }

  sendFile(res, indexPath, '/index.html', method, extra)
  return { kind: 'served' }
}
