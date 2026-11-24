/**
 * Loading a recording into the studio is a state machine. Nothing is shown or
 * playable until every part is in step: the video is decoded and its real length
 * is known, the telemetry is on the video's clock and frame, and the zooms were
 * built against that length.
 *
 *   empty ──begin──▶ loading(finishing → opening → duration → first-frame → syncing → zooms) ──ready──▶ ready
 *                      │
 *                      └──fail──▶ failed ──begin / reset──▶ …
 *
 * Every load has its own id. An event from an older load (a video that finishes
 * loading after a newer recording replaced it) is ignored, so a late event can
 * never put an old video, length or zoom set on screen.
 */

export type LoadStep = 'finishing' | 'opening' | 'duration' | 'first-frame' | 'syncing' | 'zooms';

export const LOAD_STEPS: ReadonlyArray<{ step: LoadStep; label: string }> = [
  { step: 'finishing', label: 'Finishing the recording' },
  { step: 'opening', label: 'Opening the video' },
  { step: 'duration', label: 'Measuring the video length' },
  { step: 'first-frame', label: 'Decoding the first frame' },
  { step: 'syncing', label: 'Syncing clicks and cursor with the video' },
  { step: 'zooms', label: 'Building the zooms' }
];

export type StudioLoadState =
  | { phase: 'empty' }
  | { phase: 'loading'; loadId: number; step: LoadStep }
  | { phase: 'ready'; loadId: number }
  | { phase: 'failed'; loadId: number; message: string };

export type StudioLoadEvent =
  | { type: 'begin'; loadId: number; step: LoadStep }
  | { type: 'step'; loadId: number; step: LoadStep }
  | { type: 'ready'; loadId: number }
  | { type: 'fail'; loadId: number; message: string }
  | { type: 'reset' };

export function studioLoadReducer(state: StudioLoadState, event: StudioLoadEvent): StudioLoadState {
  if (event.type === 'begin') return { phase: 'loading', loadId: event.loadId, step: event.step };
  if (event.type === 'reset') return { phase: 'empty' };
  // Every other event belongs to one load: one from an older load changes nothing.
  if (state.phase === 'empty' || state.loadId !== event.loadId) return state;
  switch (event.type) {
    case 'step':
      return state.phase === 'loading' ? { ...state, step: event.step } : state;
    case 'ready':
      return state.phase === 'loading' ? { phase: 'ready', loadId: event.loadId } : state;
    case 'fail':
      return state.phase === 'ready' ? state : { phase: 'failed', loadId: event.loadId, message: event.message };
  }
}

/**
 * Resolves true once `ready()` holds (checked now and after each listed event),
 * false after `timeoutMs`. Rejects when the video reports a decoding error.
 */
function waitUntil(video: HTMLVideoElement, events: string[], ready: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (ready()) { resolve(true); return; }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = (fn: () => void) => {
      if (timer !== null) clearTimeout(timer);
      for (const e of events) video.removeEventListener(e, check);
      video.removeEventListener('error', fail);
      fn();
    };
    const check = () => { if (ready()) done(() => resolve(true)); };
    const fail = () => done(() => reject(new Error(video.error?.message || 'The browser could not decode this recording.')));
    for (const e of events) video.addEventListener(e, check);
    video.addEventListener('error', fail);
    timer = setTimeout(() => done(() => resolve(ready())), timeoutMs);
  });
}

const finiteMs = (seconds: number) => (Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null);

export interface PreparedMedia {
  /** The video's real length; null when the browser could not tell. */
  durationMs: number | null;
  width: number;
  height: number;
}

/**
 * Brings a freshly created <video> to "first frame decoded, at 0, real length
 * known". A MediaRecorder WebM carries no length: seeking past the end makes
 * Chrome read the real one, then the video goes back to 0.
 */
export async function prepareVideo(video: HTMLVideoElement, onStep: (step: LoadStep) => void): Promise<PreparedMedia> {
  onStep('opening');
  const opened = await waitUntil(video, ['loadedmetadata'], () => video.readyState >= 1, 20000);
  if (!opened) throw new Error('The recording did not open in time.');

  let durationMs = finiteMs(video.duration);
  if (durationMs === null) {
    onStep('duration');
    try { video.currentTime = 1e101; } catch { /* the browser refused the seek */ }
    await waitUntil(video, ['durationchange', 'seeked', 'timeupdate'], () => finiteMs(video.duration) !== null, 10000);
    durationMs = finiteMs(video.duration);
  }

  onStep('first-frame');
  try { video.currentTime = 0; } catch { /* stays where it is */ }
  await waitUntil(video, ['seeked', 'loadeddata', 'canplay'], () => !video.seeking && video.readyState >= 2, 10000);

  return { durationMs, width: video.videoWidth, height: video.videoHeight };
}
