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

  it('verifies real rendered PNG icons with exact dimensions and RGBA colorType', () => {
    const iconSizes = [
      { file: 'icon16.png', size: 16 },
      { file: 'icon48.png', size: 48 },
      { file: 'icon128.png', size: 128 },
    ];

    for (const { file, size } of iconSizes) {
      const p = path.resolve(__dirname, '../../public', file);
      expect(fs.existsSync(p), `${file} must exist in public/`).toBe(true);
      const buf = fs.readFileSync(p);

      // Verify PNG signature
      expect(buf.slice(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

      // Verify IHDR width and height
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      expect(width, `${file} width must be ${size}`).toBe(size);
      expect(height, `${file} height must be ${size}`).toBe(size);

      // Verify true RGBA (color type 6)
      const colorType = buf[25];
      expect(colorType).toBe(6);

      // Must not be 158-byte dummy placeholder
      expect(buf.length).toBeGreaterThan(200);
    }
  });

  it('ensures dev scripts, raw SVGs, and index.html are not in public/ or dist/', () => {
    expect(fs.existsSync(path.resolve(__dirname, '../../public/generate-icons.js'))).toBe(false);
    expect(fs.existsSync(path.resolve(__dirname, '../../public/icon.svg'))).toBe(false);

    const distPath = path.resolve(__dirname, '../../dist');
    if (fs.existsSync(distPath)) {
      expect(fs.existsSync(path.resolve(distPath, 'generate-icons.js'))).toBe(false);
      expect(fs.existsSync(path.resolve(distPath, 'icon.svg'))).toBe(false);
      expect(fs.existsSync(path.resolve(distPath, 'index.html'))).toBe(false);
    }
  });

  it('validates all file paths referenced in manifest.json exist in dist', () => {
    const distManifestPath = path.resolve(__dirname, '../../dist/manifest.json');
    if (fs.existsSync(distManifestPath)) {
      const distDir = path.resolve(__dirname, '../../dist');
      const manifest = JSON.parse(fs.readFileSync(distManifestPath, 'utf8'));

      // icons
      for (const iconPath of Object.values(manifest.icons as Record<string, string>)) {
        expect(fs.existsSync(path.resolve(distDir, iconPath)), `icon ${iconPath} exists in dist`).toBe(true);
      }

      // popup
      expect(fs.existsSync(path.resolve(distDir, manifest.action.default_popup))).toBe(true);

      // service worker
      expect(fs.existsSync(path.resolve(distDir, manifest.background.service_worker))).toBe(true);

      // content scripts
      for (const cs of manifest.content_scripts) {
        for (const js of cs.js) {
          expect(fs.existsSync(path.resolve(distDir, js)), `content script ${js} exists in dist`).toBe(true);
        }
      }
    }
  });
});
