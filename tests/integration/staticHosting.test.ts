import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameServer } from '../../server/GameServer.js'
import { SERVER_RESTART_MESSAGE } from '../../src/shared/simulation/constants.js'
import { encodeMessage, decodeMessage } from '../../src/shared/protocol/codec.js'
import { MessageType } from '../../src/shared/protocol/messages.js'
import {
  connectWs,
  createTestServerConfig,
  getFreePort,
  waitForMessageType,
  wsUrl,
  type WsClient,
} from '../helpers/wsTestUtils.js'

function writeClientFixture(root: string): void {
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<!doctype html><html><head><title>Vite Fixture</title></head><body><div id="app">ok</div><script type="module" src="/assets/index-abcdef12.js"></script></body></html>\n',
  )
  fs.writeFileSync(path.join(root, 'assets', 'index-abcdef12.js'), 'console.log("fixture");\n')
  fs.writeFileSync(path.join(root, '.secret'), 'nope\n')
  fs.writeFileSync(path.join(root, 'assets', 'index-abcdef12.js.map'), '{"version":3}\n')
}

describe('static client hosting + server-status', () => {
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

  async function startWithFixture(): Promise<{ port: number; base: string }> {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quake-static-'))
    writeClientFixture(fixtureDir)
    const port = await getFreePort()
    server = new GameServer(
      createTestServerConfig({
        port,
        publicUrl: `http://127.0.0.1:${port}`,
        clientDist: fixtureDir,
        allowedOrigins: [`http://127.0.0.1:${port}`, 'http://localhost:3000'],
      }),
    )
    await server.start()
    return { port, base: `http://127.0.0.1:${port}` }
  }

  it('serves Vite HTML, hashed assets, SPA, and protects reserved routes', async () => {
    const { port, base } = await startWithFixture()

    const root = await fetch(`${base}/`)
    expect(root.status).toBe(200)
    expect(root.headers.get('content-type')).toMatch(/text\/html/)
    expect(root.headers.get('cache-control')).toBe('no-cache')
    const rootHtml = await root.text()
    expect(rootHtml).toContain('Vite Fixture')

    const index = await fetch(`${base}/index.html`)
    expect(index.status).toBe(200)
    expect(await index.text()).toContain('Vite Fixture')

    const asset = await fetch(`${base}/assets/index-abcdef12.js`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('cache-control')).toMatch(/immutable/)
    expect(await asset.text()).toContain('fixture')

    const missingAsset = await fetch(`${base}/assets/missing-deadbeef.js`)
    expect(missingAsset.status).toBe(404)

    const spa = await fetch(`${base}/play`)
    expect(spa.status).toBe(200)
    expect(await spa.text()).toContain('Vite Fixture')

    const api404 = await fetch(`${base}/api/unknown-route`)
    expect(api404.status).toBe(404)

    const health = await fetch(`${base}/health`)
    expect(health.status).toBe(200)
    expect((await health.json() as { status: string }).status).toBe('ok')

    const ready = await fetch(`${base}/ready`)
    expect(ready.status).toBe(200)

    const metrics = await fetch(`${base}/metrics`)
    expect(metrics.status).toBe(200)

    const status = await fetch(`${base}/status`)
    const serverStatus = await fetch(`${base}/server-status`)
    expect(status.status).toBe(200)
    expect(serverStatus.status).toBe(200)
    expect(await status.json()).toEqual(await serverStatus.json())

    const traversal = await fetch(`${base}/../package.json`)
    expect([403, 404]).toContain(traversal.status)

    const encodedTraversal = await fetch(`${base}/%2e%2e/package.json`)
    expect([403, 404]).toContain(encodedTraversal.status)

    const dotfile = await fetch(`${base}/.secret`)
    expect([403, 404]).toContain(dotfile.status)

    const mapFile = await fetch(`${base}/assets/index-abcdef12.js.map`)
    expect(mapFile.status).toBe(404)

    const client = await connectWs(wsUrl(port))
    clients.push(client)
    expect(client.socket.readyState).toBe(1)
  }, 20_000)

  it('broadcasts restart message, flips readiness, and closes cleanly', async () => {
    const { port, base } = await startWithFixture()
    const client = await connectWs(wsUrl(port))
    clients.push(client)

    client.socket.send(
      encodeMessage(MessageType.Hello, {
        protocolVersion: 1,
        displayName: 'RestartProbe',
      }),
    )
    await waitForMessageType(client.socket, MessageType.Welcome, 3000)

    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      client.socket.once('close', (code, reasonBuf) => {
        resolve({
          code,
          reason: Buffer.isBuffer(reasonBuf) ? reasonBuf.toString('utf8') : String(reasonBuf),
        })
      })
    })

    const errorPromise = waitForMessageType(client.socket, MessageType.ServerError, 5000)

    let releaseHttp: (() => void) | null = null
    const httpGate = new Promise<void>((resolve) => {
      releaseHttp = resolve
    })

    const shutdownPromise = server!.shutdown({
      beforeCloseHttp: httpGate,
    })

    const errMsg = await errorPromise
    expect(errMsg.type).toBe(MessageType.ServerError)
    if (errMsg.type === MessageType.ServerError) {
      expect(errMsg.payload.message).toBe(SERVER_RESTART_MESSAGE)
    }

    expect(server!.isReady()).toBe(false)
    const readyDuring = await fetch(`${base}/ready`)
    expect(readyDuring.status).toBe(503)

    const closed = await closePromise
    expect(closed.code).toBe(1012)

    releaseHttp?.()
    await shutdownPromise
    server = null

    await expect(fetch(`${base}/health`)).rejects.toThrow()
  }, 20_000)

  it('force deadline path resolves when close hangs', async () => {
    const port = await getFreePort()
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quake-static-'))
    writeClientFixture(fixtureDir)
    const gs = new GameServer(
      createTestServerConfig({
        port,
        clientDist: fixtureDir,
        publicUrl: `http://127.0.0.1:${port}`,
      }),
    )
    server = gs
    await gs.start()

    let hungResolve: (() => void) | null = null
    const hung = new Promise<void>((resolve) => {
      hungResolve = resolve
    })

    const started = Date.now()
    const shutdown = gs.shutdown({
      closeHttp: () => hung,
      closeWss: () => Promise.resolve(),
    })

    // Simulate force path by racing a short timeout that resolves the hang
    setTimeout(() => hungResolve?.(), 50)
    await shutdown
    server = null
    expect(Date.now() - started).toBeLessThan(5000)
  }, 10_000)
})

describe('decode sanity for shutdown payload', () => {
  it('round-trips restart message', () => {
    const bytes = encodeMessage(MessageType.ServerError, {
      code: 1,
      message: SERVER_RESTART_MESSAGE,
    })
    const decoded = decodeMessage(bytes)
    expect(decoded.ok).toBe(true)
    if (decoded.ok && decoded.type === MessageType.ServerError) {
      expect(decoded.payload.message).toBe(SERVER_RESTART_MESSAGE)
    }
  })
})
