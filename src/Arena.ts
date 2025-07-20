import { Vector3, Mesh, MeshBuilder, Scene, StandardMaterial, Color3, PhysicsImpostor, HemisphericLight, DirectionalLight } from '@babylonjs/core'

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
    
    // Add more complex obstacles for bigger map
    this.createAdvancedObstacles()
  }

  private createGround(): Mesh {
    // Larger ground plane for bigger map with more subdivisions for detail
    const ground = Mesh.CreateGround('ground', 200, 200, 32, this.scene)
    
    // Enhanced ground material with concrete-like appearance
    const groundMaterial = new StandardMaterial('groundMaterial', this.scene)
    
    // Create a more detailed, concrete-like appearance
    groundMaterial.diffuseColor = new Color3(0.4, 0.42, 0.38) // Concrete gray-green
    groundMaterial.specularColor = new Color3(0.15, 0.15, 0.12)
    groundMaterial.specularPower = 32 // Less shiny for realistic concrete
    groundMaterial.roughness = 0.8 // High roughness for concrete texture
    
    ground.material = groundMaterial
    
    // Disable physics for debugging
    console.log('Arena physics disabled for debugging')
    // ground.physicsImpostor = new PhysicsImpostor(
    //   ground,
    //   PhysicsImpostor.BoxImpostor,
    //   { mass: 0, restitution: 0.2, friction: 0.8 },
    //   this.scene
    // )
    
    this.meshes.push(ground)
    return ground
  }

  private createWalls(): void {
    const wallHeight = 15
    const wallThickness = 2
    const arenaSize = 90  // Much bigger arena
    
    // Enhanced wall material - industrial concrete look
    const wallMaterial = new StandardMaterial('wallMaterial', this.scene)
    wallMaterial.diffuseColor = new Color3(0.6, 0.58, 0.55) // Warm concrete
    wallMaterial.specularColor = new Color3(0.1, 0.1, 0.08)
    wallMaterial.specularPower = 64 // Smoother than ground
    wallMaterial.roughness = 0.6
    
    // North wall
    const northWall = MeshBuilder.CreateBox('northWall', { width: arenaSize * 2, height: wallHeight, depth: wallThickness }, this.scene)
    northWall.position = new Vector3(0, wallHeight / 2, arenaSize)
    northWall.material = wallMaterial
    // northWall.physicsImpostor = new PhysicsImpostor(northWall, PhysicsImpostor.BoxImpostor, { mass: 0 }, this.scene)
    this.meshes.push(northWall)
    
    // South wall
    const southWall = MeshBuilder.CreateBox('southWall', { width: arenaSize * 2, height: wallHeight, depth: wallThickness }, this.scene)
    southWall.position = new Vector3(0, wallHeight / 2, -arenaSize)
    southWall.material = wallMaterial
    // southWall.physicsImpostor = new PhysicsImpostor(southWall, PhysicsImpostor.BoxImpostor, { mass: 0 }, this.scene)
    this.meshes.push(southWall)
    
    // East wall
    const eastWall = MeshBuilder.CreateBox('eastWall', { width: wallThickness, height: wallHeight, depth: arenaSize * 2 }, this.scene)
    eastWall.position = new Vector3(arenaSize, wallHeight / 2, 0)
    eastWall.material = wallMaterial
    // eastWall.physicsImpostor = new PhysicsImpostor(eastWall, PhysicsImpostor.BoxImpostor, { mass: 0 }, this.scene)
    this.meshes.push(eastWall)
    
    // West wall
    const westWall = MeshBuilder.CreateBox('westWall', { width: wallThickness, height: wallHeight, depth: arenaSize * 2 }, this.scene)
    westWall.position = new Vector3(-arenaSize, wallHeight / 2, 0)
    westWall.material = wallMaterial
    // westWall.physicsImpostor = new PhysicsImpostor(westWall, PhysicsImpostor.BoxImpostor, { mass: 0 }, this.scene)
    this.meshes.push(westWall)
  }

  private createPlatforms(): void {
    const platformMaterial = new StandardMaterial('platformMaterial', this.scene)
    platformMaterial.diffuseColor = new Color3(0.4, 0.6, 0.4)
    platformMaterial.specularColor = new Color3(0.1, 0.2, 0.1)
    
    // Center elevated platform
    const centerPlatform = MeshBuilder.CreateBox('platform1', { width: 8, height: 1, depth: 8 }, this.scene)
    centerPlatform.position = new Vector3(0, 3, 0)
    centerPlatform.material = platformMaterial
    // centerPlatform.physicsImpostor = new PhysicsImpostor(centerPlatform, PhysicsImpostor.BoxImpostor, { mass: 0 }, this.scene)
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
      const platform = MeshBuilder.CreateBox(`platform${index + 2}`, platformConfig.size, this.scene)
      platform.position = platformConfig.pos
      platform.material = platformMaterial
      // platform.physicsImpostor = new PhysicsImpostor(platform, PhysicsImpostor.BoxImpostor, { mass: 0 }, this.scene)
      this.meshes.push(platform)
    })
    
    // Create ramps to some platforms
    this.createRamps()
  }

  private createRamps(): void {
    const rampMaterial = new StandardMaterial('rampMaterial', this.scene)
    rampMaterial.diffuseColor = new Color3(0.6, 0.4, 0.3)
    
    // Ramp to center platform
    const ramp1 = MeshBuilder.CreateBox('ramp1', { width: 2, height: 0.2, depth: 6 }, this.scene)
    ramp1.position = new Vector3(5, 1.5, 0)
    ramp1.rotation.z = Math.PI / 8 // 22.5 degree angle
    ramp1.material = rampMaterial
    // ramp1.physicsImpostor = new PhysicsImpostor(ramp1, PhysicsImpostor.BoxImpostor, { mass: 0 }, this.scene)
    this.meshes.push(ramp1)
    
    // Ramp to corner platform
    const ramp2 = MeshBuilder.CreateBox('ramp2', { width: 2, height: 0.2, depth: 4 }, this.scene)
    ramp2.position = new Vector3(12, 1, 15)
    ramp2.rotation.z = Math.PI / 10 // Gentle slope
    ramp2.material = rampMaterial
    // ramp2.physicsImpostor = new PhysicsImpostor(ramp2, PhysicsImpostor.BoxImpostor, { mass: 0 }, this.scene)
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
        obstacle = MeshBuilder.CreateBox(`obstacle${index}`, size, this.scene)
      }
      
      obstacle.position = obstacleConfig.pos
      obstacle.material = obstacleMaterial
      // obstacle.physicsImpostor = new PhysicsImpostor(obstacle, PhysicsImpostor.BoxImpostor, { mass: 0 }, this.scene)
      this.meshes.push(obstacle)
    })
  }

  private setupLighting(): void {
    // Enhanced ambient light for better base illumination
    const hemisphericLight = new HemisphericLight('hemisphericLight', new Vector3(0, 1, 0), this.scene)
    hemisphericLight.intensity = 0.7 // Slightly brighter for better visibility
    hemisphericLight.diffuse = new Color3(0.7, 0.8, 1.0) // Cool blue ambient
    hemisphericLight.specular = new Color3(0.3, 0.4, 0.6)
    
    // Main directional light - warm, dramatic lighting
    const directionalLight = new DirectionalLight('directionalLight', new Vector3(-0.8, -1.5, -0.6), this.scene)
    directionalLight.intensity = 1.0 // Stronger for more dramatic shadows
    directionalLight.diffuse = new Color3(1.0, 0.9, 0.75) // Warm sunlight
    directionalLight.specular = new Color3(0.8, 0.7, 0.5)
    directionalLight.position = new Vector3(40, 60, 30)
    
    // Add a secondary fill light for more dynamic lighting
    const fillLight = new DirectionalLight('fillLight', new Vector3(0.5, -0.8, 0.3), this.scene)
    fillLight.intensity = 0.4
    fillLight.diffuse = new Color3(0.5, 0.6, 0.9) // Cool blue fill
    fillLight.specular = new Color3(0.2, 0.3, 0.4)
    fillLight.position = new Vector3(-30, 40, -20)
  }

  private createAdvancedObstacles(): void {
    // Create the central pyramid/temple
    this.createPyramidTemple()
    
    // Add some strategic cover around the map
    this.createStrategicCover()
    
    // Create border walls around the entire map
    this.createBorderWalls()
  }

  private createPyramidTemple(): void {
    // Temple materials - ancient stone look
    const templeMaterial = new StandardMaterial('templeMaterial', this.scene)
    templeMaterial.diffuseColor = new Color3(0.7, 0.65, 0.5) // Sandy stone color
    templeMaterial.specularColor = new Color3(0.3, 0.25, 0.2)
    templeMaterial.specularPower = 32 // Moderate shine for aged stone
    templeMaterial.roughness = 0.8 // High roughness for stone texture

    const templeAccentMaterial = new StandardMaterial('templeAccentMaterial', this.scene)
    templeAccentMaterial.diffuseColor = new Color3(0.5, 0.45, 0.35) // Darker stone
    templeAccentMaterial.specularColor = new Color3(0.2, 0.15, 0.1)
    templeAccentMaterial.specularPower = 16
    templeAccentMaterial.roughness = 0.9

    // Build pyramid in layers from bottom to top
    const pyramidLayers = [
      { size: { width: 16, height: 2, depth: 16 }, y: 1, material: templeMaterial },
      { size: { width: 12, height: 2, depth: 12 }, y: 3, material: templeAccentMaterial },
      { size: { width: 8, height: 2, depth: 8 }, y: 5, material: templeMaterial },
      { size: { width: 6, height: 2, depth: 6 }, y: 7, material: templeAccentMaterial },
      { size: { width: 4, height: 2, depth: 4 }, y: 9, material: templeMaterial },
      { size: { width: 2, height: 3, depth: 2 }, y: 11.5, material: templeAccentMaterial } // Top spire
    ]

    pyramidLayers.forEach((layer, index) => {
      const pyramidLayer = MeshBuilder.CreateBox(`pyramidLayer${index}`, layer.size, this.scene)
      pyramidLayer.position = new Vector3(0, layer.y, 0)
      pyramidLayer.material = layer.material
      this.meshes.push(pyramidLayer)
    })

    // Add temple entrance stairs on four sides
    const stairMaterial = new StandardMaterial('stairMaterial', this.scene)
    stairMaterial.diffuseColor = new Color3(0.6, 0.55, 0.4)
    stairMaterial.specularColor = new Color3(0.25, 0.2, 0.15)
    stairMaterial.specularPower = 24

    const stairConfigs = [
      { pos: new Vector3(0, 0.5, 10), size: { width: 6, height: 1, depth: 2 } }, // South stairs
      { pos: new Vector3(0, 0.5, -10), size: { width: 6, height: 1, depth: 2 } }, // North stairs
      { pos: new Vector3(10, 0.5, 0), size: { width: 2, height: 1, depth: 6 } }, // East stairs
      { pos: new Vector3(-10, 0.5, 0), size: { width: 2, height: 1, depth: 6 } } // West stairs
    ]

    stairConfigs.forEach((stairConfig, index) => {
      const stair = MeshBuilder.CreateBox(`templeStair${index}`, stairConfig.size, this.scene)
      stair.position = stairConfig.pos
      stair.material = stairMaterial
      this.meshes.push(stair)
    })
  }

  private createStrategicCover(): void {
    // Cover material - weathered stone blocks
    const coverMaterial = new StandardMaterial('coverMaterial', this.scene)
    coverMaterial.diffuseColor = new Color3(0.55, 0.5, 0.45) // Weathered stone
    coverMaterial.specularColor = new Color3(0.2, 0.18, 0.15)
    coverMaterial.specularPower = 48
    coverMaterial.roughness = 0.7

    // Strategic cover positions around the temple
    const coverPositions = [
      // Near corners for flanking
      { pos: new Vector3(35, 1.5, 35), size: { width: 4, height: 3, depth: 4 } },
      { pos: new Vector3(-35, 1.5, 35), size: { width: 4, height: 3, depth: 4 } },
      { pos: new Vector3(35, 1.5, -35), size: { width: 4, height: 3, depth: 4 } },
      { pos: new Vector3(-35, 1.5, -35), size: { width: 4, height: 3, depth: 4 } },
      
      // Mid-range cover
      { pos: new Vector3(25, 1.5, 0), size: { width: 3, height: 3, depth: 6 } },
      { pos: new Vector3(-25, 1.5, 0), size: { width: 3, height: 3, depth: 6 } },
      { pos: new Vector3(0, 1.5, 25), size: { width: 6, height: 3, depth: 3 } },
      { pos: new Vector3(0, 1.5, -25), size: { width: 6, height: 3, depth: 3 } },
      
      // L-shaped cover for tactics
      { pos: new Vector3(50, 2, 20), size: { width: 6, height: 4, depth: 3 } },
      { pos: new Vector3(50, 2, -20), size: { width: 6, height: 4, depth: 3 } },
      { pos: new Vector3(-50, 2, 20), size: { width: 6, height: 4, depth: 3 } },
      { pos: new Vector3(-50, 2, -20), size: { width: 6, height: 4, depth: 3 } }
    ]

    coverPositions.forEach((coverConfig, index) => {
      const cover = MeshBuilder.CreateBox(`strategicCover${index}`, coverConfig.size, this.scene)
      cover.position = coverConfig.pos
      cover.material = coverMaterial
      this.meshes.push(cover)
    })
  }

  private createBorderWalls(): void {
    // Border wall material - imposing fortress walls
    const borderMaterial = new StandardMaterial('borderWallMaterial', this.scene)
    borderMaterial.diffuseColor = new Color3(0.4, 0.35, 0.3) // Dark fortress stone
    borderMaterial.specularColor = new Color3(0.15, 0.12, 0.1)
    borderMaterial.specularPower = 64
    borderMaterial.roughness = 0.9 // Very rough stone texture

    const wallHeight = 20 // Tall imposing walls
    const wallThickness = 3
    const mapBoundary = 95 // Just inside the ground boundary

    // Create the four border walls
    const borderWalls = [
      // North wall
      { pos: new Vector3(0, wallHeight / 2, mapBoundary), size: { width: mapBoundary * 2, height: wallHeight, depth: wallThickness } },
      // South wall  
      { pos: new Vector3(0, wallHeight / 2, -mapBoundary), size: { width: mapBoundary * 2, height: wallHeight, depth: wallThickness } },
      // East wall
      { pos: new Vector3(mapBoundary, wallHeight / 2, 0), size: { width: wallThickness, height: wallHeight, depth: mapBoundary * 2 } },
      // West wall
      { pos: new Vector3(-mapBoundary, wallHeight / 2, 0), size: { width: wallThickness, height: wallHeight, depth: mapBoundary * 2 } }
    ]

    borderWalls.forEach((wallConfig, index) => {
      const wall = MeshBuilder.CreateBox(`borderWall${index}`, wallConfig.size, this.scene)
      wall.position = wallConfig.pos
      wall.material = borderMaterial
      this.meshes.push(wall)
    })

    // Add some elevated platforms around the temple for vertical gameplay
    this.createElevatedPlatforms()
  }

  private createElevatedPlatforms(): void {
    // Platform material - ancient stone platforms
    const platformMaterial = new StandardMaterial('templePlatformMaterial', this.scene)
    platformMaterial.diffuseColor = new Color3(0.6, 0.55, 0.45) // Temple stone color
    platformMaterial.specularColor = new Color3(0.25, 0.22, 0.18)
    platformMaterial.specularPower = 48
    platformMaterial.roughness = 0.7

    // Strategic elevated platforms around the temple
    const elevatedPlatforms = [
      // Corner observation platforms
      { pos: new Vector3(60, 4, 60), size: { width: 8, height: 1, depth: 8 } },
      { pos: new Vector3(-60, 4, 60), size: { width: 8, height: 1, depth: 8 } },
      { pos: new Vector3(60, 4, -60), size: { width: 8, height: 1, depth: 8 } },
      { pos: new Vector3(-60, 4, -60), size: { width: 8, height: 1, depth: 8 } },
      
      // Mid-range platforms for tactical advantage
      { pos: new Vector3(40, 6, 0), size: { width: 6, height: 1, depth: 8 } },
      { pos: new Vector3(-40, 6, 0), size: { width: 6, height: 1, depth: 8 } },
      { pos: new Vector3(0, 6, 40), size: { width: 8, height: 1, depth: 6 } },
      { pos: new Vector3(0, 6, -40), size: { width: 8, height: 1, depth: 6 } },
      
      // High sniper platforms near borders
      { pos: new Vector3(75, 8, 25), size: { width: 5, height: 1, depth: 5 } },
      { pos: new Vector3(-75, 8, 25), size: { width: 5, height: 1, depth: 5 } },
      { pos: new Vector3(75, 8, -25), size: { width: 5, height: 1, depth: 5 } },
      { pos: new Vector3(-75, 8, -25), size: { width: 5, height: 1, depth: 5 } }
    ]

    elevatedPlatforms.forEach((platformConfig, index) => {
      const platform = MeshBuilder.CreateBox(`templePlatform${index}`, platformConfig.size, this.scene)
      platform.position = platformConfig.pos
      platform.material = platformMaterial
      this.meshes.push(platform)
    })
  }

  public getMeshes(): Mesh[] {
    return this.meshes
  }

  public getSpawnPoints(): Vector3[] {
    // Updated spawn points for temple-centered arena
    return [
      // Around the temple perimeter - safe distance from center
      new Vector3(20, 0.75, 20),    // Temple corners
      new Vector3(-20, 0.75, 20),   
      new Vector3(20, 0.75, -20),   
      new Vector3(-20, 0.75, -20),  
      
      // Mid-range positions around temple
      new Vector3(30, 0.75, 0),     // Cardinal directions from temple
      new Vector3(-30, 0.75, 0),    
      new Vector3(0, 0.75, 30),     
      new Vector3(0, 0.75, -30),    
      
      // Near strategic cover
      new Vector3(40, 0.75, 40),    // Near corner cover
      new Vector3(-40, 0.75, 40),   
      new Vector3(40, 0.75, -40),   
      new Vector3(-40, 0.75, -40),  
      
      // On elevated platforms (platform height + enemy half-height)
      new Vector3(60, 4.75, 60),    // Corner platforms
      new Vector3(-60, 4.75, 60),   
      new Vector3(60, 4.75, -60),   
      new Vector3(-60, 4.75, -60),  
      
      new Vector3(40, 6.75, 0),     // Mid-range platforms
      new Vector3(-40, 6.75, 0),    
      new Vector3(0, 6.75, 40),     
      new Vector3(0, 6.75, -40),    
      
      // High sniper platforms
      new Vector3(75, 8.75, 25),    
      new Vector3(-75, 8.75, 25),   
      new Vector3(75, 8.75, -25),   
      new Vector3(-75, 8.75, -25),
      
      // Near border walls for defensive spawning
      new Vector3(80, 0.75, 0),     
      new Vector3(-80, 0.75, 0),    
      new Vector3(0, 0.75, 80),     
      new Vector3(0, 0.75, -80)     
    ]
  }

  public dispose(): void {
    this.meshes.forEach(mesh => {
      // Temporarily disable physics disposal
      // if (mesh.physicsImpostor) {
      //   try {
      //     mesh.physicsImpostor.dispose()
      //   } catch (error) {
      //     console.warn('Error disposing arena physics impostor:', error)
      //   }
      // }
      try {
        mesh.dispose()
      } catch (error) {
        console.warn('Error disposing arena mesh:', error)
      }
    })
    this.meshes = []
  }
} 