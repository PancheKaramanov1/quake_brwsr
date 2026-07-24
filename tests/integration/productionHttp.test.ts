import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameServer } from '../../server/GameServer.js'
import { PROTOCOL_VERSION } from '../../src/shared/simulation/constants.js'
import { encodeMessage } from '../../src/shared/protocol/codec.js'
import { MessageType, RejectReason } from '../../src/shared/protocol/messages.js'
import {
  connectWs,
  createTestServerConfig,
  getFreePort,
  waitForMessageType,
  wsUrl,
  type WsClient,
} from '../helpers/wsTestUtils.js'

function writeMinimalDist(root: string): void {
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<!doctype html><html><body>prod</body></html>\n',
  )
  fs.writeFileSync(path.join(root, 'assets', 'index-deadbeef.js'), 'export {};\n')
}

describe('production HTTP surface', () => {
  let server: GameServer | null = null
  let fixtureDir: string | null = null
  const clients: WsClient[] = []

  afterEach(async () => {
    while (clients.length > 0) {
      const c = clients.pop()
      if (c) await c.close()
    }
    if (server) {
      await server.shutdown()
      server = null
    }
    if (fixtureDir) {
      fs.rmSync(fixtureDir, { recursive: true, force: true })
      fixtureDir = null
    }
  })

  it('serves client + ops endpoints under production config', async () => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quake-prod-'))
    writeMinimalDist(fixtureDir)
    const port = await getFreePort()
    const origin = `http://127.0.0.1:${port}`
    server = new GameServer(
      createTestServerConfig({
        port,
        publicUrl: origin,
        clientDist: fixtureDir,
        maxPlayers: 12,
        isProduction: true,
        allowedOrigins: [origin],
      }),
    )
    await server.start()

    expect((await fetch(`${origin}/`)).status).toBe(200)
    expect((await fetch(`${origin}/assets/index-deadbeef.js`)).status).toBe(200)
    expect((await fetch(`${origin}/health`)).status).toBe(200)
    expect((await fetch(`${origin}/ready`)).status).toBe(200)

    const status = await (await fetch(`${origin}/status`)).json()
    const serverStatus = await (await fetch(`${origin}/server-status`)).json()
    expect(status).toEqual(serverStatus)

    expect((await fetch(`${origin}/api/nope`)).status).toBe(404)
    expect((await fetch(`${origin}/lobby`)).status).toBe(200)
    expect([403, 404]).toContain((await fetch(`${origin}/../package.json`)).status)

    const { default: WebSocket } = await import('ws')
    const socket = new WebSocket(wsUrl(port), {
      headers: { Origin: origin },
    })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ws timeout')), 3000)
      socket.once('open', () => {
        clearTimeout(timer)
        resolve()
      })
      socket.once('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
    clients.push({
      socket,
      close: () =>
        new Promise<void>((resolve) => {
          socket.once('close', () => resolve())
          socket.close()
          setTimeout(resolve, 500)
        }),
    })
  }, 20_000)

  it('rejects wrong Origin and the 13th player', async () => {
    const port = await getFreePort()
    const origin = `http://127.0.0.1:${port}`
    server = new GameServer(
      createTestServerConfig({
        port,
        publicUrl: origin,
        maxPlayers: 12,
        isProduction: false,
        allowedOrigins: [origin],
      }),
    )
    await server.start()

    const { default: WebSocket } = await import('ws')
    const bad = new WebSocket(wsUrl(port), { headers: { Origin: 'http://evil.example' } })
    const badResult = await new Promise<'open' | 'error'>((resolve) => {
      bad.once('open', () => resolve('open'))
      bad.once('unexpected-response', () => resolve('error'))
      bad.once('error', () => resolve('error'))
      setTimeout(() => resolve('error'), 3000)
    })
    expect(badResult).toBe('error')
    try {
      bad.terminate()
    } catch {
      // ignore
    }

    for (let i = 0; i < 12; i += 1) {
      const c = await connectWs(wsUrl(port), 5000)
      clients.push(c)
      c.socket.send(
        encodeMessage(MessageType.Hello, {
          protocolVersion: PROTOCOL_VERSION,
          displayName: `P${i}`,
        }),
      )
      await waitForMessageType(c.socket, MessageType.Welcome, 5000)
    }

    const thirteenth = await connectWs(wsUrl(port), 5000)
    clients.push(thirteenth)
    thirteenth.socket.send(
      encodeMessage(MessageType.Hello, {
        protocolVersion: PROTOCOL_VERSION,
        displayName: 'P12',
      }),
    )
    const reject = await waitForMessageType(thirteenth.socket, MessageType.Reject, 5000)
    expect(reject.type).toBe(MessageType.Reject)
    if (reject.type === MessageType.Reject) {
      expect(reject.payload.reason).toBe(RejectReason.Full)
    }
  }, 60_000)
})
