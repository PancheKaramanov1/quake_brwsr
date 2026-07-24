import { describe, expect, it, vi } from 'vitest'
import { SecurityLogger } from '../../server/security/SecurityLogger.js'

describe('SecurityLogger privacy', () => {
  it('does not log IPv4, IPv6, reconnect tokens, player names, or raw payloads', () => {
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '))
    })

    const log = new SecurityLogger(true)
    log.rejectedConnection('origin', 'a1b2c3d4')
    log.invalidMessage('4', 'a1b2c3d4')
    log.rateLimit(3, 'input')
    log.movementViolation(3, 'tick_skew')
    log.weaponViolation(3, 'fire_rate')
    log.info('match_started player_count=8')
    log.info('match_ended duration_seconds=600')

    spy.mockRestore()
    const joined = lines.join('\n')

    expect(joined).toMatch(/connection_rejected reason=origin/)
    expect(joined).toMatch(/protocol_error message_type=4/)
    expect(joined).toMatch(/rate_limit_violation category=input/)
    expect(joined).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/)
    expect(joined).not.toMatch(/::/)
    expect(joined).not.toMatch(/2001:db8/i)
    expect(joined).not.toMatch(/reconnect/i)
    expect(joined).not.toMatch(/displayName|player_name|Alice|Bob/i)
    expect(joined).not.toMatch(/payload|packet|chat/i)
    expect(joined).not.toMatch(/addr=/)
  })
})
