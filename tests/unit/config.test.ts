import { describe, expect, it } from 'vitest'
import {
  loadServerConfig,
  parseListenPort,
  resolveListenPort,
  resolvePublicUrl,
  normalizePublicUrl,
} from '../../server/config.js'
import { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT } from '../../src/shared/simulation/constants.js'

describe('loadServerConfig port + public URL', () => {
  it('prefers PORT over SERVER_PORT', () => {
    const cfg = loadServerConfig({
      PORT: '3456',
      SERVER_PORT: '8080',
      ALLOWED_ORIGINS: 'http://localhost:3000',
    })
    expect(cfg.port).toBe(3456)
  })

  it('uses SERVER_PORT when PORT is absent', () => {
    const cfg = loadServerConfig({
      SERVER_PORT: '9090',
      ALLOWED_ORIGINS: 'http://localhost:3000',
    })
    expect(cfg.port).toBe(9090)
  })

  it('defaults to 8080 when both PORT and SERVER_PORT are absent', () => {
    expect(resolveListenPort({})).toBe(DEFAULT_SERVER_PORT)
    const cfg = loadServerConfig({ ALLOWED_ORIGINS: 'http://localhost:3000' })
    expect(cfg.port).toBe(8080)
  })

  it('rejects invalid port strings', () => {
    expect(() => parseListenPort('abc', 8080)).toThrow(/Invalid listen port/)
    expect(() => resolveListenPort({ PORT: 'nope' })).toThrow(/Invalid listen port/)
  })

  it('rejects decimal port values', () => {
    expect(() => parseListenPort('8080.5', 8080)).toThrow(/Invalid listen port/)
    expect(() => resolveListenPort({ PORT: '80.1' })).toThrow(/Invalid listen port/)
  })

  it('rejects negative port values', () => {
    expect(() => parseListenPort('-1', 8080)).toThrow(/Invalid listen port/)
    expect(() => resolveListenPort({ SERVER_PORT: '-5' })).toThrow(/Invalid listen port/)
  })

  it('rejects ports above 65535', () => {
    expect(() => parseListenPort('65536', 8080)).toThrow(/Invalid listen port/)
    expect(() => resolveListenPort({ PORT: '70000' })).toThrow(/Invalid listen port/)
  })

  it('rejects port 0', () => {
    expect(() => parseListenPort('0', 8080)).toThrow(/Invalid listen port/)
  })

  it('defaults host to 0.0.0.0', () => {
    const cfg = loadServerConfig({ ALLOWED_ORIGINS: 'http://localhost:3000' })
    expect(cfg.host).toBe(DEFAULT_SERVER_HOST)
    expect(cfg.host).toBe('0.0.0.0')
  })

  it('prefers PUBLIC_SERVER_URL', () => {
    const url = resolvePublicUrl(
      {
        PUBLIC_SERVER_URL: 'https://play.example.com/',
        RAILWAY_PUBLIC_DOMAIN: 'ignored.up.railway.app',
      },
      '0.0.0.0',
      8080,
    )
    expect(url).toBe('https://play.example.com')
  })

  it('derives https URL from RAILWAY_PUBLIC_DOMAIN', () => {
    const url = resolvePublicUrl(
      { RAILWAY_PUBLIC_DOMAIN: 'my-service.up.railway.app' },
      '0.0.0.0',
      8080,
    )
    expect(url).toBe('https://my-service.up.railway.app')
  })

  it('normalizes public URLs safely', () => {
    expect(normalizePublicUrl('https://a.example.com/path/')).toBe('https://a.example.com')
    expect(() => normalizePublicUrl('not a url')).toThrow(/Invalid public URL/)
    expect(() => normalizePublicUrl('ftp://x')).toThrow(/Invalid public URL protocol/)
  })

  it('rejects empty ALLOWED_ORIGINS in production', () => {
    expect(() =>
      loadServerConfig({
        NODE_ENV: 'production',
        ALLOWED_ORIGINS: '',
        PORT: '8080',
      }),
    ).toThrow(/empty ALLOWED_ORIGINS/)
  })

  it('rejects ALLOWED_ORIGINS=* in production', () => {
    expect(() =>
      loadServerConfig({
        NODE_ENV: 'production',
        ALLOWED_ORIGINS: '*',
        PORT: '8080',
      }),
    ).toThrow(/ALLOWED_ORIGINS=\*/)
  })

  it('rejects MAX_PLAYERS above protocol cap', () => {
    expect(() =>
      loadServerConfig({
        MAX_PLAYERS: '99',
        ALLOWED_ORIGINS: 'http://localhost:3000',
      }),
    ).toThrow(/MAX_PLAYERS/)
  })

  it('rejects invalid WS_PATH', () => {
    expect(() =>
      loadServerConfig({
        WS_PATH: 'ws',
        ALLOWED_ORIGINS: 'http://localhost:3000',
      }),
    ).toThrow(/WS_PATH/)
  })
})
