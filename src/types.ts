import { Vector3, Mesh, Camera } from '@babylonjs/core'

export interface GameConfig {
  gravity: number
  playerSpeed: number
  jumpPower: number
  dashPower: number
  flightSpeed: number
  friction: number
  airFriction: number
  mouseSensitivity: number
}

export interface InputState {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
  jump: boolean
  dash: boolean
  shoot: boolean
  flight: boolean
  mouseX: number
  mouseY: number
}

export interface PlayerState {
  position: Vector3
  velocity: Vector3
  rotation: Vector3
  health: number
  ammo: number
  isFlying: boolean
  isDashing: boolean
  dashCooldown: number
  onGround: boolean
}

export interface Projectile {
  mesh: Mesh
  velocity: Vector3
  damage: number
  splashRadius: number
  startTime: number
  lifeTime: number
}

export interface WeaponConfig {
  damage: number
  splashDamage: number
  splashRadius: number
  projectileSpeed: number
  ammoCapacity: number
  reloadTime: number
  fireRate: number
}

export interface GameObjects {
  camera: Camera
  playerMesh: Mesh
  arena: Mesh[]
  projectiles: Projectile[]
} 