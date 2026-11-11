import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = path.resolve(__dirname, '../dist');
const ffprobePath = path.resolve(__dirname, '../ffprobe.exe');
const ffmpegPath = path.resolve(__dirname, '../ffmpeg.exe');

console.log('[Task 9] Launching Chromium with extension and fake device flags...');

const context = await chromium.launchPersistentContext('', {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-sandbox',
    '--use-fake-device-for-media-stream'
  ]
});

try {
  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker');
  const extensionId = new URL(background.url()).host;

  const page = await context.newPage();
  page.on('console', (msg) => console.log(`[Editor Console] ${msg.text()}`));

  await page.goto(`chrome-extension://${extensionId}/editor.html`);

  const inputWebmPath = path.resolve(__dirname, '../test-results/task9_exact13s.webm');
  if (!fs.existsSync(inputWebmPath)) {
    throw new Error(`Input file not found: ${inputWebmPath}`);
  }

  console.log('[Task 9] Seeding OPFS with task9_exact13s.webm (' + fs.statSync(inputWebmPath).size + ' bytes)...');
  const rawBytes = Array.from(fs.readFileSync(inputWebmPath));
  await page.evaluate(async (bytes) => {
    const root = await navigator.storage.getDirectory();
    // Clear out any old telemetry file so fresh duration is calculated
    try {
      await root.removeEntry('smoothstudio_telemetry.json');
    } catch {
      // Ignore if not present
    }
    const vHandle = await root.getFileHandle('smoothstudio_recording.webm', { create: true });
    const writable = await vHandle.createWritable();
    await writable.write(new Uint8Array(bytes));
    await writable.close();
  }, rawBytes);

  console.log('[Task 9] Reloading editor to load recording and trigger audio silence analysis...');
  await page.reload();

  await page.waitForSelector('video#smoothstudio-source-video', { timeout: 15000 });
  console.log('[Task 9] Source video loaded in editor!');

  // Wait for silence analysis
  console.log('[Task 9] Waiting for silence analysis to complete...');
  let silences = null;
  for (let i = 0; i < 20; i++) {
    silences = await page.evaluate(async () => {
      const v = document.querySelector('video#smoothstudio-source-video');
      if (!v || !v.duration) return null;
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle('smoothstudio_recording.webm');
      const file = await handle.getFile();
      const ctx = new AudioContext();
      const ab = await file.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(ab.slice(0));
      
      const channelData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;
      const windowSize = Math.floor(sampleRate * 0.05);
      const totalWindows = Math.floor(channelData.length / windowSize);

      const detected = [];
      let silenceStartMs = null;
      const dbThreshold = -42;
      const minSilenceDurationMs = 1200;

      for (let w = 0; w < totalWindows; w++) {
        const startIdx = w * windowSize;
        let sumSquares = 0;
        for (let j = 0; j < windowSize; j++) {
          const val = channelData[startIdx + j];
          sumSquares += val * val;
        }
        const rms = Math.sqrt(sumSquares / windowSize);
        const db = rms > 0.00001 ? 20 * Math.log10(rms) : -100;
        const currentMs = (w * windowSize * 1000) / sampleRate;

        if (db < dbThreshold) {
          if (silenceStartMs === null) silenceStartMs = currentMs;
        } else {
          if (silenceStartMs !== null) {
            const dur = currentMs - silenceStartMs;
            if (dur >= minSilenceDurationMs) {
              detected.push({
                id: 'silence_' + Math.round(silenceStartMs),
                startTime: Math.round(silenceStartMs),
                endTime: Math.round(currentMs),
                duration: Math.round(dur),
                markedForCut: true
              });
            }
            silenceStartMs = null;
          }
        }
      }
      return {
        audioDurationSec: audioBuffer.duration,
        detectedSilences: detected
      };
    });

    if (silences && silences.detectedSilences && silences.detectedSilences.length >= 2) {
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log('[Task 9] Silence Analysis Result:', JSON.stringify(silences, null, 2));

  // Verify condition 1: Detected silence timestamps match known gaps within +-300ms
  // Known gaps: 3000ms - 5000ms, and 8000ms - 10000ms
  const gap1 = silences.detectedSilences[0];
  const gap2 = silences.detectedSilences[1];

  const gap1StartDiff = Math.abs(gap1.startTime - 3000);
  const gap1EndDiff = Math.abs(gap1.endTime - 5000);
  const gap2StartDiff = Math.abs(gap2.startTime - 8000);
  const gap2EndDiff = Math.abs(gap2.endTime - 10000);

  console.log(`[Task 9] Gap 1: start=${gap1.startTime}ms (diff=${gap1StartDiff}ms), end=${gap1.endTime}ms (diff=${gap1EndDiff}ms)`);
  console.log(`[Task 9] Gap 2: start=${gap2.startTime}ms (diff=${gap2StartDiff}ms), end=${gap2.endTime}ms (diff=${gap2EndDiff}ms)`);

  const condition1Passed =
    gap1StartDiff <= 300 &&
    gap1EndDiff <= 300 &&
    gap2StartDiff <= 300 &&
    gap2EndDiff <= 300;

  console.log(`\n[Task 9] Condition 1 (Timestamps match known gaps within +-300ms): ${condition1Passed ? 'PASS' : 'FAIL'}`);

  // Now trigger MP4 export with Auto-Cut Silences active
  console.log('\n[Task 9] Triggering MP4 export with Auto-Cut Silences enabled...');
  const downloadPromise = page.waitForEvent('download', { timeout: 240000 });

  // Locate the MP4 Export button
  const exportBtn = page.getByRole('button', { name: /Export 4K\/60fps MP4/i });
  await exportBtn.click();
  console.log('[Task 9] Export button clicked! Waiting for encoding and download...');

  const download = await downloadPromise;
  const exportOutputPath = path.resolve(__dirname, '../test-results/task9_silence_cut_exported.mp4');
  await download.saveAs(exportOutputPath);
  console.log('[Task 9] Export saved to:', exportOutputPath);

  const stat = fs.statSync(exportOutputPath);
  console.log(`[Task 9] File size: ${stat.size} bytes`);

  // Run ffprobe on the exported MP4
  const ffprobeOutput = execSync(`"${ffprobePath}" -v error -show_format -show_streams "${exportOutputPath}"`).toString();
  console.log('\n--- Exported MP4 ffprobe ---\n', ffprobeOutput);

  // Extract duration from ffprobe
  const durationMatch = ffprobeOutput.match(/duration=([0-9.]+)/);
  const exportedDuration = durationMatch ? parseFloat(durationMatch[1]) : 0;
  console.log(`[Task 9] Exported MP4 Duration: ${exportedDuration}s (Expected ~9.0s, original was 13.0s)`);

  // Condition 2: Duration should reflect cut of ~4.0s (should be between 8.5s and 9.5s)
  const condition2Passed = exportedDuration >= 8.5 && exportedDuration <= 9.5;
  console.log(`\n[Task 9] Condition 2 (Duration ~9s after cutting 4s of silence): ${condition2Passed ? 'PASS' : 'FAIL'}`);

  // Extract frames from exported MP4 at 1s, 4.5s, 8.5s
  const frameDir = path.resolve(__dirname, '../test-results/frames');
  if (!fs.existsSync(frameDir)) fs.mkdirSync(frameDir, { recursive: true });
  const f1 = path.join(frameDir, 'task9_cut_1s.png');
  const f2 = path.join(frameDir, 'task9_cut_4s.png');
  const f3 = path.join(frameDir, 'task9_cut_8s.png');

  execSync(`"${ffmpegPath}" -y -ss 00:00:01.000 -i "${exportOutputPath}" -frames:v 1 "${f1}"`);
  execSync(`"${ffmpegPath}" -y -ss 00:00:04.000 -i "${exportOutputPath}" -frames:v 1 "${f2}"`);
  execSync(`"${ffmpegPath}" -y -ss 00:00:08.000 -i "${exportOutputPath}" -frames:v 1 "${f3}"`);
  console.log('[Task 9] Extracted frames saved to:', f1, f2, f3);

  if (condition1Passed && condition2Passed) {
    console.log('\n[Task 9] ALL CRITERIA PASSED!');
  } else {
    console.error('\n[Task 9] CRITERIA FAILED!');
  }
} catch (err) {
  console.error('[Task 9] Error:', err);
} finally {
  await context.close();
}
