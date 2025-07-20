import { Vector3, Mesh, Scene, StandardMaterial, Color3, PhysicsImpostor, Ray, ParticleSystem, Texture } from '@babylonjs/core'
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
    
    // Check fire rate limit
    if (currentTime - this.lastFireTime < this.config.fireRate) {
      return false
    }
    
    this.lastFireTime = currentTime
    
    // Create rocket projectile
    const rocket = this.createRocketMesh()
    rocket.position = startPosition.clone()
    
    // Calculate velocity
    const velocity = direction.normalize().scale(this.config.projectileSpeed)
    
    // Setup physics
    rocket.physicsImpostor = new PhysicsImpostor(
      rocket,
      PhysicsImpostor.SphereImpostor,
      { mass: 1, restitution: 0 },
      this.scene
    )
    
    rocket.physicsImpostor.setLinearVelocity(velocity)
    
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
    // Create rocket mesh (simple cylinder for now)
    const rocket = Mesh.CreateCylinder('rocket', 0.3, 0.05, 0.05, 8, 1, this.scene)
    
    // Create material
    const material = new StandardMaterial('rocketMaterial', this.scene)
    material.diffuseColor = new Color3(0.8, 0.2, 0.1)
    material.emissiveColor = new Color3(0.3, 0.1, 0.05)
    rocket.material = material
    
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
    particleSystem.color1 = new Color3(1, 0.5, 0)
    particleSystem.color2 = new Color3(1, 0, 0)
    particleSystem.colorDead = new Color3(0.3, 0.1, 0)
    
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
      
      // Check for collision with environment
      const collision = this.checkProjectileCollision(projectile)
      
      // Check lifetime or collision
      if (currentTime - projectile.startTime > projectile.lifeTime || collision) {
        this.explodeProjectile(projectile, collision?.point || projectile.mesh.position)
        this.removeProjectile(i)
      }
    }
  }

  private checkProjectileCollision(projectile: Projectile): { point: Vector3 } | null {
    // Cast ray from projectile position in direction of movement
    const origin = projectile.mesh.position.clone()
    const direction = projectile.velocity.normalize()
    const ray = new Ray(origin, direction)
    
    const hit = this.scene.pickWithRay(ray, (mesh) => {
      return mesh !== projectile.mesh && 
             !mesh.name.includes('player') && 
             !mesh.name.includes('rocket') &&
             mesh.name.includes('ground')
    })
    
    if (hit?.hit && hit.distance < 0.5) {
      return { point: hit.pickedPoint! }
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
    explosion.color1 = new Color3(1, 1, 0)
    explosion.color2 = new Color3(1, 0.5, 0)
    explosion.colorDead = new Color3(0.3, 0.1, 0)
    
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
    // In a real game, you would check for all entities in the splash radius
    // For now, we'll just implement a placeholder that could be extended
    console.log(`Explosion at ${explosionPoint.toString()} with radius ${radius} and damage ${baseDamage}`)
    
    // TODO: Implement damage to player and other entities within radius
    // This would involve:
    // 1. Finding all entities within the splash radius
    // 2. Calculating damage falloff based on distance
    // 3. Applying damage to each entity
  }

  private removeProjectile(index: number): void {
    const projectile = this.projectiles[index]
    
    // Clean up particle system
    if (projectile.mesh.metadata?.particleSystem) {
      projectile.mesh.metadata.particleSystem.stop()
      projectile.mesh.metadata.particleSystem.dispose()
    }
    
    // Dispose physics
    if (projectile.mesh.physicsImpostor) {
      projectile.mesh.physicsImpostor.dispose()
    }
    
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