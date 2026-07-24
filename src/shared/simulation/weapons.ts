import {
  ROCKET_AMMO_CAPACITY,
  ROCKET_DAMAGE,
  ROCKET_FIRE_INTERVAL,
  ROCKET_GRAVITY,
  ROCKET_HIT_RADIUS,
  ROCKET_LIFETIME,
  ROCKET_RELOAD_TIME,
  ROCKET_SPEED,
  ROCKET_SPLASH_DAMAGE,
  ROCKET_SPLASH_RADIUS,
  TICK_DT,
} from './constants.js'
import {
  type AABB,
  type Vec3,
  cloneVec3,
  distanceVec3,
  pointInAABB,
  scaleVec3,
  sphereAABBOverlap,
  vec3,
  yawPitchToDirection,
} from './math.js'

export interface WeaponState {
  ammo: number
  fireCooldown: number
  reloadRemaining: number
  reloading: boolean
}

export function createWeaponState(): WeaponState {
  return {
    ammo: ROCKET_AMMO_CAPACITY,
    fireCooldown: 0,
    reloadRemaining: 0,
    reloading: false,
  }
}

export function stepWeapon(weapon: WeaponState, dt: number = TICK_DT): void {
  if (weapon.fireCooldown > 0) {
    weapon.fireCooldown = Math.max(0, weapon.fireCooldown - dt)
  }
  if (weapon.reloading) {
    weapon.reloadRemaining -= dt
    if (weapon.reloadRemaining <= 0) {
      weapon.reloading = false
      weapon.reloadRemaining = 0
      weapon.ammo = ROCKET_AMMO_CAPACITY
    }
  }
}

export function tryStartReload(weapon: WeaponState): boolean {
  if (weapon.reloading) return false
  if (weapon.ammo >= ROCKET_AMMO_CAPACITY) return false
  weapon.reloading = true
  weapon.reloadRemaining = ROCKET_RELOAD_TIME
  return true
}

export interface ProjectileState {
  id: number
  ownerId: number
  position: Vec3
  velocity: Vec3
  age: number
  alive: boolean
  damage: number
  splashRadius: number
}

export interface FireResult {
  ok: boolean
  reason?: string
  projectile?: ProjectileState
}

export function tryFireRocket(
  weapon: WeaponState,
  ownerId: number,
  projectileId: number,
  origin: Vec3,
  yaw: number,
  pitch: number,
): FireResult {
  if (!weapon || weapon.reloading) {
    return { ok: false, reason: 'reloading' }
  }
  if (weapon.fireCooldown > 0) {
    return { ok: false, reason: 'fire_rate' }
  }
  if (weapon.ammo <= 0) {
    return { ok: false, reason: 'no_ammo' }
  }

  const dir = vec3()
  yawPitchToDirection(yaw, pitch, dir)
  const velocity = vec3()
  scaleVec3(velocity, dir, ROCKET_SPEED)

  weapon.ammo -= 1
  weapon.fireCooldown = ROCKET_FIRE_INTERVAL
  if (weapon.ammo <= 0) {
    tryStartReload(weapon)
  }

  return {
    ok: true,
    projectile: {
      id: projectileId,
      ownerId,
      position: cloneVec3(origin),
      velocity,
      age: 0,
      alive: true,
      damage: ROCKET_DAMAGE,
      splashRadius: ROCKET_SPLASH_RADIUS,
    },
  }
}

export interface ImpactEvent {
  projectileId: number
  ownerId: number
  point: Vec3
  hitPlayerId: number | null
}

export function stepProjectile(
  p: ProjectileState,
  colliders: readonly AABB[],
  mapHalfSize: number,
  floorY: number,
  dt: number = TICK_DT,
): ImpactEvent | null {
  if (!p.alive) return null

  p.velocity.y -= ROCKET_GRAVITY * dt
  p.position.x += p.velocity.x * dt
  p.position.y += p.velocity.y * dt
  p.position.z += p.velocity.z * dt
  p.age += dt

  if (p.age >= ROCKET_LIFETIME) {
    p.alive = false
    return {
      projectileId: p.id,
      ownerId: p.ownerId,
      point: cloneVec3(p.position),
      hitPlayerId: null,
    }
  }

  if (p.position.y <= floorY) {
    p.alive = false
    p.position.y = floorY
    return {
      projectileId: p.id,
      ownerId: p.ownerId,
      point: cloneVec3(p.position),
      hitPlayerId: null,
    }
  }

  if (
    Math.abs(p.position.x) > mapHalfSize - 1 ||
    Math.abs(p.position.z) > mapHalfSize - 1
  ) {
    p.alive = false
    return {
      projectileId: p.id,
      ownerId: p.ownerId,
      point: cloneVec3(p.position),
      hitPlayerId: null,
    }
  }

  for (const box of colliders) {
    if (sphereAABBOverlap(p.position.x, p.position.y, p.position.z, 0.2, box)) {
      p.alive = false
      return {
        projectileId: p.id,
        ownerId: p.ownerId,
        point: cloneVec3(p.position),
        hitPlayerId: null,
      }
    }
  }

  return null
}

export function checkProjectilePlayerHit(
  p: ProjectileState,
  playerId: number,
  playerPos: Vec3,
  playerAlive: boolean,
): ImpactEvent | null {
  if (!p.alive || !playerAlive || playerId === p.ownerId) return null
  if (distanceVec3(p.position, playerPos) <= ROCKET_HIT_RADIUS + 0.5) {
    p.alive = false
    return {
      projectileId: p.id,
      ownerId: p.ownerId,
      point: cloneVec3(p.position),
      hitPlayerId: playerId,
    }
  }
  return null
}

export interface SplashHit {
  playerId: number
  damage: number
}

export function computeSplashDamage(
  center: Vec3,
  targets: ReadonlyArray<{ id: number; position: Vec3; alive: boolean }>,
  baseDamage: number = ROCKET_SPLASH_DAMAGE,
  radius: number = ROCKET_SPLASH_RADIUS,
  includeOwnerId?: number,
): SplashHit[] {
  const hits: SplashHit[] = []
  for (const t of targets) {
    if (!t.alive) continue
    const dist = distanceVec3(center, t.position)
    if (dist > radius) continue
    const falloff = 1 - dist / radius
    let damage = Math.round(baseDamage * falloff)
    if (includeOwnerId !== undefined && t.id === includeOwnerId) {
      damage = Math.round(damage * 0.5) // self-damage reduced
    }
    if (damage > 0) {
      hits.push({ playerId: t.id, damage })
    }
  }
  return hits
}

export function isOriginPlausible(
  origin: Vec3,
  playerPos: Vec3,
  maxDist = 3,
): boolean {
  return distanceVec3(origin, playerPos) <= maxDist
}

export function eyePosition(playerPos: Vec3, eyeOffset = 0.7): Vec3 {
  return vec3(playerPos.x, playerPos.y + eyeOffset, playerPos.z)
}

export { ROCKET_DAMAGE, pointInAABB }
