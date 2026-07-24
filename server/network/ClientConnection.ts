import { randomBytes } from 'node:crypto'
import type WebSocket from 'ws'
import { RateLimiter } from '../security/RateLimiter.js'

/** Short process-local connection id — not derived from IP, not a reconnect token. */
export function createConnectionId(): string {
  return randomBytes(4).toString('hex')
}

export class ClientConnection {
  sessionId: string | null = null
  playerId: number | null = null
  lastMessageAt = Date.now()
  lastAckSeq = 0
  rateLimiter: RateLimiter | null = null
  /** @deprecated Prefer connectionId — kept empty for privacy; never store raw IPs. */
  readonly remoteAddress: string
  readonly connectionId: string

  constructor(
    private readonly socket: WebSocket,
    connectionId: string = createConnectionId(),
  ) {
    this.connectionId = connectionId
    this.remoteAddress = ''
  }

  get isOpen(): boolean {
    return this.socket.readyState === 1 // WebSocket.OPEN
  }

  send(data: Uint8Array): void {
    if (!this.isOpen) return
    this.socket.send(data)
  }

  close(code = 1000, reason = ''): void {
    try {
      this.socket.close(code, reason)
    } catch {
      // ignore
    }
  }
}
