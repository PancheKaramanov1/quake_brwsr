import { Vector3, FreeCamera, Scene, Mesh, Ray, PhysicsImpostor } from '@babylonjs/core'
import { GameConfig, InputState, PlayerState } from './types.js'

export class Player {
  public camera: FreeCamera
  public mesh: Mesh
  public state: PlayerState

  private config: GameConfig = {
    gravity: -30,
    playerSpeed: 15,
    jumpPower: 12,
    dashPower: 25,
    flightSpeed: 20,
    friction: 8,
    airFriction: 2,
    mouseSensitivity: 0.002
  }

  private lastDashTime = 0
  private dashCooldownTime = 1000 // 1 second
  private flightToggled = false
  private lastFlightToggle = 0

  constructor(scene: Scene, startPosition: Vector3) {
    // Initialize player state
    this.state = {
      position: startPosition.clone(),
      velocity: Vector3.Zero(),
      rotation: Vector3.Zero(),
      health: 100,
      ammo: 8,
      isFlying: false,
      isDashing: false,
      dashCooldown: 0,
      onGround: false
    }

    // Create FPS camera
    this.camera = new FreeCamera('playerCamera', startPosition, scene)
    this.camera.setTarget(Vector3.Zero())
    
    // Disable default camera controls - we'll handle input manually
    this.camera.inputs.clear()

    // Create player collision mesh (invisible capsule)
    this.mesh = Mesh.CreateCylinder('player', 1.8, 0.6, 0.6, 8, 1, scene)
    this.mesh.position = startPosition.clone()
    this.mesh.isVisible = false

    // Setup physics
    this.mesh.physicsImpostor = new PhysicsImpostor(
      this.mesh,
      PhysicsImpostor.CylinderImpostor,
      { mass: 1, restitution: 0.1, friction: 0.1 },
      scene
    )

    // Disable rotation on physics body (when physics body is ready)
    this.mesh.physicsImpostor.setAngularVelocity(Vector3.Zero())
    
    // Set linear and angular damping to prevent unwanted rotation
    if (this.mesh.physicsImpostor.physicsBody) {
      // For Havok physics, we use different approach to lock rotation
      this.mesh.physicsImpostor.setAngularVelocity(Vector3.Zero())
    }
  }

  public update(deltaTime: number, input: InputState): void {
    // Debug: Log input to see if we're receiving it
    if (input.forward || input.backward || input.left || input.right || input.jump || input.dash) {
      console.log('Input received:', {
        forward: input.forward,
        backward: input.backward,
        left: input.left,
        right: input.right,
        jump: input.jump,
        dash: input.dash,
        flight: input.flight
      })
    }
    
    this.updateDashCooldown(deltaTime)
    this.handleFlightToggle(input)
    this.handleDash(input)
    this.handleMovement(deltaTime, input)
    this.handleMouseLook(input)
    this.checkGroundContact()
    this.updateCameraPosition()
  }

  private updateDashCooldown(deltaTime: number): void {
    if (this.state.dashCooldown > 0) {
      this.state.dashCooldown -= deltaTime
    }
  }

  private handleFlightToggle(input: InputState): void {
    const currentTime = Date.now()
    if (input.flight && currentTime - this.lastFlightToggle > 300) {
      this.state.isFlying = !this.state.isFlying
      this.lastFlightToggle = currentTime
      
      if (this.state.isFlying) {
        // Enable flight mode - reduce gravity effect
        this.mesh.physicsImpostor!.setMass(0.1)
      } else {
        // Disable flight mode - restore normal physics
        this.mesh.physicsImpostor!.setMass(1)
      }
    }
  }

  private handleDash(input: InputState): void {
    const currentTime = Date.now()
    
    if (input.dash && currentTime - this.lastDashTime > this.dashCooldownTime) {
      // Calculate dash direction based on current movement
      const dashDirection = new Vector3()
      
      if (input.forward) dashDirection.z += 1
      if (input.backward) dashDirection.z -= 1
      if (input.left) dashDirection.x -= 1
      if (input.right) dashDirection.x += 1
      
      // If no movement input, dash forward
      if (dashDirection.length() === 0) {
        dashDirection.z = 1
      }
      
      // Transform to world space relative to camera
      dashDirection.normalize()
      const cameraMatrix = this.camera.getWorldMatrix()
      Vector3.TransformNormalToRef(dashDirection, cameraMatrix, dashDirection)
      dashDirection.y = 0 // Keep dash horizontal
      dashDirection.normalize()
      
      // Apply dash impulse
      const dashImpulse = dashDirection.scale(this.config.dashPower)
      this.mesh.physicsImpostor!.setLinearVelocity(
        this.mesh.physicsImpostor!.getLinearVelocity()!.add(dashImpulse)
      )
      
      this.lastDashTime = currentTime
      this.state.isDashing = true
      
      // Reset dash state after short duration
      setTimeout(() => {
        this.state.isDashing = false
      }, 200)
    }
  }

  private handleMovement(deltaTime: number, input: InputState): void {
    const currentVelocity = this.mesh.physicsImpostor!.getLinearVelocity()!
    const moveDirection = new Vector3()
    
    // Calculate movement direction
    if (input.forward) moveDirection.z += 1
    if (input.backward) moveDirection.z -= 1
    if (input.left) moveDirection.x -= 1
    if (input.right) moveDirection.x += 1
    
    if (moveDirection.length() > 0) {
      moveDirection.normalize()
      
      // Transform to world space relative to camera
      const cameraMatrix = this.camera.getWorldMatrix()
      Vector3.TransformNormalToRef(moveDirection, cameraMatrix, moveDirection)
      moveDirection.y = 0 // Keep movement horizontal unless flying
      
      if (this.state.isFlying) {
        // Flight movement - full 3D control
        if (input.jump) moveDirection.y += 1
        if (input.dash) moveDirection.y -= 1 // Use dash as descend in flight mode
        
        const targetVelocity = moveDirection.scale(this.config.flightSpeed)
        this.mesh.physicsImpostor!.setLinearVelocity(targetVelocity)
      } else {
        // Ground/air movement with Quake-style physics
        const acceleration = this.state.onGround ? this.config.playerSpeed : this.config.playerSpeed * 0.3
        const newVelocity = currentVelocity.add(moveDirection.scale(acceleration * deltaTime))
        
        // Apply friction
        const friction = this.state.onGround ? this.config.friction : this.config.airFriction
        newVelocity.x *= Math.pow(1 - friction * deltaTime, deltaTime)
        newVelocity.z *= Math.pow(1 - friction * deltaTime, deltaTime)
        
        // Limit horizontal speed for ground movement
        if (this.state.onGround) {
          const horizontalSpeed = Math.sqrt(newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z)
          if (horizontalSpeed > this.config.playerSpeed) {
            const scale = this.config.playerSpeed / horizontalSpeed
            newVelocity.x *= scale
            newVelocity.z *= scale
          }
        }
        
        this.mesh.physicsImpostor!.setLinearVelocity(new Vector3(newVelocity.x, currentVelocity.y, newVelocity.z))
      }
    } else if (!this.state.isFlying) {
      // Apply friction when not moving
      const friction = this.state.onGround ? this.config.friction : this.config.airFriction
      const newVelocity = currentVelocity.clone()
      newVelocity.x *= Math.pow(1 - friction * deltaTime, deltaTime)
      newVelocity.z *= Math.pow(1 - friction * deltaTime, deltaTime)
      this.mesh.physicsImpostor!.setLinearVelocity(newVelocity)
    }
    
    // Jumping (only when on ground and not flying)
    if (input.jump && this.state.onGround && !this.state.isFlying) {
      const jumpVelocity = currentVelocity.clone()
      jumpVelocity.y = this.config.jumpPower
      this.mesh.physicsImpostor!.setLinearVelocity(jumpVelocity)
    }
  }

  private handleMouseLook(input: InputState): void {
    if (input.mouseX !== 0 || input.mouseY !== 0) {
      // Horizontal rotation (yaw)
      this.state.rotation.y -= input.mouseX * this.config.mouseSensitivity
      
      // Vertical rotation (pitch) with limits
      this.state.rotation.x -= input.mouseY * this.config.mouseSensitivity
      this.state.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.state.rotation.x))
      
      // Apply rotation to camera
      this.camera.rotation.x = this.state.rotation.x
      this.camera.rotation.y = this.state.rotation.y
    }
  }

  private checkGroundContact(): void {
    // Cast ray downward to check if player is on ground
    const origin = this.mesh.position.clone()
    const direction = new Vector3(0, -1, 0)
    const ray = new Ray(origin, direction)
    
    const hit = this.mesh.getScene().pickWithRay(ray, (mesh) => {
      return mesh !== this.mesh && mesh.name.includes('ground')
    })
    
    this.state.onGround = !!(hit?.hit && hit.distance < 1.0)
  }

  private updateCameraPosition(): void {
    // Keep camera at head level above the physics body
    this.camera.position = this.mesh.position.add(new Vector3(0, 0.7, 0))
    this.state.position = this.mesh.position.clone()
    this.state.velocity = this.mesh.physicsImpostor!.getLinearVelocity()!
    
    // Prevent player mesh from rotating (keep upright)
    this.mesh.rotation = Vector3.Zero()
    this.mesh.physicsImpostor!.setAngularVelocity(Vector3.Zero())
  }

  public takeDamage(amount: number): void {
    this.state.health = Math.max(0, this.state.health - amount)
  }

  public consumeAmmo(): boolean {
    if (this.state.ammo > 0) {
      this.state.ammo--
      return true
    }
    return false
  }

  public addAmmo(amount: number): void {
    this.state.ammo = Math.min(8, this.state.ammo + amount) // Max 8 rockets
  }
} 