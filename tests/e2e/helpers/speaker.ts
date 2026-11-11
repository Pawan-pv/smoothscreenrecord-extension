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
 */
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';

export interface SpeakerPlayback {
  /** Starts the sound; resolves with Date.now()-compatible ms of the start. */
  go(): Promise<number>;
  /** Stops the sound (if still playing) and the helper process. */
  stop(): void;
}

export async function prepareSpeaker(wav: string): Promise<SpeakerPlayback> {
  if (!fs.existsSync(wav)) throw new Error(`speaker WAV missing: ${wav}`);
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
    }
  };
}
