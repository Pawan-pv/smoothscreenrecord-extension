/**
 * Generates tests/fixtures/audio/test.wav with ffmpeg.
 *
 * Timeline (20 s, 48 kHz mono, 16-bit PCM):
 *   0.0 -  4.0 s  speech-like noise (brown-noise bursts, 250 ms on / 250 ms off)
 *   4.0 -  6.0 s  DIGITAL SILENCE (2.00 s)      <- known silence #1
 *   6.0 - 14.0 s  speech-like noise
 *  14.0 - 16.0 s  DIGITAL SILENCE (2.00 s)      <- known silence #2
 *  16.0 - 20.0 s  speech-like noise
 *
 * Short 1 kHz beeps (50 ms) at 2.0 s, 8.0 s and 18.0 s - known beep times for
 * the A/V sync check (J11). They sit inside speech, never inside a silence.
 *
 * The WAV is regenerated on demand (never committed): `node tests/fixtures/audio/generate-test-wav.mjs`
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');
const FFMPEG = path.join(REPO, 'ffmpeg.exe');
const OUT = path.join(__dirname, 'test.wav');

export const AUDIO_TIMELINE = {
  durationSec: 20,
  silences: [[4.0, 6.0], [14.0, 16.0]],
  beeps: [2.0, 8.0, 18.0]
};

const VOICE_GATE =
  "if(between(t,4,6),0,if(between(t,14,16),0,if(lt(mod(t\\,0.5)\\,0.25)\\,1\\,0.04)))";
const BEEP_GATE =
  "if(lt(abs(t-2)\\,0.025),1,if(lt(abs(t-8)\\,0.025),1,if(lt(abs(t-18)\\,0.025),1,0)))";

const filter = [
  // three 50 ms 4.5 kHz beeps (above the speech band) at the known times.
  // This ffmpeg build's `sine` source peaks at -18 dBFS, so it is scaled up first.
  `[0:a]volume=6,adelay=2000[b0]`,
  `[1:a]volume=6,adelay=8000[b1]`,
  `[2:a]volume=6,adelay=18000[b2]`,
  // speech-like bed: brown noise, gated into bursts, muted inside the silences
  `[3:a]volume='${VOICE_GATE}':eval=frame,highpass=f=180,lowpass=f=3400,volume=0.9[voice]`,
  // amix divides by the number of inputs; volume=4 restores the original levels
  `[voice][b0][b1][b2]amix=inputs=4:duration=first,volume=4,alimiter=limit=0.8[out]`
].join(';');

export function generateTestWav() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  execFileSync(FFMPEG, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=4500:sample_rate=48000:duration=0.05',
    '-f', 'lavfi', '-i', 'sine=frequency=4500:sample_rate=48000:duration=0.05',
    '-f', 'lavfi', '-i', 'sine=frequency=4500:sample_rate=48000:duration=0.05',
    '-f', 'lavfi', '-i', 'anoisesrc=r=48000:d=20:a=0.55',
    '-filter_complex', filter,
    '-map', '[out]', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', OUT
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  return OUT;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const p = generateTestWav();
  console.log(`wrote ${p} (${fs.statSync(p).size} bytes)`);
}
