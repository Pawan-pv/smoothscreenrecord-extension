import fs from 'fs';

// 1x1 transparent/colored PNG template buffer generator
function createSolidPng(r, g, b, a = 255) {
  // Minimal valid 16x16 RGBA PNG buffer
  const width = 16;
  const height = 16;
  // Use pre-crafted valid PNG header for 16x16 purple icon
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAZ0lEQVR42mNk+M9QzwABjFAaGeCSwweW4VDAyMDAwMDIyMCgxIAHYGZkYGASFxdngkskJSXBxXD5hIQEuAIQG5v/iHIZsAMsCBAXFxch1v+hAGYAG6aB4Z8Qj4ENwMYm3gCcvgEA0VwV5vDqj8sAAAAASUVORK5CYII=',
    'base64'
  );
}

const buf16 = createSolidPng(139, 92, 246);
fs.writeFileSync('public/icon16.png', buf16);
fs.writeFileSync('public/icon48.png', buf16);
fs.writeFileSync('public/icon128.png', buf16);
console.log('Generated extension icons.');
