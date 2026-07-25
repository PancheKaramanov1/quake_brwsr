/** Touch controls for mobile multiplayer (page-memory only, no persistence). */

export interface MobileSample {
  moveX: number
  moveY: number
  lookX: number
  lookY: number
  jump: boolean
  shoot: boolean
  scoreboard: boolean
}

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return (
    'ontouchstart' in window ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
  )
}

export class MobileControls {
  readonly isActive: boolean
  private root: HTMLDivElement | null = null
  private moveX = 0
  private moveY = 0
  private lookX = 0
  private lookY = 0
  private jump = false
  private shoot = false
  private scoreboard = false
  private moveTouchId: number | null = null
  private lookTouchId: number | null = null
  private moveOrigin = { x: 0, y: 0 }
  private lookOrigin = { x: 0, y: 0 }

  constructor(private readonly parent: HTMLElement) {
    this.isActive = isTouchDevice()
    if (!this.isActive) return
    this.root = document.createElement('div')
    this.root.id = 'mp-mobile-controls'
    Object.assign(this.root.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '900',
      pointerEvents: 'none',
      display: 'none',
      touchAction: 'none',
    } as CSSStyleDeclaration)

    const notice = document.createElement('div')
    notice.textContent = 'Rotate to landscape for best play'
    Object.assign(notice.style, {
      position: 'absolute',
      top: '8px',
      left: '50%',
      transform: 'translateX(-50%)',
      fontSize: '12px',
      color: 'rgba(255,255,255,0.7)',
      pointerEvents: 'none',
    } as CSSStyleDeclaration)

    const movePad = this.pad('left', '45%', '28%', (e) => this.onMovePad(e))
    const lookPad = this.pad('right', '45%', '40%', (e) => this.onLookPad(e))
    const fireBtn = this.button('FIRE', 'right', '22%', '14%', () => {
      this.shoot = true
    })
    const jumpBtn = this.button('JUMP', 'right', '38%', '14%', () => {
      this.jump = true
    })
    const scoreBtn = this.button('TAB', 'right', '8%', '12%', () => {
      this.scoreboard = true
    })

    this.root.append(notice, movePad, lookPad, fireBtn, jumpBtn, scoreBtn)
    this.parent.appendChild(this.root)

    // Prevent browser scroll/zoom while playing
    const block = (e: TouchEvent) => {
      if (this.root?.style.display === 'block') e.preventDefault()
    }
    document.addEventListener('touchmove', block, { passive: false })
    ;(this as unknown as { _block?: (e: TouchEvent) => void })._block = block
  }

  show(): void {
    if (!this.root) return
    this.root.style.display = 'block'
  }

  hide(): void {
    if (!this.root) return
    this.root.style.display = 'none'
  }

  sample(): MobileSample {
    const out: MobileSample = {
      moveX: this.moveX,
      moveY: this.moveY,
      lookX: this.lookX,
      lookY: this.lookY,
      jump: this.jump,
      shoot: this.shoot,
      scoreboard: this.scoreboard,
    }
    this.lookX = 0
    this.lookY = 0
    this.jump = false
    this.shoot = false
    this.scoreboard = false
    return out
  }

  dispose(): void {
    const block = (this as unknown as { _block?: (e: TouchEvent) => void })._block
    if (block) document.removeEventListener('touchmove', block)
    this.root?.remove()
    this.root = null
  }

  private pad(
    side: 'left' | 'right',
    bottom: string,
    size: string,
    handler: (e: TouchEvent) => void,
  ): HTMLDivElement {
    const el = document.createElement('div')
    Object.assign(el.style, {
      position: 'absolute',
      bottom,
      [side]: '4%',
      width: size,
      height: size,
      maxWidth: '180px',
      maxHeight: '180px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.08)',
      border: '1px solid rgba(255,255,255,0.2)',
      pointerEvents: 'auto',
      touchAction: 'none',
    } as unknown as CSSStyleDeclaration)
    el.addEventListener('touchstart', handler, { passive: false })
    el.addEventListener('touchmove', handler, { passive: false })
    el.addEventListener('touchend', handler, { passive: false })
    el.addEventListener('touchcancel', handler, { passive: false })
    return el
  }

  private button(
    label: string,
    side: 'left' | 'right',
    bottom: string,
    size: string,
    onPress: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = label
    Object.assign(btn.style, {
      position: 'absolute',
      bottom,
      [side]: side === 'right' ? '8%' : '8%',
      width: size,
      height: size,
      maxWidth: '88px',
      maxHeight: '88px',
      borderRadius: '50%',
      border: '1px solid rgba(255,255,255,0.35)',
      background: 'rgba(30,40,50,0.75)',
      color: '#fff',
      fontWeight: '700',
      fontSize: '12px',
      pointerEvents: 'auto',
      touchAction: 'none',
    } as unknown as CSSStyleDeclaration)
    const press = (e: Event) => {
      e.preventDefault()
      btn.style.background = 'rgba(80,120,160,0.9)'
      onPress()
    }
    const release = () => {
      btn.style.background = 'rgba(30,40,50,0.75)'
    }
    btn.addEventListener('touchstart', press, { passive: false })
    btn.addEventListener('touchend', release)
    btn.addEventListener('mousedown', press)
    btn.addEventListener('mouseup', release)
    return btn
  }

  private onMovePad(e: TouchEvent): void {
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    if (e.type === 'touchend' || e.type === 'touchcancel') {
      this.moveTouchId = null
      this.moveX = 0
      this.moveY = 0
      return
    }
    const t = this.pickTouch(e, this.moveTouchId) ?? e.changedTouches[0]
    if (!t) return
    if (e.type === 'touchstart') {
      this.moveTouchId = t.identifier
      this.moveOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }
    const dx = (t.clientX - this.moveOrigin.x) / (rect.width * 0.45)
    const dy = (t.clientY - this.moveOrigin.y) / (rect.height * 0.45)
    this.moveX = Math.max(-1, Math.min(1, dx))
    this.moveY = Math.max(-1, Math.min(1, -dy))
    const len = Math.hypot(this.moveX, this.moveY)
    if (len > 1) {
      this.moveX /= len
      this.moveY /= len
    }
  }

  private onLookPad(e: TouchEvent): void {
    e.preventDefault()
    if (e.type === 'touchend' || e.type === 'touchcancel') {
      this.lookTouchId = null
      return
    }
    const t = this.pickTouch(e, this.lookTouchId) ?? e.changedTouches[0]
    if (!t) return
    if (e.type === 'touchstart') {
      this.lookTouchId = t.identifier
      this.lookOrigin = { x: t.clientX, y: t.clientY }
      return
    }
    const dx = t.clientX - this.lookOrigin.x
    const dy = t.clientY - this.lookOrigin.y
    this.lookOrigin = { x: t.clientX, y: t.clientY }
    this.lookX += dx
    this.lookY += dy
  }

  private pickTouch(e: TouchEvent, id: number | null): Touch | null {
    if (id === null) return null
    for (let i = 0; i < e.touches.length; i++) {
      const t = e.touches.item(i)
      if (t && t.identifier === id) return t
    }
    return null
  }
}
