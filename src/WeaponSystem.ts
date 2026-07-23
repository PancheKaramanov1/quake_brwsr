import { Vector3, Mesh, Scene, StandardMaterial, Color3, Color4, ParticleSystem, Texture } from '@babylonjs/core'
import { Projectile, WeaponConfig } from './types.js'

export class WeaponSystem {
  private projectiles: Projectile[] = []
  private lastFireTime = 0
  
  private config: WeaponConfig = {
    damage: 100,
    splashDamage: 50,
    splashRadius: 5,
    projectileSpeed: 40,
    ammoCapacity: 8,
    reloadTime: 2000,
    fireRate: 500 // 500ms between shots
  }

  constructor(private scene: Scene) {}

  public fireRocket(startPosition: Vector3, direction: Vector3): boolean {
    const currentTime = Date.now()
    
    // Check fire rate limit (500ms for faster action)
    const fireDelay = 500 // 500ms between shots
    if (currentTime - this.lastFireTime < fireDelay) {
      console.log(`Fire rate limited. Wait ${(fireDelay - (currentTime - this.lastFireTime))}ms`)
      return false
    }
    
    this.lastFireTime = currentTime
    console.log('Firing rocket at:', startPosition, 'direction:', direction)
    
    // Create rocket projectile
    const rocket = this.createRocketMesh()
    rocket.position = startPosition.clone()
    
    // Calculate velocity
    const velocity = direction.normalize().scale(this.config.projectileSpeed)
    
    // Disable physics for debugging
    console.log('Rocket physics disabled for debugging')
    // rocket.physicsImpostor = new PhysicsImpostor(
    //   rocket,
    //   PhysicsImpostor.SphereImpostor,
    //   { mass: 1, restitution: 0 },
    //   this.scene
    // )
    
    // rocket.physicsImpostor.setLinearVelocity(velocity)
    
    // Create projectile data
    const projectile: Projectile = {
      mesh: rocket,
      velocity: velocity,
      damage: this.config.damage,
      splashRadius: this.config.splashRadius,
      startTime: currentTime,
      lifeTime: 5000 // 5 seconds
    }
    
    this.projectiles.push(projectile)
    
    // Add particle trail
    this.createRocketTrail(rocket)
    
    return true
  }

  public update(deltaTime: number): void {
    this.updateProjectiles(deltaTime)
  }

  private createRocketMesh(): Mesh {
    // Create rocket mesh (larger and more visible)
    const rocket = Mesh.CreateCylinder('rocket', 0.8, 0.15, 0.15, 8, 1, this.scene)
    
    // Create bright material
    const material = new StandardMaterial('rocketMaterial', this.scene)
    material.diffuseColor = new Color3(1.0, 0.3, 0.1) // Bright orange
    material.emissiveColor = new Color3(0.8, 0.4, 0.1) // Glowing effect
    rocket.material = material
    
    console.log('Created rocket mesh at:', rocket.position)
    
    return rocket
  }

  private createRocketTrail(rocket: Mesh): void {
    // Create particle system for rocket trail
    const particleSystem = new ParticleSystem('rocketTrail', 100, this.scene)
    
    // Texture (you could load a fire texture, but for now we'll use basic particles)
    particleSystem.particleTexture = new Texture('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', this.scene)
    
    // Emitter
    particleSystem.emitter = rocket
    particleSystem.minEmitBox = new Vector3(-0.05, -0.05, -0.1)
    particleSystem.maxEmitBox = new Vector3(0.05, 0.05, 0.1)
    
    // Colors
    particleSystem.color1 = new Color4(1, 0.5, 0, 1)
    particleSystem.color2 = new Color4(1, 0, 0, 1)
    particleSystem.colorDead = new Color4(0.3, 0.1, 0, 0)
    
    // Size
    particleSystem.minSize = 0.1
    particleSystem.maxSize = 0.3
    
    // Life time
    particleSystem.minLifeTime = 0.2
    particleSystem.maxLifeTime = 0.5
    
    // Emission rate
    particleSystem.emitRate = 50
    
    // Direction
    particleSystem.direction1 = new Vector3(-0.5, -0.5, -2)
    particleSystem.direction2 = new Vector3(0.5, 0.5, -2)
    
    // Angular speed
    particleSystem.minAngularSpeed = 0
    particleSystem.maxAngularSpeed = Math.PI
    
    // Speed
    particleSystem.minInitialRotation = 0
    particleSystem.maxInitialRotation = Math.PI
    
    particleSystem.start()
    
    // Store reference to clean up later
    rocket.metadata = { particleSystem }
  }

  private updateProjectiles(deltaTime: number): void {
    const currentTime = Date.now()
    
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i]
      
      // Manual movement since physics is disabled
      const movement = projectile.velocity.scale(deltaTime)
      projectile.mesh.position.addInPlace(movement)
      
      console.log(`Rocket ${i} position:`, projectile.mesh.position.toString())
      
      // Apply gravity manually
      projectile.velocity.y -= 9.81 * deltaTime
      
      // Check for collision with environment
      const collision = this.checkProjectileCollision(projectile)
      
      // Check lifetime or collision
      if (currentTime - projectile.startTime > projectile.lifeTime || collision) {
        console.log(`Rocket ${i} exploding at:`, projectile.mesh.position.toString())
        this.explodeProjectile(projectile, collision?.point || projectile.mesh.position)
        this.removeProjectile(i)
      }
    }
  }

  private checkProjectileCollision(projectile: Projectile): { point: Vector3 } | null {
    // Simple collision detection without physics
    const position = projectile.mesh.position
    
    // Check if rocket hit the ground (Y <= 0)
    if (position.y <= 0) {
      return { point: position.clone() }
    }
    
    // Check if rocket hit arena boundaries (updated for bigger map)
    if (Math.abs(position.x) > 85 || Math.abs(position.z) > 85) {
      return { point: position.clone() }
    }
    
    return null
  }

  private explodeProjectile(projectile: Projectile, explosionPoint: Vector3): void {
    // Create explosion effect
    this.createExplosion(explosionPoint)
    
    // Deal splash damage to nearby entities
    this.dealSplashDamage(explosionPoint, projectile.splashRadius, projectile.damage)
  }

  private createExplosion(position: Vector3): void {
    // Create explosion particle system
    const explosion = new ParticleSystem('explosion', 200, this.scene)
    
    // Simple explosion effect (in a real game, you'd use proper textures)
    explosion.particleTexture = new Texture('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', this.scene)
    
    // Position
    explosion.emitter = position
    explosion.minEmitBox = new Vector3(-0.5, -0.5, -0.5)
    explosion.maxEmitBox = new Vector3(0.5, 0.5, 0.5)
    
    // Colors
    explosion.color1 = new Color4(1, 1, 0, 1)
    explosion.color2 = new Color4(1, 0.5, 0, 1)
    explosion.colorDead = new Color4(0.3, 0.1, 0, 0)
    
    // Size
    explosion.minSize = 0.2
    explosion.maxSize = 1.0
    
    // Life time
    explosion.minLifeTime = 0.3
    explosion.maxLifeTime = 0.8
    
    // Emission
    explosion.emitRate = 500
    explosion.manualEmitCount = 100
    
    // Direction (spherical explosion)
    explosion.createSphereEmitter(2.0)
    
    // Speed
    explosion.minEmitPower = 2
    explosion.maxEmitPower = 8
    
    explosion.start()
    
    // Stop and dispose after explosion
    setTimeout(() => {
      explosion.stop()
      setTimeout(() => explosion.dispose(), 1000)
    }, 100)
  }

  private dealSplashDamage(explosionPoint: Vector3, radius: number, baseDamage: number): void {
    console.log(`Explosion at ${explosionPoint.toString()} with radius ${radius} and damage ${baseDamage}`)
    
    // Store explosion data for external systems to handle
    // The Game class will call enemyManager.checkSplashDamage()
    this.lastExplosion = {
      point: explosionPoint,
      radius: radius,
      damage: baseDamage
    }
  }
  
  private lastExplosion: { point: Vector3, radius: number, damage: number } | null = null
  
  public getLastExplosion(): { point: Vector3, radius: number, damage: number } | null {
    const explosion = this.lastExplosion
    this.lastExplosion = null // Clear after reading
    return explosion
  }

  private removeProjectile(index: number): void {
    const projectile = this.projectiles[index]
    
    // Clean up particle system
    if (projectile.mesh.metadata?.particleSystem) {
      projectile.mesh.metadata.particleSystem.stop()
      projectile.mesh.metadata.particleSystem.dispose()
    }
    
    // Temporarily disable physics disposal
    // if (projectile.mesh.physicsImpostor) {
    //   try {
    //     projectile.mesh.physicsImpostor.dispose()
    //   } catch (error) {
    //     console.warn('Error disposing projectile physics impostor:', error)
    //   }
    // }
    
    // Dispose mesh
    projectile.mesh.dispose()
    
    // Remove from array
    this.projectiles.splice(index, 1)
  }

  public getProjectiles(): Projectile[] {
    return this.projectiles
  }

  public dispose(): void {
    // Clean up all projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      this.removeProjectile(i)
    }
  }
} 