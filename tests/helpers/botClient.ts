/** Shared combat bot for load / soak / network impairment tests. */

import { encodeMessage, decodeMessage } from '../../src/shared/protocol/codec.js'
import { MessageType, MatchPhase } from '../../src/shared/protocol/messages.js'
import { PROTOCOL_VERSION } from '../../src/shared/simulation/constants.js'
import { connectWs, waitForMessageType, type WsClient } from './wsTestUtils.js'

export interface BotStats {
  name: string
  connected: boolean
  welcomed: boolean
  rejected: boolean
  unexpectedDisconnect: boolean
  snapshots: number
  matchEnded: number
  matchRestartSeen: number
  lastKills: number
  lastDeaths: number
  lastScore: number
  lastPhase: number
  timeRemaining: number
  protocolErrors: number
  nonFiniteSeen: boolean
  snapshotSizes: number[]
}

export interface NetworkProfile {
  name: string
  latencyMs: number
  jitterMs: number
  loss: number
  reorder: number
  duplication: number
}

export const NETWORK_PROFILES: Record<string, NetworkProfile> = {
  good: { name: 'good', latencyMs: 30, jitterMs: 5, loss: 0, reorder: 0, duplication: 0 },
  typical: { name: 'typical', latencyMs: 80, jitterMs: 20, loss: 0.01, reorder: 0, duplication: 0 },
  poor: { name: 'poor', latencyMs: 150, jitterMs: 50, loss: 0.03, reorder: 0, duplication: 0 },
  severe: {
    name: 'severe',
    latencyMs: 250,
    jitterMs: 100,
    loss: 0.08,
    reorder: 0.02,
    duplication: 0.01,
  },
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function impairedSend(
  socket: import('ws').WebSocket,
  data: Uint8Array,
  profile: NetworkProfile | null,
  sendQueue: Array<() => void>,
): void {
  if (!profile) {
    if (socket.readyState === 1) socket.send(data)
    return
  }
  if (Math.random() < profile.loss) return
  const jitter = (Math.random() * 2 - 1) * profile.jitterMs
  const wait = Math.max(0, profile.latencyMs + jitter)
  const doSend = (): void => {
    if (socket.readyState === 1) socket.send(data)
  }
  if (Math.random() < profile.duplication) {
    setTimeout(doSend, wait)
    setTimeout(doSend, wait + 5)
    return
  }
  if (Math.random() < profile.reorder && sendQueue.length > 0) {
    sendQueue.push(doSend)
    const prev = sendQueue.shift()
    setTimeout(() => prev?.(), wait + 10)
    setTimeout(doSend, wait)
    return
  }
  setTimeout(doSend, wait)
}

export class CombatBot {
  client: WsClient | null = null
  stats: BotStats
  private seq = 1
  private baseTick = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly sendQueue: Array<() => void> = []
  private sessionId = ''
  private reconnectToken = ''
  playerId = 0
  standingsHash = ''

  constructor(
    readonly name: string,
    private readonly profile: NetworkProfile | null = null,
  ) {
    this.stats = {
      name,
      connected: false,
      welcomed: false,
      rejected: false,
      unexpectedDisconnect: false,
      snapshots: 0,
      matchEnded: 0,
      matchRestartSeen: 0,
      lastKills: 0,
      lastDeaths: 0,
      lastScore: 0,
      lastPhase: MatchPhase.Waiting,
      timeRemaining: 0,
      protocolErrors: 0,
      nonFiniteSeen: false,
      snapshotSizes: [],
    }
  }

  async connect(url: string): Promise<void> {
    this.client = await connectWs(url, 8000)
    this.stats.connected = true
    const socket = this.client.socket
    socket.on('message', (raw) => this.onMessage(raw))
    socket.on('close', () => {
      if (this.stats.welcomed && !this.stats.rejected) {
        // only unexpected if we did not intend close
      }
    })
    socket.send(
      encodeMessage(MessageType.Hello, {
        protocolVersion: PROTOCOL_VERSION,
        displayName: this.name,
      }),
    )
    const welcome = await waitForMessageType(socket, MessageType.Welcome, 8000)
    if (welcome.type !== MessageType.Welcome) {
      this.stats.rejected = true
      throw new Error('no welcome')
    }
    this.stats.welcomed = true
    this.playerId = welcome.payload.playerId
    this.sessionId = welcome.payload.sessionId
    this.reconnectToken = welcome.payload.reconnectToken
  }

  private onMessage(raw: import('ws').RawData): void {
    const buf =
      raw instanceof ArrayBuffer
        ? new Uint8Array(raw)
        : Buffer.isBuffer(raw)
          ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
          : Array.isArray(raw)
            ? new Uint8Array(Buffer.concat(raw))
            : new Uint8Array()
    const decoded = decodeMessage(buf)
    if (!decoded.ok) {
      this.stats.protocolErrors += 1
      return
    }
    if (decoded.type === MessageType.Reject) {
      this.stats.rejected = true
      return
    }
    if (decoded.type === MessageType.Snapshot) {
      this.stats.snapshots += 1
      this.stats.snapshotSizes.push(buf.byteLength)
      if (this.stats.snapshotSizes.length > 2000) {
        this.stats.snapshotSizes.splice(0, this.stats.snapshotSizes.length - 2000)
      }
      this.baseTick = decoded.payload.tick
      this.stats.lastPhase = decoded.payload.phase
      this.stats.timeRemaining = decoded.payload.timeRemaining
      if (this.stats.lastPhase === MatchPhase.Countdown && this.stats.matchEnded > 0) {
        this.stats.matchRestartSeen += 1
      }
      const me = decoded.payload.players.find((p) => p.id === this.playerId)
      if (me) {
        this.stats.lastKills = me.kills
        this.stats.lastDeaths = me.deaths
        this.stats.lastScore = me.kills // score tracked via kills in FFA primary
        if (
          !Number.isFinite(me.x) ||
          !Number.isFinite(me.y) ||
          !Number.isFinite(me.z) ||
          !Number.isFinite(me.health)
        ) {
          this.stats.nonFiniteSeen = true
        }
      }
      for (const p of decoded.payload.players) {
        if (
          !Number.isFinite(p.x) ||
          !Number.isFinite(p.vx) ||
          !Number.isFinite(p.health)
        ) {
          this.stats.nonFiniteSeen = true
        }
      }
    }
    if (decoded.type === MessageType.MatchEnded) {
      this.stats.matchEnded += 1
      this.standingsHash = JSON.stringify(
        decoded.payload.standings.map((s) => [s.playerId, s.kills, s.deaths, s.rank]),
      )
    }
  }

  startCombatLoop(intervalMs = 50): void {
    const socket = this.client?.socket
    if (!socket) return
    let t = 0
    this.timer = setInterval(() => {
      if (socket.readyState !== 1) return
      t += 1
      const angle = t * 0.07
      const payload = encodeMessage(MessageType.InputCommand, {
        seq: this.seq++,
        clientTick: this.baseTick + 1,
        moveX: Math.sin(angle),
        moveY: Math.cos(angle * 0.8),
        jump: t % 40 === 0,
        crouch: false,
        dash: t % 55 === 0,
        shoot: t % 12 === 0,
        reload: t % 200 === 0,
        yaw: angle,
        pitch: Math.sin(angle * 0.3) * 0.2,
      })
      impairedSend(socket, payload, this.profile, this.sendQueue)
    }, intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async disconnect(clean = true): Promise<void> {
    this.stop()
    if (!this.client) return
    if (clean && this.client.socket.readyState === 1) {
      try {
        // Disconnect has empty payload; close without relying on optional fields.
        this.client.socket.close(1000, 'client disconnect')
      } catch {
        // ignore
      }
    }
    await this.client.close()
    this.client = null
  }

  getReconnectCreds(): { sessionId: string; token: string } {
    return { sessionId: this.sessionId, token: this.reconnectToken }
  }
}

export function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))]!
}

export async function sleep(ms: number): Promise<void> {
  await delay(ms)
}
