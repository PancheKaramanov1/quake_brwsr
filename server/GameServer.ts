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
    const addr = req.socket.remoteAddress ?? 'unknown'
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

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? '/'
    if (url === '/health' || url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', uptimeMs: Date.now() - this.startedAt }))
      return
    }
    if (url === '/ready' || url === '/readyz') {
      const ready = this.accepting && this.match !== null
      res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ready }))
      return
    }
    if (url === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(this.match.getMetrics()))
      return
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  }

  async shutdown(): Promise<void> {
    this.accepting = false
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
