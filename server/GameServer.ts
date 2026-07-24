import http from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ServerConfig } from './config.js'
import { MatchInstance } from './match/MatchInstance.js'
import { ClientConnection } from './network/ClientConnection.js'
import { SecurityLogger } from './security/SecurityLogger.js'

export class GameServer {
  private httpServer: http.Server | null = null
  private wss: WebSocketServer | null = null
  private readonly securityLog = new SecurityLogger()
  readonly match: MatchInstance
  private startedAt = 0
  private accepting = true
  private networkReady = false

  constructor(private readonly config: ServerConfig) {
    this.match = new MatchInstance(config, this.securityLog)
  }

  async start(): Promise<void> {
    this.httpServer = http.createServer((req, res) => {
      this.handleHttp(req, res)
    })

    this.wss = new WebSocketServer({
      server: this.httpServer,
      path: this.config.wsPath,
      maxPayload: 64 * 1024,
      verifyClient: (info, done) => {
        if (!this.accepting) {
          done(false, 503, 'Shutting down')
          return
        }
        const origin = info.origin ?? ''
        if (!this.isOriginAllowed(origin)) {
          this.securityLog.rejectedConnection(info.req.socket.remoteAddress ?? '?', 'origin')
          done(false, 403, 'Origin not allowed')
          return
        }
        done(true)
      },
    })

    this.wss.on('connection', (socket, req) => {
      this.onConnection(socket, req)
    })

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(this.config.port, this.config.host, () => resolve())
      this.httpServer!.on('error', reject)
    })

    this.startedAt = Date.now()
    this.match.start()
    this.networkReady = true
    console.log(
      `[server] listening on http://${this.config.host}:${this.config.port} ws path ${this.config.wsPath}`,
    )
  }

  private isOriginAllowed(origin: string): boolean {
    if (this.config.allowedOrigins.includes('*')) return true
    // Browser tools / non-browser clients may omit Origin
    if (!origin) return !this.config.isProduction
    return this.config.allowedOrigins.includes(origin)
  }

  private onConnection(socket: WebSocket, req: http.IncomingMessage): void {
    let addr = req.socket.remoteAddress ?? 'unknown'
    if (this.config.trustProxy) {
      const fwd = req.headers['x-forwarded-for']
      if (typeof fwd === 'string' && fwd.length > 0) {
        // Logging only — never used for auth decisions
        addr = fwd.split(',')[0]?.trim() || addr
      }
    }
    const conn = new ClientConnection(socket, addr)

    socket.on('message', (raw) => {
      const buf =
        raw instanceof ArrayBuffer
          ? new Uint8Array(raw)
          : Buffer.isBuffer(raw)
            ? new Uint8Array(raw)
            : Array.isArray(raw)
              ? Buffer.concat(raw)
              : new Uint8Array()
      const data = buf instanceof Uint8Array && !Buffer.isBuffer(raw) && !Array.isArray(raw)
        ? buf
        : new Uint8Array(buf)
      this.match.handleMessage(conn, data instanceof Uint8Array ? data : new Uint8Array(data))
    })

    socket.on('close', () => {
      this.match.handleDisconnect(conn)
    })

    socket.on('error', () => {
      this.match.handleDisconnect(conn)
    })
  }

  isReady(): boolean {
    return (
      this.accepting &&
      this.networkReady &&
      this.match.isSimulationReady &&
      this.httpServer !== null &&
      this.wss !== null
    )
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = (req.url ?? '/').split('?')[0] ?? '/'
    const cors = {
      'Access-Control-Allow-Origin': this.config.isProduction
        ? this.config.allowedOrigins[0] ?? ''
        : '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors)
      res.end()
      return
    }

    if (url === '/health' || url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors })
      res.end(JSON.stringify({ status: 'ok', uptimeMs: Date.now() - this.startedAt }))
      return
    }
    if (url === '/ready' || url === '/readyz') {
      const ready = this.isReady()
      res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json', ...cors })
      res.end(
        JSON.stringify({
          ready,
          accepting: this.accepting,
          networkReady: this.networkReady,
          simulationReady: this.match.isSimulationReady,
        }),
      )
      return
    }
    if (url === '/status' || url === '/api/servers' || url === '/api/servers/') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors })
      const status = this.match.getPublicStatus()
      // Directory-shaped response for future multi-server replacement
      res.end(
        JSON.stringify({
          ...status,
          servers: [status],
        }),
      )
      return
    }
    if (url === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors })
      const metrics = this.match.getMetrics()
      // Never expose reconnect tokens, IPs, or display names here
      res.end(JSON.stringify(metrics))
      return
    }
    res.writeHead(404, { 'Content-Type': 'text/plain', ...cors })
    res.end('Not found')
  }

  async shutdown(): Promise<void> {
    this.accepting = false
    this.networkReady = false
    this.match.notifyShutdown()
    this.match.stop()
    await new Promise<void>((resolve) => {
      this.wss?.close(() => resolve())
    })
    await new Promise<void>((resolve) => {
      this.httpServer?.close(() => resolve())
    })
  }
}
