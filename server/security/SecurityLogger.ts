/**
 * Privacy-safe operational logging.
 * Never log IPs, forwarded headers, display names, reconnect tokens, raw packets, or payloads.
 */
export class SecurityLogger {
  constructor(private readonly enabled = true) {}

  info(message: string): void {
    if (this.enabled) console.log(`[security] ${message}`)
  }

  rejectedConnection(reason: string, connectionId?: string): void {
    const conn = connectionId ? ` conn=${connectionId}` : ''
    this.info(`connection_rejected reason=${reason}${conn}`)
  }

  invalidMessage(code: string, connectionId?: string): void {
    const conn = connectionId ? ` conn=${connectionId}` : ''
    this.info(`protocol_error message_type=${code}${conn}`)
  }

  rateLimit(playerId: number, kind: string): void {
    this.info(`rate_limit_violation category=${kind} player=${playerId}`)
  }

  movementViolation(playerId: number, kind: string): void {
    this.info(`movement_violation kind=${kind} player=${playerId}`)
  }

  weaponViolation(playerId: number, kind: string): void {
    this.info(`weapon_violation kind=${kind} player=${playerId}`)
  }
}
