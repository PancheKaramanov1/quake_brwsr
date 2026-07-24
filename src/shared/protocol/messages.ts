/** Versioned FPS protocol message types and payloads (no Babylon). */

export enum MessageType {
  // Client → Server
  Hello = 1,
  JoinMatch = 2,
  ClientReady = 3,
  InputCommand = 4,
  Ping = 5,
  Reconnect = 6,
  Disconnect = 7,

  // Server → Client
  Welcome = 10,
  Reject = 11,
  MatchState = 12,
  Snapshot = 13,
  PlayerJoined = 14,
  PlayerLeft = 15,
  ProjectileSpawn = 16,
  ProjectileImpact = 17,
  DamageEvent = 18,
  DeathEvent = 19,
  RespawnEvent = 20,
  ScoreUpdate = 21,
  MatchEnded = 22,
  Pong = 23,
  ServerError = 24,
  EntitySpawn = 25,
  EntityDestroy = 26,
  LocalCorrection = 27,
}

export enum RejectReason {
  Full = 1,
  VersionMismatch = 2,
  InvalidName = 3,
  Banned = 4,
  Shutdown = 5,
  AuthFailed = 6,
  Duplicate = 7,
}

export enum MatchPhase {
  Waiting = 0,
  Countdown = 1,
  Active = 2,
  Ending = 3,
  Results = 4,
  Restarting = 5,
}

/** SnapshotPlayer.flags bit layout. */
export enum PlayerFlag {
  Dashing = 1 << 0,
  Reloading = 1 << 1,
  SpawnProtect = 1 << 2,
}

export interface HelloPayload {
  protocolVersion: number
  displayName: string
}

export interface JoinMatchPayload {
  mapId: string
}

export type ClientReadyPayload = Record<string, never>

export interface InputCommandPayload {
  seq: number
  clientTick: number
  /** i8, clamped to -1..1 */
  moveX: number
  /** i8, clamped to -1..1 */
  moveY: number
  jump: boolean
  crouch: boolean
  dash: boolean
  shoot: boolean
  reload: boolean
  yaw: number
  pitch: number
}

export interface PingPayload {
  clientTime: number
}

export interface ReconnectPayload {
  sessionId: string
  reconnectToken: string
}

export interface DisconnectPayload {
  reason: string
}

export interface WelcomePayload {
  playerId: number
  sessionId: string
  reconnectToken: string
  tickRate: number
  snapshotRate: number
  mapId: string
}

export interface RejectPayload {
  reason: RejectReason
  message: string
}

export interface MatchStatePayload {
  phase: MatchPhase
  timeRemaining: number
  scoreLimit: number
  playerCount: number
}

export interface SnapshotPlayer {
  id: number
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
  /** u8: PlayerFlag bits */
  flags: number
  kills: number
  deaths: number
}

export interface SnapshotProjectile {
  id: number
  ownerId: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
}

export interface SnapshotPayload {
  tick: number
  ackSeq: number
  phase: MatchPhase
  timeRemaining: number
  scoreLimit: number
  players: SnapshotPlayer[]
  projectiles: SnapshotProjectile[]
}

export interface PlayerJoinedPayload {
  playerId: number
  displayName: string
}

export interface PlayerLeftPayload {
  playerId: number
  reason: string
}

export interface ProjectileSpawnPayload {
  id: number
  ownerId: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
}

export interface ProjectileImpactPayload {
  id: number
  x: number
  y: number
  z: number
}

export interface DamageEventPayload {
  victimId: number
  attackerId: number
  amount: number
  remainingHealth: number
}

export interface DeathEventPayload {
  victimId: number
  killerId: number
  weapon: number
}

export interface RespawnEventPayload {
  playerId: number
  x: number
  y: number
  z: number
  yaw: number
}

export interface ScoreEntry {
  playerId: number
  kills: number
  deaths: number
}

export interface ScoreUpdatePayload {
  scores: ScoreEntry[]
}

export interface StandingEntry {
  playerId: number
  displayName: string
  kills: number
  deaths: number
  rank: number
}

export interface MatchEndedPayload {
  standings: StandingEntry[]
}

export interface PongPayload {
  clientTime: number
  serverTime: number
}

export interface ServerErrorPayload {
  code: number
  message: string
}

export interface EntitySpawnPayload {
  entityId: number
  entityType: number
  x: number
  y: number
  z: number
}

export interface EntityDestroyPayload {
  entityId: number
}

export interface LocalCorrectionPayload {
  tick: number
  ackSeq: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  yaw: number
  pitch: number
}

export interface MessagePayloadMap {
  [MessageType.Hello]: HelloPayload
  [MessageType.JoinMatch]: JoinMatchPayload
  [MessageType.ClientReady]: ClientReadyPayload
  [MessageType.InputCommand]: InputCommandPayload
  [MessageType.Ping]: PingPayload
  [MessageType.Reconnect]: ReconnectPayload
  [MessageType.Disconnect]: DisconnectPayload
  [MessageType.Welcome]: WelcomePayload
  [MessageType.Reject]: RejectPayload
  [MessageType.MatchState]: MatchStatePayload
  [MessageType.Snapshot]: SnapshotPayload
  [MessageType.PlayerJoined]: PlayerJoinedPayload
  [MessageType.PlayerLeft]: PlayerLeftPayload
  [MessageType.ProjectileSpawn]: ProjectileSpawnPayload
  [MessageType.ProjectileImpact]: ProjectileImpactPayload
  [MessageType.DamageEvent]: DamageEventPayload
  [MessageType.DeathEvent]: DeathEventPayload
  [MessageType.RespawnEvent]: RespawnEventPayload
  [MessageType.ScoreUpdate]: ScoreUpdatePayload
  [MessageType.MatchEnded]: MatchEndedPayload
  [MessageType.Pong]: PongPayload
  [MessageType.ServerError]: ServerErrorPayload
  [MessageType.EntitySpawn]: EntitySpawnPayload
  [MessageType.EntityDestroy]: EntityDestroyPayload
  [MessageType.LocalCorrection]: LocalCorrectionPayload
}

export type ProtocolPayload = MessagePayloadMap[MessageType]

export type DecodedMessage = {
  [K in MessageType]: { ok: true; type: K; payload: MessagePayloadMap[K] }
}[MessageType]

const KNOWN_MESSAGE_TYPES: ReadonlySet<number> = new Set(
  Object.values(MessageType).filter((v): v is number => typeof v === 'number'),
)

export function isMessageType(value: number): value is MessageType {
  return KNOWN_MESSAGE_TYPES.has(value)
}
