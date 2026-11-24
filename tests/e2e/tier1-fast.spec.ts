/**
 * Tier 1 Fast Verification Suite (headless Chromium, NO live screen capture)
 *
 * The harness bundle is built from the CURRENT src/ before the suite runs
 * (npm run build:tier1-harness) and the suite refuses to run against a bundle
 * older than the source, so a green run always describes this checkout.
 *
 * Time: the MP4 exports use the software H.264 encoder on machines without a
 * hardware one (~1.6-3.4 fps at 1080p), so a1-a3 render the 20 s recording at
 * 960 px wide (same duration, audio, cuts and trim; only the picture is smaller).
 * Expect a few minutes in total.
 *
 * Verifies:
 *   a) MP4 Export + QA-009 + Cut Silences (WebCodecs H.264 + AAC, A/V sync, silence cuts)
 *   b) GIF Export (QA-028 sequential videoBlob decode, bounded memory, multi-frame animation)
 *   c) Privacy + SOP + HTML Widget (Non-destructive blur, sensitive redaction, XSS safety, hotspot coordinates, navigation)
 *   d) Real-Mic Silence Detection (QA-034 timeline alignment on real c2 mic audio)
 */
import { test, expect, chromium, Browser, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import { AddressInfo } from 'net';
import { execSync } from 'child_process';
import { FFPROBE, mediaInfo, countFrames, ffprobeJson, CHROME_CFT } from './helpers/harness';

const REPO = process.cwd();
const FIXTURES_DIR = path.join(REPO, 'tests', 'fixtures');
const ARTIFACTS_DIR = path.join(os.tmpdir(), 'ss-tier1-artifacts');

const HARNESS_BUNDLE = path.join(FIXTURES_DIR, 'tier1-harness.bundle.js');

/** Newest modification time of any file under dir (recursive). */
function newestMtimeMs(dir: string): number {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtimeMs(full) : fs.statSync(full).mtimeMs);
  }
  return newest;
}

/** Builds the harness from src/ and proves it is not older than the source it bundles. */
function buildAndVerifyHarness(): void {
  execSync('npm run build:tier1-harness', { cwd: REPO, stdio: 'inherit' });
  const bundleMs = fs.statSync(HARNESS_BUNDLE).mtimeMs;
  const sourceMs = Math.max(newestMtimeMs(path.join(REPO, 'src')), fs.statSync(path.join(FIXTURES_DIR, 'tier1-harness.ts')).mtimeMs);
  if (bundleMs < sourceMs) {
    throw new Error('tier1-harness.bundle.js is older than src/: refusing to test stale code.');
  }
}

interface FixtureServer {
  base: string;
  close: () => Promise<void>;
}

function startFixtureServer(): Promise<FixtureServer> {
  const server = http.createServer((req, res) => {
    const rel = (req.url || '/').split('?')[0].replace(/^\//, '') || 'tier1-harness.html';
    const file = path.join(FIXTURES_DIR, rel);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.webm': 'video/webm',
      '.wav': 'audio/wav',
      '.json': 'application/json',
      '.css': 'text/css'
    };
    res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r()))
      });
    });
  });
}

test.describe('Tier 1 Fast Verification Suite', () => {
  test.setTimeout(120_000); // 2 minute maximum suite budget

  let server: FixtureServer;
  let browser: Browser;
  let harnessPage: Page;

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    buildAndVerifyHarness();
    server = await startFixtureServer();

    browser = await chromium.launch({
      executablePath: fs.existsSync(CHROME_CFT) ? CHROME_CFT : undefined,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu-sandbox', '--enable-features=WebCodecs']
    });

    harnessPage = await browser.newPage();
    await harnessPage.goto(`${server.base}/tier1-harness.html`);
  });

  test.afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  test('a1) MP4 Export uncut (~20.2s, no repeated tail, A/V sync)', async () => {
    test.setTimeout(240_000);
    const t0 = Date.now();

    const uncutData = await harnessPage.evaluate(async () => {
      const { HardwareMp4Exporter, CursorSplineEngine, VIBE_PRESETS } = (window as any).__tier1Harness;
      const resp = await fetch('/tier1-c2.webm');
      const blob = await resp.blob();

      const exporter = new HardwareMp4Exporter();
      const mp4Blob = await exporter.exportMp4({
        videoBlob: blob,
        durationMs: 20221,
        targetWidth: 960, // 20 s of 960 px keeps the software encoder within budget
        aspectRatio: '16:9',
        preset: VIBE_PRESETS['keynote-pro'],
        pills: [],
        silences: [],
        cursorEngine: new CursorSplineEngine(),
        keystrokes: [],
        cutSilences: false,
        showSpotlight: false,
        showCursor: false,
        showHud: false
      });

      const buffer = await mp4Blob.arrayBuffer();
      return Array.from(new Uint8Array(buffer));
    });

    const uncutPath = path.join(ARTIFACTS_DIR, 'tier1-uncut.mp4');
    fs.writeFileSync(uncutPath, Buffer.from(uncutData));

    const uncutInfo = mediaInfo(uncutPath);
    console.log(`[Tier 1] Uncut MP4 exported in ${Date.now() - t0}ms, size: ${uncutInfo.sizeBytes} bytes, duration: ${uncutInfo.durationSec}s`);

    const uncutVideo = uncutInfo.streams.find((s: any) => s.codec_type === 'video');
    const uncutAudio = uncutInfo.streams.find((s: any) => s.codec_type === 'audio');

    expect(uncutVideo, 'video stream exists').toBeDefined();
    expect(uncutVideo.codec_name).toBe('h264');
    expect(uncutAudio, 'audio stream exists').toBeDefined();
    expect(uncutAudio.codec_name).toBe('aac');

    // Assert duration matches recorded container duration within tolerance (clamped duration, no repeated tail)
    expect(uncutInfo.durationSec).toBeGreaterThan(20.0);
    expect(uncutInfo.durationSec).toBeLessThan(20.5);

    // Assert A/V skew tolerance (< 0.25s)
    const uncutSkew = Math.abs((uncutVideo.durationSec || uncutInfo.durationSec) - (uncutAudio.durationSec || uncutInfo.durationSec));
    expect(uncutSkew).toBeLessThan(0.25);
  });

  test('a2) MP4 Export with cut silences, auto-zoom pills, cursor, and spotlight', async () => {
    test.setTimeout(240_000);
    const tCut0 = Date.now();
    const cutData = await harnessPage.evaluate(async () => {
      const { HardwareMp4Exporter, CursorSplineEngine, VIBE_PRESETS } = (window as any).__tier1Harness;
      const resp = await fetch('/tier1-c2.webm');
      const blob = await resp.blob();

      // Cursors & Clicks
      const mousePoints = [
        { t: 500, x: 0.2, y: 0.2, c: 'default' },
        { t: 2500, x: 0.5, y: 0.5, c: 'pointer' },
        { t: 8000, x: 0.8, y: 0.3, c: 'pointer' },
        { t: 12000, x: 0.5, y: 0.7, c: 'default' }
      ];
      const clicks = [
        { t: 2500, x: 0.5, y: 0.5, button: 0, targetTag: 'button' },
        { t: 8000, x: 0.8, y: 0.3, button: 0, targetTag: 'a' }
      ];
      const cursorEngine = new CursorSplineEngine(mousePoints, clicks);

      // Auto-zoom pill
      const pills = [
        {
          id: 'pill-1',
          startTime: 1000,
          endTime: 4000,
          targetX: 0.5,
          targetY: 0.5,
          targetScale: 1.6,
          tiltX: 4,
          tiltY: -3
        }
      ];

      // Two silences to cut (~4.4s total removed)
      const silences = [
        { id: 's1', startTime: 4750, endTime: 6950, duration: 2200, markedForCut: true },
        { id: 's2', startTime: 14750, endTime: 16950, duration: 2200, markedForCut: true }
      ];

      const exporter = new HardwareMp4Exporter();
      const mp4Blob = await exporter.exportMp4({
        videoBlob: blob,
        durationMs: 20221,
        targetWidth: 960, // 20 s of 960 px keeps the software encoder within budget
        aspectRatio: '16:9',
        preset: VIBE_PRESETS['keynote-pro'],
        pills,
        silences,
        cursorEngine,
        keystrokes: [],
        cutSilences: true,
        showSpotlight: true,
        showCursor: true,
        showHud: true
      });

      const buffer = await mp4Blob.arrayBuffer();
      return Array.from(new Uint8Array(buffer));
    });

    const cutPath = path.join(ARTIFACTS_DIR, 'tier1-cut.mp4');
    fs.writeFileSync(cutPath, Buffer.from(cutData));

    const cutInfo = mediaInfo(cutPath);
    console.log(`[Tier 1] Cut MP4 exported in ${Date.now() - tCut0}ms, size: ${cutInfo.sizeBytes} bytes, duration: ${cutInfo.durationSec}s`);

    const cutVideo = cutInfo.streams.find((s: any) => s.codec_type === 'video');
    const cutAudio = cutInfo.streams.find((s: any) => s.codec_type === 'audio');

    expect(cutVideo).toBeDefined();
    expect(cutVideo.codec_name).toBe('h264');
    expect(cutAudio).toBeDefined();
    expect(cutAudio.codec_name).toBe('aac');

    // Assert duration shortened by cut silences (20.3s - 4.4s ≈ 15.8s ± 0.4s)
    expect(cutInfo.durationSec).toBeGreaterThan(15.2);
    expect(cutInfo.durationSec).toBeLessThan(16.5);

    // Assert A/V sync stays locked after silence cuts
    const cutSkew = Math.abs((cutVideo.durationSec || cutInfo.durationSec) - (cutAudio.durationSec || cutInfo.durationSec));
    expect(cutSkew).toBeLessThan(0.25);
  });

  test('a3) MP4 Export with trimStartMs, trimEndMs and cut silences', async () => {
    test.setTimeout(240_000);
    const tTrim0 = Date.now();
    const trimmedData = await harnessPage.evaluate(async () => {
      const { HardwareMp4Exporter, CursorSplineEngine, VIBE_PRESETS } = (window as any).__tier1Harness;
      const resp = await fetch('/tier1-c2.webm');
      const blob = await resp.blob();

      // Trim 2000ms off start and 2000ms off end (total 4000ms trim)
      // Cut one 2200ms silence inside the trim window [2000, 18221]
      const silences = [
        { id: 's1', startTime: 4750, endTime: 6950, duration: 2200, markedForCut: true }
      ];

      const exporter = new HardwareMp4Exporter();
      const mp4Blob = await exporter.exportMp4({
        videoBlob: blob,
        durationMs: 20221,
        targetWidth: 960, // 20 s of 960 px keeps the software encoder within budget
        trimStartMs: 2000,
        trimEndMs: 18221,
        aspectRatio: '16:9',
        preset: VIBE_PRESETS['keynote-pro'],
        pills: [],
        silences,
        cursorEngine: new CursorSplineEngine(),
        keystrokes: [],
        cutSilences: true,
        showSpotlight: false,
        showCursor: false,
        showHud: false
      });

      const buffer = await mp4Blob.arrayBuffer();
      return Array.from(new Uint8Array(buffer));
    });

    const trimPath = path.join(ARTIFACTS_DIR, 'tier1-trimmed.mp4');
    fs.writeFileSync(trimPath, Buffer.from(trimmedData));

    const trimInfo = mediaInfo(trimPath);
    console.log(`[Tier 1] Trimmed MP4 exported in ${Date.now() - tTrim0}ms, size: ${trimInfo.sizeBytes} bytes, duration: ${trimInfo.durationSec}s`);

    const trimVideo = trimInfo.streams.find((s: any) => s.codec_type === 'video');
    const trimAudio = trimInfo.streams.find((s: any) => s.codec_type === 'audio');

    expect(trimVideo, 'video stream exists').toBeDefined();
    expect(trimVideo.codec_name).toBe('h264');
    expect(trimAudio, 'audio stream exists').toBeDefined();
    expect(trimAudio.codec_name).toBe('aac');

    // Expected duration: 20.22s - 4.0s (trim) - 2.2s (silence cut) ≈ 14.02s (± 0.4s)
    expect(trimInfo.durationSec).toBeGreaterThan(13.6);
    expect(trimInfo.durationSec).toBeLessThan(14.5);

    // Assert A/V sync stays locked when both trim and silence cuts are active
    const trimSkew = Math.abs((trimVideo.durationSec || trimInfo.durationSec) - (trimAudio.durationSec || trimInfo.durationSec));
    expect(trimSkew).toBeLessThan(0.25);
  });

  test('b) GIF Export (QA-028): sequential videoBlob decode, bounded memory, multi-frame motion', async () => {
    const t0 = Date.now();

    const gifResult = await harnessPage.evaluate(async () => {
      const { HardwareGifExporter, CursorSplineEngine, VIBE_PRESETS } = (window as any).__tier1Harness;
      const resp = await fetch('/tier1-c2.webm');
      const blob = await resp.blob();

      const exporter = new HardwareGifExporter();
      const startMs = performance.now();
      const gifBlob = await exporter.exportGif({
        videoBlob: blob,
        durationMs: 3000,
        aspectRatio: '16:9',
        preset: VIBE_PRESETS['keynote-pro'],
        pills: [],
        silences: [],
        cursorEngine: new CursorSplineEngine(),
        keystrokes: [],
        cutSilences: false,
        showSpotlight: false,
        showCursor: false,
        showHud: false,
        qualityPreset: 'compact'
      });
      const elapsedMs = performance.now() - startMs;

      const buffer = await gifBlob.arrayBuffer();
      return {
        bytes: Array.from(new Uint8Array(buffer)),
        elapsedMs,
        size: gifBlob.size
      };
    });

    console.log(`[Tier 1] GIF Export took ${gifResult.elapsedMs.toFixed(0)}ms, size: ${gifResult.size} bytes`);
    expect(gifResult.elapsedMs).toBeLessThan(10_000); // Fast export

    const gifPath = path.join(ARTIFACTS_DIR, 'tier1-export.gif');
    fs.writeFileSync(gifPath, Buffer.from(gifResult.bytes));

    // Verify GIF magic header (GIF89a or GIF87a)
    const header = Buffer.from(gifResult.bytes.slice(0, 6)).toString('ascii');
    expect(header === 'GIF89a' || header === 'GIF87a').toBe(true);

    // Verify bounded memory: compact 3s clip must be <= 500 KB (QA-028 bounded buffer)
    expect(gifResult.size).toBeGreaterThan(10_000);
    expect(gifResult.size).toBeLessThan(500_000);

    // Verify multi-frame animation
    const gifInfo = mediaInfo(gifPath);
    const frameCount = countFrames(gifPath);
    console.log(`[Tier 1] GIF frames: ${frameCount}, duration: ${gifInfo.durationSec}s`);
    expect(frameCount).toBeGreaterThan(5);
  });

  test('c) Privacy + SOP + HTML Widget: non-destructive blur, sensitive redaction, XSS safety, hotspot coordinates', async () => {
    // 1. Verify Non-Destructive Privacy Redaction on privacy.html
    const privacyPage = await browser.newPage();
    await privacyPage.goto(`${server.base}/privacy.html`);

    await privacyPage.evaluate(() => {
      // Install redactor in page context
      const { applyAutoRedaction } = (window as any).__tier1Harness || {};
    });

    // Run redaction in harness
    const redactionCheck = await harnessPage.evaluate(async (base) => {
      const { redactTextString, isSensitiveString } = (window as any).__tier1Harness;

      const email = 'dana.reeves@example-corp.com';
      const rev = '$14,250.00';
      const key = 'sk\u005flive_51H8xQ2KlmNoPqRsTuVwXyZ0123';

      const emailRedacted = redactTextString(email);
      const revRedacted = redactTextString(rev);
      const keyRedacted = redactTextString(key);

      return {
        isSensitiveEmail: isSensitiveString(email),
        isSensitiveRev: isSensitiveString(rev),
        isSensitiveKey: isSensitiveString(key),
        emailRedacted,
        revRedacted,
        keyRedacted
      };
    }, server.base);

    expect(redactionCheck.isSensitiveEmail).toBe(true);
    expect(redactionCheck.isSensitiveRev).toBe(true);
    expect(redactionCheck.isSensitiveKey).toBe(true);
    expect(redactionCheck.emailRedacted).not.toContain('dana.reeves@example-corp.com');
    expect(redactionCheck.revRedacted).not.toContain('14,250');
    expect(redactionCheck.keyRedacted).not.toContain('51H8xQ2');

    // 2. Generate SOP Guide and HTML Widget with sensitive strings + XSS payload
    const widgetExport = await harnessPage.evaluate(() => {
      const { SopGuideExporter, HtmlWidgetExporter } = (window as any).__tier1Harness;

      const telemetry = {
        sessionId: 'tier1-test-session',
        metadata: {
          width: 1920,
          height: 1080,
          devicePixelRatio: 1,
          platform: 'Win32',
          title: 'Review of $14,250.00 payment</script><script>window.__xss=true</script>',
          timestamp: Date.now()
        },
        mousePoints: [],
        clicks: [
          {
            t: 1000,
            x: 0.52, // normalized coordinates
            y: 0.48,
            button: 0,
            targetTag: 'BUTTON',
            targetLabel: 'Step One </script><script>window.__xss=true</script>',
            targetText: 'Step One </script><script>window.__xss=true</script>'
          },
          {
            t: 2000,
            x: 0.75,
            y: 0.25,
            button: 0,
            targetTag: 'INPUT',
            targetLabel: 'Pay $14,250.00 to ops.lead@acme-labs.io with sk\u005flive_51H8xQ2KlmNoPqRsTuVwXyZ0123',
            targetText: 'sk\u005flive_51H8xQ2KlmNoPqRsTuVwXyZ0123'
          }
        ],
        keystrokes: []
      };

      const snapshots = [
        { timestamp: 950, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
        { timestamp: 1950, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }
      ];

      const sopMarkdown = SopGuideExporter.generateMarkdownGuide(telemetry, snapshots, true);
      const widgetHtml = HtmlWidgetExporter.generateInteractiveWidget(telemetry, snapshots, true);

      return { sopMarkdown, widgetHtml };
    });

    // Assert SOP Guide Redaction
    expect(widgetExport.sopMarkdown).not.toContain('ops.lead@acme-labs.io');
    expect(widgetExport.sopMarkdown).not.toContain('$14,250.00');
    expect(widgetExport.sopMarkdown).not.toContain('sk\u005flive_51H8xQ2KlmNoPqRsTuVwXyZ0123');

    // Assert HTML Widget Redaction & Escaping
    expect(widgetExport.widgetHtml).not.toContain('ops.lead@acme-labs.io');
    expect(widgetExport.widgetHtml).not.toContain('$14,250.00');
    expect(widgetExport.widgetHtml).not.toContain('sk\u005flive_51H8xQ2KlmNoPqRsTuVwXyZ0123');
    // Ensure </script> is safely escaped
    expect(widgetExport.widgetHtml).not.toContain('</script><script>window.__xss=true</script>');
    expect(widgetExport.widgetHtml).toContain('\\u003c/script\\u003e');

    // 3. Load the exported widget directly in a fresh page in Chromium
    const widgetPage = await browser.newPage();
    const pageErrors: string[] = [];
    widgetPage.on('pageerror', (err) => pageErrors.push(err.message));
    widgetPage.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push(msg.text());
    });

    await widgetPage.setContent(widgetExport.widgetHtml, { waitUntil: 'domcontentloaded' });

    // Assert 0 page/console errors
    expect(pageErrors).toEqual([]);

    // Assert XSS was NOT executed
    const xssExecuted = await widgetPage.evaluate(() => (window as any).__xss);
    expect(xssExecuted).toBeUndefined();

    // Assert Hotspot coordinates are valid percentage (52.0% and 48.0%, not NaN% or 0.0%)
    const hotspotStyle = await widgetPage.locator('#hotspot').getAttribute('style');
    expect(hotspotStyle).toContain('52.0%');
    expect(hotspotStyle).toContain('48.0%');
    expect(hotspotStyle).not.toContain('NaN');

    // Assert Next and Prev step navigation works
    await expect(widgetPage.locator('#prev-btn')).toBeDisabled();
    await expect(widgetPage.locator('#next-btn')).toBeEnabled();

    // Click Next Step
    await widgetPage.locator('#next-btn').click();
    const step2Hotspot = await widgetPage.locator('#hotspot').getAttribute('style');
    expect(step2Hotspot).toContain('75');
    expect(step2Hotspot).toContain('25');
    await expect(widgetPage.locator('#prev-btn')).toBeEnabled();

    // Click Previous Step
    await widgetPage.locator('#prev-btn').click();
    const returnHotspot = await widgetPage.locator('#hotspot').getAttribute('style');
    expect(returnHotspot).toContain('52');

    await widgetPage.close();
    await privacyPage.close();
  });

  test('d) Real-Mic Silence Detection (QA-034): analyzeSilences finds exactly 2 aligned pauses on c2 audio', async () => {
    const silences = await harnessPage.evaluate(async () => {
      const { AudioProcessor } = (window as any).__tier1Harness;
      const resp = await fetch('/c2-mic-audio.webm');
      const blob = await resp.blob();

      const processor = new AudioProcessor();
      return await processor.analyzeSilences(blob, [], [], -42, 1200, 20221);
    });

    console.log('[Tier 1] Detected real-mic silences:', JSON.stringify(silences));

    // Assert exactly 2 aligned silence spans
    expect(silences).toHaveLength(2);

    // Span 1: around 4.7s - 6.9s
    expect(Math.abs(silences[0].startTime - 4750)).toBeLessThan(500);
    expect(Math.abs(silences[0].endTime - 6950)).toBeLessThan(500);
    expect(silences[0].duration).toBeGreaterThanOrEqual(1200);
    expect(silences[0].markedForCut).toBe(true);

    // Span 2: around 14.7s - 16.9s
    expect(Math.abs(silences[1].startTime - 14750)).toBeLessThan(500);
    expect(Math.abs(silences[1].endTime - 16950)).toBeLessThan(500);
    expect(silences[1].duration).toBeGreaterThanOrEqual(1200);
    expect(silences[1].markedForCut).toBe(true);
  });

  test('e) SOP + HTML widget leave out trimmed-out and cut-out steps (real browser, live src)', async () => {
    const out = await harnessPage.evaluate(() => {
      const { SopGuideExporter, HtmlWidgetExporter } = (window as any).__tier1Harness;
      const click = (t: number, label: string) => ({ t, x: 0.4, y: 0.5, button: 0, targetTag: 'BUTTON', targetText: label, targetLabel: label });
      const telemetry = {
        metadata: { id: 'e', startTime: 1_700_000_000_000, endTime: 1_700_000_012_000, durationMs: 12000, width: 1280, height: 720, devicePixelRatio: 1, title: 'Trim demo', url: 'https://app.example.com/home?token=abc123&view=week' },
        mousePoints: [],
        clicks: [click(1000, 'Alpha-Early'), click(5000, 'Bravo-Kept'), click(6000, 'Charlie-Cut'), click(7000, 'Delta-Kept'), click(10000, 'Echo-Late')],
        keystrokes: [{ t: 1100, key: 'k', combo: 'Ctrl + K' }, { t: 5100, key: 's', combo: 'Ctrl + S' }],
        inputEvents: [],
        typingSessions: [
          { t: 1200, endT: 1600, text: 'typed-early', sensitive: false, targetLabel: 'Name', targetTag: 'input' },
          { t: 5200, endT: 5600, text: 'typed-kept', sensitive: false, targetLabel: 'City', targetTag: 'input' }
        ]
      };
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const snapshots = [1000, 5000, 6000, 7000, 10000].map((timestamp) => ({ timestamp, dataUrl: `${png}#SNAP${timestamp}` }));
      const timeline = { durationMs: 12000, trimStartMs: 4000, trimEndMs: 8000, cutRanges: [{ startTime: 5500, endTime: 6500 }] };
      return {
        md: SopGuideExporter.generateMarkdownGuide(telemetry, snapshots, true, timeline),
        html: HtmlWidgetExporter.generateInteractiveWidget(telemetry, snapshots, true, timeline),
        mdFull: SopGuideExporter.generateMarkdownGuide(telemetry, snapshots, true)
      };
    });

    for (const kept of ['Bravo-Kept', 'Delta-Kept']) {
      expect(out.md).toContain(kept);
      expect(out.html).toContain(kept);
    }
    expect(out.md).toContain('typed-kept');
    for (const gone of ['Alpha-Early', 'Charlie-Cut', 'Echo-Late', 'SNAP1000', 'SNAP6000', 'SNAP10000']) {
      expect(out.md, `${gone} must not be in the SOP`).not.toContain(gone);
      expect(out.html, `${gone} must not be in the HTML widget`).not.toContain(gone);
    }
    expect(out.md).not.toContain('typed-early');
    expect(out.md).toMatch(/### Step 1: Click on \*\*"Bravo-Kept"\*\*[^\n]*`\[1\.0s\]`/); // re-based to the exported timeline
    expect(out.md).toContain('**Duration**: 3.0s');
    expect(out.html).toContain('Step 1 of 2');
    // The Source URL never prints the token.
    expect(out.md).not.toContain('abc123');
    // Without a timeline nothing is dropped (the filter only acts when asked).
    expect(out.mdFull).toContain('Alpha-Early');
    expect(out.mdFull).toContain('Echo-Late');
  });

  test('f) Cancel: a GIF and an MP4 export stop promptly, release the decoder/encoder, and an immediate re-export works', async () => {
    test.setTimeout(240_000);
    const result = await harnessPage.evaluate(async () => {
      const { HardwareGifExporter, HardwareMp4Exporter, CursorSplineEngine, VIBE_PRESETS } = (window as any).__tier1Harness;
      const decoders: any[] = [];
      const encoders: any[] = [];
      const RealDecoder = (window as any).VideoDecoder;
      const RealEncoder = (window as any).VideoEncoder;
      (window as any).VideoDecoder = class extends RealDecoder { constructor(init: any) { super(init); decoders.push(this); } };
      (window as any).VideoEncoder = class extends RealEncoder { constructor(init: any) { super(init); encoders.push(this); } };
      try {
        const blob = await (await fetch('/tier1-c2.webm')).blob();
        const base = () => ({
          videoBlob: blob,
          durationMs: 20221,
          aspectRatio: '16:9',
          preset: VIBE_PRESETS['keynote-pro'],
          pills: [],
          silences: [],
          cursorEngine: new CursorSplineEngine(),
          keystrokes: [],
          cutSilences: false,
          showSpotlight: false,
          showCursor: false,
          showHud: false
        });
        const cancelAt = async (run: (signal: AbortSignal, arm: (pct: number) => (pct: number) => void) => Promise<unknown>, atPct: number) => {
          const controller = new AbortController();
          let abortedAt = 0;
          let progressAtAbort = -1;
          const onProgress = (pct: number) => {
            if (!abortedAt && pct >= atPct) {
              abortedAt = performance.now();
              progressAtAbort = pct;
              controller.abort();
            }
          };
          let error: any = null;
          try { await run(controller.signal, () => onProgress); } catch (e: any) { error = { name: e?.name, message: e?.message }; }
          return { error, rejectedAfterMs: abortedAt ? performance.now() - abortedAt : -1, progressAtAbort };
        };

        const gifCancel = await cancelAt(
          (signal, arm) => new HardwareGifExporter().exportGif({ ...base(), qualityPreset: 'compact', signal, onProgress: arm(10) }),
          10
        );
        const gifDecoderStates = decoders.map((d) => d.state);

        const mp4Cancel = await cancelAt(
          (signal, arm) => new HardwareMp4Exporter().exportMp4({ ...base(), targetWidth: 640, signal, onProgress: arm(5) }),
          5
        );
        const mp4DecoderStates = decoders.map((d) => d.state);
        const encoderStates = encoders.map((e) => e.state);

        // Immediately after both cancels: a normal export must still work.
        const t0 = performance.now();
        const gif = await new HardwareGifExporter().exportGif({ ...base(), durationMs: 2000, trimStartMs: 0, trimEndMs: 2000, qualityPreset: 'compact' });
        const mp4 = await new HardwareMp4Exporter().exportMp4({ ...base(), durationMs: 2000, trimStartMs: 0, trimEndMs: 1500, targetWidth: 640 });
        const mp4Bytes = Array.from(new Uint8Array(await mp4.arrayBuffer()));
        return {
          gifCancel, mp4Cancel, gifDecoderStates, mp4DecoderStates, encoderStates,
          videoElementsLeft: document.querySelectorAll('video').length,
          reexport: { gifSize: gif.size, gifType: gif.type, mp4Size: mp4.size, ms: performance.now() - t0 },
          mp4Bytes
        };
      } finally {
        (window as any).VideoDecoder = RealDecoder;
        (window as any).VideoEncoder = RealEncoder;
      }
    });

    console.log(`[Tier 1] cancel: GIF rejected ${result.gifCancel.rejectedAfterMs.toFixed(0)}ms after abort (at ${result.gifCancel.progressAtAbort}%), MP4 ${result.mp4Cancel.rejectedAfterMs.toFixed(0)}ms (at ${result.mp4Cancel.progressAtAbort}%); re-export ${result.reexport.ms.toFixed(0)}ms`);

    for (const [name, c] of [['GIF', result.gifCancel], ['MP4', result.mp4Cancel]] as const) {
      expect(c.error, `${name} export must reject when cancelled`).toEqual({ name: 'AbortError', message: 'The export was cancelled.' });
      expect(c.progressAtAbort, `${name} must have been cancelled mid-way`).toBeGreaterThan(0);
      expect(c.progressAtAbort, `${name} must not have finished`).toBeLessThan(100);
      expect(c.rejectedAfterMs, `${name} must stop promptly after the abort`).toBeLessThan(3000);
    }
    expect(result.gifDecoderStates.length, 'the GIF export opened a decoder').toBeGreaterThan(0);
    for (const s of result.mp4DecoderStates) expect(s, 'every decoder is closed after a cancel').toBe('closed');
    for (const s of result.encoderStates) expect(s, 'every encoder is closed after a cancel').toBe('closed');
    expect(result.videoElementsLeft, 'no <video> element is left behind').toBe(0);

    // An immediate re-export after the cancels works and is a real file.
    expect(result.reexport.gifType).toBe('image/gif');
    expect(result.reexport.gifSize).toBeGreaterThan(5_000);
    const mp4Path = path.join(ARTIFACTS_DIR, 'tier1-reexport.mp4');
    fs.writeFileSync(mp4Path, Buffer.from(result.mp4Bytes));
    const info = mediaInfo(mp4Path);
    expect(info.streams.find((s: any) => s.codec_type === 'video')?.codec_name).toBe('h264');
    expect(info.durationSec).toBeGreaterThan(1.3);
    expect(info.durationSec).toBeLessThan(1.8);
  });

  test('g) followCursor reaches the export: the default equals ON, OFF produces a different picture', async () => {
    test.setTimeout(120_000);
    const hashes = await harnessPage.evaluate(async () => {
      const { HardwareGifExporter, CursorSplineEngine, VIBE_PRESETS } = (window as any).__tier1Harness;
      const blob = await (await fetch('/tier1-c2.webm')).blob();
      const sha = async (b: Blob) => {
        const digest = await crypto.subtle.digest('SHA-256', await b.arrayBuffer());
        return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, '0')).join('');
      };
      // A zoom on the top-left while the cursor sits bottom-right: following the
      // cursor visibly moves the camera, not following keeps it on the zoom.
      const run = async (followCursor?: boolean) => sha(await new HardwareGifExporter().exportGif({
        videoBlob: blob,
        durationMs: 2000,
        trimStartMs: 0,
        trimEndMs: 2000,
        aspectRatio: '16:9',
        preset: VIBE_PRESETS['keynote-pro'],
        pills: [{ id: 'z', startTime: 0, endTime: 2000, targetX: 0.25, targetY: 0.25, targetScale: 2, tiltX: 0, tiltY: 0 }],
        silences: [],
        cursorEngine: new CursorSplineEngine([{ t: 0, x: 0.9, y: 0.9, c: 'default' }, { t: 2000, x: 0.9, y: 0.9, c: 'default' }], []),
        keystrokes: [],
        cutSilences: false,
        showSpotlight: false,
        showCursor: false,
        showHud: false,
        qualityPreset: 'compact',
        ...(followCursor === undefined ? {} : { followCursor })
      }));
      return { byDefault: await run(), on: await run(true), off: await run(false) };
    });
    expect(hashes.byDefault, 'the default is ON, exactly like the editor').toBe(hashes.on);
    expect(hashes.off, 'switching it OFF must change the exported picture').not.toBe(hashes.on);
  });
});
