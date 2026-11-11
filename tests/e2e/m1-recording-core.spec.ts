/**
 * M1 — Recording core (MODULES.md M1-01 .. M1-10).
 *
 * Real built extension (dist/), real Chrome for Testing, real screen capture
 * (QA-005: the capture auto-select flags are ignored, so the SCREEN is
 * captured with the fixture in a raised window), editor tab in the BACKGROUND
 * while recording, real microphone for the mic check. Nothing in the picture
 * or the audio is replaced.
 *
 * The recording that is checked is always the one the EDITOR has loaded: its
 * <video> src is read back as bytes and measured with ffprobe / ffmpeg, so the
 * checks do not depend on where the product stores the file.
 *
 * The only fault injection in this file is in the IndexedDB-fallback test: it
 * makes navigator.storage.getDirectory() reject on extension pages (OPFS
 * "unavailable", as under a storage policy). The capture, the encoder, the
 * page and the recording stay real.
 */
import { test, expect, Page, BrowserContext } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import {
  launchApp, serveFixtures, recordPage, mediaInfo, outDir, streamEndTime, framePts, FFMPEG,
  sleep, REPO, extractFrameByIndex, lumaStdDev
} from './helpers/harness';
import { loadedRecordingBytes } from './helpers/harness';
import { guardRecording } from './helpers/marker';

/* ----------------------------------------------------------------- helpers */

/**
 * Re-asserts HWND_TOPMOST on the test browser right before a recording. The
 * harness does it once at launch, but the window may not be visible yet then,
 * and another always-on-top desktop window can end up above it - the screen
 * capture would then record that window instead of the fixture.
 */
function raiseBrowser(profile: string): void {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(REPO, 'tests', 'e2e', 'helpers', 'raise-window.ps1'), '-ProfileDir', profile, '-Mode', 'top'],
      { encoding: 'utf8', timeout: 20000 }).trim();
    console.log('[m1] raise browser:', out);
  } catch (e) { console.log('[m1] raise browser failed:', String(e).slice(0, 200)); }
}

/** Bytes of the recording the editor has loaded (its <video> blob URL). */
async function loadedRecording(editor: Page, file: string): Promise<string> {
  const bytes = await loadedRecordingBytes(editor);
  expect(bytes, 'the editor must have a loaded recording').toBeTruthy();
  guardRecording(bytes!, path.basename(path.dirname(file)) + '/' + path.basename(file)); // AGENTS.md 3.8
  fs.writeFileSync(file, bytes!);
  return file;
}

async function loadedSessionId(editor: Page): Promise<string | null> {
  return editor.locator('#smoothstudio-source-video').getAttribute('data-session-id');
}

async function swSession(context: BrowserContext): Promise<Record<string, any>> {
  const sw = context.serviceWorkers()[0];
  return sw.evaluate(() => chrome.storage.session.get(null));
}

/** Every telemetry object the product has persisted (chrome.storage + OPFS). */
async function persistedTelemetry(page: Page): Promise<any[]> {
  return page.evaluate(async () => {
    const out: any[] = [];
    const local = await chrome.storage.local.get(null);
    for (const [k, v] of Object.entries(local)) {
      if (/telemetry/i.test(k) && v && typeof v === 'object' && (v as any).metadata) out.push(v);
    }
    try {
      const root = await navigator.storage.getDirectory();
      for await (const [name, h] of (root as any).entries()) {
        if (/telemetry.*\.json$/i.test(name)) {
          try { out.push(JSON.parse(await (await (h as any).getFile()).text())); } catch { /* not json */ }
        }
      }
    } catch { /* no OPFS */ }
    return out;
  });
}

/** Committed OPFS entries and their sizes (what would survive a crash). */
async function opfsListing(page: Page): Promise<{ name: string; size: number }[]> {
  return page.evaluate(async () => {
    const out: { name: string; size: number }[] = [];
    const walk = async (dir: any, prefix: string) => {
      for await (const [name, h] of dir.entries()) {
        if (h.kind === 'file') out.push({ name: prefix + name, size: (await h.getFile()).size });
        else await walk(h, prefix + name + '/');
      }
    };
    await walk(await navigator.storage.getDirectory(), '');
    return out;
  });
}

/**
 * Decodes the epoch band of EVERY frame in one ffmpeg pass (top 30 % of the
 * frame, scaled to 480 px wide). Returns one value per decoded frame
 * (null = no epoch band). A value only counts if it lies inside [lo, hi]:
 * other UI (the editor, for example) can decode to an epoch-LOOKING number.
 */
function epochPerFrame(file: string, lo: number, hi: number): (number | null)[] {
  const W = 480;
  const probe = execFileSync(path.join(path.dirname(FFMPEG), 'ffprobe.exe'), ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim().split(',').map(Number);
  const H = Math.round((probe[1] * 0.3) * (W / probe[0]) / 2) * 2;
  const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-vsync', '0', '-vf',
    `crop=iw:ih*0.3:0:0,scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
  const frameBytes = W * H * 3;
  const values: (number | null)[] = [];
  for (let off = 0; off + frameBytes <= raw.length; off += frameBytes) {
    let found: number | null = null;
    for (let y = 0; y < H && found === null; y++) {
      let value = 0;
      for (let c = 0; c < 48; c++) {
        const x = Math.min(W - 1, Math.round((c + 0.5) * W / 48));
        const i = off + (y * W + x) * 3;
        const luma = 0.299 * raw[i] + 0.587 * raw[i + 1] + 0.114 * raw[i + 2];
        value = value * 2 + (luma > 128 ? 1 : 0);
      }
      if (value >= lo && value <= hi) found = value;
    }
    values.push(found);
  }
  return values;
}

function captureSettingsFromConsole(lines: string[]): any | null {
  for (const l of lines) {
    const m = /Capture track settings:\s*(\{.*\})/.exec(l);
    if (m) { try { return JSON.parse(m[1]); } catch { /* ignore */ } }
  }
  return null;
}

/**
 * Independent baseline for M1-03: the frame rate a PLAIN MediaRecorder gets
 * when it records the raw getDisplayMedia track of this machine (VP8, the same
 * bitrate), with the animating fixture in front - i.e. a recorder with zero
 * product overhead. No product code is involved; the frames are counted by
 * ffprobe in the file it produced.
 */
async function plainRecorderFps(context: BrowserContext, fixtureUrl: string, front: Page, file: string, seconds = 6): Promise<number> {
  const probe = await context.newPage();
  try {
    await probe.goto(fixtureUrl);
    await probe.evaluate(async () => {
      (window as any).__probeStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: false });
    });
    await front.bringToFront();
    const b64 = await probe.evaluate(async (sec) => {
      const stream: MediaStream = (window as any).__probeStream;
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 10_000_000 });
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.start(250);
      await new Promise((r) => setTimeout(r, sec * 1000));
      await new Promise((r) => { rec.onstop = r; rec.stop(); });
      stream.getTracks().forEach((t) => t.stop());
      const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    }, seconds);
    const bytes = Buffer.from(b64, 'base64');
    guardRecording(bytes, 'plain-recorder baseline'); // AGENTS.md 3.8
    fs.writeFileSync(file, bytes);
    const pts = framePts(file);
    return pts.length / Math.max(0.5, (pts[pts.length - 1] || 0) - (pts[0] || 0));
  } finally {
    await probe.close().catch(() => undefined);
  }
}

/** "Frame pump (...): N captured frames read, M frames sent ..." from the recorder's log. */
function pumpStats(lines: string[]): { read: number; sent: number } | null {
  for (const l of lines) {
    const m = /Frame pump \([^)]*\): (\d+) captured frames read, (\d+) frames sent/.exec(l);
    if (m) return { read: parseInt(m[1], 10), sent: parseInt(m[2], 10) };
  }
  return null;
}

/** Diagnostics: every page's console goes to <dir>/console.log. */
function logConsole(context: BrowserContext, dir: string): void {
  const file = path.join(dir, 'console.log');
  fs.writeFileSync(file, '');
  context.on('console', (m) => {
    try {
      const where = m.page()?.url().slice(0, 60) || 'worker';
      fs.appendFileSync(file, `[${new Date().toISOString()}] [${m.type()}] ${where} | ${m.text().slice(0, 600)}\n`);
    } catch { /* ignore */ }
  });
}

/* ------------------------------------------------------------------- tests */

test.describe('M1 recording core', () => {
  test.setTimeout(360000);

  test('M1 timing: a real screen recording covers the live interval with every frame the capture delivers, editor in the background (M1-01..03)', async () => {
    const dir = outDir('m1-timing');
    const site = await serveFixtures();
    const app = await launchApp({ capture: 'screen', raiseWindow: true });
    logConsole(app.context, dir);
    try {
      const target = await app.context.newPage();
      await target.goto(`${site.base}/clock.html`, { waitUntil: 'domcontentloaded' });
      await target.waitForTimeout(500);
      raiseBrowser(app.profile);
      // the baseline of this machine, measured before the product records
      const baselineFps = await plainRecorderFps(app.context, `${site.base}/static.html`, target, path.join(dir, 'plain-recorder.webm'));
      console.log(`M1 plain MediaRecorder on the raw capture track: ${baselineFps.toFixed(1)} fps`);
      const editorConsole: string[] = [];
      const editor = await app.context.newPage();
      editor.on('console', (m) => editorConsole.push(m.text()));
      await editor.goto(`chrome-extension://${app.extensionId}/editor.html?record=true&includeMic=false`);

      const testStart = Date.now();
      const session = await recordPage(app.context, app.extensionId, '', {
        seconds: 10, includeMic: false, target, editor,
        // diagnostics only: is the background editor hidden / responsive?
        interact: async () => {
          const t0 = Date.now();
          const st = await Promise.race([
            editor.evaluate(() => document.visibilityState),
            sleep(2000).then(() => 'no answer within 2 s')
          ]);
          console.log(`M1 editor while recording: ${st} (answered in ${Date.now() - t0} ms)`);
        }
      });
      const stopEpoch = session.startedAt + session.wallClockSec * 1000;
      const lo = testStart - 1000;
      const hi = Date.now() + 1000;
      const file = await loadedRecording(session.editor, path.join(dir, 'recording.webm'));

      // M1-01: one real video stream, even dimensions equal to the capture track
      const info = mediaInfo(file);
      console.log('M1 timing ffprobe:', JSON.stringify(info));
      const video = info.streams.filter((s: any) => s.codec_type === 'video');
      expect(video.length).toBe(1);
      expect(['vp8', 'vp9']).toContain(video[0].codec_name);
      expect(video[0].width % 2, 'width must be even').toBe(0);
      expect(video[0].height % 2, 'height must be even').toBe(0);
      const settings = captureSettingsFromConsole(editorConsole);
      console.log('M1 capture track settings:', JSON.stringify(settings));
      expect(settings, 'the capture track settings must be logged by the recorder').toBeTruthy();
      expect(video[0].width).toBe(settings.width);
      expect(video[0].height).toBe(settings.height);
      // Frame 0 is whatever was on screen when the user pressed Start (the
      // editor): it must be a REAL captured picture, not a blank/invented one.
      const f0 = extractFrameByIndex(file, 0, path.join(dir, 'frame0.png'));
      const f0Detail = lumaStdDev(f0, { x: 0, y: 0, w: video[0].width, h: video[0].height });
      console.log(`M1 frame 0 luma std-dev: ${f0Detail.toFixed(1)}`);
      expect(f0Detail, 'frame 0 must be a real captured picture (not a uniform black frame)').toBeGreaterThan(5);

      const epochs = epochPerFrame(file, lo, hi);
      const pts = framePts(file);
      const page = epochs.map((e, i) => ({ e, t: pts[i] })).filter((x): x is { e: number; t: number } => x.e !== null);
      console.log(`M1 frames: ${epochs.length}, showing the page: ${page.length}`);
      expect(page.length, 'the recording must show the fixture page').toBeGreaterThan(10);

      // M1-02: the page frames cover the live interval
      const firstPage = page[0].e;
      const lastPage = page[page.length - 1].e;
      console.log(`M1 first page frame ${firstPage} vs HUD visible ${session.startedAt} (${firstPage - session.startedAt} ms)`);
      console.log(`M1 last  page frame ${lastPage} vs stop click ${Math.round(stopEpoch)} (${Math.round(lastPage - stopEpoch)} ms)`);
      expect(firstPage, 'the page must be recorded from the moment the HUD says "live"').toBeLessThanOrEqual(session.startedAt + 100);
      expect(Math.abs(lastPage - stopEpoch), 'the last page frame must be within 0.3 s of the stop click').toBeLessThan(300);

      // M1-03: every frame the capture delivers is kept, with no holes
      const live = page.filter((x) => x.e >= session.startedAt && x.e <= stopEpoch);
      let worstGap = 0;
      let worstAt = 0;
      for (let i = 1; i < live.length; i++) {
        const g = live[i].e - live[i - 1].e;
        if (g > worstGap) { worstGap = g; worstAt = live[i - 1].e - session.startedAt; }
      }
      const distinct = new Set(live.map((x) => x.e)).size;
      const spanSec = (live[live.length - 1].e - live[0].e) / 1000;
      const fps = distinct / spanSec;
      const stats = pumpStats(editorConsole);
      console.log(`M1 recorded ${distinct} distinct page frames over ${spanSec.toFixed(2)} s = ${fps.toFixed(1)} fps ` +
        `(plain recorder ${baselineFps.toFixed(1)} fps); worst hole ${worstGap} ms at +${worstAt} ms; ` +
        `pump ${JSON.stringify(stats)}, frames in the file ${pts.length}`);
      expect(worstGap, 'no hole in the recorded page frames (editor in the background)').toBeLessThanOrEqual(500);
      expect(stats, 'the recorder reports its frame counts').toBeTruthy();
      expect(pts.length, 'the file keeps >= 95% of the frames read from the capture track').toBeGreaterThanOrEqual(0.95 * stats!.read);
      expect(fps, 'at least 90% of the frame rate of a plain MediaRecorder on the raw track').toBeGreaterThanOrEqual(0.9 * baselineFps);
    } finally {
      await app.cleanup();
      await site.close();
    }
  });

  test('M1 mic: a real-microphone recording has one Opus track that ends with the video (M1-04)', async () => {
    const dir = outDir('m1-mic');
    const site = await serveFixtures();
    const app = await launchApp({ capture: 'screen', raiseWindow: true, mic: true });
    logConsole(app.context, dir);
    try {
      const target = await app.context.newPage();
      await target.goto(`${site.base}/static.html`, { waitUntil: 'domcontentloaded' });
      raiseBrowser(app.profile);
      const session = await recordPage(app.context, app.extensionId, '', { seconds: 8, includeMic: true, target });
      const file = await loadedRecording(session.editor, path.join(dir, 'recording.webm'));
      const info = mediaInfo(file);
      console.log('M1 mic ffprobe:', JSON.stringify(info));
      const audio = info.streams.filter((s: any) => s.codec_type === 'audio');
      expect(audio.length, 'mic ON -> one audio stream').toBe(1);
      expect(audio[0].codec_name).toBe('opus');
      const vEnd = streamEndTime(file, 'v');
      const aEnd = streamEndTime(file, 'a');
      console.log(`M1 mic: video ends ${vEnd.toFixed(3)} s, audio ends ${aEnd.toFixed(3)} s, wall ${session.wallClockSec.toFixed(3)} s`);
      expect(Math.abs(aEnd - vEnd), 'audio and video tracks must end together').toBeLessThan(0.15);
    } finally {
      await app.cleanup();
      await site.close();
    }
  });

  test('M1 stop paths: HUD, editor Stop and popup Stop each give one new recording with its own session and telemetry (M1-07..09)', async () => {
    const dir = outDir('m1-stop');
    const site = await serveFixtures();
    const app = await launchApp({ capture: 'screen', raiseWindow: true });
    logConsole(app.context, dir);
    try {
      const target = await app.context.newPage();
      await target.goto(`${site.base}/clock.html`, { waitUntil: 'domcontentloaded' });
      await target.waitForTimeout(500);
      raiseBrowser(app.profile);
      const editor = await app.context.newPage();
      await editor.goto(`chrome-extension://${app.extensionId}/editor.html?record=true&includeMic=false`);

      const runs: { how: string; click: string; text: string }[] = [
        { how: 'hud', click: '#btn-alpha', text: 'Alpha Action' },
        { how: 'editor', click: '#btn-beta', text: 'Beta Action' },
        { how: 'popup', click: '#open-modal', text: 'Open Modal' }
      ];
      const seen: string[] = [];
      for (const [i, run] of runs.entries()) {
        await editor.bringToFront();
        const startPrompt = editor.locator('#start-capture-prompt-btn');
        if (await startPrompt.count()) await startPrompt.click({ timeout: 20000 });
        else await editor.locator('#record-new-screen-top-btn').click({ timeout: 20000 });
        await editor.locator('#stop-live-recording-top-btn').waitFor({ state: 'visible', timeout: 30000 });
        await target.bringToFront();
        await target.locator('#smoothstudio-stop-btn').waitFor({ state: 'visible', timeout: 20000 });
        expect((await swSession(app.context)).isRecording, `${run.how}: SW must be recording`).toBe(true);
        await target.locator(run.click).click();
        if (run.click === '#open-modal') await target.locator('#close-modal').click().catch(() => undefined);
        await target.waitForTimeout(3000);

        if (run.how === 'hud') {
          await target.locator('#smoothstudio-stop-btn').click();
        } else if (run.how === 'editor') {
          await editor.bringToFront();
          await editor.locator('#stop-live-recording-top-btn').click();
        } else {
          const popup = await app.context.newPage();
          await popup.goto(`chrome-extension://${app.extensionId}/popup.html`);
          await popup.getByRole('button', { name: /Stop Recording/ }).click({ timeout: 10000 });
          await popup.close().catch(() => undefined);
        }

        // exactly one NEW recording, with a session id never seen before
        await expect.poll(async () => {
          const sid = await editor.locator('#smoothstudio-source-video').getAttribute('data-session-id', { timeout: 1000 }).catch(() => null);
          return sid && !seen.includes(sid) ? sid : null;
        }, { message: `${run.how}: the editor must load a NEW recording with a new session id`, timeout: 60000 }).not.toBeNull();
        const sid = (await loadedSessionId(editor))!;
        seen.push(sid);
        expect(await editor.locator('#smoothstudio-source-video').count(), 'exactly one loaded recording').toBe(1);
        console.log(`M1 stop via ${run.how}: session ${sid}`);

        // HUD gone, SW reset
        await expect(target.locator('#smoothstudio-floating-hud'), `${run.how}: the HUD must leave the page`).toHaveCount(0, { timeout: 10000 });
        await expect.poll(async () => (await swSession(app.context)).isRecording, { timeout: 10000 }).toBe(false);

        // the telemetry of THIS session holds this recording's click and not the previous one's
        await expect.poll(async () => (await persistedTelemetry(editor)).some((t) => t.metadata?.sessionId === sid),
          { message: `${run.how}: telemetry of session ${sid} must be persisted`, timeout: 15000 }).toBe(true);
        const tel = (await persistedTelemetry(editor)).find((t) => t.metadata?.sessionId === sid);
        const texts = (tel.clicks || []).map((c: any) => c.targetText || '');
        console.log(`M1 ${run.how} telemetry clicks:`, JSON.stringify(texts));
        expect(texts.some((t: string) => t.includes(run.text)), `${run.how}: its own click "${run.text}"`).toBe(true);
        for (const other of runs.filter((_, j) => j < i)) {
          expect(texts.some((t: string) => t.includes(other.text)), `${run.how}: must not contain "${other.text}" of an earlier recording`).toBe(false);
        }

        const file = await loadedRecording(editor, path.join(dir, `recording-${run.how}.webm`));
        expect(mediaInfo(file).streams.filter((s: any) => s.codec_type === 'video').length).toBe(1);
      }
      expect(new Set(seen).size, 'three recordings, three session ids').toBe(3);

      // M1-09: a reload shows the last recording with the same session id
      await editor.reload();
      await editor.locator('#smoothstudio-source-video').waitFor({ state: 'attached', timeout: 30000 });
      expect(await loadedSessionId(editor), 'after a reload the editor shows the same session').toBe(seen[2]);
    } finally {
      await app.cleanup();
      await site.close();
    }
  });

  test('M1 crash: a recording survives an editor renderer crash and is recovered when the editor reopens (M1-05, M1-06)', async () => {
    const dir = outDir('m1-crash');
    const site = await serveFixtures();
    const app = await launchApp({ capture: 'screen', raiseWindow: true });
    logConsole(app.context, dir);
    try {
      const target = await app.context.newPage();
      await target.goto(`${site.base}/clock.html`, { waitUntil: 'domcontentloaded' });
      await target.waitForTimeout(500);
      raiseBrowser(app.profile);
      const editor = await app.context.newPage();
      await editor.goto(`chrome-extension://${app.extensionId}/editor.html?record=true&includeMic=false`);
      await editor.bringToFront();
      await editor.locator('#start-capture-prompt-btn').click({ timeout: 20000 });
      await editor.locator('#stop-live-recording-top-btn').waitFor({ state: 'visible', timeout: 30000 });
      await target.bringToFront();
      await target.locator('#smoothstudio-stop-btn').waitFor({ state: 'visible', timeout: 20000 });
      const startedAt = Date.now();

      await target.waitForTimeout(4000);
      // M1-05: data is committed while recording
      const listing = await opfsListing(editor);
      const committed = listing.reduce((n, e) => n + e.size, 0);
      console.log('M1 OPFS while recording:', JSON.stringify(listing.slice(0, 12)), `(${listing.length} entries, ${committed} bytes)`);
      expect(committed, 'encoded video must be committed to OPFS while recording').toBeGreaterThan(50_000);

      await target.waitForTimeout(3000);
      const cdp = await app.context.newCDPSession(editor);
      const crashed = new Promise<void>((r) => editor.once('crash', () => r()));
      const crashRequestedAt = Date.now();
      // fire and forget: the renderer dies before it could answer
      cdp.send('Page.crash').catch(() => undefined);
      const how = await Promise.race([crashed.then(() => 'crash event'), sleep(10000).then(() => 'no crash event within 10 s')]);
      console.log(`M1 Page.crash -> ${how}`);
      const crashedAt = crashRequestedAt;
      const recordedSec = (crashedAt - startedAt) / 1000;
      console.log(`M1 editor renderer crashed after ${recordedSec.toFixed(2)} s of recording`);
      await editor.close().catch(() => undefined);

      const reopened = await app.context.newPage();
      await reopened.goto(`chrome-extension://${app.extensionId}/editor.html`);
      await reopened.locator('#smoothstudio-source-video').waitFor({ state: 'attached', timeout: 45000 });
      const file = await loadedRecording(reopened, path.join(dir, 'recovered.webm'));
      const info = mediaInfo(file);
      const vEnd = streamEndTime(file, 'v');
      console.log('M1 recovered ffprobe:', JSON.stringify(info), `video ends ${vEnd.toFixed(3)} s`);
      expect(vEnd, 'the recovered recording must keep what was recorded before the crash').toBeGreaterThanOrEqual(recordedSec - 1);
      const epochs = epochPerFrame(file, startedAt - 15000, crashedAt + 2000).filter((e): e is number => e !== null);
      expect(epochs.length, 'the recovered file must decode to real page frames').toBeGreaterThan(20);
      expect(Math.min(...epochs)).toBeGreaterThan(startedAt - 3000);
      expect(Math.max(...epochs)).toBeLessThan(crashedAt + 500);

      await expect.poll(async () => (await swSession(app.context)).isRecording,
        { message: 'the SW must not think it is still recording', timeout: 15000 }).toBe(false);
      await expect(target.locator('#smoothstudio-floating-hud'), 'the HUD must leave the page').toHaveCount(0, { timeout: 15000 });
    } finally {
      await app.cleanup();
      await site.close();
    }
  });

  test('M1 idb fallback: without OPFS the recording is kept in IndexedDB and survives an editor reload (M1-10)', async () => {
    const dir = outDir('m1-idb');
    const site = await serveFixtures();
    const app = await launchApp({ capture: 'screen', raiseWindow: true });
    logConsole(app.context, dir);
    try {
      // Fault injection (storage API only): OPFS is unavailable on extension pages.
      await app.context.addInitScript(() => {
        if (location.protocol === 'chrome-extension:') {
          (StorageManager.prototype as any).getDirectory = function () {
            return Promise.reject(new DOMException('OPFS unavailable (test fault injection)', 'SecurityError'));
          };
        }
      });
      const target = await app.context.newPage();
      await target.goto(`${site.base}/static.html`, { waitUntil: 'domcontentloaded' });
      raiseBrowser(app.profile);
      const session = await recordPage(app.context, app.extensionId, '', { seconds: 5, includeMic: false, target });
      const sid = await loadedSessionId(session.editor);
      const before = await loadedRecording(session.editor, path.join(dir, 'before.webm'));
      const sizeBefore = fs.statSync(before).size;
      expect(sizeBefore).toBeGreaterThan(50_000);

      // the recording must survive a reload without OPFS
      await session.editor.reload();
      await expect(session.editor.locator('#smoothstudio-source-video'),
        'without OPFS the recording must still be there after a reload (IndexedDB fallback)').toHaveCount(1, { timeout: 30000 });
      const after = await loadedRecording(session.editor, path.join(dir, 'after.webm'));
      expect(fs.statSync(after).size, 'the same recording comes back after the reload').toBe(sizeBefore);
      expect(streamEndTime(after, 'v')).toBeGreaterThan(4);
      expect(sid, 'the recording carries a session id').toBeTruthy();
      expect(await loadedSessionId(session.editor), 'and the same session id after the reload').toBe(sid);
    } finally {
      await app.cleanup();
      await site.close();
    }
  });
});
