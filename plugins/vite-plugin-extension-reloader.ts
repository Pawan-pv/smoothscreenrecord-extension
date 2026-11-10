import { Plugin } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import { exec } from 'child_process';

const RELOADER_PORT = 8989;

export function extensionReloaderPlugin(): Plugin {
  let wss: WebSocketServer | null = null;
  const clients = new Set<WebSocket>();
  let contentBuildInProgress = false;

  const broadcast = (payload: Record<string, any>) => {
    const data = JSON.stringify(payload);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  };

  return {
    name: 'vite-plugin-extension-reloader',
    apply: 'build',

    buildStart() {
      const isWatch = Boolean(process.env.VITE_WATCH_MODE || process.argv.includes('--watch'));
      if (!isWatch) return;

      if (!wss) {
        try {
          wss = new WebSocketServer({ port: RELOADER_PORT });

          wss.on('connection', (ws) => {
            clients.add(ws);
            console.log(`[ExtensionReloader] Connected Chrome Extension client (Active: ${clients.size})`);

            ws.on('close', () => {
              clients.delete(ws);
            });
          });

          wss.on('error', (err: any) => {
            if (err.code === 'EADDRINUSE') {
              console.warn(`[ExtensionReloader] Port ${RELOADER_PORT} in use; skipping standalone reloader server.`);
            } else {
              console.error('[ExtensionReloader] WebSocket server error:', err);
            }
          });

          console.log(`\n%c[ExtensionReloader]%c Automated Extension Reloader active on ws://localhost:${RELOADER_PORT}`, 'color: #10B981; font-weight: bold;', 'color: inherit;');
        } catch (err) {
          console.warn('[ExtensionReloader] Failed to initialize WebSocket server:', err);
        }
      }
    },

    watchChange(id) {
      const normalized = id.replace(/\\/g, '/');
      if (normalized.includes('/src/content/') && !contentBuildInProgress) {
        contentBuildInProgress = true;
        console.log('[ExtensionReloader] Content script modified. Rebuilding IIFEs...');
        exec(
          'bun build src/content/dom-tracker.ts --target=browser --format=iife --outfile=dist/content/dom-tracker.js --minify && bun build src/content/privacy-redactor.ts --target=browser --format=iife --outfile=dist/content/privacy-redactor.js --minify',
          (err) => {
            contentBuildInProgress = false;
            if (!err) {
              console.log('[ExtensionReloader] Content scripts bundled. Notifying active tabs...');
              broadcast({ type: 'CONTENT_SCRIPT_UPDATED' });
            } else {
              console.error('[ExtensionReloader] Content script build error:', err);
            }
          }
        );
      }
    },

    closeBundle() {
      const isWatch = Boolean(process.env.VITE_WATCH_MODE || process.argv.includes('--watch'));
      if (!isWatch) return;

      console.log('[ExtensionReloader] Build complete. Triggering chrome.runtime.reload()...');
      broadcast({ type: 'EXTENSION_RELOAD', timestamp: Date.now() });
    }
  };
}
