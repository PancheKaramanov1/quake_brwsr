import { describe, expect, it } from 'vitest'
import {
  aabbFromCenterSize,
  clamp,
  distanceVec3,
  lerp,
  normalizeVec3,
  pointInAABB,
  sphereAABBOverlap,
  vec3,
} from '../../src/shared/simulation/math.js'

describe('clamp', () => {
  it('passes values through when already in range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })

  it('clamps to the minimum', () => {
    expect(clamp(-5, 0, 10)).toBe(0)
  })

  it('clamps to the maximum', () => {
    expect(clamp(15, 0, 10)).toBe(10)
  })
})

describe('lerp', () => {
  it('returns a at t=0 and b at t=1', () => {
    expect(lerp(2, 8, 0)).toBe(2)
    expect(lerp(2, 8, 1)).toBe(8)
  })

  it('interpolates at the midpoint', () => {
    expect(lerp(0, 10, 0.5)).toBe(5)
  })
})

describe('distanceVec3', () => {
  it('is zero for coincident points', () => {
    expect(distanceVec3(vec3(1, 2, 3), vec3(1, 2, 3))).toBe(0)
  })

  it('computes euclidean distance', () => {
    expect(distanceVec3(vec3(0, 0, 0), vec3(3, 4, 0))).toBe(5)
  })
})

describe('normalizeVec3', () => {
  it('produces a unit-length vector', () => {
    const out = vec3()
    normalizeVec3(out, vec3(3, 0, 4))
    expect(out.x).toBeCloseTo(0.6)
    expect(out.y).toBeCloseTo(0)
    expect(out.z).toBeCloseTo(0.8)
  })

  it('returns the zero vector for a near-zero-length input instead of dividing by zero', () => {
    const out = vec3(9, 9, 9)
    normalizeVec3(out, vec3(0, 0, 0))
    expect(out).toEqual({ x: 0, y: 0, z: 0 })
  })
})

describe('aabbFromCenterSize + pointInAABB', () => {
  it('builds a box centered on the given point with the given extents', () => {
    const box = aabbFromCenterSize(0, 0, 0, 2, 4, 6)
    expect(box).toEqual({ minX: -1, minY: -2, minZ: -3, maxX: 1, maxY: 2, maxZ: 3 })
  })

  it('reports points inside and outside the box', () => {
    const box = aabbFromCenterSize(0, 0, 0, 2, 2, 2)
    expect(pointInAABB(vec3(0, 0, 0), box)).toBe(true)
    expect(pointInAABB(vec3(2, 0, 0), box)).toBe(false)
  })

  it('honors the margin', () => {
    const box = aabbFromCenterSize(0, 0, 0, 2, 2, 2)
    expect(pointInAABB(vec3(1.5, 0, 0), box, 0.5)).toBe(true)
    expect(pointInAABB(vec3(1.5, 0, 0), box)).toBe(false)
  })
})

describe('sphereAABBOverlap', () => {
  it('detects overlap when the sphere touches the box', () => {
    const box = aabbFromCenterSize(0, 0, 0, 2, 2, 2)
    expect(sphereAABBOverlap(2, 0, 0, 1, box)).toBe(true)
  })

  it('detects no overlap when the sphere is far from the box', () => {
    const box = aabbFromCenterSize(0, 0, 0, 2, 2, 2)
    expect(sphereAABBOverlap(10, 0, 0, 1, box)).toBe(false)
  })
})
