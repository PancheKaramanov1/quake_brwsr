import type WebSocket from 'ws'
import { RateLimiter } from '../security/RateLimiter.js'

export class ClientConnection {
  sessionId: string | null = null
  playerId: number | null = null
  lastMessageAt = Date.now()
  lastAckSeq = 0
  rateLimiter: RateLimiter | null = null
  readonly remoteAddress: string

  constructor(
    private readonly socket: WebSocket,
    remoteAddress: string,
  ) {
    this.remoteAddress = remoteAddress
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
