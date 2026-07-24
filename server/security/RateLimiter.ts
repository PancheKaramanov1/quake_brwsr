export class RateLimiter {
  private messageTimestamps: number[] = []
  private inputTimestamps: number[] = []

  constructor(
    private readonly maxMessagesPerSecond: number,
    private readonly maxInputsPerSecond: number,
  ) {}

  allowMessage(now = Date.now()): boolean {
    this.messageTimestamps = this.messageTimestamps.filter((t) => now - t < 1000)
    if (this.messageTimestamps.length >= this.maxMessagesPerSecond) return false
    this.messageTimestamps.push(now)
    return true
  }

  allowInput(now = Date.now()): boolean {
    this.inputTimestamps = this.inputTimestamps.filter((t) => now - t < 1000)
    if (this.inputTimestamps.length >= this.maxInputsPerSecond) return false
    this.inputTimestamps.push(now)
    return true
  }
}
