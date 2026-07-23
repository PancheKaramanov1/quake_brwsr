/** Transport abstraction for binary WebSocket (and future) FPS networking. */

export type TransportHandler = (data: Uint8Array) => void

export interface Transport {
  connect(url: string): Promise<void>
  send(data: Uint8Array): void
  onMessage(handler: TransportHandler): void
  onClose(handler: (reason: string) => void): void
  onError(handler: (err: Error) => void): void
  close(code?: number, reason?: string): void
  readonly connected: boolean
  readonly rttMs: number
}

export enum ConnectionState {
  Disconnected = 0,
  Connecting = 1,
  Connected = 2,
  Reconnecting = 3,
  Closed = 4,
}
