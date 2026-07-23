import { TICK_DT, TICK_RATE } from './constants.js'

/** Fixed-timestep accumulator for frame-rate independent simulation. */
export class FixedTimestep {
  private accumulator = 0
  readonly dt: number
  readonly maxSubSteps: number

  constructor(dt = TICK_DT, maxSubSteps = 8) {
    this.dt = dt
    this.maxSubSteps = maxSubSteps
  }

  reset(): void {
    this.accumulator = 0
  }

  /**
   * Advance simulation by wall-clock delta (seconds).
   * Returns number of steps executed.
   * Caps catch-up to avoid spiral-of-death after tab suspension.
   */
  advance(frameDt: number, step: (dt: number) => void): number {
    const clamped = Math.min(Math.max(frameDt, 0), this.dt * this.maxSubSteps)
    this.accumulator += clamped
    let steps = 0
    while (this.accumulator >= this.dt && steps < this.maxSubSteps) {
      step(this.dt)
      this.accumulator -= this.dt
      steps += 1
    }
    if (this.accumulator > this.dt * this.maxSubSteps) {
      this.accumulator = 0
    }
    return steps
  }

  get alpha(): number {
    return this.accumulator / this.dt
  }
}

export function ticksToSeconds(ticks: number, tickRate = TICK_RATE): number {
  return ticks / tickRate
}

export function secondsToTicks(seconds: number, tickRate = TICK_RATE): number {
  return Math.round(seconds * tickRate)
}
