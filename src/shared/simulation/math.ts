/** Plain vector math — no Babylon.js dependency. */

export interface Vec3 {
  x: number
  y: number
  z: number
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z }
}

export function cloneVec3(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z }
}

export function setVec3(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x
  out.y = y
  out.z = z
  return out
}

export function copyVec3(out: Vec3, v: Vec3): Vec3 {
  out.x = v.x
  out.y = v.y
  out.z = v.z
  return out
}

export function addVec3(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x + b.x
  out.y = a.y + b.y
  out.z = a.z + b.z
  return out
}

export function subVec3(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x - b.x
  out.y = a.y - b.y
  out.z = a.z - b.z
  return out
}

export function scaleVec3(out: Vec3, v: Vec3, s: number): Vec3 {
  out.x = v.x * s
  out.y = v.y * s
  out.z = v.z * s
  return out
}

export function lengthVec3(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
}

export function lengthSqVec3(v: Vec3): number {
  return v.x * v.x + v.y * v.y + v.z * v.z
}

export function distanceVec3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

export function distanceXZ(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

export function normalizeVec3(out: Vec3, v: Vec3): Vec3 {
  const len = lengthVec3(v)
  if (len < 1e-8) {
    out.x = 0
    out.y = 0
    out.z = 0
    return out
  }
  const inv = 1 / len
  out.x = v.x * inv
  out.y = v.y * inv
  out.z = v.z * inv
  return out
}

export function lerpVec3(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  out.x = a.x + (b.x - a.x) * t
  out.y = a.y + (b.y - a.y) * t
  out.z = a.z + (b.z - a.z) * t
  return out
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function yawPitchToDirection(yaw: number, pitch: number, out: Vec3): Vec3 {
  const cp = Math.cos(pitch)
  out.x = Math.sin(yaw) * cp
  out.y = Math.sin(pitch)
  out.z = Math.cos(yaw) * cp
  return out
}

export function forwardFromYaw(yaw: number, out: Vec3): Vec3 {
  out.x = Math.sin(yaw)
  out.y = 0
  out.z = Math.cos(yaw)
  return out
}

export function rightFromYaw(yaw: number, out: Vec3): Vec3 {
  out.x = Math.cos(yaw)
  out.y = 0
  out.z = -Math.sin(yaw)
  return out
}

export interface AABB {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

export function aabbFromCenterSize(
  cx: number,
  cy: number,
  cz: number,
  w: number,
  h: number,
  d: number,
): AABB {
  const hw = w * 0.5
  const hh = h * 0.5
  const hd = d * 0.5
  return {
    minX: cx - hw,
    minY: cy - hh,
    minZ: cz - hd,
    maxX: cx + hw,
    maxY: cy + hh,
    maxZ: cz + hd,
  }
}

export function pointInAABB(p: Vec3, box: AABB, margin = 0): boolean {
  return (
    p.x >= box.minX - margin &&
    p.x <= box.maxX + margin &&
    p.y >= box.minY - margin &&
    p.y <= box.maxY + margin &&
    p.z >= box.minZ - margin &&
    p.z <= box.maxZ + margin
  )
}

export function sphereAABBOverlap(
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  box: AABB,
): boolean {
  const qx = clamp(cx, box.minX, box.maxX)
  const qy = clamp(cy, box.minY, box.maxY)
  const qz = clamp(cz, box.minZ, box.maxZ)
  const dx = cx - qx
  const dy = cy - qy
  const dz = cz - qz
  return dx * dx + dy * dy + dz * dz <= radius * radius
}
