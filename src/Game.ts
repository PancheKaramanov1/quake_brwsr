import { Engine, Scene, Vector3, HavokPlugin } from '@babylonjs/core'
import HavokPhysics from '@babylonjs/havok'
import { Player } from './Player.js'
import { InputManager } from './InputManager.js'
import { WeaponSystem } from './WeaponSystem.js'
import { Arena } from './Arena.js'
import { GameConfig } from './types.js'

export class Game {
  private engine: Engine
  private scene: Scene
  private player: Player
  private inputManager: InputManager
  private weaponSystem: WeaponSystem
  private arena: Arena
  
  private lastTime = 0
  private isRunning = false

  constructor(canvas: HTMLCanvasElement) {
    // Create Babylon.js engine
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true
    })

    // Create scene
    this.scene = new Scene(this.engine)
    
    // Initialize input manager
    this.inputManager = new InputManager(canvas)
    
    // Initialize systems (will be completed in init())
    this.weaponSystem = new WeaponSystem(this.scene)
    this.arena = new Arena(this.scene)
    this.player = new Player(this.scene, new Vector3(0, 2, 0))
  }

  public async init(): Promise<void> {
    try {
      // Initialize physics
      await this.initPhysics()
      
      // Create game world
      this.createWorld()
      
      // Setup game loop
      this.setupGameLoop()
      
      // Setup window resize handling
      this.setupWindowResize()
      
      console.log('FPS Game initialized successfully!')
      console.log('Controls:')
      console.log('- WASD: Move')
      console.log('- Mouse: Look around')
      console.log('- LMB: Shoot rockets')
      console.log('- Space: Jump (or fly up when flying)')
      console.log('- Shift: Dash')
      console.log('- F: Toggle flight mode')
      console.log('Click on the canvas to start playing!')
      
    } catch (error) {
      console.error('Failed to initialize game:', error)
      throw error
    }
  }

  private async initPhysics(): Promise<void> {
    // Initialize Havok physics engine
    const havokInstance = await HavokPhysics()
    const havokPlugin = new HavokPlugin(true, havokInstance)
    this.scene.enablePhysics(new Vector3(0, -9.81, 0), havokPlugin)
  }

  private createWorld(): void {
    // Arena and world geometry are already created in Arena constructor
    // Player is already created and positioned
    
    // Set camera as the active camera
    this.scene.activeCamera = this.player.camera
    
    // Setup fog for atmosphere
    this.scene.fogMode = Scene.FOGMODE_EXP2
    this.scene.fogDensity = 0.002
    this.scene.fogColor = this.scene.clearColor
  }

  private setupGameLoop(): void {
    this.lastTime = performance.now()
    
    this.engine.runRenderLoop(() => {
      if (!this.isRunning) return
      
      const currentTime = performance.now()
      const deltaTime = (currentTime - this.lastTime) / 1000 // Convert to seconds
      this.lastTime = currentTime
      
      this.update(deltaTime)
      this.render()
    })
  }

  private update(deltaTime: number): void {
    // Get input state
    const input = this.inputManager.getInputState()
    
    // Only update game if pointer is locked (player is actively playing)
    if (this.inputManager.isPointerLocked()) {
      // Update player
      this.player.update(deltaTime, input)
      
      // Handle shooting
      if (input.shoot) {
        this.handleShooting()
      }
      
      // Update weapon system
      this.weaponSystem.update(deltaTime)
      
      // Update UI
      this.updateUI()
    }
  }

  private handleShooting(): void {
    // Check if player has ammo
    if (!this.player.consumeAmmo()) {
      console.log('Out of ammo!')
      return
    }
    
    // Get shooting position and direction
    const shootPosition = this.player.camera.position.clone()
    const shootDirection = this.player.camera.getForwardRay().direction
    
    // Fire rocket
    const fired = this.weaponSystem.fireRocket(shootPosition, shootDirection)
    
    if (fired) {
      console.log(`Rocket fired! Ammo remaining: ${this.player.state.ammo}`)
    }
  }

  private updateUI(): void {
    // Update health display
    const healthElement = document.getElementById('healthValue')
    if (healthElement) {
      healthElement.textContent = this.player.state.health.toString()
    }
    
    // Update ammo display
    const ammoElement = document.getElementById('ammoValue')
    if (ammoElement) {
      ammoElement.textContent = this.player.state.ammo.toString()
    }
    
    // Update health bar color based on health level
    const healthBar = document.getElementById('healthBar')
    if (healthBar) {
      if (this.player.state.health < 30) {
        healthBar.style.color = '#ff4444'
      } else if (this.player.state.health < 60) {
        healthBar.style.color = '#ffaa44'
      } else {
        healthBar.style.color = '#44ff44'
      }
    }
    
    // Update crosshair color based on flight status
    const crosshair = document.getElementById('crosshair')
    if (crosshair) {
      if (this.player.state.isFlying) {
        crosshair.style.borderColor = '#44aaff'
      } else if (this.player.state.isDashing) {
        crosshair.style.borderColor = '#ff4444'
      } else {
        crosshair.style.borderColor = '#ffffff'
      }
    }
  }

  private render(): void {
    this.scene.render()
  }

  private setupWindowResize(): void {
    window.addEventListener('resize', () => {
      this.engine.resize()
    })
  }

  public start(): void {
    this.isRunning = true
    console.log('Game started!')
  }

  public stop(): void {
    this.isRunning = false
    console.log('Game stopped!')
  }

  public dispose(): void {
    this.stop()
    
    // Dispose game systems
    this.weaponSystem.dispose()
    this.arena.dispose()
    
    // Dispose Babylon.js resources
    this.scene.dispose()
    this.engine.dispose()
  }

  // Public getters for debugging/external access
  public getScene(): Scene {
    return this.scene
  }

  public getPlayer(): Player {
    return this.player
  }

  public getWeaponSystem(): WeaponSystem {
    return this.weaponSystem
  }
} 