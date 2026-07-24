import http from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ServerConfig } from './config.js'
import { MatchInstance } from './match/MatchInstance.js'
import { ClientConnection, createConnectionId } from './network/ClientConnection.js'
import { SecurityLogger } from './security/SecurityLogger.js'
import { tryServeStatic } from './staticAssets.js'

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
          this.securityLog.rejectedConnection('origin')
          done(false, 403, 'Origin not allowed')
          return
        }
        if (this.match.activePlayerCount() >= this.config.maxPlayers) {
          // Soft signal — Hello will still reject with Full; keep verify open for reconnects.
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
      `server_started host=${this.config.host} port=${this.config.port} ws_path=${this.config.wsPath}`,
    )
  }

  private isOriginAllowed(origin: string): boolean {
    if (this.config.allowedOrigins.includes('*')) return true
    // Browser tools / non-browser clients may omit Origin
    if (!origin) return !this.config.isProduction
    return this.config.allowedOrigins.includes(origin)
  }

  private onConnection(socket: WebSocket, _req: http.IncomingMessage): void {
    const conn = new ClientConnection(socket, createConnectionId())

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

  private corsHeaders(): Record<string, string> {
    return {
      'Access-Control-Allow-Origin': this.config.isProduction
        ? this.config.allowedOrigins[0] ?? ''
        : '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  }

  private writeStatus(res: http.ServerResponse, cors: Record<string, string>): void {
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors })
    const status = this.match.getPublicStatus()
    res.end(
      JSON.stringify({
        ...status,
        servers: [status],
      }),
    )
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = (req.url ?? '/').split('?')[0] ?? '/'
    const cors = this.corsHeaders()

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
    if (
      url === '/status' ||
      url === '/server-status' ||
      url === '/api/servers' ||
      url === '/api/servers/'
    ) {
      this.writeStatus(res, cors)
      return
    }
    if (url === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors })
      const metrics = this.match.getMetrics()
      // Never expose reconnect tokens, IPs, or display names here
      res.end(JSON.stringify(metrics))
      return
    }

    const staticResult = tryServeStatic(req, res, {
      clientDist: this.config.clientDist,
      extraHeaders: cors,
    })
    if (staticResult.kind !== 'skipped' && staticResult.kind !== 'not_found') {
      return
    }
    if (staticResult.kind === 'not_found' && (url === '/' || !url.includes('.'))) {
      // tryServeStatic already wrote 404 when dist missing / no index
      if (res.headersSent) return
    }
    if (res.headersSent) return

    res.writeHead(404, { 'Content-Type': 'text/plain', ...cors })
    res.end('Not found')
  }

  /**
   * Graceful shutdown:
   * 1 stop accepting  2 ready→503  3 notify clients  4 close sockets
   * 5 stop sim  6 clear timers  7 close WSS  8 close HTTP
   */
  async shutdown(options?: {
    /** Test hook: resolve before HTTP close (HTTP still serves /ready as 503). */
    beforeCloseHttp?: Promise<void>
    /** Test hook: replace HTTP close (must eventually close or hang intentionally). */
    closeHttp?: () => Promise<void>
    closeWss?: () => Promise<void>
  }): Promise<void> {
    this.accepting = false
    this.networkReady = false
    this.match.notifyShutdown()
    this.match.stop()

    const closeWss =
      options?.closeWss ??
      (() =>
        new Promise<void>((resolve) => {
          if (!this.wss) {
            resolve()
            return
          }
          this.wss.close(() => resolve())
        }))

    const closeHttp =
      options?.closeHttp ??
      (() =>
        new Promise<void>((resolve) => {
          if (!this.httpServer) {
            resolve()
            return
          }
          this.httpServer.close(() => resolve())
        }))

    await closeWss()
    if (options?.beforeCloseHttp) {
      await options.beforeCloseHttp
    }
    await closeHttp()
    this.wss = null
    this.httpServer = null
  }
}
