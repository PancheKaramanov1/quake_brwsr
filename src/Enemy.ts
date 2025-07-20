import { Vector3, Mesh, Scene, StandardMaterial, Color3, PhysicsImpostor, Ray, AbstractMesh } from '@babylonjs/core'

export class Enemy {
  public mesh!: Mesh // Definite assignment assertion
  public health: number = 100
  public maxHealth: number = 100
  public speed: number = 6  // Faster movement
  public damage: number = 20
  public attackRange: number = 25  // Longer attack range
  public sightRange: number = 40   // Better sight range
  public shootRange: number = 30   // Range at which enemies shoot
  
  private target: Vector3 | null = null
  private lastAttackTime: number = 0
  private attackCooldown: number = 1500 // 1.5 seconds between shots
  private patrolTarget!: Vector3 // Definite assignment assertion
  private isPatrolling: boolean = true
  private _isDead: boolean = false // Renamed to avoid conflict
  private enemyProjectiles: Mesh[] = [] // Track enemy projectiles

  constructor(scene: Scene, position: Vector3, name: string = 'enemy') {
    this.createEnemyMesh(scene, position, name)
    this.patrolTarget = this.generatePatrolTarget(position)
  }

  private createEnemyMesh(scene: Scene, position: Vector3, name: string): void {
    // Create enemy as a red box for now
    this.mesh = Mesh.CreateBox(name, 1.5, scene)
    
    // Ensure enemy spawns on ground level (adjust Y position)
    const groundLevel = 0.75 // Half the enemy height (1.5/2) to sit on ground
    this.mesh.position = new Vector3(position.x, groundLevel, position.z)
    
    // Enhanced enemy material - menacing red with metallic hints
    const material = new StandardMaterial(`${name}Material`, scene)
    material.diffuseColor = new Color3(0.9, 0.15, 0.1) // Brighter, more aggressive red
    material.specularColor = new Color3(0.3, 0.1, 0.1) // Red metallic highlights
    material.emissiveColor = new Color3(0.15, 0.02, 0.02) // Subtle glow
    material.specularPower = 64 // Moderate shine
    this.mesh.material = material
    
    // Temporarily disable physics for debugging
    console.log('Enemy physics disabled for debugging')
    // this.mesh.physicsImpostor = new PhysicsImpostor(
    //   this.mesh,
    //   PhysicsImpostor.BoxImpostor,
    //   { mass: 1, restitution: 0.1, friction: 0.8 },
    //   scene
    // )
    
    // this.mesh.physicsImpostor.setAngularVelocity(Vector3.Zero())
  }

  public update(deltaTime: number, playerPosition: Vector3): void {
    if (this._isDead) return

    // Check if player is in sight range
    const distanceToPlayer = Vector3.Distance(this.mesh.position, playerPosition)
    
    if (distanceToPlayer <= this.sightRange) {
      // Player is in range - switch to combat mode
      this.target = playerPosition.clone()
      this.isPatrolling = false
      
      if (distanceToPlayer <= this.shootRange) {
        // Shoot at player from medium range
        this.handleShooting(playerPosition)
        if (distanceToPlayer > this.attackRange * 0.7) {
          // Keep moving closer while shooting
          this.moveTowardsTarget(deltaTime)
        }
      } else if (distanceToPlayer <= this.attackRange) {
        this.handleCombat(playerPosition)
      } else {
        // Always chase the player aggressively
        this.moveTowardsTarget(deltaTime)
      }
    } else {
      // No player in sight - patrol
      this.patrol(deltaTime)
    }
    
    // Update enemy projectiles
    this.updateProjectiles(deltaTime)
    
    // Keep enemy upright and on the ground
    this.mesh.rotation = Vector3.Zero()
    
    // Ensure enemy stays on ground level (no floating)
    const groundLevel = 0.75 // Half enemy height (1.5/2)
    if (this.mesh.position.y !== groundLevel) {
      this.mesh.position.y = groundLevel
    }
    
    // if (this.mesh.physicsImpostor) {
    //   this.mesh.physicsImpostor.setAngularVelocity(Vector3.Zero())
    // }
  }

  private moveTowardsTarget(deltaTime: number): void {
    if (!this.target) return

    const direction = this.target.subtract(this.mesh.position)
    direction.y = 0 // Keep movement horizontal
    direction.normalize()

    // Simple direct movement (no physics)
    const movement = direction.scale(this.speed * deltaTime)
    this.mesh.position.addInPlace(movement)
    
    // Ensure enemy stays on ground during movement
    this.mesh.position.y = 0.75
    
    // Face the target
    this.mesh.lookAt(this.target)
  }

  private patrol(deltaTime: number): void {
    // Check if reached patrol target
    const distanceToPatrol = Vector3.Distance(this.mesh.position, this.patrolTarget)
    
    if (distanceToPatrol < 2) {
      // Generate new patrol target
      this.patrolTarget = this.generatePatrolTarget(this.mesh.position)
    }
    
    // Move towards patrol target
    const direction = this.patrolTarget.subtract(this.mesh.position)
    direction.y = 0
    direction.normalize()

    // Simple direct movement (no physics)
    const movement = direction.scale(this.speed * 0.5 * deltaTime) // Slower patrol speed
    this.mesh.position.addInPlace(movement)
    
    // Ensure enemy stays on ground during patrol
    this.mesh.position.y = 0.75
  }

  private generatePatrolTarget(currentPosition: Vector3): Vector3 {
    // Generate random patrol point within reasonable distance
    const radius = 10
    const angle = Math.random() * Math.PI * 2
    const distance = Math.random() * radius + 3
    
    return new Vector3(
      currentPosition.x + Math.cos(angle) * distance,
      currentPosition.y,
      currentPosition.z + Math.sin(angle) * distance
    )
  }

  private handleCombat(playerPosition: Vector3): void {
    const currentTime = Date.now()
    
    // Face the player
    this.mesh.lookAt(playerPosition)
    
    // Attack if cooldown is over
    if (currentTime - this.lastAttackTime > this.attackCooldown) {
      this.attack(playerPosition)
      this.lastAttackTime = currentTime
    }
    
    // Stop moving when in attack range (no physics needed)
    // Enemy just stays in position during attack
  }

  private handleShooting(playerPosition: Vector3): void {
    const currentTime = Date.now()
    
    // Face the player
    this.mesh.lookAt(playerPosition)
    
    // Shoot if cooldown is over
    if (currentTime - this.lastAttackTime > this.attackCooldown) {
      this.shootProjectile(playerPosition)
      this.lastAttackTime = currentTime
    }
  }

  private shootProjectile(playerPosition: Vector3): void {
    console.log(`Enemy ${this.mesh.name} shoots at player!`)
    
    // Create enemy projectile (blue to distinguish from player rockets)
    const projectile = Mesh.CreateSphere(`enemyProjectile_${Date.now()}`, 8, 0.3, this.mesh.getScene())
    projectile.position = this.mesh.position.clone()
    projectile.position.y += 0.5 // Shoot from slightly above center
    
    // Blue enemy projectile material
    const material = new StandardMaterial(`enemyProjectileMat_${Date.now()}`, this.mesh.getScene())
    material.diffuseColor = new Color3(0.1, 0.3, 1.0) // Blue
    material.emissiveColor = new Color3(0.05, 0.2, 0.8) // Glowing blue
    projectile.material = material
    
    // Calculate direction to player
    const direction = playerPosition.subtract(this.mesh.position)
    direction.normalize()
    
    // Add some inaccuracy to make it challenging but not impossible
    direction.x += (Math.random() - 0.5) * 0.3
    direction.z += (Math.random() - 0.5) * 0.3
    direction.normalize()
    
    // Store projectile with velocity
    const velocity = direction.scale(15) // Enemy projectile speed
    projectile.metadata = {
      velocity: velocity,
      startTime: Date.now(),
      damage: this.damage
    }
    
    this.enemyProjectiles.push(projectile)
    
    // Visual feedback for shooting
    const enemyMaterial = this.mesh.material as StandardMaterial
    if (enemyMaterial) {
      const originalColor = enemyMaterial.emissiveColor.clone()
      enemyMaterial.emissiveColor = new Color3(1, 0.5, 0) // Orange flash
      
      setTimeout(() => {
        enemyMaterial.emissiveColor = originalColor
      }, 200)
    }
  }

  private updateProjectiles(deltaTime: number): void {
    for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
      const projectile = this.enemyProjectiles[i]
      const metadata = projectile.metadata
      
      if (!metadata) continue
      
      // Move projectile
      const movement = metadata.velocity.scale(deltaTime)
      projectile.position.addInPlace(movement)
      
      // Apply gravity
      metadata.velocity.y -= 9.81 * deltaTime
      
      // Check if projectile should be removed
      const currentTime = Date.now()
      const age = currentTime - metadata.startTime
      
      if (age > 5000 || projectile.position.y < 0 || 
          Math.abs(projectile.position.x) > 60 || Math.abs(projectile.position.z) > 60) {
        // Remove old or out-of-bounds projectiles
        projectile.dispose()
        this.enemyProjectiles.splice(i, 1)
      }
    }
  }

  private attack(playerPosition: Vector3): void {
    // Legacy melee attack - in a real game, this would do damage directly
    console.log(`Enemy ${this.mesh.name} attacks player for ${this.damage} damage!`)
    
    // Visual feedback - briefly change color
    const material = this.mesh.material as StandardMaterial
    if (material) {
      const originalColor = material.emissiveColor.clone()
      material.emissiveColor = new Color3(1, 0.5, 0) // Orange flash
      
      setTimeout(() => {
        material.emissiveColor = originalColor
      }, 200)
    }
  }

  public takeDamage(amount: number): boolean {
    if (this._isDead) return false
    
    this.health -= amount
    console.log(`Enemy ${this.mesh.name} takes ${amount} damage. Health: ${this.health}/${this.maxHealth}`)
    
    // Visual damage feedback
    const material = this.mesh.material as StandardMaterial
    if (material) {
      const flashIntensity = Math.min(amount / 50, 1) // Scale flash with damage
      material.emissiveColor = new Color3(flashIntensity, 0, 0)
      
      setTimeout(() => {
        if (!this._isDead) {
          material.emissiveColor = new Color3(0.2, 0.05, 0.05)
        }
      }, 300)
    }
    
    if (this.health <= 0) {
      this.die()
      return true // Enemy died
    }
    
    return false
  }

  private die(): void {
    this._isDead = true
    console.log(`Enemy ${this.mesh.name} has been destroyed!`)
    
    // Change appearance to indicate death
    const material = this.mesh.material as StandardMaterial
    if (material) {
      material.diffuseColor = new Color3(0.3, 0.3, 0.3) // Gray out
      material.emissiveColor = new Color3(0, 0, 0)
    }
    
    // Disable physics instead of disposing (safer with Havok)
    if (this.mesh.physicsImpostor) {
      try {
        this.mesh.physicsImpostor.setMass(0)
        this.mesh.physicsImpostor.setLinearVelocity(Vector3.Zero())
        this.mesh.physicsImpostor.setAngularVelocity(Vector3.Zero())
      } catch (error) {
        console.warn('Error disabling enemy physics:', error)
      }
    }
    
    // Make invisible and disable
    this.mesh.isVisible = false
    
    // Schedule removal (longer delay for safer cleanup)
    setTimeout(() => {
      this.dispose()
    }, 5000) // Remove after 5 seconds
  }

  public dispose(): void {
    // Temporarily disable physics disposal to avoid errors
    // if (this.mesh.physicsImpostor) {
    //   try {
    //     this.mesh.physicsImpostor.dispose()
    //   } catch (error) {
    //     console.warn('Error disposing enemy physics impostor:', error)
    //   }
    // }
    
    // Just dispose the mesh for now
    try {
      this.mesh.dispose()
    } catch (error) {
      console.warn('Error disposing enemy mesh:', error)
    }
  }

  public isInRange(position: Vector3, range: number): boolean {
    return Vector3.Distance(this.mesh.position, position) <= range
  }

  public getPosition(): Vector3 {
    return this.mesh.position.clone()
  }

  public isDeadCheck(): boolean {
    return this._isDead
  }
} 