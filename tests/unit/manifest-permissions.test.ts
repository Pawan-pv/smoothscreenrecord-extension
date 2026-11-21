import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Chrome Web Store Permission Cleanliness', () => {
  const rootManifestPath = path.resolve(__dirname, '../../manifest.json');
  const publicManifestPath = path.resolve(__dirname, '../../public/manifest.json');

  it('keeps only confirmed-used permissions in manifest.json', () => {
    const raw = fs.readFileSync(rootManifestPath, 'utf8');
    const manifest = JSON.parse(raw);

    // Confirm unused high-privilege permissions are stripped
    expect(manifest.permissions).not.toContain('scripting');
    expect(manifest.permissions).not.toContain('offscreen');
    expect(manifest.permissions).not.toContain('downloads');
    expect(manifest.permissions).not.toContain('tabCapture');

    // Confirm required permissions remain
    expect(manifest.permissions).toContain('storage');
    expect(manifest.permissions).toContain('activeTab');
    expect(manifest.permissions).toEqual(['storage', 'activeTab']);
  });

  it('keeps public/manifest.json in sync with root manifest.json', () => {
    if (fs.existsSync(publicManifestPath)) {
      const raw = fs.readFileSync(publicManifestPath, 'utf8');
      const manifest = JSON.parse(raw);
      expect(manifest.permissions).toEqual(['storage', 'activeTab']);
    }
  });

  it('verifies offscreen worker stub has been removed', () => {
    const workerPath = path.resolve(__dirname, '../../src/offscreen/recorder-worker.ts');
    const offscreenHtmlPath = path.resolve(__dirname, '../../offscreen.html');

    expect(fs.existsSync(workerPath)).toBe(false);
    expect(fs.existsSync(offscreenHtmlPath)).toBe(false);
  });
});
