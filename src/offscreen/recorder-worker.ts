// Offscreen document script for background stream capture if needed
console.log('[SmoothStudio Offscreen] Worker initialized.');

window.addEventListener('message', async (event) => {
  if (event.data?.type === 'PING') {
    window.parent.postMessage({ type: 'PONG' }, '*');
  }
});
