import { describe, expect, it } from 'vitest'
import {
  clearLegacyMultiplayerStorage,
  isLocalHostname,
  normalizeWsPath,
  resolveDefaultHttpBase,
  resolveDefaultServerUrl,
  wsUrlFromPublicStatus,
} from '../../src/client/net/serverUrls.js'

describe('resolveDefaultServerUrl', () => {
  it('maps HTTPS production origin to wss://host/ws', () => {
    expect(
      resolveDefaultServerUrl({
        protocol: 'https:',
        host: 'game.example.com',
        hostname: 'game.example.com',
        origin: 'https://game.example.com',
      }),
    ).toBe('wss://game.example.com/ws')
  })

  it('maps HTTP production origin to ws://host/ws', () => {
    expect(
      resolveDefaultServerUrl({
        protocol: 'http:',
        host: 'play.example.com:8080',
        hostname: 'play.example.com',
        origin: 'http://play.example.com:8080',
      }),
    ).toBe('ws://play.example.com:8080/ws')
  })

  it('uses local development default on localhost', () => {
    expect(
      resolveDefaultServerUrl({
        protocol: 'http:',
        host: 'localhost:3000',
        hostname: 'localhost',
        origin: 'http://localhost:3000',
      }),
    ).toBe('ws://localhost:8080/ws')
  })

  it('uses local development default on 127.0.0.1', () => {
    expect(
      resolveDefaultServerUrl({
        protocol: 'http:',
        host: '127.0.0.1:3000',
        hostname: '127.0.0.1',
        origin: 'http://127.0.0.1:3000',
      }),
    ).toBe('ws://localhost:8080/ws')
  })

  it('honors explicit development override', () => {
    expect(
      resolveDefaultServerUrl(
        {
          protocol: 'http:',
          host: 'localhost:3000',
          hostname: 'localhost',
          origin: 'http://localhost:3000',
        },
        { VITE_GAME_SERVER_URL: 'ws://127.0.0.1:9090/custom' },
      ),
    ).toBe('ws://127.0.0.1:9090/custom')
  })

  it('supports custom Railway-style hostnames without rebuild', () => {
    expect(
      resolveDefaultServerUrl({
        protocol: 'https:',
        host: 'my-app.up.railway.app',
        hostname: 'my-app.up.railway.app',
        origin: 'https://my-app.up.railway.app',
      }),
    ).toBe('wss://my-app.up.railway.app/ws')
  })

  it('normalizes websocket path', () => {
    expect(normalizeWsPath('ws')).toBe('/ws')
    expect(normalizeWsPath('/game')).toBe('/game')
    expect(
      resolveDefaultServerUrl(
        {
          protocol: 'https:',
          host: 'a.example',
          hostname: 'a.example',
          origin: 'https://a.example',
        },
        {},
        '/custom',
      ),
    ).toBe('wss://a.example/custom')
  })
})

describe('resolveDefaultHttpBase', () => {
  it('uses page origin in production', () => {
    expect(
      resolveDefaultHttpBase({
        protocol: 'https:',
        host: 'game.example.com',
        hostname: 'game.example.com',
        origin: 'https://game.example.com',
      }),
    ).toBe('https://game.example.com')
  })

  it('uses local HTTP base on localhost', () => {
    expect(
      resolveDefaultHttpBase({
        protocol: 'http:',
        host: 'localhost:3000',
        hostname: 'localhost',
        origin: 'http://localhost:3000',
      }),
    ).toBe('http://localhost:8080')
  })
})

describe('wsUrlFromPublicStatus + storage cleanup', () => {
  it('builds wss from https publicUrl', () => {
    expect(
      wsUrlFromPublicStatus(
        { publicUrl: 'https://x.example.com', wsPath: '/ws' },
        'http://localhost:8080',
        'ws://localhost:8080/ws',
      ),
    ).toBe('wss://x.example.com/ws')
  })

  it('clears legacy localStorage keys without writing new ones', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v)
      },
      removeItem: (k: string) => {
        store.delete(k)
      },
    } as Storage
    store.set('mp_display_name', 'Old')
    store.set('mp_server_url', 'ws://old')
    clearLegacyMultiplayerStorage(storage)
    expect(store.has('mp_display_name')).toBe(false)
    expect(store.has('mp_server_url')).toBe(false)
  })

  it('detects local hostnames', () => {
    expect(isLocalHostname('localhost')).toBe(true)
    expect(isLocalHostname('127.0.0.1')).toBe(true)
    expect(isLocalHostname('play.example.com')).toBe(false)
  })
})
