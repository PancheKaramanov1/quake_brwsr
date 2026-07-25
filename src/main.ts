import { Game } from './Game.js'
import { MultiplayerMenu } from './client/ui/MultiplayerMenu.js'
import { MultiplayerGame } from './client/MultiplayerGame.js'

async function startSinglePlayer(canvas: HTMLCanvasElement): Promise<() => void> {
  const game = new Game(canvas)
  await game.init()
  game.start()

  const onVis = () => {
    if (document.hidden) game.stop()
    else game.start()
  }
  document.addEventListener('visibilitychange', onVis)

  return () => {
    document.removeEventListener('visibilitychange', onVis)
    game.dispose()
  }
}

async function main(): Promise<void> {
  const canvas = document.getElementById('gameCanvas')
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Game canvas not found!')
  }

  // Hide legacy SP overlay chrome during multiplayer shell
  const legacyUi = document.getElementById('ui')
  if (legacyUi) legacyUi.style.display = 'none'

  let disposeSession: (() => void) | null = null
  let mpGame: MultiplayerGame | null = null

  const menu = new MultiplayerMenu(document.body, {
    onSinglePlayer: () => {
      void (async () => {
        menu.hide()
        if (legacyUi) legacyUi.style.display = ''
        disposeSession = await startSinglePlayer(canvas)
      })()
    },
    onConnect: (displayName, serverUrl) => {
      void (async () => {
        menu.setStatus('Connecting…')
        try {
          mpGame?.dispose()
          mpGame = new MultiplayerGame(canvas, document.body, menu)
          await mpGame.startSession(serverUrl, displayName)
          menu.hide()
          disposeSession = () => {
            mpGame?.dispose()
            mpGame = null
          }
        } catch (err) {
          menu.show()
          menu.showReject(
            err instanceof Error ? err.message : 'Connection failed',
          )
        }
      })()
    },
    onBackToMain: () => {
      mpGame?.dispose()
      mpGame = null
    },
  })

  window.addEventListener('beforeunload', () => {
    disposeSession?.()
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void main()
  })
} else {
  void main()
}
