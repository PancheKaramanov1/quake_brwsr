/** DOM overlay menu for single-player / multiplayer entry. */

import { RejectReason, type StandingEntry } from '../../shared/protocol/messages.js'

export type MenuMode = 'main' | 'multiplayer' | 'results' | 'hidden'

export interface MultiplayerMenuCallbacks {
  onSinglePlayer: () => void
  onConnect: (displayName: string, serverUrl: string) => void
  onBackToMain?: () => void
}

function defaultServerUrl(): string {
  const envUrl = import.meta.env.VITE_GAME_SERVER_URL
  if (typeof envUrl === 'string' && envUrl.length > 0) return envUrl
  return 'ws://localhost:8080/ws'
}

function rejectMessage(reason: RejectReason | string | null | undefined, fallback?: string): string {
  if (typeof reason === 'string' && reason.length > 0) return reason
  if (typeof reason === 'number') {
    switch (reason) {
      case RejectReason.Full:
        return 'Server is full — try again later.'
      case RejectReason.VersionMismatch:
        return 'Version mismatch — update the client or server.'
      case RejectReason.InvalidName:
        return 'Invalid display name.'
      case RejectReason.Banned:
        return 'You are banned from this server.'
      case RejectReason.Shutdown:
        return 'Server is shutting down.'
      case RejectReason.AuthFailed:
        return 'Reconnect authentication failed.'
      case RejectReason.Duplicate:
        return 'Duplicate session.'
      default:
        break
    }
  }
  return fallback ?? 'Connection rejected.'
}

export class MultiplayerMenu {
  private readonly root: HTMLDivElement
  private readonly mainPanel: HTMLDivElement
  private readonly multiPanel: HTMLDivElement
  private readonly resultsPanel: HTMLDivElement
  private readonly statusEl: HTMLParagraphElement
  private readonly resultsBody: HTMLDivElement
  private readonly reconnectEl: HTMLParagraphElement
  private mode: MenuMode = 'main'

  constructor(
    private readonly parent: HTMLElement,
    private readonly callbacks: MultiplayerMenuCallbacks,
  ) {
    this.root = document.createElement('div')
    this.root.id = 'mp-menu-root'
    Object.assign(this.root.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '1000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background:
        'radial-gradient(ellipse at 30% 20%, #2a3540 0%, #12161c 55%, #0a0c0f 100%)',
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      color: '#e8ecef',
    } as CSSStyleDeclaration)

    this.mainPanel = this.buildMainPanel()
    this.multiPanel = this.buildMultiPanel()
    this.resultsPanel = this.buildResultsPanel()

    this.statusEl = this.multiPanel.querySelector('#mp-status') as HTMLParagraphElement
    this.resultsBody = this.resultsPanel.querySelector('#mp-results-body') as HTMLDivElement
    this.reconnectEl = this.resultsPanel.querySelector('#mp-reconnect') as HTMLParagraphElement

    this.root.append(this.mainPanel, this.multiPanel, this.resultsPanel)
    this.parent.appendChild(this.root)
    this.setMode('main')
  }

  show(): void {
    this.root.style.display = 'flex'
    this.setMode('main')
  }

  hide(): void {
    this.root.style.display = 'none'
    this.mode = 'hidden'
  }

  setStatus(text: string, isError = false): void {
    this.statusEl.textContent = text
    this.statusEl.style.color = isError ? '#ff6b6b' : '#9ab0c0'
  }

  showReject(reason: RejectReason | string, message?: string): void {
    this.setMode('multiplayer')
    this.setStatus(message ?? rejectMessage(reason), true)
  }

  showReconnectStatus(text: string): void {
    this.reconnectEl.textContent = text
    this.reconnectEl.style.display = text ? 'block' : 'none'
  }

  showResults(standings: StandingEntry[]): void {
    this.setMode('results')
    this.resultsBody.replaceChildren()
    const table = document.createElement('table')
    Object.assign(table.style, {
      width: '100%',
      borderCollapse: 'collapse',
      marginTop: '12px',
    } as CSSStyleDeclaration)
    const head = document.createElement('thead')
    head.innerHTML =
      '<tr><th style="text-align:left;padding:6px">#</th><th style="text-align:left;padding:6px">Player</th><th style="text-align:right;padding:6px">K</th><th style="text-align:right;padding:6px">D</th></tr>'
    table.appendChild(head)
    const body = document.createElement('tbody')
    const sorted = [...standings].sort((a, b) => a.rank - b.rank)
    for (const s of sorted) {
      const tr = document.createElement('tr')
      tr.innerHTML = `<td style="padding:6px">${s.rank}</td><td style="padding:6px">${escapeHtml(
        s.displayName,
      )}</td><td style="padding:6px;text-align:right">${s.kills}</td><td style="padding:6px;text-align:right">${s.deaths}</td>`
      body.appendChild(tr)
    }
    table.appendChild(body)
    this.resultsBody.appendChild(table)
  }

  getMode(): MenuMode {
    return this.mode
  }

  dispose(): void {
    this.root.remove()
  }

  private setMode(mode: MenuMode): void {
    this.mode = mode
    this.root.style.display = mode === 'hidden' ? 'none' : 'flex'
    this.mainPanel.style.display = mode === 'main' ? 'block' : 'none'
    this.multiPanel.style.display = mode === 'multiplayer' ? 'block' : 'none'
    this.resultsPanel.style.display = mode === 'results' ? 'block' : 'none'
  }

  private buildMainPanel(): HTMLDivElement {
    const panel = this.panelShell('QUAKE BRWSR')
    const sub = document.createElement('p')
    sub.textContent = 'Local arena or online free-for-all'
    Object.assign(sub.style, {
      margin: '0 0 28px',
      opacity: '0.7',
      fontSize: '14px',
    } as CSSStyleDeclaration)

    const sp = this.button('Single Player', () => {
      this.hide()
      this.callbacks.onSinglePlayer()
    })
    const mp = this.button('Multiplayer', () => this.setMode('multiplayer'))

    panel.append(sub, sp, mp)
    return panel
  }

  private buildMultiPanel(): HTMLDivElement {
    const panel = this.panelShell('Multiplayer')

    const nameLabel = this.label('Display name')
    const nameInput = document.createElement('input')
    nameInput.id = 'mp-name'
    nameInput.type = 'text'
    nameInput.maxLength = 16
    nameInput.placeholder = 'Player'
    nameInput.value = localStorage.getItem('mp_display_name') ?? 'Player'
    this.styleInput(nameInput)

    const urlLabel = this.label('Server URL')
    const urlInput = document.createElement('input')
    urlInput.id = 'mp-url'
    urlInput.type = 'text'
    urlInput.value = localStorage.getItem('mp_server_url') ?? defaultServerUrl()
    this.styleInput(urlInput)

    const status = document.createElement('p')
    status.id = 'mp-status'
    status.textContent = ''
    Object.assign(status.style, {
      minHeight: '20px',
      margin: '8px 0 16px',
      fontSize: '13px',
      color: '#9ab0c0',
    } as CSSStyleDeclaration)

    const connectBtn = this.button('Connect', () => {
      const name = nameInput.value.trim()
      const url = urlInput.value.trim()
      localStorage.setItem('mp_display_name', name)
      localStorage.setItem('mp_server_url', url)
      this.setStatus('Connecting…')
      this.callbacks.onConnect(name, url)
    })

    const backBtn = this.button('Back', () => {
      this.setMode('main')
      this.callbacks.onBackToMain?.()
    }, true)

    panel.append(nameLabel, nameInput, urlLabel, urlInput, status, connectBtn, backBtn)
    return panel
  }

  private buildResultsPanel(): HTMLDivElement {
    const panel = this.panelShell('Match Results')
    const body = document.createElement('div')
    body.id = 'mp-results-body'

    const reconnect = document.createElement('p')
    reconnect.id = 'mp-reconnect'
    reconnect.style.display = 'none'
    Object.assign(reconnect.style, {
      marginTop: '12px',
      fontSize: '13px',
      color: '#f0c674',
    } as CSSStyleDeclaration)

    const back = this.button('Main Menu', () => {
      this.setMode('main')
      this.callbacks.onBackToMain?.()
    })

    panel.append(body, reconnect, back)
    return panel
  }

  private panelShell(title: string): HTMLDivElement {
    const panel = document.createElement('div')
    Object.assign(panel.style, {
      width: 'min(420px, 92vw)',
      padding: '32px 28px',
      background: 'rgba(18, 24, 30, 0.92)',
      border: '1px solid rgba(180, 200, 220, 0.15)',
      boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
    } as CSSStyleDeclaration)
    const h = document.createElement('h1')
    h.textContent = title
    Object.assign(h.style, {
      margin: '0 0 8px',
      fontSize: '28px',
      letterSpacing: '0.04em',
      fontWeight: '700',
    } as CSSStyleDeclaration)
    panel.appendChild(h)
    return panel
  }

  private button(label: string, onClick: () => void, secondary = false): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = label
    Object.assign(btn.style, {
      display: 'block',
      width: '100%',
      marginTop: '10px',
      padding: '12px 16px',
      border: secondary ? '1px solid rgba(180,200,220,0.25)' : 'none',
      background: secondary ? 'transparent' : '#3d7ea6',
      color: '#fff',
      fontSize: '15px',
      cursor: 'pointer',
      letterSpacing: '0.03em',
    } as CSSStyleDeclaration)
    btn.addEventListener('click', onClick)
    btn.addEventListener('mouseenter', () => {
      btn.style.background = secondary ? 'rgba(255,255,255,0.06)' : '#4a93bf'
    })
    btn.addEventListener('mouseleave', () => {
      btn.style.background = secondary ? 'transparent' : '#3d7ea6'
    })
    return btn
  }

  private label(text: string): HTMLLabelElement {
    const el = document.createElement('label')
    el.textContent = text
    Object.assign(el.style, {
      display: 'block',
      marginTop: '14px',
      marginBottom: '6px',
      fontSize: '12px',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      opacity: '0.65',
    } as CSSStyleDeclaration)
    return el
  }

  private styleInput(input: HTMLInputElement): void {
    Object.assign(input.style, {
      width: '100%',
      boxSizing: 'border-box',
      padding: '10px 12px',
      border: '1px solid rgba(180,200,220,0.2)',
      background: 'rgba(0,0,0,0.35)',
      color: '#e8ecef',
      fontSize: '15px',
      outline: 'none',
    } as CSSStyleDeclaration)
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
