import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import fs from 'fs';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = path.resolve(__dirname, '../dist');
const ffprobePath = path.resolve(__dirname, '../ffprobe.exe');

// Start local HTTP server to serve the animated target application
const targetHtml = `<!DOCTYPE html>
<html>
<head>
  <title>SmoothStudio Autonomous Test Target App</title>
  <style>
    body { margin: 0; background: #111827; color: #f9fafb; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; overflow: hidden; }
    #canvas { border: 2px solid #8b5cf6; border-radius: 12px; }
    .badge { margin-top: 16px; padding: 8px 16px; background: #1f2937; border: 1px solid #374151; border-radius: 8px; font-family: monospace; }
  </style>
</head>
<body>
  <h1>SmoothStudio Live Capture Target</h1>
  <canvas id="canvas" width="800" height="450"></canvas>
  <div class="badge" id="counter">Frame: 0</div>
  <script>
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    let frame = 0;
    function draw() {
      frame++;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, 800, 450);
      const x = 400 + Math.sin(frame * 0.05) * 250;
      const y = 225 + Math.cos(frame * 0.05) * 120;
      ctx.fillStyle = '#8b5cf6';
      ctx.beginPath();
      ctx.arc(x, y, 35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f43f5e';
      ctx.fillRect(x - 15, y - 15, 30, 30);
      ctx.fillStyle = '#ffffff';
      ctx.font = '20px sans-serif';
      ctx.fillText('Testing 60FPS Video Capture', 260, 50);
      ctx.fillText('Frame: ' + frame, 350, 400);
      document.getElementById('counter').textContent = 'Live Frame: ' + frame;
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(targetHtml);
});

await new Promise((r) => server.listen(8765, r));
console.log('[TestServer] Target app listening at http://localhost:8765');

const context = await chromium.launchPersistentContext('', {
  headless: false,
  acceptDownloads: true,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--auto-select-tab-capture-source-by-title=SmoothStudio Autonomous Test Target App',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream'
  ]
});

try {
  // Find extension background service worker
  let [background] = context.serviceWorkers();
  if (!background) {
    background = await context.waitForEvent('serviceworker', { timeout: 10000 });
  }
  const extensionId = new URL(background.url()).host;
  console.log('[Test] Extension ID:', extensionId);

  // 1. Open Target App
  const targetPage = await context.newPage();
  await targetPage.goto('http://localhost:8765');
  await targetPage.waitForSelector('#canvas');
  console.log('[Test] Target page loaded');

  // 2. Open Editor Studio with record=true
  const editorPage = await context.newPage();
  const consoleLogs = [];
  editorPage.on('console', (msg) => {
    const text = `[EditorConsole ${msg.type()}] ${msg.text()}`;
    consoleLogs.push(text);
    console.log(text);
  });
  editorPage.on('pageerror', (err) => {
    const text = `[EditorError] ${err.message}`;
    consoleLogs.push(text);
    console.error(text);
  });

  await editorPage.goto(`chrome-extension://${extensionId}/editor.html?record=true`);
  await editorPage.waitForSelector('#start-capture-prompt-btn', { timeout: 10000 });
  console.log('[Test] Record prompt overlay is visible! User clicks prompt button:');

  // 3. User clicks "Select Screen / Tab to Record" with direct transient user gesture
  await editorPage.click('#start-capture-prompt-btn');
  console.log('[Test] Clicked #start-capture-prompt-btn. Waiting for recording to start...');

  // 4. Wait for recording to become active
  await editorPage.waitForFunction(() => {
    return document.querySelector('button')?.textContent?.includes('Stop Live Recording');
  }, { timeout: 15000 });
  console.log('[Test] Recording is actively capturing! Letting it record for 15 seconds...');

  // Perform continuous interactions on target page for 15 seconds
  const startTime = Date.now();
  let interactionCount = 0;
  while (Date.now() - startTime < 15500) {
    const progress = (Date.now() - startTime) / 15500;
    const x = 300 + Math.sin(progress * Math.PI * 6) * 200;
    const y = 300 + Math.cos(progress * Math.PI * 6) * 100;
    await targetPage.mouse.move(x, y);
    if (interactionCount % 5 === 0) {
      await targetPage.mouse.click(x, y);
    }
    interactionCount++;
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`[Test] Completed 15s session with ${interactionCount} cursor interactions.`);

  // 5. User clicks "Stop Live Recording" button
  await editorPage.bringToFront();
  const stopButton = editorPage.locator('button:has-text("Stop Live Recording")');
  await stopButton.click();
  console.log('[Test] Clicked Stop Live Recording. Waiting for OPFS finalize and video load...');

  // 6. Wait for editor to load real video
  await editorPage.waitForFunction(() => {
    const v = document.querySelector('video#smoothstudio-source-video');
    return v && (v.getAttribute('data-ready') === 'true' || v.readyState >= 1);
  }, { timeout: 20000 });

  // 7. Extract OPFS and video element evidence
  const evidence = await editorPage.evaluate(async () => {
    const videoEl = document.querySelector('video#smoothstudio-source-video');
    let opfsSize = 0;
    try {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle('smoothstudio_recording.webm');
      const file = await fh.getFile();
      opfsSize = file.size;
    } catch (e) {
      opfsSize = -1;
    }

    return {
      opfsSize,
      videoElementFound: Boolean(videoEl),
      videoSrc: videoEl?.src,
      videoDurationSec: videoEl?.duration,
      videoWidth: videoEl?.videoWidth,
      videoHeight: videoEl?.videoHeight,
      isDemoWorkspace: Boolean(window.__smoothstudio_demo_active),
      readyState: videoEl?.readyState
    };
  });

  console.log('\n=== FIX 1 RAW VERIFICATION EVIDENCE ===');
  console.log(JSON.stringify(evidence, null, 2));

  if (evidence.opfsSize > 0 && evidence.videoElementFound && !evidence.isDemoWorkspace) {
    console.log('\n>>> FIX 1 RESULT: PASS <<<');
  } else {
    console.log('\n>>> FIX 1 RESULT: FAIL <<<');
  }

  // 8. Now Test Fix 2: MP4 Export
  console.log('\n--- TESTING FIX 2: REAL MP4 EXPORT VIA WEBCODECS + MP4-MUXER ---');
  const exportBtn = editorPage.locator('button:has-text("Export 4K/60fps MP4")');
  await exportBtn.waitFor({ state: 'visible', timeout: 10000 });

  const downloadPromise = editorPage.waitForEvent('download', { timeout: 90000 });
  await exportBtn.click();
  console.log('[Test] Clicked Export MP4 button. Waiting for WebCodecs encoding...');

  const download = await downloadPromise;
  const exportedMp4Path = path.resolve(__dirname, '../Exported_Cinematic.mp4');
  await download.saveAs(exportedMp4Path);
  console.log('[Test] MP4 file saved to:', exportedMp4Path);

  const stats = fs.statSync(exportedMp4Path);
  console.log(`[Test] Exported MP4 file size: ${stats.size} bytes (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

  // Run ffprobe on the exported file
  console.log('\n=== RUNNING FFPROBE ON EXPORTED MP4 ===');
  const ffprobeCmd = `"${ffprobePath}" -v error -show_format -show_streams -print_format json "${exportedMp4Path}"`;
  const ffprobeOutput = execSync(ffprobeCmd, { encoding: 'utf8' });
  console.log('Raw ffprobe JSON Output:');
  console.log(ffprobeOutput);

  const ffprobeData = JSON.parse(ffprobeOutput);
  const videoStream = ffprobeData.streams?.find((s) => s.codec_type === 'video');
  const formatName = ffprobeData.format?.format_name;
  const duration = parseFloat(ffprobeData.format?.duration || '0');

  console.log('\n=== FIX 2 SUMMARY ===');
  console.log(`Format: ${formatName}`);
  console.log(`Codec: ${videoStream?.codec_name}`);
  console.log(`Resolution: ${videoStream?.width}x${videoStream?.height}`);
  console.log(`Duration: ${duration}s`);
  console.log(`Size: ${stats.size} bytes`);

  if (formatName?.includes('mp4') && videoStream?.codec_name === 'h264' && stats.size > 1000 && duration > 0) {
    console.log('\n>>> FIX 2 RESULT: PASS <<<');
  } else {
    console.log('\n>>> FIX 2 RESULT: FAIL <<<');
  }

} catch (err) {
  console.error('[Test Error]', err);
} finally {
  await context.close();
  server.close();
  process.exit(0);
}
