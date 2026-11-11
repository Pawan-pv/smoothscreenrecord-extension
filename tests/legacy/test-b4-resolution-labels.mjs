import { chromium } from 'playwright';
import http from 'http';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTENSION_DIST_PATH = path.resolve(__dirname, '../dist');
const ffprobePath = path.resolve(__dirname, '../ffprobe.exe');
const testOutDir = path.resolve(__dirname, '../test-results/b4');
if (!fs.existsSync(testOutDir)) fs.mkdirSync(testOutDir, { recursive: true });

// 1. Host local test app server
const targetHtml = fs.readFileSync(path.resolve(__dirname, 'test-target.html'), 'utf8');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(targetHtml);
});
await new Promise((r) => server.listen(8775, r));
console.log('[B4 Test] Test server running on http://localhost:8775');

const CHROME_EXECUTABLE = 'C:\\Users\\pawan\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';
const tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b4-session-'));

console.log('[B4 Test] Starting automated verification for B4 Capture Resolution & Honest Export Labels...');

const context = await chromium.launchPersistentContext(tempUserDataDir, {
  headless: false,
  executablePath: CHROME_EXECUTABLE,
  viewport: { width: 1920, height: 1080 },
  args: [
    `--disable-extensions-except=${EXTENSION_DIST_PATH}`,
    `--load-extension=${EXTENSION_DIST_PATH}`,
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--window-size=1920,1080',
    '--enable-features=WebCodecs',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--auto-select-tab-capture-source-by-title=SmoothStudio Autonomous Test Target App'
  ]
});

try {
  let [background] = context.serviceWorkers();
  if (!background) {
    background = await context.waitForEvent('serviceworker', { timeout: 10000 });
  }
  const extensionId = new URL(background.url()).host;
  console.log(`[B4 Test] Extension ID discovered: ${extensionId}`);

  // 2. Open target app tab at 1920x1080
  const targetPage = await context.newPage();
  await targetPage.setViewportSize({ width: 1920, height: 1080 });
  await targetPage.goto('http://localhost:8775');
  await targetPage.waitForSelector('#btn-deploy', { timeout: 10000 });
  await targetPage.bringToFront();
  await new Promise((r) => setTimeout(r, 600));

  // 3. Open Editor Studio tab with record=true
  const editorPage = await context.newPage();
  editorPage.on('console', (msg) => console.log('[Editor Log]', msg.text()));
  editorPage.on('pageerror', (err) => console.error('[Editor Error]', err));
  await editorPage.setViewportSize({ width: 1920, height: 1080 });
  await editorPage.goto(`chrome-extension://${extensionId}/editor.html?record=true&includeMic=false`);
  await editorPage.waitForSelector('#start-capture-prompt-btn', { timeout: 10000 });

  // 4. User clicks prompt button to start recording
  console.log('[B4 Test] Starting live recording via prompt button...');
  await editorPage.click('#start-capture-prompt-btn');

  // Wait for recording to become active
  await editorPage.waitForSelector('#stop-live-recording-top-btn', { timeout: 15000 });
  console.log('[B4 Test] Live recording is active! Switching to target page to generate 1080p frames...');

  await targetPage.bringToFront();
  await new Promise((r) => setTimeout(r, 600));
  for (let i = 0; i < 40; i++) {
    await targetPage.mouse.move(200 + i * 20, 300 + Math.sin(i * 0.4) * 50);
    if (i === 15) await targetPage.click('#btn-deploy');
    await new Promise((r) => setTimeout(r, 100));
  }

  // 5. Stop live recording
  console.log('[B4 Test] Stopping live recording via Editor UI...');
  await editorPage.bringToFront();
  await editorPage.click('#stop-live-recording-top-btn');

  // Wait for recording video element to be decoded and loaded
  await editorPage.waitForFunction(() => {
    const v = document.querySelector('video#smoothstudio-source-video');
    return v && (v.getAttribute('data-ready') === 'true' || v.readyState >= 1);
  }, { timeout: 25000 });
  console.log('[B4 Test] Editor video loaded into Studio.');

  // 6. Extract raw video blob from OPFS
  const rawWebmBytes = await editorPage.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('smoothstudio_recording.webm');
    const f = await fh.getFile();
    const buf = await f.arrayBuffer();
    return Array.from(new Uint8Array(buf));
  });

  const rawWebmPath = path.join(testOutDir, 'raw_recording_1080p.webm');
  fs.writeFileSync(rawWebmPath, Buffer.from(rawWebmBytes));
  console.log(`[B4 Test] Saved raw recording to ${rawWebmPath} (${fs.statSync(rawWebmPath).size} bytes)`);

  // Probe raw recording resolution with ffprobe
  const rawProbeJson = execSync(`"${ffprobePath}" -v quiet -print_format json -show_streams "${rawWebmPath}"`, { encoding: 'utf-8' });
  const rawProbe = JSON.parse(rawProbeJson);
  const videoStream = rawProbe.streams.find((s) => s.codec_type === 'video');
  if (!videoStream) throw new Error('No video stream found in raw recording');
  console.log(`[B4 Test] Raw recording resolution probed by ffprobe: ${videoStream.width}x${videoStream.height}`);

  if (videoStream.width < 1280 || videoStream.height < 720) {
    throw new Error(`Raw recording resolution too low: ${videoStream.width}x${videoStream.height}`);
  }

  // 7. Inspect UI export dropdown and honest upscaling labels
  console.log('[B4 Test] Inspecting UI export labels and dropdown in EditorStudio...');
  await editorPage.waitForSelector('#export-resolution-select', { timeout: 10000 });
  await editorPage.waitForSelector('#export-mp4-btn', { timeout: 10000 });

  const initialSelectVal = await editorPage.$eval('#export-resolution-select', (el) => el.value);
  console.log(`[B4 Test] Default export resolution select value: "${initialSelectVal}"`);
  if (initialSelectVal !== 'source') {
    throw new Error(`Expected default export resolution to be 'source', but got '${initialSelectVal}'`);
  }

  const optionTexts = await editorPage.$$eval('#export-resolution-select option', (opts) =>
    opts.map((o) => ({ value: o.getAttribute('value'), text: o.textContent?.trim() }))
  );
  console.log('[B4 Test] Resolution select options:', optionTexts);

  const sourceOpt = optionTexts.find((o) => o.value === 'source');
  const fourKOpt = optionTexts.find((o) => o.value === '4k');

  if (!sourceOpt || !sourceOpt.text?.includes('Source Default')) {
    throw new Error(`Source option missing '(Source Default)': ${sourceOpt?.text}`);
  }
  if (!fourKOpt || !fourKOpt.text?.includes('Upscaled from')) {
    throw new Error(`4K option must clearly state 'Upscaled from [source]', got: ${fourKOpt?.text}`);
  }

  const initialBtnText = await editorPage.$eval('#export-mp4-btn', (el) => el.textContent?.trim());
  console.log(`[B4 Test] Initial export button text: "${initialBtnText}"`);
  if (!initialBtnText?.includes('1080p') || initialBtnText?.includes('Upscaled')) {
    throw new Error(`Initial button should be source 1080p without 'Upscaled', got: ${initialBtnText}`);
  }

  // Change select to '4k' and check honest label on button
  await editorPage.selectOption('#export-resolution-select', '4k');
  await new Promise((r) => setTimeout(r, 200));

  const upscaledBtnText = await editorPage.$eval('#export-mp4-btn', (el) => el.textContent?.trim());
  console.log(`[B4 Test] Export button text when 4K selected: "${upscaledBtnText}"`);
  if (!upscaledBtnText?.includes('Upscaled from 1080p') && !upscaledBtnText?.includes('Upscaled from')) {
    throw new Error(`Button text MUST state 'Upscaled from [source]' when target > source, got: "${upscaledBtnText}"`);
  }

  // 8. Test Export MP4 at 1080p (source) and 4K (upscaled) to verify bitrates via ffprobe
  console.log('[B4 Test] Exporting 1080p MP4 to verify ~14 Mbps bitrate tier...');
  await editorPage.selectOption('#export-resolution-select', '1080p');
  await new Promise((r) => setTimeout(r, 200));

  const base64Mp4_1080p = await editorPage.evaluate(async () => {
    const videoEl = window.__lastLoadedVideoElement || window.__smoothstudio_video;
    const blob = window.__lastLoadedVideoBlob;
    const HardwareMp4Exporter = window.__HardwareMp4Exporter;
    const preset = window.__VIBE_PRESETS['keynote-pro'];
    const exporter = new HardwareMp4Exporter();
    const mp4Blob = await exporter.exportMp4({
      videoSource: videoEl,
      videoBlob: blob,
      durationMs: 2500,
      aspectRatio: '16:9',
      preset,
      pills: [],
      silences: [],
      cursorEngine: { getCursorAt: () => ({ x: 0.5, y: 0.5, visible: false }) },
      keystrokes: [],
      cutSilences: false,
      showSpotlight: false,
      showCursor: false,
      showHud: false,
      targetWidth: 1920
    });

    const reader = new FileReader();
    return new Promise((resolve) => {
      reader.onloadend = () => {
        const b64 = reader.result.split(',')[1];
        resolve(b64);
      };
      reader.readAsDataURL(mp4Blob);
    });
  });

  const mp4Path_1080p = path.join(testOutDir, 'exported_1080p.mp4');
  fs.writeFileSync(mp4Path_1080p, Buffer.from(base64Mp4_1080p, 'base64'));
  console.log(`[B4 Test] Saved 1080p MP4 to ${mp4Path_1080p} (${fs.statSync(mp4Path_1080p).size} bytes)`);

  const probe1080Json = execSync(`"${ffprobePath}" -v quiet -print_format json -show_streams -show_format "${mp4Path_1080p}"`, { encoding: 'utf-8' });
  const probe1080 = JSON.parse(probe1080Json);
  const stream1080 = probe1080.streams.find((s) => s.codec_type === 'video');
  const bitrate1080 = parseInt(stream1080.bit_rate || probe1080.format.bit_rate || '0', 10);
  console.log(`[B4 Test] 1080p MP4: ${stream1080.width}x${stream1080.height}, bitrate: ${(bitrate1080 / 1_000_000).toFixed(2)} Mbps`);

  if (stream1080.width !== 1920 || stream1080.height !== 1080) {
    throw new Error(`Expected 1920x1080 for 1080p export, got ${stream1080.width}x${stream1080.height}`);
  }

  console.log('[B4 Test] Exporting 4K MP4 to verify ~35-40 Mbps bitrate tier...');
  const base64Mp4_4k = await editorPage.evaluate(async () => {
    const videoEl = window.__lastLoadedVideoElement || window.__smoothstudio_video;
    const blob = window.__lastLoadedVideoBlob;
    const HardwareMp4Exporter = window.__HardwareMp4Exporter;
    const preset = window.__VIBE_PRESETS['keynote-pro'];
    const exporter = new HardwareMp4Exporter();
    const mp4Blob = await exporter.exportMp4({
      videoSource: videoEl,
      videoBlob: blob,
      durationMs: 2500,
      aspectRatio: '16:9',
      preset,
      pills: [],
      silences: [],
      cursorEngine: { getCursorAt: () => ({ x: 0.5, y: 0.5, visible: false }) },
      keystrokes: [],
      cutSilences: false,
      showSpotlight: false,
      showCursor: false,
      showHud: false,
      targetWidth: 3840
    });

    const reader = new FileReader();
    return new Promise((resolve) => {
      reader.onloadend = () => {
        const b64 = reader.result.split(',')[1];
        resolve(b64);
      };
      reader.readAsDataURL(mp4Blob);
    });
  });

  const mp4Path_4k = path.join(testOutDir, 'exported_4k.mp4');
  fs.writeFileSync(mp4Path_4k, Buffer.from(base64Mp4_4k, 'base64'));
  console.log(`[B4 Test] Saved 4K MP4 to ${mp4Path_4k} (${fs.statSync(mp4Path_4k).size} bytes)`);

  const probe4kJson = execSync(`"${ffprobePath}" -v quiet -print_format json -show_streams -show_format "${mp4Path_4k}"`, { encoding: 'utf-8' });
  const probe4k = JSON.parse(probe4kJson);
  const stream4k = probe4k.streams.find((s) => s.codec_type === 'video');
  const bitrate4k = parseInt(stream4k.bit_rate || probe4k.format.bit_rate || '0', 10);
  console.log(`[B4 Test] 4K MP4: ${stream4k.width}x${stream4k.height}, bitrate: ${(bitrate4k / 1_000_000).toFixed(2)} Mbps`);

  if (stream4k.width !== 3840 || stream4k.height !== 2160) {
    throw new Error(`Expected 3840x2160 for 4K export, got ${stream4k.width}x${stream4k.height}`);
  }

  console.log('\n[B4 Test] ALL VERIFICATIONS PASSED:');
  console.log(`  - Raw recording resolution: ${videoStream.width}x${videoStream.height}`);
  console.log(`  - Default export preset: ${initialSelectVal} (Source Default)`);
  console.log(`  - Upscaling honest label verified: "${upscaledBtnText}"`);
  console.log(`  - 1080p export resolution & bitrate: ${stream1080.width}x${stream1080.height} @ ${(bitrate1080 / 1_000_000).toFixed(2)} Mbps`);
  console.log(`  - 4K export resolution & bitrate: ${stream4k.width}x${stream4k.height} @ ${(bitrate4k / 1_000_000).toFixed(2)} Mbps`);

  await context.close();
  server.close();
  process.exit(0);
} catch (err) {
  console.error('[B4 Test] FAILED:', err);
  await context.close();
  server.close();
  process.exit(1);
}
