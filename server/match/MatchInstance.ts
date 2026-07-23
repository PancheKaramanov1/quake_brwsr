import { randomBytes } from 'node:crypto'
import {
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  DISPLAY_NAME_PATTERN,
  MAX_INPUTS_PER_SECOND,
  MAX_MESSAGE_BYTES,
  MAX_MESSAGES_PER_SECOND,
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  PRE_MATCH_COUNTDOWN_SECONDS,
  PROTOCOL_VERSION,
  SNAPSHOT_RATE,
  TICK_DT,
  TICK_RATE,
} from '../../src/shared/simulation/constants.js'
import { encodeMessage, decodeMessage, validateDisplayName } from '../../src/shared/protocol/codec.js'
import {
  MatchPhase,
  MessageType,
  PlayerFlag,
  RejectReason,
  type InputCommandPayload,
  type SnapshotPayload,
  type SnapshotPlayer,
  type SnapshotProjectile,
} from '../../src/shared/protocol/messages.js'
import { GameWorld } from '../../src/shared/simulation/world.js'
import { sortLeaderboard } from '../../src/shared/simulation/combat.js'
import type { ServerConfig } from '../config.js'
import type { ClientConnection } from '../network/ClientConnection.js'
import { RateLimiter } from '../security/RateLimiter.js'
import { SecurityLogger } from '../security/SecurityLogger.js'

export interface SessionRecord {
  sessionId: string
  reconnectToken: string
  playerId: number
  displayName: string
  lastSeq: number
  graceUntil: number
  connection: ClientConnection | null
}

export class MatchInstance {
  readonly world = new GameWorld()
  readonly sessions = new Map<string, SessionRecord>()
  readonly playerToSession = new Map<number, string>()
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private running = false
  private resultsTimer: ReturnType<typeof setTimeout> | null = null
  metrics = {
    tickCount: 0,
    tickDurations: [] as number[],
    snapshotBytes: 0,
    snapshotCount: 0,
    bytesIn: 0,
    bytesOut: 0,
    connections: 0,
    rejects: 0,
    errors: 0,
  }

  constructor(
    private readonly config: ServerConfig,
    private readonly securityLog: SecurityLogger,
  ) {
    this.world.scoreLimit = config.scoreLimit
    this.world.timeRemaining = config.matchDurationSeconds
  }

  start(): void {
    if (this.running) return
    this.running = true
    const intervalMs = 1000 / this.config.tickRate
    this.tickTimer = setInterval(() => this.tick(), intervalMs)
  }

  stop(): void {
    this.running = false
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
    if (this.resultsTimer) {
      clearTimeout(this.resultsTimer)
      this.resultsTimer = null
    }
  }

  activePlayerCount(): number {
    let n = 0
    for (const s of this.sessions.values()) {
      if (s.connection?.isOpen) n += 1
    }
    return n
  }

  handleHello(conn: ClientConnection, displayName: string, protocolVersion: number): void {
    if (protocolVersion !== PROTOCOL_VERSION) {
      this.reject(conn, RejectReason.VersionMismatch, 'Protocol version mismatch')
      return
    }
    const nameError = validateDisplayName(displayName)
    if (nameError) {
      this.reject(conn, RejectReason.InvalidName, nameError)
      return
    }
    let name = displayName.trim()
    // Deduplicate display names
    const used = new Set([...this.sessions.values()].map((s) => s.displayName))
    if (used.has(name)) {
      let i = 2
      while (used.has(`${name}_${i}`) && i < 100) i += 1
      name = `${name}_${i}`
    }

    if (this.activePlayerCount() >= this.config.maxPlayers) {
      this.reject(conn, RejectReason.Full, 'Server full')
      return
    }

    try {
      const player = this.world.addPlayer(name)
      const sessionId = randomBytes(16).toString('hex')
      const reconnectToken = randomBytes(16).toString('hex')
      const session: SessionRecord = {
        sessionId,
        reconnectToken,
        playerId: player.id,
        displayName: name,
        lastSeq: 0,
        graceUntil: 0,
        connection: conn,
      }
      this.sessions.set(sessionId, session)
      this.playerToSession.set(player.id, sessionId)
      conn.sessionId = sessionId
      conn.playerId = player.id
      conn.rateLimiter = new RateLimiter(MAX_MESSAGES_PER_SECOND, MAX_INPUTS_PER_SECOND)

      conn.send(
        encodeMessage(MessageType.Welcome, {
          playerId: player.id,
          sessionId,
          reconnectToken,
          tickRate: TICK_RATE,
          snapshotRate: SNAPSHOT_RATE,
          mapId: this.world.map.id,
        }),
      )

      this.broadcastExcept(
        player.id,
        encodeMessage(MessageType.PlayerJoined, {
          playerId: player.id,
          displayName: name,
        }),
      )

      this.maybeStartMatch()
      this.metrics.connections += 1
    } catch {
      this.reject(conn, RejectReason.Full, 'Server full')
    }
  }

  handleReconnect(conn: ClientConnection, sessionId: string, token: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.reconnectToken !== token) {
      this.reject(conn, RejectReason.AuthFailed, 'Invalid reconnect token')
      return
    }
    if (Date.now() > session.graceUntil && session.graceUntil !== 0 && !session.connection) {
      this.reject(conn, RejectReason.AuthFailed, 'Reconnect grace expired')
      return
    }
    if (session.connection?.isOpen) {
      session.connection.close(4000, 'replaced')
    }
    session.connection = conn
    session.graceUntil = 0
    conn.sessionId = sessionId
    conn.playerId = session.playerId
    conn.rateLimiter = new RateLimiter(MAX_MESSAGES_PER_SECOND, MAX_INPUTS_PER_SECOND)
    const player = this.world.players.get(session.playerId)
    if (player) player.connected = true

    conn.send(
      encodeMessage(MessageType.Welcome, {
        playerId: session.playerId,
        sessionId,
        reconnectToken: session.reconnectToken,
        tickRate: TICK_RATE,
        snapshotRate: SNAPSHOT_RATE,
        mapId: this.world.map.id,
      }),
    )
  }

  handleInput(conn: ClientConnection, input: InputCommandPayload): void {
    if (conn.playerId === null) return
    const session = conn.sessionId ? this.sessions.get(conn.sessionId) : undefined
    if (!session) return

    if (!conn.rateLimiter?.allowInput()) {
      this.securityLog.rateLimit(conn.playerId, 'input')
      return
    }

    // Duplicate / out-of-order: ignore older or equal seq
    if (input.seq <= session.lastSeq) {
      return
    }
    // Stale / future tick bounds
    const tickDelta = input.clientTick - this.world.tick
    if (tickDelta < -120 || tickDelta > 6) {
      this.securityLog.movementViolation(conn.playerId, 'tick_skew')
      return
    }

    session.lastSeq = input.seq
    conn.lastAckSeq = input.seq

    const moveX = Math.max(-1, Math.min(1, Math.round(input.moveX)))
    const moveY = Math.max(-1, Math.min(1, Math.round(input.moveY)))

    this.world.applyInput({
      playerId: conn.playerId,
      seq: input.seq,
      moveX,
      moveY,
      jump: input.jump,
      dash: input.dash,
      shoot: input.shoot,
      reload: input.reload,
      yaw: input.yaw,
      pitch: input.pitch,
    })
  }

  handleDisconnect(conn: ClientConnection): void {
    if (!conn.sessionId) return
    const session = this.sessions.get(conn.sessionId)
    if (!session) return
    session.connection = null
    session.graceUntil = Date.now() + this.config.reconnectGraceMs
    const player = this.world.players.get(session.playerId)
    if (player) player.connected = false

    // Cleanup after grace
    setTimeout(() => {
      const s = this.sessions.get(session.sessionId)
      if (s && !s.connection) {
        this.world.removePlayer(s.playerId)
        this.playerToSession.delete(s.playerId)
        this.sessions.delete(s.sessionId)
        this.broadcast(
          encodeMessage(MessageType.PlayerLeft, {
            playerId: s.playerId,
            reason: 'timeout',
          }),
        )
      }
    }, this.config.reconnectGraceMs)
  }

  handleMessage(conn: ClientConnection, data: Uint8Array): void {
    this.metrics.bytesIn += data.byteLength
    if (data.byteLength > MAX_MESSAGE_BYTES) {
      this.securityLog.invalidMessage(conn.remoteAddress, 'oversized')
      conn.close(1009, 'too large')
      return
    }
    if (conn.rateLimiter && !conn.rateLimiter.allowMessage()) {
      this.securityLog.rateLimit(conn.playerId ?? -1, 'message')
      conn.close(1008, 'rate limit')
      return
    }

    const decoded = decodeMessage(data)
    if (!decoded.ok) {
      this.securityLog.invalidMessage(conn.remoteAddress, decoded.error.code)
      this.metrics.errors += 1
      if (decoded.error.code === 'version_mismatch') {
        this.reject(conn, RejectReason.VersionMismatch, decoded.error.message)
      }
      return
    }

    conn.lastMessageAt = Date.now()

    switch (decoded.type) {
      case MessageType.Hello:
        this.handleHello(conn, decoded.payload.displayName, decoded.payload.protocolVersion)
        break
      case MessageType.Reconnect:
        this.handleReconnect(conn, decoded.payload.sessionId, decoded.payload.reconnectToken)
        break
      case MessageType.InputCommand:
        this.handleInput(conn, decoded.payload)
        break
      case MessageType.Ping:
        conn.send(
          encodeMessage(MessageType.Pong, {
            clientTime: decoded.payload.clientTime,
            serverTime: Date.now(),
          }),
        )
        break
      case MessageType.ClientReady:
        break
      case MessageType.Disconnect:
        conn.close(1000, 'client disconnect')
        break
      case MessageType.JoinMatch:
        break
      default:
        this.securityLog.invalidMessage(conn.remoteAddress, `unexpected_${decoded.type}`)
        break
    }
  }

  private tick(): void {
    const t0 = performance.now()
    this.world.step()
    this.flushWorldEvents()

    if (this.world.shouldEmitSnapshot()) {
      this.broadcastSnapshot()
    }

    // Heartbeat / timeout
    const now = Date.now()
    for (const session of this.sessions.values()) {
      const c = session.connection
      if (!c?.isOpen) continue
      if (now - c.lastMessageAt > this.config.connectionTimeoutMs) {
        this.securityLog.info(`timeout player=${session.playerId}`)
        c.close(1001, 'timeout')
      }
    }

    const dt = performance.now() - t0
    this.metrics.tickCount += 1
    this.metrics.tickDurations.push(dt)
    if (this.metrics.tickDurations.length > 600) {
      this.metrics.tickDurations.shift()
    }

    if (
      this.world.phase === MatchPhase.Results &&
      !this.resultsTimer
    ) {
      this.resultsTimer = setTimeout(() => {
        this.resultsTimer = null
        this.world.restartMatch()
        this.broadcastMatchState()
      }, 8000)
    }
  }

  private flushWorldEvents(): void {
    const events = this.world.drainEvents()
    for (const ev of events) {
      switch (ev.type) {
        case 'projectile_spawn':
          this.broadcast(
            encodeMessage(MessageType.ProjectileSpawn, {
              id: ev.data.id as number,
              ownerId: ev.data.ownerId as number,
              x: ev.data.x as number,
              y: ev.data.y as number,
              z: ev.data.z as number,
              vx: ev.data.vx as number,
              vy: ev.data.vy as number,
              vz: ev.data.vz as number,
            }),
          )
          break
        case 'projectile_impact':
          this.broadcast(
            encodeMessage(MessageType.ProjectileImpact, {
              id: ev.data.projectileId as number,
              x: ev.data.x as number,
              y: ev.data.y as number,
              z: ev.data.z as number,
            }),
          )
          break
        case 'damage':
          this.broadcast(
            encodeMessage(MessageType.DamageEvent, {
              victimId: ev.data.victimId as number,
              attackerId: ev.data.attackerId as number,
              amount: ev.data.amount as number,
              remainingHealth: ev.data.health as number,
            }),
          )
          break
        case 'death':
          this.broadcast(
            encodeMessage(MessageType.DeathEvent, {
              victimId: ev.data.victimId as number,
              killerId: ev.data.attackerId as number,
              weapon: 0,
            }),
          )
          break
        case 'respawn':
          this.broadcast(
            encodeMessage(MessageType.RespawnEvent, {
              playerId: ev.data.playerId as number,
              x: ev.data.x as number,
              y: ev.data.y as number,
              z: ev.data.z as number,
              yaw: ev.data.yaw as number,
            }),
          )
          break
        case 'match_ended': {
          const standings = (ev.data.standings as ReturnType<typeof sortLeaderboard>).map(
            (s, i) => ({
              playerId: s.id,
              displayName: s.name,
              kills: s.kills,
              deaths: s.deaths,
              rank: i + 1,
            }),
          )
          this.broadcast(encodeMessage(MessageType.MatchEnded, { standings }))
          break
        }
        case 'player_left':
          this.broadcast(
            encodeMessage(MessageType.PlayerLeft, {
              playerId: ev.data.playerId as number,
              reason: 'left',
            }),
          )
          break
        default:
          break
      }
    }
  }

  private broadcastSnapshot(): void {
    const players: SnapshotPlayer[] = []
    for (const p of this.world.players.values()) {
      let flags = 0
      if (p.sim.dashRemaining > 0) flags |= PlayerFlag.Dashing
      if (p.weapon.reloading) flags |= PlayerFlag.Reloading
      if (p.spawnProtection > 0) flags |= PlayerFlag.SpawnProtect
      players.push({
        id: p.id,
        x: p.sim.position.x,
        y: p.sim.position.y,
        z: p.sim.position.z,
        vx: p.sim.velocity.x,
        vy: p.sim.velocity.y,
        vz: p.sim.velocity.z,
        yaw: p.sim.yaw,
        pitch: p.sim.pitch,
        health: p.health,
        alive: p.sim.alive,
        weapon: 0,
        ammo: p.weapon.ammo,
        flags,
        kills: p.kills,
        deaths: p.deaths,
      })
    }
    const projectiles: SnapshotProjectile[] = [...this.world.projectiles.values()].map((pr) => ({
      id: pr.id,
      ownerId: pr.ownerId,
      x: pr.position.x,
      y: pr.position.y,
      z: pr.position.z,
      vx: pr.velocity.x,
      vy: pr.velocity.y,
      vz: pr.velocity.z,
    }))

    for (const session of this.sessions.values()) {
      const c = session.connection
      if (!c?.isOpen) continue
      const payload: SnapshotPayload = {
        tick: this.world.tick,
        ackSeq: session.lastSeq,
        phase: this.world.phase,
        timeRemaining: this.world.timeRemaining,
        scoreLimit: this.world.scoreLimit,
        players,
        projectiles,
      }
      const buf = encodeMessage(MessageType.Snapshot, payload)
      c.send(buf)
      this.metrics.bytesOut += buf.byteLength
      this.metrics.snapshotBytes += buf.byteLength
      this.metrics.snapshotCount += 1

      // Local correction for owning player
      const me = this.world.players.get(session.playerId)
      if (me) {
        c.send(
          encodeMessage(MessageType.LocalCorrection, {
            tick: this.world.tick,
            ackSeq: session.lastSeq,
            x: me.sim.position.x,
            y: me.sim.position.y,
            z: me.sim.position.z,
            vx: me.sim.velocity.x,
            vy: me.sim.velocity.y,
            vz: me.sim.velocity.z,
            yaw: me.sim.yaw,
            pitch: me.sim.pitch,
          }),
        )
      }
    }
  }

  private broadcastMatchState(): void {
    this.broadcast(
      encodeMessage(MessageType.MatchState, {
        phase: this.world.phase,
        timeRemaining: this.world.timeRemaining,
        scoreLimit: this.world.scoreLimit,
        playerCount: this.world.players.size,
      }),
    )
  }

  private maybeStartMatch(): void {
    if (
      this.world.phase === MatchPhase.Waiting &&
      this.activePlayerCount() >= MIN_PLAYERS_TO_START
    ) {
      this.world.startCountdown(PRE_MATCH_COUNTDOWN_SECONDS)
      this.broadcastMatchState()
    }
  }

  private reject(conn: ClientConnection, reason: RejectReason, message: string): void {
    this.metrics.rejects += 1
    this.securityLog.rejectedConnection(conn.remoteAddress, RejectReason[reason] ?? String(reason))
    conn.send(encodeMessage(MessageType.Reject, { reason, message }))
    conn.close(1008, message)
  }

  broadcast(data: Uint8Array): void {
    for (const session of this.sessions.values()) {
      if (session.connection?.isOpen) {
        session.connection.send(data)
        this.metrics.bytesOut += data.byteLength
      }
    }
  }

  broadcastExcept(playerId: number, data: Uint8Array): void {
    for (const session of this.sessions.values()) {
      if (session.playerId === playerId) continue
      if (session.connection?.isOpen) {
        session.connection.send(data)
        this.metrics.bytesOut += data.byteLength
      }
    }
  }

  notifyShutdown(): void {
    this.broadcast(
      encodeMessage(MessageType.ServerError, {
        code: 1,
        message: 'Server shutting down',
      }),
    )
    for (const session of this.sessions.values()) {
      session.connection?.close(1001, 'shutdown')
    }
  }

  getMetrics(): Record<string, number | string> {
    const durs = [...this.metrics.tickDurations].sort((a, b) => a - b)
    const p = (q: number) =>
      durs.length === 0 ? 0 : durs[Math.min(durs.length - 1, Math.floor(q * (durs.length - 1)))]
    const avgSnap =
      this.metrics.snapshotCount === 0
        ? 0
        : this.metrics.snapshotBytes / this.metrics.snapshotCount
    return {
      tickCount: this.metrics.tickCount,
      tickP50: p(0.5),
      tickP95: p(0.95),
      tickMax: durs.length ? durs[durs.length - 1] : 0,
      players: this.activePlayerCount(),
      avgSnapshotBytes: avgSnap,
      bytesIn: this.metrics.bytesIn,
      bytesOut: this.metrics.bytesOut,
      phase: MatchPhase[this.world.phase] ?? String(this.world.phase),
      rejects: this.metrics.rejects,
      errors: this.metrics.errors,
    }
  }
}

// silence unused import warnings for constants used in docs
void DISPLAY_NAME_MIN
void DISPLAY_NAME_MAX
void DISPLAY_NAME_PATTERN
void MAX_PLAYERS
void TICK_DT
