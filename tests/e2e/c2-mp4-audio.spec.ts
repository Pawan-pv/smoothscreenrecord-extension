// C2: the exported MP4 must contain the recording's audio (AAC), in sync with
// the video, and auto-cut must remove the same span from audio AND video.
// Real Chromium + real extension + real screen capture + REAL microphone: the fixture
// WAV is played through the real speakers (QA-020: no fake capture device).
// Visual events: tests/fixtures/sync-flash.html flashes white every 3s.
// Audio events: the speech-like fixture WAV has silent gaps at 4-6s and 14-16s (WAV time).
import { test, expect } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { launchExtension, readOpfsFile, ffprobeStreams, writeScratch, FFPROBE, SPEECH_WAV } from './helpers/extension';
import { serveFixtures, recordSession, detectSilences, detectFlashOnsets, ffprobeRaw } from './helpers/session';

const FRAME = 1 / 60;

async function exportMp4(editor: import('@playwright/test').Page, name: string): Promise<string> {
  const dir = path.join(os.tmpdir(), 'ss-e2e-artifacts');
  fs.mkdirSync(dir, { recursive: true });
  const downloadPromise = editor.waitForEvent('download', { timeout: 600000 });
  await editor.locator('#export-mp4-btn').click();
  // Fail fast with the product's own error text if the export reports a failure.
  const failure = editor.getByText('MP4 Export Failed').first();
  const failed = failure.waitFor({ state: 'visible', timeout: 600000 }).then(async () => {
    const text = await editor.locator('body').innerText();
    const m = /MP4 Export Failed\s*(.*)/.exec(text);
    throw new Error('Editor reported: MP4 Export Failed ' + (m ? m[1] : ''));
  });
  failed.catch(() => undefined);
  const download = await Promise.race([downloadPromise, failed]) as import('@playwright/test').Download;
  const out = path.join(dir, name);
  await download.saveAs(out);
  return out;
}

function nearest(values: number[], t: number): number {
  return values.reduce((best, v) => (Math.abs(v - t) < Math.abs(best - t) ? v : best), values[0]);
}

test('C2: MP4 export contains AAC audio in sync with video; auto-cut cuts audio and video together', async () => {
  test.setTimeout(900000);
  const site = await serveFixtures();
  const ext = await launchExtension({ realMic: true, raiseWindow: true });
  try {
    const { editor } = await recordSession(ext.context, ext.extensionId, `${site.base}/sync-flash.html`, 20, { includeMic: true, speakerWav: SPEECH_WAV });
    editor.on('console', (m) => { if (m.type() === 'error' || /Exporter|Seek|Muxed/.test(m.text())) console.log(`[editor ${m.type()}] ${m.text().slice(0, 300)}`); });
    editor.on('crash', () => console.log('[editor] PAGE CRASHED'));
    editor.on('close', () => console.log('[editor] page closed'));

    const raw = await readOpfsFile(editor, 'smoothstudio_recording.webm');
    expect(raw).not.toBeNull();
    const webm = writeScratch('c2-source.webm', raw!);
    console.log('C2 source ffprobe:\n' + ffprobeRaw(webm, FFPROBE));
    const srcDuration = parseFloat(ffprobeStreams(webm).format.duration || '0');

    // Wait until the editor has analysed the audio (two silence gaps shown).
    await expect.poll(() => editor.locator('[data-silence-id]').count(), { timeout: 60000 }).toBe(2);

    // ---------- Export 1: no cuts ----------
    const mp4 = await exportMp4(editor, 'c2-export.mp4');
    console.log('C2 export ffprobe:\n' + ffprobeRaw(mp4, FFPROBE));
    const probe = ffprobeStreams(mp4);
    const v = probe.streams.filter((s) => s.codec_type === 'video');
    const a = probe.streams.filter((s) => s.codec_type === 'audio');
    expect(v.length).toBe(1);
    expect(v[0].codec_name).toBe('h264');
    expect(a.length, 'exported MP4 must contain an audio stream').toBe(1);
    expect(a[0].codec_name).toBe('aac');
    const mp4Duration = parseFloat(probe.format.duration || '0');
    expect(Math.abs(mp4Duration - srcDuration)).toBeLessThan(0.25);

    // ---------- A/V sync: export must preserve the source's audio/video relation ----------
    const srcSil = detectSilences(webm);
    const outSil = detectSilences(mp4);
    const srcFlash = detectFlashOnsets(webm);
    const outFlash = detectFlashOnsets(mp4);
    console.log('C2 source silences:', JSON.stringify(srcSil));
    console.log('C2 export silences:', JSON.stringify(outSil));
    console.log('C2 source flash onsets:', JSON.stringify(srcFlash));
    console.log('C2 export flash onsets:', JSON.stringify(outFlash));
    expect(srcSil.length).toBe(2);
    expect(outSil.length).toBe(2);
    expect(srcFlash.length).toBeGreaterThanOrEqual(5);
    expect(outFlash.length).toBe(srcFlash.length);

    const audioEvents = [srcSil[0].start, srcSil[0].end, srcSil[1].start, srcSil[1].end];
    const audioEventsOut = [outSil[0].start, outSil[0].end, outSil[1].start, outSil[1].end];
    const audioShift = audioEvents.map((t, i) => audioEventsOut[i] - t);
    const videoShift = srcFlash.map((t, i) => outFlash[i] - t);
    console.log('C2 audio shift (export - source), s:', JSON.stringify(audioShift.map((x) => +x.toFixed(4))));
    console.log('C2 video shift (export - source), s:', JSON.stringify(videoShift.map((x) => +x.toFixed(4))));
    // Compare each audio event with the flash nearest to it in time (start, middle, end of the file).
    const skew = audioEvents.map((t, i) => {
      const flashT = nearest(srcFlash, t);
      const j = srcFlash.indexOf(flashT);
      return audioShift[i] - videoShift[j];
    });
    console.log('C2 A/V skew introduced by export, s:', JSON.stringify(skew.map((x) => +x.toFixed(4))));
    for (const s of skew) {
      expect(Math.abs(s), `A/V skew ${s}s exceeds one frame`).toBeLessThanOrEqual(FRAME);
    }

    // ---------- Export 2: auto-cut ON ----------
    await editor.locator('[title="Toggle automatic silence skipping during playback & export"]').click();
    await expect(editor.locator('[title="Toggle automatic silence skipping during playback & export"]')).toContainText('ON');
    const cutMp4 = await exportMp4(editor, 'c2-export-cut.mp4');
    console.log('C2 cut export ffprobe:\n' + ffprobeRaw(cutMp4, FFPROBE));
    const cutProbe = ffprobeStreams(cutMp4);
    const cutV = cutProbe.streams.find((s) => s.codec_type === 'video')!;
    const cutA = cutProbe.streams.find((s) => s.codec_type === 'audio');
    expect(cutA, 'cut export must still contain audio').toBeTruthy();
    const cutTotal = srcSil.reduce((sum, s) => sum + (s.end - s.start), 0);
    const cutDuration = parseFloat(cutProbe.format.duration || '0');
    console.log(`C2 cut: source=${srcDuration}s silence=${cutTotal.toFixed(3)}s export=${cutDuration}s`);
    expect(Math.abs(cutDuration - (srcDuration - cutTotal))).toBeLessThan(0.4);
    // The silent spans are gone from the audio...
    const cutSil = detectSilences(cutMp4);
    console.log('C2 cut export silences:', JSON.stringify(cutSil));
    expect(cutSil.length).toBe(0);
    // ...and audio and video are the same length (same spans removed from both).
    const vd = parseFloat(cutV.duration || '0');
    const ad = parseFloat(cutA!.duration || '0');
    console.log(`C2 cut stream durations: video=${vd}s audio=${ad}s`);
    expect(Math.abs(vd - ad)).toBeLessThan(0.05);
    // After the cut, flashes after the first gap move earlier by the removed time (video was cut too).
    const cutFlash = detectFlashOnsets(cutMp4);
    console.log('C2 cut export flash onsets:', JSON.stringify(cutFlash));
    const lastSrc = srcFlash[srcFlash.length - 1];
    if (lastSrc > srcSil[1].end) {
      const lastCut = cutFlash[cutFlash.length - 1];
      expect(Math.abs((lastSrc - lastCut) - cutTotal)).toBeLessThan(0.15);
    }
  } finally {
    await ext.cleanup();
    await site.close();
  }
});
