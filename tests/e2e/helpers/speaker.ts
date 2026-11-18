/**
 * Real audio for the mic journeys (QA-020).
 *
 * `--use-fake-device-for-media-stream` does NOT only fake the microphone: it
 * also replaces getDisplayMedia with Chromium's synthetic green test pattern,
 * so it must never be used in a journey that records the screen (AGENTS.md
 * §3.3). Instead the fixture WAV is played through the REAL speakers by a
 * process OUTSIDE Chrome (Chrome's echo canceller only removes Chrome's own
 * output), and the REAL microphone records it.
 *
 * The WAV is pre-loaded first, so `go()` starts the sound within a few ms and
 * returns the wall-clock instant (ms since epoch) at which playback started.
 *
 * QA-032: this machine's audio was effectively dead for the mic journeys: the
 * default render endpoint was MUTED at volume 0, and the default CAPTURE
 * endpoint was at volume 0 (its raw signal is digital silence: a 1 kHz tone at
 * full render volume recorded at -91 dB through dshow). `prepareSpeaker`
 * therefore reads both real Core Audio endpoints (IAudioEndpointVolume),
 * unmutes/raises them while the fixture plays (render 80 %, capture 100 %),
 * and restores the user's exact settings on `stop()`.
 */
import { spawn, execFileSync, ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENDPOINT_SCRIPT = path.join(HERE, 'audio-endpoint.ps1');

interface EndpointState { muted: boolean; volume: number }

/** Reads/writes a real Windows audio endpoint (Core Audio), by flow. */
function audioEndpoint(flow: 'render' | 'capture', action: 'get' | 'set', percent = 80, muted = false): EndpointState | null {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ENDPOINT_SCRIPT,
      '-Action', action, '-Percent', String(percent), '-Muted', muted ? '1' : '0', '-Flow', flow], { encoding: 'utf8', timeout: 30000 });
    const line = out.trim().split(/\r?\n/).pop() || '{}';
    const parsed = JSON.parse(line);
    return { muted: Boolean(parsed.muted), volume: Number(parsed.volume) };
  } catch (err) {
    console.warn(`[speaker] could not read/control the ${flow} audio endpoint:`, err);
    return null;
  }
}

export interface SpeakerPlayback {
  /** Starts the sound; resolves with Date.now()-compatible ms of the start. */
  go(): Promise<number>;
  /** Stops the sound (if still playing) and the helper process. */
  stop(): void;
}

export async function prepareSpeaker(wav: string): Promise<SpeakerPlayback> {
  if (!fs.existsSync(wav)) throw new Error(`speaker WAV missing: ${wav}`);
  // QA-032: make the real speakers audible and the real microphone sensitive.
  // A muted/zero render endpoint means the mic records only room noise; a
  // zero-gain capture endpoint records digital silence (measured -91 dB).
  const beforeRender = audioEndpoint('render', 'get');
  const beforeCapture = audioEndpoint('capture', 'get');
  if (beforeRender) console.log(`[speaker] render endpoint before playback: ${JSON.stringify(beforeRender)}`);
  if (beforeCapture) console.log(`[speaker] capture endpoint before playback: ${JSON.stringify(beforeCapture)}`);
  if (beforeRender && (beforeRender.muted || beforeRender.volume < 10)) {
    console.log(`[speaker] render endpoint set for the fixture playback: ${JSON.stringify(audioEndpoint('render', 'set', 80))}`);
  }
  if (beforeCapture && (beforeCapture.muted || beforeCapture.volume < 60)) {
    console.log(`[speaker] capture endpoint set for the fixture playback: ${JSON.stringify(audioEndpoint('capture', 'set', 100))}`);
  }
  const script = [
    `$sp = New-Object System.Media.SoundPlayer '${wav.replace(/'/g, "''")}'`,
    '$sp.Load()',
    "[Console]::Out.WriteLine('READY')",
    '[Console]::In.ReadLine() | Out-Null',
    "[Console]::Out.WriteLine('START ' + [DateTimeOffset]::Now.ToUnixTimeMilliseconds())",
    '$sp.PlaySync()',
    "[Console]::Out.WriteLine('END')"
  ].join('; ');
  const proc: ChildProcessWithoutNullStreams = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
  let buf = '';
  const waiters: { re: RegExp; resolve: (m: RegExpExecArray) => void }[] = [];
  proc.stdout.on('data', (d) => {
    buf += String(d);
    for (const w of [...waiters]) {
      const m = w.re.exec(buf);
      if (m) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
    }
  });
  const waitFor = (re: RegExp, ms: number) => new Promise<RegExpExecArray>((resolve, reject) => {
    const m = re.exec(buf);
    if (m) return resolve(m);
    const t = setTimeout(() => reject(new Error(`speaker helper: no ${re} within ${ms} ms (output: ${buf.slice(0, 200)})`)), ms);
    waiters.push({ re, resolve: (x) => { clearTimeout(t); resolve(x); } });
  });
  await waitFor(/READY/, 20000);
  return {
    async go() {
      proc.stdin.write('\n');
      const m = await waitFor(/START (\d+)/, 5000);
      return Number(m[1]);
    },
    stop() {
      try { proc.kill(); } catch { /* already gone */ }
      if (beforeRender) {
        console.log(`[speaker] render endpoint restored: ${JSON.stringify(audioEndpoint('render', 'set', beforeRender.volume, beforeRender.muted))}`);
      }
      if (beforeCapture) {
        console.log(`[speaker] capture endpoint restored: ${JSON.stringify(audioEndpoint('capture', 'set', beforeCapture.volume, beforeCapture.muted))}`);
      }
    }
  };
}
