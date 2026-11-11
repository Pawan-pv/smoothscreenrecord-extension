// C1: the microphone must be recorded.
// Real Chromium, real extension (dist/), real getDisplayMedia (entire screen, auto-picked),
// real getUserMedia (fake mic device fed from tests/fixtures/test-audio.wav).
// The editor tab is in the background while the user records another tab (rule 6).
import { test, expect } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { AddressInfo } from 'net';
import { launchExtension, readOpfsFile, ffprobeStreams, writeScratch, REPO } from './helpers/extension';

function serveFixtures(): Promise<{ url: string; close: () => Promise<void> }> {
  const dir = path.join(REPO, 'tests', 'fixtures');
  const server = http.createServer((req, res) => {
    const file = path.join(dir, (req.url || '/').split('?')[0].replace(/^\//, '') || 'test-page.html');
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}/test-page.html`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

test('C1: a recording made with the mic ON contains an Opus audio stream of the recording length', async () => {
  test.setTimeout(180000);
  const site = await serveFixtures();
  const ext = await launchExtension({ fakeMicFile: true });
  try {
    const target = await ext.context.newPage();
    await target.goto(site.url);

    const editor = await ext.context.newPage();
    await editor.goto(`chrome-extension://${ext.extensionId}/editor.html?record=true&includeMic=true`);
    await editor.locator('#start-capture-prompt-btn').click();
    await expect(editor.locator('#stop-live-recording-top-btn')).toBeVisible({ timeout: 30000 });
    const startedAt = Date.now();

    // Recorded page comes to the front; the editor is now in the background.
    await target.bringToFront();
    await expect(target.locator('#smoothstudio-stop-btn')).toBeVisible({ timeout: 15000 });
    await target.waitForTimeout(20000);
    await target.locator('#smoothstudio-stop-btn').click();
    const stoppedAt = Date.now();
    const wallClockSec = (stoppedAt - startedAt) / 1000;

    await expect(editor.locator('#smoothstudio-source-video')).toHaveCount(1, { timeout: 60000 });

    const bytes = await readOpfsFile(editor, 'smoothstudio_recording.webm');
    expect(bytes, 'raw recording missing from OPFS').not.toBeNull();
    const file = writeScratch('c1-mic-recording.webm', bytes!);
    const probe = ffprobeStreams(file);
    const audio = probe.streams.filter((s) => s.codec_type === 'audio');
    const video = probe.streams.filter((s) => s.codec_type === 'video');

    expect(video.length, 'recording must contain a video stream').toBe(1);
    expect(audio.length, 'recording with mic ON must contain an audio stream').toBe(1);
    expect(audio[0].codec_name).toBe('opus');
    const durationSec = parseFloat(probe.format.duration || '0');
    // The file length must match the real elapsed recording time (wall clock from
    // "recording live" to the stop click), not a fixed number.
    console.log(`C1 raw: ffprobe duration=${durationSec}s wallClock=${wallClockSec.toFixed(3)}s`);
    expect(Math.abs(durationSec - wallClockSec)).toBeLessThan(1.5);
    expect(durationSec).toBeGreaterThan(19);

    // The editor must show the decoded audio, not the "NO AUDIO" placeholder.
    const waveform = editor.locator('[data-waveform="real"]');
    await expect(waveform).toHaveCount(1, { timeout: 60000 });
    const barCount = await waveform.locator(':scope > div').count();
    expect(barCount, 'waveform should have one bar per bucket').toBeGreaterThanOrEqual(100);

    // Silence detection must find the two known gaps in tests/fixtures/test-audio.wav:
    // 5s-7s and 13s-15s (2s each). Tolerance +-1s for capture start offset.
    const silences = editor.locator('[data-silence-id]');
    await expect.poll(() => silences.count(), { timeout: 60000 }).toBe(2);
    const titles = await silences.evaluateAll((els) => els.map((e) => e.getAttribute('title') || ''));
    const durations = titles.map((t) => {
      const m = /Silence gap \((\d+(?:\.\d+)?)s\)/.exec(t);
      return m ? parseFloat(m[1]) : NaN;
    });
    for (const d of durations) expect(Math.abs(d - 2)).toBeLessThan(0.5);
    const lefts = await silences.evaluateAll((els) => els.map((e) => parseFloat((e as HTMLElement).style.left)));
    // Timeline position: left% of the timeline == start / duration.
    const starts = lefts.map((l) => (l / 100) * durationSec);
    expect(Math.abs(starts[0] - 5), `first gap starts at ${starts[0]}s`).toBeLessThan(1);
    expect(Math.abs(starts[1] - 13), `second gap starts at ${starts[1]}s`).toBeLessThan(1);
  } finally {
    await ext.cleanup();
    await site.close();
  }
});
