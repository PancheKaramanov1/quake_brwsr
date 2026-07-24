/** Babylon.js multiplayer session: arena, prediction, remotes, HUD. */

import {
  Color3,
  Engine,
  FreeCamera,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core'
import { InputManager } from '../InputManager.js'
import type { InputState } from '../types.js'
import {
  MatchPhase,
  MessageType,
  type ProjectileImpactPayload,
  type ProjectileSpawnPayload,
  type SnapshotPayload,
  type StandingEntry,
} from '../shared/protocol/messages.js'
import {
  MAX_PITCH,
  MOUSE_SENSITIVITY,
  PLAYER_EYE_OFFSET,
  PLAYER_HEIGHT,
  SERVER_RESTART_MESSAGE,
  TICK_DT,
  WS_CLOSE_SERVICE_RESTART,
} from '../shared/simulation/constants.js'
import { ARENA_MAP, buildAABBs, type MapBox } from '../shared/simulation/mapDefinition.js'
import { FixedTimestep } from '../shared/simulation/fixedTimestep.js'
import {
  createPlayerSimState,
  type PlayerSimState,
} from '../shared/simulation/playerMovement.js'
import { GameClient } from './net/GameClient.js'
import { SnapshotInterpolator } from './net/interpolation.js'
import {
  ClientPrediction,
  simStateFromAuthoritative,
  type PendingInput,
} from './net/prediction.js'
import { MultiplayerMenu } from './ui/MultiplayerMenu.js'

const PLAYER_COLORS: ReadonlyArray<Color3> = [
  new Color3(0.9, 0.25, 0.2),
  new Color3(0.2, 0.55, 0.95),
  new Color3(0.2, 0.8, 0.35),
  new Color3(0.95, 0.75, 0.15),
  new Color3(0.75, 0.3, 0.9),
  new Color3(0.15, 0.8, 0.85),
  new Color3(0.95, 0.45, 0.1),
  new Color3(0.55, 0.55, 0.95),
]

function kindColor(kind: MapBox['kind']): Color3 {
  switch (kind) {
    case 'wall':
      return new Color3(0.55, 0.53, 0.5)
    case 'platform':
      return new Color3(0.4, 0.55, 0.42)
    case 'ramp':
      return new Color3(0.5, 0.48, 0.35)
    case 'cover':
      return new Color3(0.45, 0.4, 0.35)
    case 'structure':
      return new Color3(0.5, 0.5, 0.55)
    case 'boundary':
      return new Color3(0.35, 0.36, 0.38)
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

interface RemoteVisual {
  mesh: Mesh
  material: StandardMaterial
}

interface RocketVisual {
  mesh: Mesh
  id: number
}

interface ExplosionFx {
  mesh: Mesh
  age: number
}

export class MultiplayerGame {
  private engine: Engine
  private scene: Scene
  private camera: FreeCamera
  private input: InputManager
  private client: GameClient
  private prediction: ClientPrediction
  private interpolator = new SnapshotInterpolator()
  private timestep = new FixedTimestep()
  private menu: MultiplayerMenu | null = null

  private arenaMeshes: Mesh[] = []
  private remotes = new Map<number, RemoteVisual>()
  private rockets = new Map<number, RocketVisual>()
  private explosions: ExplosionFx[] = []
  private materialCache = new Map<string, StandardMaterial>()

  private yaw = 0
  private pitch = 0
  private reloadHeld = false
  private crouchHeld = false
  private tabHeld = false
  private showPerf = false
  private showScoreboard = false
  private disposed = false
  private running = false
  private lastFrameMs = 0
  private fps = 0
  private fpsAccum = 0
  private fpsFrames = 0

  private hudRoot: HTMLDivElement
  private hudHealth: HTMLSpanElement
  private hudAmmo: HTMLSpanElement
  private hudScore: HTMLSpanElement
  private hudTimer: HTMLSpanElement
  private hudPlayers: HTMLSpanElement
  private hudPing: HTMLSpanElement
  private hudKillFeed: HTMLDivElement
  private scoreboardEl: HTMLDivElement
  private perfEl: HTMLDivElement
  private resultsShown = false
  private serverRestartHandled = false

  private unsubSnapshot: (() => void) | null = null
  private unsubEvent: (() => void) | null = null
  private keyDownHandler: ((e: KeyboardEvent) => void) | null = null
  private keyUpHandler: ((e: KeyboardEvent) => void) | null = null

  constructor(
    canvas: HTMLCanvasElement,
    private readonly overlayParent: HTMLElement = document.body,
  ) {
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
    })
    this.scene = new Scene(this.engine)
    this.scene.fogMode = Scene.FOGMODE_EXP2
    this.scene.fogDensity = 0.002
    this.scene.clearColor.set(0.08, 0.1, 0.12, 1)

    const light = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.15), this.scene)
    light.intensity = 0.95

    this.buildArena()

    const spawn = ARENA_MAP.spawns[0]
    const start = new Vector3(spawn?.x ?? 0, (spawn?.y ?? 1) + PLAYER_EYE_OFFSET, spawn?.z ?? 0)
    this.camera = new FreeCamera('mpCam', start, this.scene)
    this.camera.inputs.clear()
    this.scene.activeCamera = this.camera
    this.yaw = spawn?.yaw ?? 0
    this.pitch = 0

    this.input = new InputManager(canvas)

    const colliders = buildAABBs(ARENA_MAP)
    const initial = createPlayerSimState(
      { x: spawn?.x ?? 0, y: spawn?.y ?? 1, z: spawn?.z ?? 0 },
      spawn?.yaw ?? 0,
    )
    this.prediction = new ClientPrediction(initial, colliders, ARENA_MAP.bounds.floorY)
    this.client = new GameClient()

    const hud = this.createHud()
    this.hudRoot = hud.root
    this.hudHealth = hud.health
    this.hudAmmo = hud.ammo
    this.hudScore = hud.score
    this.hudTimer = hud.timer
    this.hudPlayers = hud.players
    this.hudPing = hud.ping
    this.hudKillFeed = hud.killFeed
    this.scoreboardEl = hud.scoreboard
    this.perfEl = hud.perf

    this.bindKeys()
    this.bindNet()
  }

  /** Show entry menu; starts session after Connect. */
  showMenu(onSinglePlayer: () => void): MultiplayerMenu {
    this.menu?.dispose()
    this.menu = new MultiplayerMenu(this.overlayParent, {
      onSinglePlayer,
      onConnect: (name, url) => {
        void this.startSession(url, name)
      },
    })
    return this.menu
  }

  async startSession(url: string, displayName: string): Promise<void> {
    try {
      this.serverRestartHandled = false
      await this.client.connect(url, displayName)
      this.menu?.hide()
      this.hudRoot.style.display = 'block'
      this.running = true
      this.lastFrameMs = performance.now()
      this.engine.runRenderLoop(() => this.frame())
      window.addEventListener('resize', this.onResize)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connect failed'
      this.menu?.showReject(msg)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.running = false
    this.engine.stopRenderLoop()
    window.removeEventListener('resize', this.onResize)
    if (this.keyDownHandler) window.removeEventListener('keydown', this.keyDownHandler)
    if (this.keyUpHandler) window.removeEventListener('keyup', this.keyUpHandler)
    this.unsubSnapshot?.()
    this.unsubEvent?.()
    this.client.dispose()
    this.menu?.dispose()
    this.hudRoot.remove()
    for (const m of this.arenaMeshes) m.dispose()
    for (const r of this.remotes.values()) r.mesh.dispose()
    for (const r of this.rockets.values()) r.mesh.dispose()
    for (const e of this.explosions) e.mesh.dispose()
    this.scene.dispose()
    this.engine.dispose()
  }

  private onResize = (): void => {
    this.engine.resize()
  }

  private bindNet(): void {
    this.unsubSnapshot = this.client.onSnapshot((snap) => this.onSnapshot(snap))
    this.unsubEvent = this.client.onEvent((type, payload) => {
      switch (type) {
        case MessageType.Reject:
          this.menu?.show()
          this.menu?.showReject(
            typeof payload === 'object' && payload !== null && 'message' in payload
              ? String((payload as { message: string }).message)
              : 'Rejected',
          )
          this.running = false
          break
        case MessageType.Welcome:
          this.client.sendReady()
          break
        case MessageType.LocalCorrection: {
          const c = payload as {
            ackSeq: number
            x: number
            y: number
            z: number
            vx: number
            vy: number
            vz: number
            yaw: number
            pitch: number
          }
          this.prediction.reconcile(
            c.ackSeq,
            simStateFromAuthoritative({ ...c, alive: true }),
          )
          break
        }
        case MessageType.ProjectileSpawn:
          this.spawnRocket(payload as ProjectileSpawnPayload)
          break
        case MessageType.ProjectileImpact:
          this.impactRocket(payload as ProjectileImpactPayload)
          break
        case MessageType.MatchEnded: {
          const standings =
            typeof payload === 'object' &&
            payload !== null &&
            'standings' in payload
              ? ((payload as { standings: StandingEntry[] }).standings ?? [])
              : []
          this.showResults(standings)
          break
        }
        case MessageType.ServerError: {
          const message =
            typeof payload === 'object' &&
            payload !== null &&
            'message' in payload
              ? String((payload as { message: string }).message)
              : SERVER_RESTART_MESSAGE
          this.handleServerRestart(message)
          break
        }
        case MessageType.Disconnect: {
          const reason =
            typeof payload === 'object' &&
            payload !== null &&
            'reason' in payload
              ? String((payload as { reason: string }).reason)
              : ''
          if (
            reason === SERVER_RESTART_MESSAGE ||
            reason === 'service_restart' ||
            reason === `code_${WS_CLOSE_SERVICE_RESTART}` ||
            reason.includes(String(WS_CLOSE_SERVICE_RESTART)) ||
            this.client.rejectReason === SERVER_RESTART_MESSAGE
          ) {
            this.handleServerRestart(SERVER_RESTART_MESSAGE)
          } else {
            this.running = false
            this.hudRoot.style.display = 'none'
            this.prediction.clear()
            this.interpolator.clear()
            this.menu?.show()
            this.menu?.showReconnectStatus('Disconnected — reconnect from Multiplayer')
          }
          break
        }
        default:
          break
      }
    })
  }

  private handleServerRestart(message: string): void {
    if (this.serverRestartHandled) return
    this.serverRestartHandled = true
    this.running = false
    this.hudRoot.style.display = 'none'
    this.prediction.clear()
    this.interpolator.clear()
    this.client.clearSessionCredentials()
    try {
      this.client.disconnect('server_restart')
    } catch {
      // already closed
    }
    this.menu?.showServerRestart()
    if (message && message !== SERVER_RESTART_MESSAGE) {
      this.menu?.setStatus(message, true)
    }
  }

  private bindKeys(): void {
    this.keyDownHandler = (e: KeyboardEvent) => {
      if (e.code === 'KeyR') this.reloadHeld = true
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') this.crouchHeld = true
      if (e.code === 'Tab') {
        e.preventDefault()
        this.tabHeld = true
        this.showScoreboard = true
      }
      if (e.code === 'F3') {
        e.preventDefault()
        this.showPerf = !this.showPerf
        this.perfEl.style.display = this.showPerf ? 'block' : 'none'
      }
    }
    this.keyUpHandler = (e: KeyboardEvent) => {
      if (e.code === 'KeyR') this.reloadHeld = false
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') this.crouchHeld = false
      if (e.code === 'Tab') {
        this.tabHeld = false
        this.showScoreboard = false
      }
    }
    window.addEventListener('keydown', this.keyDownHandler)
    window.addEventListener('keyup', this.keyUpHandler)
  }

  private frame(): void {
    if (!this.running || this.disposed) return
    const now = performance.now()
    const dt = (now - this.lastFrameMs) / 1000
    this.lastFrameMs = now

    this.fpsAccum += dt
    this.fpsFrames += 1
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum
      this.fpsAccum = 0
      this.fpsFrames = 0
    }

    this.client.noteFrame(now, () => {
      this.prediction.clear()
      this.interpolator.clear()
    })

    this.timestep.advance(dt, () => this.fixedTick())

    this.updateRemotes(now)
    this.updateRockets(dt)
    this.updateExplosions(dt)
    this.syncCamera(this.prediction.state)
    this.updateHud()
    this.scene.render()
  }

  private fixedTick(): void {
    if (this.prediction.isAwaitingSnapshot) {
      this.client.advanceClientTick()
      return
    }

    const raw = this.input.getInputState()
    this.applyLook(raw)

    let moveX = 0
    let moveY = 0
    if (raw.left) moveX -= 1
    if (raw.right) moveX += 1
    if (raw.forward) moveY += 1
    if (raw.backward) moveY -= 1

    this.client.advanceClientTick()
    const pending: PendingInput = {
      seq: 0,
      moveX,
      moveY,
      jump: raw.jump,
      crouch: this.crouchHeld,
      dash: raw.dash,
      shoot: raw.shoot,
      reload: this.reloadHeld,
      yaw: this.yaw,
      pitch: this.pitch,
    }

    const seq = this.client.sendInput({
      moveX: pending.moveX,
      moveY: pending.moveY,
      jump: pending.jump,
      crouch: pending.crouch,
      dash: pending.dash,
      shoot: pending.shoot,
      reload: pending.reload,
      yaw: pending.yaw,
      pitch: pending.pitch,
    })
    pending.seq = seq
    this.prediction.applyLocalPrediction(pending)
  }

  private applyLook(input: InputState): void {
    if (!this.input.isPointerLocked()) return
    this.yaw += input.mouseX * MOUSE_SENSITIVITY
    this.pitch -= input.mouseY * MOUSE_SENSITIVITY
    if (this.pitch > MAX_PITCH) this.pitch = MAX_PITCH
    if (this.pitch < -MAX_PITCH) this.pitch = -MAX_PITCH
  }

  private onSnapshot(snap: SnapshotPayload): void {
    this.interpolator.pushSnapshot(snap.tick, performance.now(), snap.players)

    const localId = this.client.localPlayerId
    if (localId === null) return

    const local = snap.players.find((p) => p.id === localId)
    if (!local) return

    if (this.prediction.isAwaitingSnapshot || this.prediction.pendingCount === 0) {
      this.prediction.reset(
        simStateFromAuthoritative({
          x: local.x,
          y: local.y,
          z: local.z,
          vx: local.vx,
          vy: local.vy,
          vz: local.vz,
          yaw: local.yaw,
          pitch: local.pitch,
          alive: local.alive,
        }),
      )
      this.yaw = local.yaw
      this.pitch = local.pitch
    } else {
      this.prediction.reconcile(
        snap.ackSeq,
        simStateFromAuthoritative({
          x: local.x,
          y: local.y,
          z: local.z,
          vx: local.vx,
          vy: local.vy,
          vz: local.vz,
          yaw: local.yaw,
          pitch: local.pitch,
          alive: local.alive,
        }),
      )
    }

    // Sync rockets from snapshot set
    const live = new Set(snap.projectiles.map((p) => p.id))
    for (const id of [...this.rockets.keys()]) {
      if (!live.has(id)) {
        this.rockets.get(id)?.mesh.dispose()
        this.rockets.delete(id)
      }
    }
    for (const p of snap.projectiles) {
      if (!this.rockets.has(p.id)) {
        this.spawnRocket({
          id: p.id,
          ownerId: p.ownerId,
          x: p.x,
          y: p.y,
          z: p.z,
          vx: p.vx,
          vy: p.vy,
          vz: p.vz,
        })
      } else {
        const r = this.rockets.get(p.id)!
        r.mesh.position.set(p.x, p.y, p.z)
      }
    }
  }

  private syncCamera(state: PlayerSimState): void {
    this.camera.position.set(
      state.position.x,
      state.position.y + PLAYER_EYE_OFFSET,
      state.position.z,
    )
    const lookYaw = this.yaw
    const lookPitch = this.pitch
    const fx = Math.sin(lookYaw) * Math.cos(lookPitch)
    const fy = Math.sin(lookPitch)
    const fz = Math.cos(lookYaw) * Math.cos(lookPitch)
    this.camera.setTarget(
      this.camera.position.add(new Vector3(fx, fy, fz)),
    )
  }

  private updateRemotes(now: number): void {
    const localId = this.client.localPlayerId
    const sampled = this.interpolator.sample(now)
    const seen = new Set<number>()

    for (const [id, p] of sampled) {
      if (id === localId) continue
      if (!p.alive) {
        const existing = this.remotes.get(id)
        if (existing) existing.mesh.setEnabled(false)
        continue
      }
      seen.add(id)
      let visual = this.remotes.get(id)
      if (!visual) {
        visual = this.createRemoteMesh(id)
        this.remotes.set(id, visual)
      }
      visual.mesh.setEnabled(true)
      visual.mesh.position.set(p.x, p.y + PLAYER_HEIGHT * 0.5, p.z)
      visual.mesh.rotation.y = p.yaw
    }

    for (const [id, visual] of this.remotes) {
      if (!seen.has(id) && !sampled.has(id)) {
        visual.mesh.dispose()
        this.remotes.delete(id)
      }
    }
  }

  private createRemoteMesh(id: number): RemoteVisual {
    const mesh = MeshBuilder.CreateCylinder(
      `remote_${id}`,
      { height: PLAYER_HEIGHT, diameter: 0.7, tessellation: 10 },
      this.scene,
    )
    const mat = new StandardMaterial(`remoteMat_${id}`, this.scene)
    mat.diffuseColor = PLAYER_COLORS[id % PLAYER_COLORS.length]!.clone()
    mat.specularColor = new Color3(0.1, 0.1, 0.1)
    mesh.material = mat
    return { mesh, material: mat }
  }

  private spawnRocket(p: ProjectileSpawnPayload): void {
    if (this.rockets.has(p.id)) return
    const mesh = MeshBuilder.CreateSphere(`rocket_${p.id}`, { diameter: 0.35 }, this.scene)
    const mat = this.getMaterial('rocket', new Color3(1, 0.45, 0.1))
    mesh.material = mat
    mesh.position.set(p.x, p.y, p.z)
    this.rockets.set(p.id, { mesh, id: p.id })
  }

  private impactRocket(p: ProjectileImpactPayload): void {
    const existing = this.rockets.get(p.id)
    if (existing) {
      existing.mesh.dispose()
      this.rockets.delete(p.id)
    }
    const blast = MeshBuilder.CreateSphere(`fx_${p.id}`, { diameter: 2.5 }, this.scene)
    const mat = this.getMaterial('blast', new Color3(1, 0.55, 0.15))
    blast.material = mat
    blast.position.set(p.x, p.y, p.z)
    this.explosions.push({ mesh: blast, age: 0 })
  }

  private updateRockets(dt: number): void {
    // Positions primarily driven by snapshots / spawn; light coasting for smoothness
    void dt
  }

  private updateExplosions(dt: number): void {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const fx = this.explosions[i]!
      fx.age += dt
      const s = 1 + fx.age * 3
      fx.mesh.scaling.setAll(s)
      const mat = fx.mesh.material as StandardMaterial | null
      if (mat) mat.alpha = Math.max(0, 1 - fx.age * 2.5)
      if (fx.age > 0.45) {
        fx.mesh.dispose()
        this.explosions.splice(i, 1)
      }
    }
  }

  private buildArena(): void {
    const ground = MeshBuilder.CreateGround(
      'mpGround',
      { width: ARENA_MAP.bounds.halfSize * 2, height: ARENA_MAP.bounds.halfSize * 2 },
      this.scene,
    )
    ground.position.y = ARENA_MAP.bounds.floorY
    const gMat = this.getMaterial('ground', new Color3(0.4, 0.42, 0.38))
    ground.material = gMat
    this.arenaMeshes.push(ground)

    for (const box of ARENA_MAP.boxes) {
      const mesh = MeshBuilder.CreateBox(
        box.id,
        { width: box.w, height: box.h, depth: box.d },
        this.scene,
      )
      mesh.position.set(box.cx, box.cy, box.cz)
      mesh.material = this.getMaterial(`kind_${box.kind}`, kindColor(box.kind))
      this.arenaMeshes.push(mesh)
    }
  }

  private getMaterial(key: string, color: Color3): StandardMaterial {
    let mat = this.materialCache.get(key)
    if (!mat) {
      mat = new StandardMaterial(key, this.scene)
      mat.diffuseColor = color
      mat.specularColor = new Color3(0.08, 0.08, 0.08)
      this.materialCache.set(key, mat)
    }
    return mat
  }

  private createHud(): {
    root: HTMLDivElement
    health: HTMLSpanElement
    ammo: HTMLSpanElement
    score: HTMLSpanElement
    timer: HTMLSpanElement
    players: HTMLSpanElement
    ping: HTMLSpanElement
    killFeed: HTMLDivElement
    scoreboard: HTMLDivElement
    perf: HTMLDivElement
  } {
    const root = document.createElement('div')
    root.id = 'mp-hud'
    Object.assign(root.style, {
      display: 'none',
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '50',
      color: '#e8ecef',
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      textShadow: '0 1px 2px rgba(0,0,0,0.8)',
    } as CSSStyleDeclaration)

    const bar = document.createElement('div')
    Object.assign(bar.style, {
      position: 'absolute',
      left: '16px',
      bottom: '16px',
      display: 'flex',
      gap: '18px',
      fontSize: '18px',
      fontWeight: '600',
    } as CSSStyleDeclaration)

    const mk = (label: string): HTMLSpanElement => {
      const wrap = document.createElement('span')
      const title = document.createElement('span')
      title.textContent = `${label} `
      title.style.opacity = '0.55'
      title.style.fontSize = '12px'
      const val = document.createElement('span')
      val.textContent = '—'
      wrap.append(title, val)
      bar.appendChild(wrap)
      return val
    }

    const health = mk('HP')
    const ammo = mk('AMMO')
    const score = mk('SCORE')
    const timer = mk('TIME')
    const players = mk('PLAYERS')
    const ping = mk('PING')

    const topRight = document.createElement('div')
    Object.assign(topRight.style, {
      position: 'absolute',
      right: '16px',
      top: '16px',
      textAlign: 'right',
      fontSize: '13px',
    } as CSSStyleDeclaration)

    const killFeed = document.createElement('div')
    Object.assign(killFeed.style, {
      position: 'absolute',
      right: '16px',
      top: '48px',
      width: '280px',
      fontSize: '13px',
      lineHeight: '1.5',
    } as CSSStyleDeclaration)

    const scoreboard = document.createElement('div')
    scoreboard.id = 'mp-scoreboard'
    Object.assign(scoreboard.style, {
      display: 'none',
      position: 'absolute',
      left: '50%',
      top: '18%',
      transform: 'translateX(-50%)',
      minWidth: '360px',
      padding: '16px 20px',
      background: 'rgba(10,14,18,0.85)',
      border: '1px solid rgba(200,220,240,0.15)',
      fontSize: '14px',
    } as CSSStyleDeclaration)

    const perf = document.createElement('div')
    Object.assign(perf.style, {
      display: 'none',
      position: 'absolute',
      left: '16px',
      top: '16px',
      padding: '8px 10px',
      background: 'rgba(0,0,0,0.55)',
      fontSize: '12px',
      fontFamily: 'ui-monospace, monospace',
      whiteSpace: 'pre',
    } as CSSStyleDeclaration)

    const cross = document.createElement('div')
    Object.assign(cross.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '10px',
      height: '10px',
      marginLeft: '-5px',
      marginTop: '-5px',
      border: '1px solid rgba(255,255,255,0.7)',
      borderRadius: '50%',
    } as CSSStyleDeclaration)

    root.append(bar, topRight, killFeed, scoreboard, perf, cross)
    this.overlayParent.appendChild(root)

    return {
      root,
      health,
      ammo,
      score,
      timer,
      players,
      ping,
      killFeed,
      scoreboard,
      perf,
    }
  }

  private updateHud(): void {
    const localId = this.client.localPlayerId
    const local = localId !== null ? this.client.players.get(localId) : undefined
    this.hudHealth.textContent = local ? String(local.health) : '—'
    this.hudAmmo.textContent = local ? String(local.ammo) : '—'
    this.hudScore.textContent = local ? `${local.kills}/${local.deaths}` : '—'
    this.hudTimer.textContent = formatTime(this.client.timeRemaining)
    this.hudPlayers.textContent = String(this.client.players.size)
    this.hudPing.textContent = `${Math.round(this.client.ping)} ms`

    this.hudKillFeed.replaceChildren()
    for (const entry of this.client.killFeed.slice(0, 5)) {
      const line = document.createElement('div')
      const killer = this.client.players.get(entry.killerId)?.displayName ?? `#${entry.killerId}`
      const victim = this.client.players.get(entry.victimId)?.displayName ?? `#${entry.victimId}`
      line.textContent =
        entry.killerId === entry.victimId ? `${victim} died` : `${killer}  →  ${victim}`
      this.hudKillFeed.appendChild(line)
    }

    this.scoreboardEl.style.display = this.showScoreboard || this.tabHeld ? 'block' : 'none'
    if (this.showScoreboard || this.tabHeld) {
      const rows = [...this.client.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
      this.scoreboardEl.innerHTML =
        '<div style="font-weight:700;margin-bottom:8px">SCOREBOARD</div>' +
        rows
          .map(
            (p, i) =>
              `<div style="display:flex;justify-content:space-between;gap:24px;padding:3px 0"><span>${i + 1}. ${escapeHtml(p.displayName)}</span><span>${p.kills} / ${p.deaths}</span></div>`,
          )
          .join('')
    }

    if (this.showPerf) {
      const snap = this.client.lastSnapshot
      this.perfEl.textContent = [
        `fps  ${this.fps.toFixed(0)}`,
        `ping ${Math.round(this.client.ping)} ms`,
        `players ${this.client.players.size}`,
        `phase ${MatchPhase[this.client.phase] ?? this.client.phase}`,
        `snap tick ${snap?.tick ?? '—'}`,
        `interp buf ${this.interpolator.bufferSize}`,
        `pending ${this.prediction.pendingCount}`,
        `dt ${TICK_DT.toFixed(4)}`,
      ].join('\n')
    }

    if (this.client.phase === MatchPhase.Results && !this.resultsShown) {
      this.showResults(this.client.standings)
    }
  }

  private showResults(standings: StandingEntry[]): void {
    this.resultsShown = true
    if (!this.menu) {
      this.menu = new MultiplayerMenu(this.overlayParent, {
        onSinglePlayer: () => undefined,
        onConnect: () => undefined,
      })
    }
    this.menu.showResults(standings.length > 0 ? standings : this.buildStandingsFallback())
  }

  private buildStandingsFallback(): StandingEntry[] {
    return [...this.client.players.values()]
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
      .map((p, i) => ({
        playerId: p.id,
        displayName: p.displayName,
        kills: p.kills,
        deaths: p.deaths,
        rank: i + 1,
      }))
  }
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
