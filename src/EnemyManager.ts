import { Vector3, Scene } from '@babylonjs/core'
import { Enemy } from './Enemy.js'
import { Player } from './Player.js'
import { WeaponSystem } from './WeaponSystem.js'
import { Projectile } from './types.js'

export class EnemyManager {
  private enemies: Enemy[] = []
  private spawnPoints: Vector3[] = []
  private maxEnemies: number = 12  // More enemies for bigger map
  private spawnCooldown: number = 5000 // 5 seconds for more action
  private lastSpawnTime: number = 0
  private enemyCounter: number = 0

  constructor(private scene: Scene, spawnPoints: Vector3[]) {
    this.spawnPoints = spawnPoints
    this.spawnInitialEnemies()
  }

  private spawnInitialEnemies(): void {
    // Spawn more enemies at start for immediate action
    for (let i = 0; i < Math.min(6, this.maxEnemies); i++) {
      this.spawnEnemy()
    }
  }

  public update(deltaTime: number, player: Player, weaponSystem: WeaponSystem): void {
    // Update all enemies
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i]
      
      if (enemy.isDeadCheck()) {
        // Remove dead enemies after they've been dead for a while
        // This gives time for death animations and safer cleanup
        this.enemies.splice(i, 1)
        continue
      }
      
      // Update enemy AI
      enemy.update(deltaTime, player.state.position)
      
      // Check collision with player rockets
      this.checkProjectileCollisions(enemy, weaponSystem.getProjectiles())
      
      // Check if enemy projectiles hit the player
      this.checkEnemyProjectileHits(enemy, player)
    }
    
    // Spawn new enemies if needed
    this.handleEnemySpawning()
  }

  private spawnEnemy(): void {
    if (this.enemies.length >= this.maxEnemies) return
    
    // Choose random spawn point
    const spawnPoint = this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)]
    
    // Offset spawn point slightly to avoid overlapping
    const offset = new Vector3(
      (Math.random() - 0.5) * 4,
      0,
      (Math.random() - 0.5) * 4
    )
    
    const finalSpawnPoint = spawnPoint.add(offset)
    finalSpawnPoint.y = 2 // Ensure enemies spawn above ground
    
    // Create enemy
    const enemy = new Enemy(this.scene, finalSpawnPoint, `enemy_${this.enemyCounter++}`)
    this.enemies.push(enemy)
    
    console.log(`Spawned enemy at ${finalSpawnPoint.toString()}. Total enemies: ${this.enemies.length}`)
  }

  private handleEnemySpawning(): void {
    const currentTime = Date.now()
    
    // Spawn new enemy if below max and cooldown expired
    if (this.enemies.length < this.maxEnemies && 
        currentTime - this.lastSpawnTime > this.spawnCooldown) {
      this.spawnEnemy()
      this.lastSpawnTime = currentTime
    }
  }

  private checkProjectileCollisions(enemy: Enemy, projectiles: Projectile[]): void {
    for (const projectile of projectiles) {
      const distance = Vector3.Distance(enemy.getPosition(), projectile.mesh.position)
      
      // Check direct hit
      if (distance < 1.0) {
        enemy.takeDamage(projectile.damage)
        console.log(`Direct rocket hit on ${enemy.mesh.name}!`)
        return
      }
      
      // Check splash damage (this would be handled by the explosion system in WeaponSystem)
      // For now, we'll let the WeaponSystem handle splash damage
    }
  }

  public checkSplashDamage(explosionPoint: Vector3, splashRadius: number, damage: number): void {
    // Check all enemies for splash damage
    for (const enemy of this.enemies) {
      if (enemy.isDeadCheck()) continue
      
      const distance = Vector3.Distance(enemy.getPosition(), explosionPoint)
      
      if (distance <= splashRadius) {
        // Calculate damage falloff
        const falloff = 1 - (distance / splashRadius)
        const splashDamage = Math.floor(damage * 0.5 * falloff) // 50% of base damage with falloff
        
        if (splashDamage > 0) {
          enemy.takeDamage(splashDamage)
          console.log(`Splash damage to ${enemy.mesh.name}: ${splashDamage} (distance: ${distance.toFixed(1)})`)
        }
      }
    }
  }

  public getEnemies(): Enemy[] {
    return this.enemies
  }

  public getEnemyCount(): number {
    return this.enemies.length
  }

  public dispose(): void {
    // Clean up all enemies safely
    for (const enemy of this.enemies) {
      try {
        enemy.dispose()
      } catch (error) {
        console.warn('Error disposing enemy:', error)
      }
    }
    this.enemies = []
  }

  private checkEnemyProjectileHits(enemy: Enemy, player: Player): void {
    // Get enemy projectiles (accessing private property through type assertion)
    const enemyAny = enemy as any
    if (!enemyAny.enemyProjectiles) return
    
    const projectiles = enemyAny.enemyProjectiles as any[]
    
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const projectile = projectiles[i]
      const distance = Vector3.Distance(projectile.position, player.state.position)
      
      // Check if projectile hit player (within 1.5 units)
      if (distance < 1.5) {
        console.log(`Player hit by enemy projectile! Damage: ${projectile.metadata?.damage || 20}`)
        
        // Deal damage to player
        player.takeDamage(projectile.metadata?.damage || 20)
        
        // Remove the projectile
        projectile.dispose()
        projectiles.splice(i, 1)
      }
    }
  }

  // Method for player to take damage from enemies
  public checkPlayerDamage(playerPosition: Vector3): number {
    let totalDamage = 0
    
    for (const enemy of this.enemies) {
      if (enemy.isDeadCheck()) continue
      
      // Check if enemy is in attack range
      if (enemy.isInRange(playerPosition, enemy.attackRange)) {
        // This is just for demo - in reality, enemies would handle their own attack timing
        totalDamage += enemy.damage
      }
    }
    
    return totalDamage
  }
} 