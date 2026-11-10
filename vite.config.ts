import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { execSync } from 'child_process';

function bundleContentScriptsPlugin(): Plugin {
  return {
    name: 'bundle-content-scripts',
    closeBundle() {
      console.log('[bundleContentScriptsPlugin] Bundling content scripts as standalone IIFEs...');
      execSync('bun build src/content/dom-tracker.ts --target=browser --format=iife --outfile=dist/content/dom-tracker.js --minify', { stdio: 'inherit' });
      execSync('bun build src/content/privacy-redactor.ts --target=browser --format=iife --outfile=dist/content/privacy-redactor.js --minify', { stdio: 'inherit' });
      console.log('[bundleContentScriptsPlugin] Content scripts bundled successfully as IIFE.');
    }
  };
}

export default defineConfig({
  plugins: [react(), bundleContentScriptsPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        editor: resolve(import.meta.dirname, 'editor.html'),
        popup: resolve(import.meta.dirname, 'popup.html'),
        offscreen: resolve(import.meta.dirname, 'offscreen.html'),
        'background/service-worker': resolve(import.meta.dirname, 'src/background/service-worker.ts')
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background/service-worker') {
            return 'background/service-worker.js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  }
});
