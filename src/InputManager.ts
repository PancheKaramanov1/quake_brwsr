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
  private pointerLocked = false

  constructor(private canvas: HTMLCanvasElement) {
    this.setupEventListeners()
  }

  private setupEventListeners(): void {
    // Keyboard events
    window.addEventListener('keydown', (e) => this.onKeyDown(e))
    window.addEventListener('keyup', (e) => this.onKeyUp(e))

    // Mouse events
    this.canvas.addEventListener('click', () => this.requestPointerLock())
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e))
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e))
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e))

    // Pointer lock events
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas
      console.log('Pointer lock changed:', this.pointerLocked) // Debug
    })
  }

  private onKeyDown(event: KeyboardEvent): void {
    console.log('Key down:', event.code) // Debug: Check if keys are being detected
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
    if (event.button === 0) { // Left mouse button
      this.inputState.shoot = true
    }
  }

  private onMouseUp(event: MouseEvent): void {
    if (event.button === 0) { // Left mouse button
      this.inputState.shoot = false
    }
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
    this.inputState.dash = this.keys['ShiftLeft'] || this.keys['ShiftRight'] || false
    this.inputState.flight = this.keys['KeyF'] || false
  }

  private requestPointerLock(): void {
    this.canvas.requestPointerLock()
  }

  public getInputState(): InputState {
    // Reset mouse movement after reading
    const state = { ...this.inputState }
    this.inputState.mouseX = 0
    this.inputState.mouseY = 0
    return state
  }

  public isPointerLocked(): boolean {
    return this.pointerLocked
  }
} 