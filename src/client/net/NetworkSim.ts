/** Dev-only latency / loss / reorder wrapper around Transport. */

import type { Transport, TransportHandler } from '../../shared/network/transport.js'

export interface NetworkSimConfig {
  /** One-way base latency in milliseconds (applied to send and receive). */
  latencyMs: number
  /** Extra random latency ±jitterMs. */
  jitterMs: number
  /** Packet loss probability 0..1. */
  loss: number
  /** Probability a delivered packet is duplicated. */
  duplication: number
  /** Probability a delayed packet is reordered vs peers in the queue. */
  reorder: number
}

const ZERO_CONFIG: NetworkSimConfig = {
  latencyMs: 0,
  jitterMs: 0,
  loss: 0,
  duplication: 0,
  reorder: 0,
}

function isDisabled(config: NetworkSimConfig): boolean {
  if (import.meta.env.PROD) return true
  return (
    config.latencyMs === 0 &&
    config.jitterMs === 0 &&
    config.loss === 0 &&
    config.duplication === 0 &&
    config.reorder === 0
  )
}

interface QueuedPacket {
  data: Uint8Array
  deliverAt: number
  orderKey: number
}

export class NetworkSim implements Transport {
  private readonly inner: Transport
  private config: NetworkSimConfig
  private messageHandler: TransportHandler | null = null
  private closeHandler: ((reason: string) => void) | null = null
  private errorHandler: ((err: Error) => void) | null = null
  private inbound: QueuedPacket[] = []
  private outbound: QueuedPacket[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private orderCounter = 0
  private disabled: boolean

  constructor(inner: Transport, config: Partial<NetworkSimConfig> = {}) {
    this.inner = inner
    this.config = { ...ZERO_CONFIG, ...config }
    this.disabled = isDisabled(this.config)

    this.inner.onMessage((data) => this.enqueueInbound(data))
    this.inner.onClose((reason) => this.closeHandler?.(reason))
    this.inner.onError((err) => this.errorHandler?.(err))

    if (!this.disabled) {
      this.timer = setInterval(() => this.flush(), 4)
    }
  }

  setConfig(config: Partial<NetworkSimConfig>): void {
    this.config = { ...this.config, ...config }
    this.disabled = isDisabled(this.config)
    if (!this.disabled && this.timer === null) {
      this.timer = setInterval(() => this.flush(), 4)
    }
  }

  get rttMs(): number {
    return this.inner.rttMs
  }

  setRttMs(ms: number): void {
    const inner = this.inner as Transport & { setRttMs?: (value: number) => void }
    inner.setRttMs?.(ms)
  }

  get connected(): boolean {
    return this.inner.connected
  }

  connect(url: string): Promise<void> {
    return this.inner.connect(url)
  }

  send(data: Uint8Array): void {
    if (this.disabled) {
      this.inner.send(data)
      return
    }
    this.enqueue(this.outbound, data, (packet) => this.inner.send(packet))
  }

  onMessage(handler: TransportHandler): void {
    this.messageHandler = handler
  }

  onClose(handler: (reason: string) => void): void {
    this.closeHandler = handler
  }

  onError(handler: (err: Error) => void): void {
    this.errorHandler = handler
  }

  close(code?: number, reason?: string): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.inbound = []
    this.outbound = []
    this.inner.close(code, reason)
  }

  private enqueueInbound(data: Uint8Array): void {
    if (this.disabled) {
      this.messageHandler?.(data)
      return
    }
    this.enqueue(this.inbound, data, (packet) => this.messageHandler?.(packet))
  }

  private enqueue(
    queue: QueuedPacket[],
    data: Uint8Array,
    _deliver: (data: Uint8Array) => void,
  ): void {
    void _deliver
    if (Math.random() < this.config.loss) return

    const copies = Math.random() < this.config.duplication ? 2 : 1
    for (let i = 0; i < copies; i++) {
      const copy = new Uint8Array(data.byteLength)
      copy.set(data)
      let delay = this.config.latencyMs
      if (this.config.jitterMs > 0) {
        delay += (Math.random() * 2 - 1) * this.config.jitterMs
      }
      if (this.config.reorder > 0 && Math.random() < this.config.reorder) {
        delay += 10 + Math.random() * 40
      }
      delay = Math.max(0, delay)
      queue.push({
        data: copy,
        deliverAt: performance.now() + delay,
        orderKey: this.orderCounter++,
      })
    }
  }

  private flush(): void {
    const now = performance.now()
    this.flushQueue(this.outbound, now, (data) => this.inner.send(data))
    this.flushQueue(this.inbound, now, (data) => this.messageHandler?.(data))
  }

  private flushQueue(
    queue: QueuedPacket[],
    now: number,
    deliver: (data: Uint8Array) => void,
  ): void {
    if (queue.length === 0) return
    queue.sort((a, b) => a.deliverAt - b.deliverAt || a.orderKey - b.orderKey)
    let i = 0
    while (i < queue.length && queue[i]!.deliverAt <= now) {
      deliver(queue[i]!.data)
      i += 1
    }
    if (i > 0) queue.splice(0, i)
  }
}
