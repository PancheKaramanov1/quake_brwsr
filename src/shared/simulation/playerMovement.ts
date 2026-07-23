import {
  AIR_FRICTION,
  DASH_COOLDOWN,
  DASH_DURATION,
  DASH_POWER,
  GRAVITY,
  JUMP_COOLDOWN,
  JUMP_POWER,
  MAX_PITCH,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  TICK_DT,
} from './constants.js'
import {
  type AABB,
  type Vec3,
  clamp,
  cloneVec3,
  forwardFromYaw,
  lengthVec3,
  normalizeVec3,
  rightFromYaw,
  sphereAABBOverlap,
  vec3,
} from './math.js'

export interface MoveInput {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
  jump: boolean
  dash: boolean
  /** Normalized aim; yaw/pitch already applied on client or from command. */
  yaw: number
  pitch: number
}

export interface PlayerSimState {
  position: Vec3
  velocity: Vec3
  yaw: number
  pitch: number
  jumpVelocity: number
  grounded: boolean
  dashVelocity: Vec3
  dashRemaining: number
  dashCooldown: number
  jumpCooldown: number
  alive: boolean
}

export function createPlayerSimState(spawn: Vec3, yaw = 0): PlayerSimState {
  return {
    position: cloneVec3(spawn),
    velocity: vec3(),
    yaw,
    pitch: 0,
    jumpVelocity: 0,
    grounded: true,
    dashVelocity: vec3(),
    dashRemaining: 0,
    dashCooldown: 0,
    jumpCooldown: 0,
    alive: true,
  }
}

const _fwd = vec3()
const _right = vec3()
const _wish = vec3()
const _move = vec3()
const _dashDir = vec3()

export function stepPlayerMovement(
  state: PlayerSimState,
  input: MoveInput,
  colliders: readonly AABB[],
  floorY: number,
  dt: number = TICK_DT,
): void {
  if (!state.alive) return

  state.yaw = input.yaw
  state.pitch = clamp(input.pitch, -MAX_PITCH, MAX_PITCH)

  if (state.dashCooldown > 0) {
    state.dashCooldown = Math.max(0, state.dashCooldown - dt)
  }
  if (state.jumpCooldown > 0) {
    state.jumpCooldown = Math.max(0, state.jumpCooldown - dt)
  }

  if (state.dashRemaining > 0) {
    state.dashRemaining -= dt
    if (state.dashRemaining <= 0) {
      state.dashRemaining = 0
      state.dashVelocity.x = 0
      state.dashVelocity.y = 0
      state.dashVelocity.z = 0
    }
  }

  if (
    input.dash &&
    state.dashCooldown <= 0 &&
    state.dashRemaining <= 0
  ) {
    _dashDir.x = 0
    _dashDir.y = 0
    _dashDir.z = 0
    if (input.forward) _dashDir.z += 1
    if (input.backward) _dashDir.z -= 1
    if (input.left) _dashDir.x -= 1
    if (input.right) _dashDir.x += 1
    if (lengthVec3(_dashDir) < 1e-6) {
      _dashDir.z = 1
    }
    normalizeVec3(_dashDir, _dashDir)
    forwardFromYaw(state.yaw, _fwd)
    rightFromYaw(state.yaw, _right)
    state.dashVelocity.x = _fwd.x * _dashDir.z + _right.x * _dashDir.x
    state.dashVelocity.z = _fwd.z * _dashDir.z + _right.z * _dashDir.x
    state.dashVelocity.y = 0
    normalizeVec3(state.dashVelocity, state.dashVelocity)
    state.dashVelocity.x *= DASH_POWER
    state.dashVelocity.z *= DASH_POWER
    state.dashRemaining = DASH_DURATION
    state.dashCooldown = DASH_COOLDOWN
  }

  if (input.jump && state.grounded && state.jumpCooldown <= 0) {
    state.jumpVelocity = JUMP_POWER
    state.grounded = false
    state.jumpCooldown = JUMP_COOLDOWN
  }

  _wish.x = 0
  _wish.y = 0
  _wish.z = 0
  if (input.forward) _wish.z += 1
  if (input.backward) _wish.z -= 1
  if (input.left) _wish.x -= 1
  if (input.right) _wish.x += 1

  _move.x = 0
  _move.y = 0
  _move.z = 0

  if (lengthVec3(_wish) > 1e-6) {
    normalizeVec3(_wish, _wish)
    forwardFromYaw(state.yaw, _fwd)
    rightFromYaw(state.yaw, _right)
    _move.x = (_fwd.x * _wish.z + _right.x * _wish.x) * PLAYER_SPEED * dt
    _move.z = (_fwd.z * _wish.z + _right.z * _wish.x) * PLAYER_SPEED * dt
  }

  if (state.dashRemaining > 0) {
    _move.x += state.dashVelocity.x * dt
    _move.z += state.dashVelocity.z * dt
  }

  const nextX = state.position.x + _move.x
  const nextZ = state.position.z + _move.z

  if (!collidesAt(nextX, state.position.y, state.position.z, colliders)) {
    state.position.x = nextX
  }
  if (!collidesAt(state.position.x, state.position.y, nextZ, colliders)) {
    state.position.z = nextZ
  }

  if (!state.grounded) {
    state.jumpVelocity += GRAVITY * dt
  }

  let nextY = state.position.y + state.jumpVelocity * dt
  const standY = resolveGroundHeight(state.position.x, state.position.z, colliders, floorY)

  if (nextY <= standY) {
    nextY = standY
    state.jumpVelocity = 0
    state.grounded = true
  } else {
    state.grounded = false
  }

  // Ceiling / solid check on Y
  if (collidesAt(state.position.x, nextY, state.position.z, colliders)) {
    if (state.jumpVelocity > 0) {
      state.jumpVelocity = 0
    }
  } else {
    state.position.y = nextY
  }

  state.velocity.x = _move.x / dt
  state.velocity.y = state.jumpVelocity
  state.velocity.z = _move.z / dt

  const friction = state.grounded ? 1 : Math.max(0, 1 - AIR_FRICTION * dt)
  state.velocity.x *= friction
  state.velocity.z *= friction
}

function collidesAt(x: number, y: number, z: number, colliders: readonly AABB[]): boolean {
  const bodyY = y + PLAYER_HEIGHT * 0.5
  for (const box of colliders) {
    // Skip thin floors relative to feet — handled by ground height
    const isFloorLike = box.maxY - box.minY < 1.2 && box.maxY <= y + 0.2
    if (isFloorLike) continue
    if (sphereAABBOverlap(x, bodyY, z, PLAYER_RADIUS, box)) {
      // Only block if capsule overlaps solid volume above feet
      if (box.maxY > y + 0.15) {
        return true
      }
    }
  }
  return false
}

export function resolveGroundHeight(
  x: number,
  z: number,
  colliders: readonly AABB[],
  floorY: number,
): number {
  let best = floorY + PLAYER_HEIGHT * 0.5
  for (const box of colliders) {
    if (x < box.minX - PLAYER_RADIUS || x > box.maxX + PLAYER_RADIUS) continue
    if (z < box.minZ - PLAYER_RADIUS || z > box.maxZ + PLAYER_RADIUS) continue
    const top = box.maxY + PLAYER_HEIGHT * 0.5
    if (top > best && top < best + 8) {
      // Prefer highest surface under or near feet
      best = top
    } else if (box.maxY >= floorY && top > floorY + PLAYER_HEIGHT * 0.5 - 0.01) {
      if (
        x >= box.minX - PLAYER_RADIUS &&
        x <= box.maxX + PLAYER_RADIUS &&
        z >= box.minZ - PLAYER_RADIUS &&
        z <= box.maxZ + PLAYER_RADIUS
      ) {
        if (top > best) best = top
      }
    }
  }
  // Recompute more carefully: highest platform top under player xz
  best = floorY + PLAYER_HEIGHT * 0.5
  for (const box of colliders) {
    if (x < box.minX - PLAYER_RADIUS || x > box.maxX + PLAYER_RADIUS) continue
    if (z < box.minZ - PLAYER_RADIUS || z > box.maxZ + PLAYER_RADIUS) continue
    const top = box.maxY + PLAYER_HEIGHT * 0.5
    if (top > best) best = top
  }
  return best
}

export function inputFromAxes(
  moveX: number,
  moveY: number,
  jump: boolean,
  dash: boolean,
  yaw: number,
  pitch: number,
): MoveInput {
  return {
    forward: moveY > 0,
    backward: moveY < 0,
    left: moveX < 0,
    right: moveX > 0,
    jump,
    dash,
    yaw,
    pitch,
  }
}
