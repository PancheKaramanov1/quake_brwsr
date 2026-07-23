/** Local player prediction + server reconciliation. */

import {
  CORRECTION_SMOOTH_FACTOR,
  CORRECTION_SNAP_THRESHOLD,
  TICK_DT,
} from '../../shared/simulation/constants.js'
import type { AABB } from '../../shared/simulation/math.js'
import { cloneVec3, distanceVec3, vec3 } from '../../shared/simulation/math.js'
import {
  inputFromAxes,
  type PlayerSimState,
  stepPlayerMovement,
} from '../../shared/simulation/playerMovement.js'

export interface PendingInput {
  seq: number
  moveX: number
  moveY: number
  jump: boolean
  crouch: boolean
  dash: boolean
  shoot: boolean
  reload: boolean
  yaw: number
  pitch: number
}

function cloneSimState(src: PlayerSimState): PlayerSimState {
  return {
    position: cloneVec3(src.position),
    velocity: cloneVec3(src.velocity),
    yaw: src.yaw,
    pitch: src.pitch,
    jumpVelocity: src.jumpVelocity,
    grounded: src.grounded,
    dashVelocity: cloneVec3(src.dashVelocity),
    dashRemaining: src.dashRemaining,
    dashCooldown: src.dashCooldown,
    jumpCooldown: src.jumpCooldown,
    alive: src.alive,
  }
}

function copySimState(dst: PlayerSimState, src: PlayerSimState): void {
  dst.position.x = src.position.x
  dst.position.y = src.position.y
  dst.position.z = src.position.z
  dst.velocity.x = src.velocity.x
  dst.velocity.y = src.velocity.y
  dst.velocity.z = src.velocity.z
  dst.yaw = src.yaw
  dst.pitch = src.pitch
  dst.jumpVelocity = src.jumpVelocity
  dst.grounded = src.grounded
  dst.dashVelocity.x = src.dashVelocity.x
  dst.dashVelocity.y = src.dashVelocity.y
  dst.dashVelocity.z = src.dashVelocity.z
  dst.dashRemaining = src.dashRemaining
  dst.dashCooldown = src.dashCooldown
  dst.jumpCooldown = src.jumpCooldown
  dst.alive = src.alive
}

export class ClientPrediction {
  private pending: PendingInput[] = []
  private predicted: PlayerSimState
  private colliders: readonly AABB[]
  private floorY: number
  private awaitingSnapshot = false

  constructor(initial: PlayerSimState, colliders: readonly AABB[], floorY: number) {
    this.predicted = cloneSimState(initial)
    this.colliders = colliders
    this.floorY = floorY
  }

  get state(): PlayerSimState {
    return this.predicted
  }

  get pendingCount(): number {
    return this.pending.length
  }

  get isAwaitingSnapshot(): boolean {
    return this.awaitingSnapshot
  }

  setColliders(colliders: readonly AABB[], floorY: number): void {
    this.colliders = colliders
    this.floorY = floorY
  }

  /** Hard-reset predicted state (e.g. first snapshot / respawn). */
  reset(state: PlayerSimState): void {
    this.predicted = cloneSimState(state)
    this.pending = []
    this.awaitingSnapshot = false
  }

  /**
   * Clear pending inputs and freeze prediction until the next authoritative
   * snapshot (used after tab suspension).
   */
  clear(): void {
    this.pending = []
    this.awaitingSnapshot = true
  }

  applyLocalPrediction(input: PendingInput): PlayerSimState {
    if (this.awaitingSnapshot) {
      return this.predicted
    }
    this.pending.push({ ...input })
    const move = inputFromAxes(
      input.moveX,
      input.moveY,
      input.jump,
      input.dash,
      input.yaw,
      input.pitch,
    )
    stepPlayerMovement(this.predicted, move, this.colliders, this.floorY, TICK_DT)
    return this.predicted
  }

  /**
   * Rewind to authoritative state at ackSeq, then replay unacked inputs.
   * Soft-blends position when error is small; snaps when large.
   */
  reconcile(ackSeq: number, authoritative: PlayerSimState): PlayerSimState {
    this.awaitingSnapshot = false
    this.pending = this.pending.filter((p) => p.seq > ackSeq)

    const corrected = cloneSimState(authoritative)
    for (const input of this.pending) {
      const move = inputFromAxes(
        input.moveX,
        input.moveY,
        input.jump,
        input.dash,
        input.yaw,
        input.pitch,
      )
      stepPlayerMovement(corrected, move, this.colliders, this.floorY, TICK_DT)
    }

    const error = distanceVec3(this.predicted.position, corrected.position)
    if (error < CORRECTION_SNAP_THRESHOLD) {
      const t = CORRECTION_SMOOTH_FACTOR
      this.predicted.position.x += (corrected.position.x - this.predicted.position.x) * t
      this.predicted.position.y += (corrected.position.y - this.predicted.position.y) * t
      this.predicted.position.z += (corrected.position.z - this.predicted.position.z) * t
      this.predicted.velocity.x += (corrected.velocity.x - this.predicted.velocity.x) * t
      this.predicted.velocity.y += (corrected.velocity.y - this.predicted.velocity.y) * t
      this.predicted.velocity.z += (corrected.velocity.z - this.predicted.velocity.z) * t
      this.predicted.yaw = corrected.yaw
      this.predicted.pitch = corrected.pitch
      this.predicted.jumpVelocity = corrected.jumpVelocity
      this.predicted.grounded = corrected.grounded
      this.predicted.dashVelocity.x = corrected.dashVelocity.x
      this.predicted.dashVelocity.y = corrected.dashVelocity.y
      this.predicted.dashVelocity.z = corrected.dashVelocity.z
      this.predicted.dashRemaining = corrected.dashRemaining
      this.predicted.dashCooldown = corrected.dashCooldown
      this.predicted.jumpCooldown = corrected.jumpCooldown
      this.predicted.alive = corrected.alive
    } else {
      copySimState(this.predicted, corrected)
    }

    return this.predicted
  }
}

/** Build a PlayerSimState from snapshot / LocalCorrection fields. */
export function simStateFromAuthoritative(fields: {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  yaw: number
  pitch: number
  alive?: boolean
}): PlayerSimState {
  return {
    position: vec3(fields.x, fields.y, fields.z),
    velocity: vec3(fields.vx, fields.vy, fields.vz),
    yaw: fields.yaw,
    pitch: fields.pitch,
    jumpVelocity: fields.vy,
    grounded: Math.abs(fields.vy) < 0.01,
    dashVelocity: vec3(),
    dashRemaining: 0,
    dashCooldown: 0,
    jumpCooldown: 0,
    alive: fields.alive ?? true,
  }
}
