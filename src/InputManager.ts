import { InputState } from './types.js'

export class InputManager {
  private inputState: InputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    dash: false,
    shoot: false,
    flight: false,
    mouseX: 0,
    mouseY: 0
  }

  private keys: { [key: string]: boolean } = {}
  private shootPressed = false // Track if shoot was just pressed (mouse or key)
  private dashPressed = false // Track if dash key was just pressed
  private pointerLocked = false

  constructor(private canvas: HTMLCanvasElement) {
    this.setupEventListeners()
  }

  private setupEventListeners(): void {
    // Keyboard events
    window.addEventListener('keydown', (e) => this.onKeyDown(e))
    window.addEventListener('keyup', (e) => this.onKeyUp(e))

    // Mouse events - make sure they're set up properly
    this.canvas.addEventListener('click', () => this.requestPointerLock())
    this.canvas.addEventListener('mousedown', (e) => {
      console.log('Canvas mousedown event captured')
      this.onMouseDown(e)
    })
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e))
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e))

    // Pointer lock events
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = !!document.pointerLockElement
    })
  }

  private onKeyDown(event: KeyboardEvent): void {
    // Handle one-shot inputs (only trigger on first press)
    if ((event.code === 'ShiftLeft' || event.code === 'ShiftRight') && 
        !this.keys['ShiftLeft'] && !this.keys['ShiftRight']) {
      this.dashPressed = true
    }
    
    // Handle F key shooting
    if (event.code === 'KeyF' && !this.keys['KeyF']) {
      this.shootPressed = true
      console.log('F key shoot pressed!')
    }
    
    this.keys[event.code] = true
    this.updateInputState()
    
    // Prevent default for game keys
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyF'].includes(event.code)) {
      event.preventDefault()
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    this.keys[event.code] = false
    this.updateInputState()
  }

  private onMouseDown(event: MouseEvent): void {
    console.log('Mouse down event:', event.button, 'Pointer locked:', this.pointerLocked)
    
    if (event.button === 0) { // Left mouse button
      this.shootPressed = true
      console.log('Mouse shoot flag set to true!')
      this.updateInputState() // Update input state immediately
      event.preventDefault() // Prevent default mouse behavior
    }
  }

  private onMouseUp(event: MouseEvent): void {
    // Mouse shooting uses one-shot system, no need to handle mouse up
  }

  private onMouseMove(event: MouseEvent): void {
    if (!this.pointerLocked) return

    this.inputState.mouseX = event.movementX
    this.inputState.mouseY = event.movementY
  }

  private updateInputState(): void {
    this.inputState.forward = this.keys['KeyW'] || false
    this.inputState.backward = this.keys['KeyS'] || false
    this.inputState.left = this.keys['KeyA'] || false
    this.inputState.right = this.keys['KeyD'] || false
    this.inputState.jump = this.keys['Space'] || false
    this.inputState.dash = this.dashPressed  // Use one-shot flag for Shift key
    this.inputState.shoot = this.shootPressed  // Use one-shot flag for F key or mouse click
    this.inputState.flight = false  // Flight removed
    
    // Debug shoot state
    if (this.shootPressed) {
      console.log('updateInputState: shoot is true!')
    }
  }

  private requestPointerLock(): void {
    this.canvas.requestPointerLock()
  }

  public getInputState(): InputState {
    // Reset mouse movement after reading
    const state = { ...this.inputState }
    
    // Debug shooting - only log when shoot is actually happening
    if (this.shootPressed) {
      console.log('InputManager: returning shoot=true to game!')
    }
    
    // Reset one-shot inputs after reading
    this.inputState.mouseX = 0
    this.inputState.mouseY = 0
    this.shootPressed = false
    this.dashPressed = false
    this.inputState.shoot = false
    this.inputState.dash = false
    this.inputState.flight = false
    
    return state
  }

  public isPointerLocked(): boolean {
    return this.pointerLocked
  }
} 