import { Game } from './game.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);
// Exposed for automated browser checks and debugging from the console.
window.__game = game;

game.init().catch((err) => {
  console.error('[main] The game failed to start:', err);
  const box = document.getElementById('error-message');
  if (box && !box.textContent) {
    box.textContent = `Something went wrong while starting the game: ${err.message}`;
    document.getElementById('error').classList.remove('hidden');
    document.getElementById('loading').classList.add('hidden');
  }
});
