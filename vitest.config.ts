import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup-tests.ts'],
    include: ['tests/unit/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/engine/spring-physics.ts',
        'src/engine/cursor-spline.ts',
        'src/engine/diagnostic-channel.ts',
        'src/engine/sfx-synthesizer.ts',
        'src/content/privacy-redactor.ts',
        'src/background/service-worker.ts'
      ]
    }
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src')
    }
  }
});
