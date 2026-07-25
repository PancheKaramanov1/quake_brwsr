/** Process-local instance identifiers for diagnostics (never secrets). */

import { randomBytes } from 'node:crypto'
import { BUILD_VERSION } from '../src/shared/simulation/constants.js'

/** Created once when the Node process constructs GameServer. */
export function createServerInstanceId(): string {
  return randomBytes(6).toString('hex')
}

/** Created once when MatchInstance is constructed. */
export function createMatchInstanceId(): string {
  return randomBytes(6).toString('hex')
}

export function getBuildVersion(): string {
  return BUILD_VERSION
}
