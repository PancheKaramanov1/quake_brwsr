import { Vector3, Mesh, Scene, StandardMaterial, Color3, PhysicsImpostor, HemisphericLight, DirectionalLight } from '@babylonjs/core'

export class Arena {
  private meshes: Mesh[] = []

  constructor(private scene: Scene) {
    this.createArena()
    this.setupLighting()
  }

  private createArena(): void {
    // Create ground plane
    const ground = this.createGround()
    
    // Create walls around the arena
    this.createWalls()
    
    // Create some platforms for vertical gameplay
    this.createPlatforms()
    
    // Create obstacles/cover
    this.createObstacles()
  }

  private createGround(): Mesh {
    // Large ground plane
    const ground = Mesh.CreateGround('ground', 100, 100, 2, this.scene)
    
    // Ground material
    const groundMaterial = new StandardMaterial('groundMaterial', this.scene)
    groundMaterial.diffuseColor = new Color3(0.3, 0.3, 0.4)
    groundMaterial.specularColor = new Color3(0.1, 0.1, 0.1)
    ground.material = groundMaterial
    
    // Physics
    ground.physicsImpostor = new PhysicsImpostor(
      ground,
      PhysicsImpostor.BoxImpostor,
      { mass: 0, restitution: 0.2, friction: 0.8 },
      this.scene
    )
    
    this.meshes.push(ground)
    return ground
  }

  private createWalls(): void {
    const wallHeight = 10
    const wallThickness = 1
    const arenaSize = 50
    
    // Wall material
    const wallMaterial = new StandardMaterial('wallMaterial', this.scene)
    wallMaterial.diffuseColor = new Color3(0.5, 0.5, 0.6)
    wallMaterial.specularColor = new Color3(0.2, 0.2, 0.2)
    
    // North wall
    const northWall = Mesh.CreateBox('northWall', { width: arenaSize * 2, height: wallHeight, depth: wallThickness }, this.scene)
    northWall.position = new Vector3(0, wallHeight / 2, arenaSize)
    northWall.material = wallMaterial
    northWall.physicsImpostor = new PhysicsImpostor(northWall, PhysicsImpostor.BoxImpostor, { mass: 0 }, this.scene)
    this.meshes.push(northWall)
    
    // South wall
    const southWall = Mesh.CreateBox('southWall', { width: arenaSize * 2, height: wallHeight, depth: wallThickness }, this.scene)
    southWall.position = new Vector3(0, wallHeight / 2, -arenaSize)
    southWall.material = wallMaterial
    southWall.physicsImpostor = new PhysicsImpostor(southWall, PhysicsImpostor.BoxImpostor, { mass: 0 }, this.scene)
    this.meshes.push(southWall)
    
    // East wall
    const eastWall = Mesh.CreateBox('eastWall', { width: wallThickness, height: wallHeight, depth: arenaSize * 2 }, this.scene)
    eastWall.position = new Vector3(arenaSize, wallHeight / 2, 0)
    eastWall.material = wallMaterial
    eastWall.physicsImpostor = new PhysicsImpostor(eastWall, PhysicsImpostor.BoxImpostor, { mass: 0 }, this.scene)
    this.meshes.push(eastWall)
    
    // West wall
    const westWall = Mesh.CreateBox('westWall', { width: wallThickness, height: wallHeight, depth: arenaSize * 2 }, this.scene)
    westWall.position = new Vector3(-arenaSize, wallHeight / 2, 0)
    westWall.material = wallMaterial
    westWall.physicsImpostor = new PhysicsImpostor(westWall, PhysicsImpostor.BoxImpostor, { mass: 0 }, this.scene)
    this.meshes.push(westWall)
  }

  private createPlatforms(): void {
    const platformMaterial = new StandardMaterial('platformMaterial', this.scene)
    platformMaterial.diffuseColor = new Color3(0.4, 0.6, 0.4)
    platformMaterial.specularColor = new Color3(0.1, 0.2, 0.1)
    
    // Center elevated platform
    const centerPlatform = Mesh.CreateBox('platform1', { width: 8, height: 1, depth: 8 }, this.scene)
    centerPlatform.position = new Vector3(0, 3, 0)
    centerPlatform.material = platformMaterial
    centerPlatform.physicsImpostor = new PhysicsImpostor(centerPlatform, PhysicsImpostor.BoxImpostor, { mass: 0 }, this.scene)
    this.meshes.push(centerPlatform)
    
    // Corner platforms
    const platforms = [
      { pos: new Vector3(15, 2, 15), size: { width: 6, height: 1, depth: 6 } },
      { pos: new Vector3(-15, 2, 15), size: { width: 6, height: 1, depth: 6 } },
      { pos: new Vector3(15, 2, -15), size: { width: 6, height: 1, depth: 6 } },
      { pos: new Vector3(-15, 2, -15), size: { width: 6, height: 1, depth: 6 } },
      
      // Mid-level platforms
      { pos: new Vector3(0, 5, 20), size: { width: 4, height: 1, depth: 4 } },
      { pos: new Vector3(0, 5, -20), size: { width: 4, height: 1, depth: 4 } },
      { pos: new Vector3(20, 4, 0), size: { width: 4, height: 1, depth: 4 } },
      { pos: new Vector3(-20, 4, 0), size: { width: 4, height: 1, depth: 4 } }
    ]
    
    platforms.forEach((platformConfig, index) => {
      const platform = Mesh.CreateBox(`platform${index + 2}`, platformConfig.size, this.scene)
      platform.position = platformConfig.pos
      platform.material = platformMaterial
      platform.physicsImpostor = new PhysicsImpostor(platform, PhysicsImpostor.BoxImpostor, { mass: 0 }, this.scene)
      this.meshes.push(platform)
    })
    
    // Create ramps to some platforms
    this.createRamps()
  }

  private createRamps(): void {
    const rampMaterial = new StandardMaterial('rampMaterial', this.scene)
    rampMaterial.diffuseColor = new Color3(0.6, 0.4, 0.3)
    
    // Ramp to center platform
    const ramp1 = Mesh.CreateBox('ramp1', { width: 2, height: 0.2, depth: 6 }, this.scene)
    ramp1.position = new Vector3(5, 1.5, 0)
    ramp1.rotation.z = Math.PI / 8 // 22.5 degree angle
    ramp1.material = rampMaterial
    ramp1.physicsImpostor = new PhysicsImpostor(ramp1, PhysicsImpostor.BoxImpostor, { mass: 0 }, this.scene)
    this.meshes.push(ramp1)
    
    // Ramp to corner platform
    const ramp2 = Mesh.CreateBox('ramp2', { width: 2, height: 0.2, depth: 4 }, this.scene)
    ramp2.position = new Vector3(12, 1, 15)
    ramp2.rotation.z = Math.PI / 10 // Gentle slope
    ramp2.material = rampMaterial
    ramp2.physicsImpostor = new PhysicsImpostor(ramp2, PhysicsImpostor.BoxImpostor, { mass: 0 }, this.scene)
    this.meshes.push(ramp2)
  }

  private createObstacles(): void {
    const obstacleMaterial = new StandardMaterial('obstacleMaterial', this.scene)
    obstacleMaterial.diffuseColor = new Color3(0.7, 0.3, 0.3)
    obstacleMaterial.specularColor = new Color3(0.2, 0.1, 0.1)
    
    // Create various obstacles for cover and interesting geometry
    const obstacles = [
      // Pillars
      { type: 'cylinder', pos: new Vector3(8, 2.5, 8), size: { diameter: 1.5, height: 5 } },
      { type: 'cylinder', pos: new Vector3(-8, 2.5, 8), size: { diameter: 1.5, height: 5 } },
      { type: 'cylinder', pos: new Vector3(8, 2.5, -8), size: { diameter: 1.5, height: 5 } },
      { type: 'cylinder', pos: new Vector3(-8, 2.5, -8), size: { diameter: 1.5, height: 5 } },
      
      // Boxes for cover
      { type: 'box', pos: new Vector3(12, 1, 0), size: { width: 2, height: 2, depth: 3 } },
      { type: 'box', pos: new Vector3(-12, 1, 0), size: { width: 2, height: 2, depth: 3 } },
      { type: 'box', pos: new Vector3(0, 1, 12), size: { width: 3, height: 2, depth: 2 } },
      { type: 'box', pos: new Vector3(0, 1, -12), size: { width: 3, height: 2, depth: 2 } },
      
      // L-shaped cover
      { type: 'box', pos: new Vector3(25, 1.5, 25), size: { width: 6, height: 3, depth: 1 } },
      { type: 'box', pos: new Vector3(28, 1.5, 22), size: { width: 1, height: 3, depth: 6 } }
    ]
    
    obstacles.forEach((obstacleConfig, index) => {
      let obstacle: Mesh
      
      if (obstacleConfig.type === 'cylinder') {
        const size = obstacleConfig.size as { diameter: number, height: number }
        obstacle = Mesh.CreateCylinder(`obstacle${index}`, size.height, size.diameter, size.diameter, 8, 1, this.scene)
      } else {
        const size = obstacleConfig.size as { width: number, height: number, depth: number }
        obstacle = Mesh.CreateBox(`obstacle${index}`, size, this.scene)
      }
      
      obstacle.position = obstacleConfig.pos
      obstacle.material = obstacleMaterial
      obstacle.physicsImpostor = new PhysicsImpostor(obstacle, PhysicsImpostor.BoxImpostor, { mass: 0 }, this.scene)
      this.meshes.push(obstacle)
    })
  }

  private setupLighting(): void {
    // Ambient light
    const hemisphericLight = new HemisphericLight('hemisphericLight', new Vector3(0, 1, 0), this.scene)
    hemisphericLight.intensity = 0.6
    hemisphericLight.diffuse = new Color3(0.8, 0.8, 1)
    hemisphericLight.specular = new Color3(0.2, 0.2, 0.4)
    
    // Directional light (sun)
    const directionalLight = new DirectionalLight('directionalLight', new Vector3(-1, -2, -1), this.scene)
    directionalLight.intensity = 0.8
    directionalLight.diffuse = new Color3(1, 0.9, 0.8)
    directionalLight.specular = new Color3(0.3, 0.3, 0.2)
    
    // Position the directional light
    directionalLight.position = new Vector3(20, 40, 20)
  }

  public getMeshes(): Mesh[] {
    return this.meshes
  }

  public getSpawnPoints(): Vector3[] {
    // Return various spawn points around the arena
    return [
      new Vector3(0, 2, 0),      // Center
      new Vector3(15, 3, 15),    // Corner platform
      new Vector3(-15, 3, 15),   // Corner platform
      new Vector3(15, 3, -15),   // Corner platform
      new Vector3(-15, 3, -15),  // Corner platform
      new Vector3(0, 6, 20),     // High platform
      new Vector3(0, 6, -20),    // High platform
    ]
  }

  public dispose(): void {
    this.meshes.forEach(mesh => {
      if (mesh.physicsImpostor) {
        mesh.physicsImpostor.dispose()
      }
      mesh.dispose()
    })
    this.meshes = []
  }
} 