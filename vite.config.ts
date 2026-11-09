import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        editor: resolve(import.meta.dirname, 'editor.html'),
        popup: resolve(import.meta.dirname, 'popup.html'),
        offscreen: resolve(import.meta.dirname, 'offscreen.html'),
        'background/service-worker': resolve(import.meta.dirname, 'src/background/service-worker.ts'),
        'content/dom-tracker': resolve(import.meta.dirname, 'src/content/dom-tracker.ts'),
        'content/privacy-redactor': resolve(import.meta.dirname, 'src/content/privacy-redactor.ts')
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background/service-worker') {
            return 'background/service-worker.js';
          }
          if (chunkInfo.name === 'content/dom-tracker') {
            return 'content/dom-tracker.js';
          }
          if (chunkInfo.name === 'content/privacy-redactor') {
            return 'content/privacy-redactor.js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  }
});
