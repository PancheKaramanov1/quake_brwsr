/** Shared networking and simulation constants (no Babylon / DOM). */

export const PROTOCOL_VERSION = 1

export const TICK_RATE = 60
export const TICK_DT = 1 / TICK_RATE
export const INPUT_SEND_RATE = 60
export const SNAPSHOT_RATE = 20
export const SNAPSHOT_INTERVAL_TICKS = TICK_RATE / SNAPSHOT_RATE

export const INTERP_DELAY_MS = 100
export const HEARTBEAT_INTERVAL_MS = 2000
export const CONNECTION_TIMEOUT_MS = 10000
export const RECONNECT_GRACE_MS = 15000

export const MAX_PLAYERS = 12
export const MAX_MESSAGE_BYTES = 64 * 1024
export const MAX_MESSAGES_PER_SECOND = 120
export const MAX_INPUTS_PER_SECOND = 90
/** Max inputs retained per connection between ticks (bounded queue). */
export const MAX_PENDING_INPUTS = 32
/** Max inputs applied from one connection in a single server tick. */
export const MAX_INPUTS_PER_TICK = 2
/** Soft tick budget (ms); overruns are counted in metrics. */
export const TICK_BUDGET_MS = 1000 / TICK_RATE

export const MATCH_DURATION_SECONDS = 600
export const SCORE_LIMIT = 25
export const RESPAWN_DELAY_SECONDS = 3
export const SPAWN_PROTECTION_SECONDS = 2
export const PRE_MATCH_COUNTDOWN_SECONDS = 5
export const MATCH_END_DISPLAY_SECONDS = 8
export const MIN_PLAYERS_TO_START = 1

export const PLAYER_RADIUS = 0.3
export const PLAYER_HEIGHT = 1.8
export const PLAYER_EYE_OFFSET = 0.7
export const PLAYER_SPEED = 20
export const JUMP_POWER = 12
export const DASH_POWER = 35
export const DASH_DURATION = 0.3
export const DASH_COOLDOWN = 1.0
export const JUMP_COOLDOWN = 0.5
export const GRAVITY = -30
export const GROUND_FRICTION = 8
export const AIR_FRICTION = 2
export const MOUSE_SENSITIVITY = 0.003
export const MAX_PITCH = Math.PI / 2 - 0.01

export const ROCKET_DAMAGE = 100
export const ROCKET_SPLASH_DAMAGE = 50
export const ROCKET_SPLASH_RADIUS = 5
export const ROCKET_SPEED = 40
export const ROCKET_GRAVITY = 9.81
export const ROCKET_LIFETIME = 5
export const ROCKET_FIRE_INTERVAL = 0.5
export const ROCKET_AMMO_CAPACITY = 8
export const ROCKET_RELOAD_TIME = 2
export const ROCKET_HIT_RADIUS = 1.0
export const PLAYER_HIT_RADIUS = 0.9

export const MAX_POSITION_DELTA_PER_TICK = PLAYER_SPEED * TICK_DT * 3 + DASH_POWER * TICK_DT
export const CORRECTION_SNAP_THRESHOLD = 2.5
export const CORRECTION_SMOOTH_FACTOR = 0.25
export const MAX_INPUT_AGE_TICKS = 120
export const MAX_FUTURE_INPUT_TICKS = 6

export const DISPLAY_NAME_MIN = 1
export const DISPLAY_NAME_MAX = 16
export const DISPLAY_NAME_PATTERN = /^[a-zA-Z0-9_\- ]+$/

export const DEFAULT_SERVER_HOST = '0.0.0.0'
export const DEFAULT_SERVER_PORT = 8080
export const DEFAULT_WS_PATH = '/ws'
export const DEFAULT_SERVER_NAME = 'Reactor Atrium FFA'
export const DEFAULT_SERVER_REGION = 'local'
