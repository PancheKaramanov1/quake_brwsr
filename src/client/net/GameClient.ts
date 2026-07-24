/** High-level multiplayer game client: connect, input, snapshot handling. */

import { ConnectionState, type Transport } from '../../shared/network/transport.js'
import { encodeMessage, decodeMessage } from '../../shared/protocol/codec.js'
import {
  MatchPhase,
  MessageType,
  RejectReason,
  type DamageEventPayload,
  type DeathEventPayload,
  type InputCommandPayload,
  type LocalCorrectionPayload,
  type MatchEndedPayload,
  type ProjectileImpactPayload,
  type ProjectileSpawnPayload,
  type RespawnEventPayload,
  type SnapshotPayload,
  type SnapshotPlayer,
  type StandingEntry,
  type WelcomePayload,
} from '../../shared/protocol/messages.js'
import {
  HEARTBEAT_INTERVAL_MS,
  PROTOCOL_VERSION,
} from '../../shared/simulation/constants.js'
import { BrowserTransport } from './BrowserTransport.js'

export type ConnectionStateName =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed'

export interface ClientPlayerInfo {
  id: number
  displayName: string
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  yaw: number
  pitch: number
  health: number
  alive: boolean
  weapon: number
  ammo: number
  flags: number
  kills: number
  deaths: number
}

export interface KillFeedEntry {
  victimId: number
  killerId: number
  weapon: number
  time: number
}

export type SnapshotListener = (snapshot: SnapshotPayload) => void
export type EventListener = (type: MessageType, payload: unknown) => void

function connectionStateName(state: ConnectionState): ConnectionStateName {
  switch (state) {
    case ConnectionState.Disconnected:
      return 'disconnected'
    case ConnectionState.Connecting:
      return 'connecting'
    case ConnectionState.Connected:
      return 'connected'
    case ConnectionState.Reconnecting:
      return 'reconnecting'
    case ConnectionState.Closed:
      return 'closed'
    default: {
      const _exhaustive: never = state
      return _exhaustive
    }
  }
}

function rejectReasonLabel(reason: RejectReason): string {
  switch (reason) {
    case RejectReason.Full:
      return 'Server is full'
    case RejectReason.VersionMismatch:
      return 'Protocol version mismatch'
    case RejectReason.InvalidName:
      return 'Invalid display name'
    case RejectReason.Banned:
      return 'Banned'
    case RejectReason.Shutdown:
      return 'Server shutting down'
    case RejectReason.AuthFailed:
      return 'Authentication failed'
    case RejectReason.Duplicate:
      return 'Duplicate connection'
    default:
      return 'Connection rejected'
  }
}

export class GameClient {
  private transport: Transport
  private ownsTransport: boolean
  private state: ConnectionState = ConnectionState.Disconnected
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private seq = 0
  private clientTick = 0
  private sessionId: string | null = null
  private reconnectToken: string | null = null
  private lastUrl = ''
  private snapshotListeners: SnapshotListener[] = []
  private eventListeners: EventListener[] = []
  private suspended = false
  private lastFrameTime = 0

  localPlayerId: number | null = null
  phase: MatchPhase = MatchPhase.Waiting
  timeRemaining = 0
  scoreLimit = 0
  tickRate = 60
  snapshotRate = 20
  mapId = ''
  players = new Map<number, ClientPlayerInfo>()
  killFeed: KillFeedEntry[] = []
  standings: StandingEntry[] = []
  rejectReason: string | null = null
  lastSnapshot: SnapshotPayload | null = null
  lastCorrection: LocalCorrectionPayload | null = null
  lastProjectileSpawn: ProjectileSpawnPayload | null = null
  lastProjectileImpact: ProjectileImpactPayload | null = null
  ping = 0

  constructor(transport?: Transport) {
    if (transport) {
      this.transport = transport
      this.ownsTransport = false
    } else {
      this.transport = new BrowserTransport()
      this.ownsTransport = true
    }
    this.wireTransport()
  }

  get connectionState(): ConnectionStateName {
    return connectionStateName(this.state)
  }

  get isSuspended(): boolean {
    return this.suspended
  }

  getTransport(): Transport {
    return this.transport
  }

  onSnapshot(listener: SnapshotListener): () => void {
    this.snapshotListeners.push(listener)
    return () => {
      this.snapshotListeners = this.snapshotListeners.filter((l) => l !== listener)
    }
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.push(listener)
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener)
    }
  }

  async connect(url: string, displayName: string): Promise<void> {
    this.rejectReason = null
    this.lastUrl = url
    this.state = ConnectionState.Connecting
    this.seq = 0
    this.clientTick = 0

    await this.transport.connect(url)
    this.state = ConnectionState.Connected
    this.sendHello(displayName)
    this.startHeartbeat()
  }

  async reconnect(): Promise<void> {
    if (!this.sessionId || !this.reconnectToken || !this.lastUrl) {
      throw new Error('No session to reconnect')
    }
    this.rejectReason = null
    this.state = ConnectionState.Reconnecting
    await this.transport.connect(this.lastUrl)
    this.transport.send(
      encodeMessage(MessageType.Reconnect, {
        sessionId: this.sessionId,
        reconnectToken: this.reconnectToken,
      }),
    )
    this.state = ConnectionState.Connected
    this.startHeartbeat()
  }

  disconnect(reason = 'client disconnect'): void {
    this.stopHeartbeat()
    if (this.transport.connected) {
      try {
        this.transport.send(encodeMessage(MessageType.Disconnect, { reason }))
      } catch {
        // ignore
      }
    }
    this.transport.close(1000, reason)
    this.state = ConnectionState.Closed
  }

  /** Advance local client tick counter (call once per fixed sim step). */
  advanceClientTick(): number {
    this.clientTick += 1
    return this.clientTick
  }

  sendInput(partial: Omit<InputCommandPayload, 'seq' | 'clientTick'>): number {
    this.seq += 1
    const payload: InputCommandPayload = {
      seq: this.seq,
      clientTick: this.clientTick,
      moveX: partial.moveX,
      moveY: partial.moveY,
      jump: partial.jump,
      crouch: partial.crouch,
      dash: partial.dash,
      shoot: partial.shoot,
      reload: partial.reload,
      yaw: partial.yaw,
      pitch: partial.pitch,
    }
    this.transport.send(encodeMessage(MessageType.InputCommand, payload))
    return this.seq
  }

  sendReady(): void {
    this.transport.send(encodeMessage(MessageType.ClientReady, {}))
  }

  /**
   * Call each frame with performance.now(). Detects tab suspension via
   * visibility + large frame gap; clears prediction responsibility to caller
   * by flipping `suspended` until the next snapshot.
   */
  noteFrame(now: number, clearPrediction: () => void): void {
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
    if (this.lastFrameTime > 0) {
      const gap = now - this.lastFrameTime
      if (hidden || gap > 500) {
        if (!this.suspended) {
          this.suspended = true
          clearPrediction()
        }
      }
    }
    this.lastFrameTime = now
  }

  dispose(): void {
    this.disconnect()
    this.snapshotListeners = []
    this.eventListeners = []
    if (this.ownsTransport) {
      this.transport.close()
    }
  }

  private wireTransport(): void {
    this.transport.onMessage((data) => this.handleRaw(data))
    this.transport.onClose((reason) => {
      this.stopHeartbeat()
      if (this.state !== ConnectionState.Closed) {
        this.state = ConnectionState.Disconnected
      }
      this.emitEvent(MessageType.Disconnect, { reason })
    })
    this.transport.onError((_err) => {
      // Connection errors surface via close / reject
    })
  }

  private sendHello(displayName: string): void {
    this.transport.send(
      encodeMessage(MessageType.Hello, {
        protocolVersion: PROTOCOL_VERSION,
        displayName,
      }),
    )
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (!this.transport.connected) return
      this.transport.send(
        encodeMessage(MessageType.Ping, { clientTime: performance.now() }),
      )
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private handleRaw(data: Uint8Array): void {
    const decoded = decodeMessage(data)
    if (!decoded.ok) {
      if (decoded.error.code === 'version_mismatch') {
        this.rejectReason = decoded.error.message
      }
      return
    }

    switch (decoded.type) {
      case MessageType.Welcome:
        this.handleWelcome(decoded.payload)
        break
      case MessageType.Reject:
        this.rejectReason =
          decoded.payload.message || rejectReasonLabel(decoded.payload.reason)
        this.state = ConnectionState.Closed
        this.stopHeartbeat()
        this.emitEvent(MessageType.Reject, decoded.payload)
        break
      case MessageType.MatchState:
        this.phase = decoded.payload.phase
        this.timeRemaining = decoded.payload.timeRemaining
        this.scoreLimit = decoded.payload.scoreLimit
        this.emitEvent(MessageType.MatchState, decoded.payload)
        break
      case MessageType.Snapshot:
        this.handleSnapshot(decoded.payload)
        break
      case MessageType.LocalCorrection:
        this.lastCorrection = decoded.payload
        this.emitEvent(MessageType.LocalCorrection, decoded.payload)
        break
      case MessageType.PlayerJoined: {
        const existing = this.players.get(decoded.payload.playerId)
        if (existing) {
          existing.displayName = decoded.payload.displayName
        } else {
          this.players.set(decoded.payload.playerId, {
            id: decoded.payload.playerId,
            displayName: decoded.payload.displayName,
            x: 0,
            y: 0,
            z: 0,
            vx: 0,
            vy: 0,
            vz: 0,
            yaw: 0,
            pitch: 0,
            health: 100,
            alive: true,
            weapon: 0,
            ammo: 0,
            flags: 0,
            kills: 0,
            deaths: 0,
          })
        }
        this.emitEvent(MessageType.PlayerJoined, decoded.payload)
        break
      }
      case MessageType.PlayerLeft:
        this.players.delete(decoded.payload.playerId)
        this.emitEvent(MessageType.PlayerLeft, decoded.payload)
        break
      case MessageType.ProjectileSpawn:
        this.lastProjectileSpawn = decoded.payload
        this.emitEvent(MessageType.ProjectileSpawn, decoded.payload)
        break
      case MessageType.ProjectileImpact:
        this.lastProjectileImpact = decoded.payload
        this.emitEvent(MessageType.ProjectileImpact, decoded.payload)
        break
      case MessageType.DamageEvent:
        this.applyDamage(decoded.payload)
        this.emitEvent(MessageType.DamageEvent, decoded.payload)
        break
      case MessageType.DeathEvent:
        this.applyDeath(decoded.payload)
        this.emitEvent(MessageType.DeathEvent, decoded.payload)
        break
      case MessageType.RespawnEvent:
        this.applyRespawn(decoded.payload)
        this.emitEvent(MessageType.RespawnEvent, decoded.payload)
        break
      case MessageType.ScoreUpdate:
        for (const s of decoded.payload.scores) {
          const p = this.players.get(s.playerId)
          if (p) {
            p.kills = s.kills
            p.deaths = s.deaths
          }
        }
        this.emitEvent(MessageType.ScoreUpdate, decoded.payload)
        break
      case MessageType.MatchEnded:
        this.handleMatchEnded(decoded.payload)
        break
      case MessageType.Pong: {
        const rtt = Math.max(0, performance.now() - decoded.payload.clientTime)
        this.ping = rtt
        const withRtt = this.transport as Transport & { setRttMs?: (ms: number) => void }
        withRtt.setRttMs?.(rtt)
        this.emitEvent(MessageType.Pong, decoded.payload)
        break
      }
      case MessageType.ServerError:
        this.rejectReason = decoded.payload.message
        this.emitEvent(MessageType.ServerError, decoded.payload)
        break
      default:
        this.emitEvent(decoded.type, decoded.payload)
        break
    }
  }

  private handleWelcome(payload: WelcomePayload): void {
    this.localPlayerId = payload.playerId
    this.sessionId = payload.sessionId
    this.reconnectToken = payload.reconnectToken
    this.tickRate = payload.tickRate
    this.snapshotRate = payload.snapshotRate
    this.mapId = payload.mapId
    this.state = ConnectionState.Connected
    this.rejectReason = null
    this.emitEvent(MessageType.Welcome, payload)
  }

  private handleSnapshot(payload: SnapshotPayload): void {
    this.suspended = false
    this.lastSnapshot = payload
    this.phase = payload.phase
    this.timeRemaining = payload.timeRemaining
    this.scoreLimit = payload.scoreLimit

    const seen = new Set<number>()
    for (const sp of payload.players) {
      seen.add(sp.id)
      this.upsertPlayer(sp)
    }
    for (const id of [...this.players.keys()]) {
      if (!seen.has(id) && id !== this.localPlayerId) {
        // Keep display names for briefly missing players; prune later via PlayerLeft
      }
    }

    for (const listener of this.snapshotListeners) {
      listener(payload)
    }
    this.emitEvent(MessageType.Snapshot, payload)
  }

  private upsertPlayer(sp: SnapshotPlayer): void {
    const existing = this.players.get(sp.id)
    const name = existing?.displayName ?? `Player ${sp.id}`
    this.players.set(sp.id, {
      id: sp.id,
      displayName: name,
      x: sp.x,
      y: sp.y,
      z: sp.z,
      vx: sp.vx,
      vy: sp.vy,
      vz: sp.vz,
      yaw: sp.yaw,
      pitch: sp.pitch,
      health: sp.health,
      alive: sp.alive,
      weapon: sp.weapon,
      ammo: sp.ammo,
      flags: sp.flags,
      kills: sp.kills,
      deaths: sp.deaths,
    })
  }

  private applyDamage(payload: DamageEventPayload): void {
    const p = this.players.get(payload.victimId)
    if (p) p.health = payload.remainingHealth
  }

  private applyDeath(payload: DeathEventPayload): void {
    const victim = this.players.get(payload.victimId)
    if (victim) {
      victim.alive = false
      victim.health = 0
    }
    this.killFeed.unshift({
      victimId: payload.victimId,
      killerId: payload.killerId,
      weapon: payload.weapon,
      time: performance.now(),
    })
    if (this.killFeed.length > 8) this.killFeed.length = 8
  }

  private applyRespawn(payload: RespawnEventPayload): void {
    const p = this.players.get(payload.playerId)
    if (p) {
      p.alive = true
      p.health = 100
      p.x = payload.x
      p.y = payload.y
      p.z = payload.z
      p.yaw = payload.yaw
    }
  }

  private handleMatchEnded(payload: MatchEndedPayload): void {
    this.standings = payload.standings
    this.phase = MatchPhase.Results
    this.emitEvent(MessageType.MatchEnded, payload)
  }

  private emitEvent(type: MessageType, payload: unknown): void {
    for (const listener of this.eventListeners) {
      listener(type, payload)
    }
  }
}
