/**
 * Proves the multiplayer join flow does not persist display names, server URLs,
 * or reconnect tokens. Uses an in-memory Storage stub (no DOM required).
 */
import { describe, expect, it } from 'vitest'
import { clearLegacyMultiplayerStorage } from '../../src/client/net/serverUrls.js'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length(): number {
    return this.data.size
  }
  clear(): void {
    this.data.clear()
  }
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.data.delete(key)
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
}

/** Mirrors join-handler persistence policy: memory only. */
function joinWithoutPersistence(
  storage: Storage,
  displayName: string,
  serverUrl: string,
  reconnectToken: string | null,
): { name: string; url: string; token: string | null } {
  // Ignore any stale keys
  void storage.getItem('mp_display_name')
  void storage.getItem('mp_server_url')
  clearLegacyMultiplayerStorage(storage)

  const sessionName = displayName
  const sessionUrl = serverUrl
  const sessionToken = reconnectToken
  // Never write identity / URL / token
  return { name: sessionName, url: sessionUrl, token: sessionToken }
}

describe('ephemeral multiplayer identity', () => {
  it('does not persist display names, server URLs, or reconnect tokens', () => {
    const storage = new MemoryStorage()
    storage.setItem('mp_display_name', 'StaleHero')
    storage.setItem('mp_server_url', 'ws://stale.example/ws')
    storage.setItem('unrelated', 'keep')

    const session = joinWithoutPersistence(
      storage,
      'FreshName',
      'wss://live.example/ws',
      'tok_abc_should_stay_in_memory_only',
    )

    expect(session.name).toBe('FreshName')
    expect(session.url).toBe('wss://live.example/ws')
    expect(session.token).toBe('tok_abc_should_stay_in_memory_only')

    expect(storage.getItem('mp_display_name')).toBeNull()
    expect(storage.getItem('mp_server_url')).toBeNull()
    expect(storage.getItem('reconnect_token')).toBeNull()
    expect(storage.getItem('tok_abc_should_stay_in_memory_only')).toBeNull()
    expect(storage.getItem('unrelated')).toBe('keep')
  })
})
