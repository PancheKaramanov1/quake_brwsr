/** Browser WebSocket transport implementing the shared Transport interface. */

import type { Transport, TransportHandler } from '../../shared/network/transport.js'

export class BrowserTransport implements Transport {
  private socket: WebSocket | null = null
  private messageHandler: TransportHandler | null = null
  private closeHandler: ((reason: string) => void) | null = null
  private errorHandler: ((err: Error) => void) | null = null
  private _rttMs = 0
  private intentionallyClosed = false

  /** Allow GameClient (or tests) to publish measured RTT from Ping/Pong. */
  setRttMs(ms: number): void {
    this._rttMs = Math.max(0, ms)
  }

  get rttMs(): number {
    return this._rttMs
  }

  get connected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN
  }

  connect(url: string): Promise<void> {
    this.close()
    this.intentionallyClosed = false

    return new Promise((resolve, reject) => {
      let settled = false
      const ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      this.socket = ws

      const settleOk = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      const settleErr = (err: Error): void => {
        if (settled) return
        settled = true
        reject(err)
      }

      ws.onopen = () => {
        settleOk()
      }

      ws.onmessage = (ev: MessageEvent) => {
        if (!this.messageHandler) return
        if (ev.data instanceof ArrayBuffer) {
          this.messageHandler(new Uint8Array(ev.data))
          return
        }
        if (ArrayBuffer.isView(ev.data)) {
          const view = ev.data as ArrayBufferView
          this.messageHandler(
            new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
          )
        }
      }

      ws.onerror = () => {
        const err = new Error('WebSocket error')
        this.errorHandler?.(err)
        settleErr(err)
      }

      ws.onclose = (ev: CloseEvent) => {
        this.socket = null
        const reason =
          ev.reason ||
          (this.intentionallyClosed ? 'closed' : `code_${ev.code}`)
        this.closeHandler?.(reason)
        if (!settled) {
          settleErr(new Error(`WebSocket closed before open: ${reason}`))
        }
      }
    })
  }

  send(data: Uint8Array): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    // Copy into a fresh ArrayBuffer-backed view for the WebSocket API.
    const copy = new Uint8Array(data.byteLength)
    copy.set(data)
    this.socket.send(copy.buffer)
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

  close(code = 1000, reason = ''): void {
    this.intentionallyClosed = true
    const ws = this.socket
    this.socket = null
    if (!ws) return
    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(code, reason)
      }
    } catch {
      // ignore
    }
  }
}
