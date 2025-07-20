import { Game } from './Game.js'

// Main entry point for the FPS game
async function main(): Promise<void> {
  try {
    // Get the canvas element
    const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement
    if (!canvas) {
      throw new Error('Game canvas not found!')
    }

    // Create game instance
    console.log('Creating game instance...')
    const game = new Game(canvas)
    
    // Initialize the game
    console.log('Initializing FPS game...')
    await game.init()
    console.log('Game initialization complete!')
    
    // Start the game
    console.log('Starting game...')
    game.start()
    console.log('Game started successfully!')
    
    // Make game globally accessible for debugging
    ;(window as any).game = game
    
    // Handle page visibility changes to pause/resume game
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        game.stop()
      } else {
        game.start()
      }
    })
    
    // Handle cleanup on page unload
    window.addEventListener('beforeunload', () => {
      game.dispose()
    })
    
  } catch (error) {
    console.error('Failed to start FPS game:', error)
    
    // Display error message to user
    const errorMessage = document.createElement('div')
    errorMessage.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255, 0, 0, 0.9);
      color: white;
      padding: 20px;
      border-radius: 10px;
      font-family: Arial, sans-serif;
      text-align: center;
      z-index: 1000;
    `
    errorMessage.innerHTML = `
      <h3>Failed to Start Game</h3>
      <p>${error instanceof Error ? error.message : 'Unknown error occurred'}</p>
      <p>Please check the console for more details.</p>
    `
    document.body.appendChild(errorMessage)
  }
}

// Start the game when the page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main)
} else {
  main()
} 