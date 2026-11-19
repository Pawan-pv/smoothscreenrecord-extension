// C1: the microphone must be recorded.
// Real Chromium, real extension (dist/), real getDisplayMedia (entire screen, auto-picked),
// real getUserMedia (the REAL microphone hears tests/fixtures/audio/test.wav played
// through the REAL speakers - see helpers/speaker.ts).
// The editor tab is in the background while the user records another tab (rule 6).
import { test, expect } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { AddressInfo } from 'net';
import { launchExtension, readOpfsFile, ffprobeStreams, writeScratch, REPO, SPEECH_WAV } from './helpers/extension';
import { detectAcousticDelay, checkKnownPauses, maxWindowDb, recordingOrigin } from './helpers/harness';
import { prepareSpeaker } from './helpers/speaker';

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
  const ext = await launchExtension({ realMic: true, raiseWindow: true });
  // QA-020: the REAL mic records the fixture WAV played through the REAL speakers.
  const speaker = await prepareSpeaker(SPEECH_WAV);
  try {
    const target = await ext.context.newPage();
    await target.goto(site.url);

    const editor = await ext.context.newPage();
    await editor.goto(`chrome-extension://${ext.extensionId}/editor.html?record=true&includeMic=true`);
    await editor.locator('#start-capture-prompt-btn').click();
    await expect(editor.locator('#stop-live-recording-top-btn')).toBeVisible({ timeout: 30000 });

    // Recorded page comes to the front; the editor is now in the background.
    await target.bringToFront();
    await expect(target.locator('#smoothstudio-stop-btn')).toBeVisible({ timeout: 15000 });
    // QA-038: the wall clock starts when the recorder's first encoded picture
    // really shows the recorded page, not when the HUD was painted ~1 s earlier
    // (QA-037). Anchoring on Date.now() here made the file look 2 s too short.
    const startedAt = await recordingOrigin(editor);
    const audioOffsetSec = ((await speaker.go()) - startedAt) / 1000;
    console.log(`C1 speaker playback started ${audioOffsetSec.toFixed(3)} s after the recording went live`);
    await target.waitForTimeout(20000);
    await target.locator('#smoothstudio-stop-btn').click();
    speaker.stop();
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

    // Silence detection must find the two known gaps of tests/fixtures/audio/test.wav
    // (WAV time 4-6 s and 14-16 s, 2 s each), shifted by the measured acoustic delay.
    const delay = detectAcousticDelay(file, [[4, 6], [14, 16]]);
    console.log(`C1 measured speaker-WAV delay in the recording: ${JSON.stringify(delay)}` +
      ` (START line said ${audioOffsetSec.toFixed(3)}s)`);
    expect(delay, 'the speaker audio must be audible in the real-mic recording').not.toBeNull();
    const silences = editor.locator('[data-silence-id]');
    await expect.poll(() => silences.count(), { timeout: 60000 }).toBeGreaterThanOrEqual(1);
    await editor.waitForTimeout(1000);
    const titles = await silences.evaluateAll((els) => els.map((e) => e.getAttribute('title') || ''));
    const durations = titles.map((t) => {
      const m = /Silence gap \((\d+(?:\.\d+)?)s\)/.exec(t);
      return m ? parseFloat(m[1]) : NaN;
    });
    const lefts = await silences.evaluateAll((els) => els.map((e) => parseFloat((e as HTMLElement).style.left)));
    // Timeline position: left% of the timeline == start / duration.
    const starts = lefts.map((l) => (l / 100) * durationSec);
    const pauses = starts.map((s, i) => ({ start: s, duration: durations[i] }));
    console.log('C1 product pauses:', JSON.stringify(pauses));
    // QA-020 ground truth from the recording itself (real room, real mic).
    const checks = checkKnownPauses(file, [[4, 6], [14, 16]], delay!.delaySec, pauses);
    console.log('C1 known pauses vs the recording:', JSON.stringify(checks));
    const quiet = checks.filter((c) => c.quiet);
    expect(quiet.length, 'at least one known pause must have stayed quiet in the room').toBeGreaterThanOrEqual(1);
    for (const c of quiet) {
      expect(c.matched, `the product missed the quiet pause at ${c.gap[0].toFixed(2)}s (max ${c.maxDb} dB)`).toBeTruthy();
      expect(Math.abs(c.matched!.duration - 2), `pause at ${c.gap[0].toFixed(2)}s lasts ${c.matched!.duration}s`).toBeLessThan(0.5);
    }
    // ...and the product reports no pause where the recording is not quiet
    // (a recording may begin quietly: the speaker audio starts at the delay).
    for (const p of pauses) {
      if (p.start < 0.1 && p.duration <= delay!.delaySec + 0.3) continue;
      const loud = maxWindowDb(file, p.start + 0.25, p.start + p.duration - 0.25);
      expect(loud, `the product's pause at ${p.start.toFixed(2)}s is not quiet in the recording (${loud} dB)`).toBeLessThan(-25);
    }
  } finally {
    speaker.stop();
    await ext.cleanup();
    await site.close();
  }
});
