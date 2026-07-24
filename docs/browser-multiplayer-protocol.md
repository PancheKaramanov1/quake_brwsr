# Browser Multiplayer Protocol

## Transport

- **WebSocket** binary frames (browser `WebSocket` ↔ Node `ws`)
- Default path: `/ws` (`WS_PATH`)
- Max payload: **64 KiB** (`MAX_MESSAGE_BYTES`)
- Protocol version: **1** (`PROTOCOL_VERSION`)

Source: `src/shared/protocol/messages.ts`, `src/shared/protocol/codec.ts`.

## Frame layout

Every message is one binary buffer:

| Offset | Size | Field |
| ------ | ---- | ----- |
| 0 | 1 | `protocolVersion` (u8) — must be `1` |
| 1 | 1 | `messageType` (u8) — `MessageType` |
| 2 | 2 | `payloadLength` (u16 LE) |
| 4 | N | Payload bytes |

`PROTOCOL_HEADER_BYTES = 4`. Decode rejects truncated, oversized, wrong version, unknown type, or trailing payload bytes.

Quantization (snapshots / corrections):

- Position: ×100 → int32
- Velocity: ×100 → int16
- Angles: mapped to int16 via `32767 / π`

## Message types

### Client → server

| Type | Id | Purpose |
| ---- | -- | ------- |
| `Hello` | 1 | Join: `protocolVersion`, `displayName` |
| `JoinMatch` | 2 | Reserved (`mapId`); currently no-op — session discovery uses HTTP `GET /status` instead |
| `ClientReady` | 3 | Reserved; currently no-op |
| `InputCommand` | 4 | Movement / actions for prediction |
| `Ping` | 5 | RTT: `clientTime` |
| `Reconnect` | 6 | `sessionId` + `reconnectToken` |
| `Disconnect` | 7 | Graceful close reason |

### Server → client

| Type | Id | Purpose |
| ---- | -- | ------- |
| `Welcome` | 10 | `playerId`, session + reconnect token, tick/snapshot rates, `mapId` |
| `Reject` | 11 | `RejectReason` + message |
| `MatchState` | 12 | Phase, time remaining, score limit, player count |
| `Snapshot` | 13 | World state at tick (players + projectiles) |
| `PlayerJoined` / `PlayerLeft` | 14 / 15 | Presence |
| `ProjectileSpawn` / `ProjectileImpact` | 16 / 17 | Rocket events |
| `DamageEvent` / `DeathEvent` / `RespawnEvent` | 18–20 | Combat |
| `ScoreUpdate` | 21 | Kill/death rows |
| `MatchEnded` | 22 | Final standings |
| `Pong` | 23 | Echo `clientTime` + `serverTime` |
| `ServerError` | 24 | Error code + message |
| `EntitySpawn` / `EntityDestroy` | 25 / 26 | Generic entity hooks |
| `LocalCorrection` | 27 | Hard pose correction for local player |

### Reject reasons

`Full`, `VersionMismatch`, `InvalidName`, `Banned`, `Shutdown`, `AuthFailed`, `Duplicate`.

### Match phases

`Waiting` → `Countdown` → `Active` → `Ending` → `Results` → `Restarting`.

## InputCommand

| Field | Notes |
| ----- | ----- |
| `seq` | Monotonic; server ignores `seq <= lastSeq` |
| `clientTick` | Must be within about −120…+6 of server tick |
| `moveX` / `moveY` | Clamped to −1…1 (i8) |
| `jump`, `crouch`, `dash`, `shoot`, `reload` | Booleans (bit-packed on wire) |
| `yaw`, `pitch` | Aim radians |

Rates: send target **60 Hz**; server caps **90 inputs/s** and **120 messages/s**.

## Snapshot

| Field | Notes |
| ----- | ----- |
| `tick` | Server sim tick |
| `ackSeq` | Highest processed input seq for recipient |
| `phase`, `timeRemaining`, `scoreLimit` | Match HUD |
| `players[]` | Pose, vel, aim, health, alive, weapon, ammo, flags, K/D |
| `projectiles[]` | id, owner, pose, vel |

`PlayerFlag` bits: `Dashing`, `Reloading`, `SpawnProtect`.

Broadcast cadence: every `TICK_RATE / SNAPSHOT_RATE` ticks (**3** ticks at 60/20).

## Handshake flow

```text
Client                         Server
  |-- Hello(v1, name) -------->|
  |<--------- Welcome ---------|  (or Reject)
  |-- InputCommand @ 60 Hz --->|
  |<---- Snapshot @ 20 Hz -----|
  |<-- Damage/Death/etc. ------|
  |-- Ping ------------------->|
  |<--------- Pong ------------|
```

Reconnect: `Reconnect(sessionId, reconnectToken)` within `RECONNECT_GRACE_MS` (default 15 s).

## Display names

- Length 1–16
- Pattern: `^[a-zA-Z0-9_\- ]+$`
- Server may suffix `_2`, `_3`, … on collision

## API usage

```ts
import { encodeMessage, decodeMessage } from '../src/shared/protocol/codec.js'
import { MessageType } from '../src/shared/protocol/messages.js'

const bytes = encodeMessage(MessageType.Hello, {
  protocolVersion: 1,
  displayName: 'Player',
})
const result = decodeMessage(bytes)
```
