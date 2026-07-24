export class SecurityLogger {
  constructor(private readonly enabled = true) {}

  info(message: string): void {
    if (this.enabled) console.log(`[security] ${message}`)
  }

  rejectedConnection(addr: string, reason: string): void {
    this.info(`reject addr=${addr} reason=${reason}`)
  }

  invalidMessage(addr: string, code: string): void {
    this.info(`invalid_message addr=${addr} code=${code}`)
  }

  rateLimit(playerId: number, kind: string): void {
    this.info(`rate_limit player=${playerId} kind=${kind}`)
  }

  movementViolation(playerId: number, kind: string): void {
    this.info(`movement_violation player=${playerId} kind=${kind}`)
  }

  weaponViolation(playerId: number, kind: string): void {
    this.info(`weapon_violation player=${playerId} kind=${kind}`)
  }
}
