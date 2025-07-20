import { Vector3, FreeCamera, Scene, Mesh, Ray, PhysicsImpostor } from '@babylonjs/core'
import { GameConfig, InputState, PlayerState } from './types.js'

export class Player {
  public camera: FreeCamera
  public mesh: Mesh
  public state: PlayerState

  private config: GameConfig = {
    gravity: -30,
    playerSpeed: 20,          // Increased for more responsive movement
    jumpPower: 12,
    dashPower: 35,            // Increased dash power for more impact  
    flightSpeed: 25,          // Faster flight for better aerial mobility
    friction: 8,
    airFriction: 2,
    mouseSensitivity: 0.003   // Slightly more sensitive mouse look
  }

  private lastDashTime = 0
  private dashCooldownTime = 1000 // 1 second
  private lastJumpTime = 0
  private jumpCooldownTime = 500 // 0.5 second between jumps
  
  // New movement mechanics
  private jumpVelocity: number = 0
  private isGrounded: boolean = true
  private dashVelocity: Vector3 = new Vector3(0, 0, 0)
  private dashDuration: number = 0
  private maxDashDuration: number = 0.3 // 300ms dash duration

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

    // Temporarily disable physics for debugging
    console.log('Player physics disabled for debugging')
    // this.mesh.physicsImpostor = new PhysicsImpostor(
    //   this.mesh,
    //   PhysicsImpostor.CylinderImpostor,
    //   { mass: 1, restitution: 0.1, friction: 0.1 },
    //   scene
    // )

    // this.mesh.physicsImpostor.setAngularVelocity(Vector3.Zero())
    
    // if (this.mesh.physicsImpostor.physicsBody) {
    //   this.mesh.physicsImpostor.setAngularVelocity(Vector3.Zero())
    // }
  }

  public update(deltaTime: number, input: InputState): void {
    // Enhanced debug logging
    console.log('Player update called, deltaTime:', deltaTime)
    console.log('Input state:', input)
    
    // Test basic movement first
    // Movement is handled in handleMovement() method with camera-relative controls
    
    this.updateDashCooldown(deltaTime)
    this.handleJump(input)
    this.handleDash(input, deltaTime)
    this.handleMovement(deltaTime, input)
    this.handleMouseLook(input)
    this.applyGravityAndJump(deltaTime)
    this.updateCameraPosition()
  }

  private updateDashCooldown(deltaTime: number): void {
    if (this.state.dashCooldown > 0) {
      this.state.dashCooldown -= deltaTime
    }
  }

  private handleJump(input: InputState): void {
    const currentTime = Date.now()
    
    if (input.jump && this.isGrounded && currentTime - this.lastJumpTime > this.jumpCooldownTime) {
      // Apply jump velocity
      this.jumpVelocity = this.config.jumpPower
      this.isGrounded = false
      this.lastJumpTime = currentTime
      
      // console.log('Jump executed with power:', this.config.jumpPower)
    }
  }

  private handleDash(input: InputState, deltaTime: number): void {
    const currentTime = Date.now()
    
    // Update existing dash if active
    if (this.dashDuration > 0) {
      this.dashDuration -= deltaTime
      if (this.dashDuration <= 0) {
        // End dash
        this.dashVelocity = Vector3.Zero()
        this.state.isDashing = false
        // console.log('Dash ended')
      }
    }
    
    // Start new dash if conditions are met
    if (input.dash && currentTime - this.lastDashTime > this.dashCooldownTime && this.dashDuration <= 0) {
      // Calculate dash direction based on current movement input
      const dashDirection = new Vector3()
      
      if (input.forward) dashDirection.z += 1
      if (input.backward) dashDirection.z -= 1
      if (input.left) dashDirection.x -= 1
      if (input.right) dashDirection.x += 1
      
      // If no movement input, dash forward relative to camera
      if (dashDirection.length() === 0) {
        dashDirection.z = 1
      }
      
      dashDirection.normalize()
      
      // Use same simple approach as movement
      const yaw = this.state.rotation.y
      
      // Calculate forward and right directions from camera yaw
      const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
      const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
      
      // Calculate final dash direction
      const finalDashDirection = new Vector3()
      finalDashDirection.addInPlace(forward.scale(dashDirection.z))
      finalDashDirection.addInPlace(right.scale(dashDirection.x))
      finalDashDirection.normalize()
      
      // Set dash velocity instead of instant movement
      this.dashVelocity = finalDashDirection.scale(this.config.dashPower)
      this.dashDuration = this.maxDashDuration
      this.lastDashTime = currentTime
      this.state.isDashing = true
      
      // console.log('Dash started with velocity:', this.dashVelocity)
    }
  }

  private handleMovement(deltaTime: number, input: InputState): void {
    // Calculate base movement direction
    const moveDirection = new Vector3()
    
    // Calculate movement direction from input
    if (input.forward) moveDirection.z += 1
    if (input.backward) moveDirection.z -= 1
    if (input.left) moveDirection.x -= 1
    if (input.right) moveDirection.x += 1
    
    // Combine regular movement with dash velocity
    let totalMovement = new Vector3()
    
    if (moveDirection.length() > 0) {
      moveDirection.normalize()
      
      // Use camera rotation for movement direction
      const yaw = this.state.rotation.y
      
      // Calculate forward and right directions from camera yaw
      const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
      const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
      
      // Calculate final movement direction
      const finalMovement = new Vector3()
      finalMovement.addInPlace(forward.scale(moveDirection.z)) // Forward/backward
      finalMovement.addInPlace(right.scale(moveDirection.x))   // Left/right
      
      // Apply normal movement
      const normalMovement = finalMovement.normalize().scale(this.config.playerSpeed * deltaTime)
      totalMovement.addInPlace(normalMovement)
    }
    
    // Add dash velocity if dashing
    if (this.dashDuration > 0) {
      const dashMovement = this.dashVelocity.scale(deltaTime)
      totalMovement.addInPlace(dashMovement)
    }
    
    // Apply horizontal movement
    this.mesh.position.x += totalMovement.x
    this.mesh.position.z += totalMovement.z
  }

  private applyGravityAndJump(deltaTime: number): void {
    // Apply gravity
    if (!this.isGrounded) {
      this.jumpVelocity += this.config.gravity * deltaTime
    }
    
    // Apply jump/fall movement
    const newY = this.mesh.position.y + this.jumpVelocity * deltaTime
    
    // Simple ground check (Y = 2 is starting height, ground level would be around 0.75 for standing)
    const groundLevel = 2 // Player starting height
    if (newY <= groundLevel) {
      // Hit ground
      this.mesh.position.y = groundLevel
      this.jumpVelocity = 0
      this.isGrounded = true
    } else {
      // In air
      this.mesh.position.y = newY
      this.isGrounded = false
    }
  }

  private handleMouseLook(input: InputState): void {
    if (input.mouseX !== 0 || input.mouseY !== 0) {
      // Horizontal rotation (yaw) - positive mouseX should rotate right  
      this.state.rotation.y += input.mouseX * this.config.mouseSensitivity
      
      // Vertical rotation (pitch) - positive mouseY should look down (standard FPS)
      this.state.rotation.x -= input.mouseY * this.config.mouseSensitivity
      this.state.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.state.rotation.x))
      
      // Apply rotation to camera
      this.camera.rotation.x = this.state.rotation.x
      this.camera.rotation.y = this.state.rotation.y
    }
  }

  private checkGroundContact(): void {
    // Simple ground check (no physics ray casting)
    // Assume player is on ground if Y position is low enough
    this.state.onGround = this.mesh.position.y <= 2.0
  }

  private updateCameraPosition(): void {
    // Keep camera at head level above the physics body
    this.camera.position = this.mesh.position.add(new Vector3(0, 0.7, 0))
    this.state.position = this.mesh.position.clone()
    
    // No physics, so set velocity to zero
    this.state.velocity = Vector3.Zero()
    
    // Prevent player mesh from rotating (keep upright)
    this.mesh.rotation = Vector3.Zero()
    // this.mesh.physicsImpostor!.setAngularVelocity(Vector3.Zero())
  }

  public takeDamage(amount: number): void {
    this.state.health = Math.max(0, this.state.health - amount)
  }

  public consumeAmmo(): boolean {
    // Infinite ammo - always return true
    // Keep ammo display at a reasonable number for UI
    this.state.ammo = Math.max(1, this.state.ammo)
    return true
  }

  public addAmmo(amount: number): void {
    this.state.ammo = Math.min(8, this.state.ammo + amount) // Max 8 rockets
  }
} 