/**
 * Recording-session state machine of the MV3 service worker.
 *
 * The SW owns the single source of truth for "which recording is live":
 *   idle -> recording(sessionId) -> stopping -> idle
 * A stop that belongs to an OLD session must never end, reset or re-notify a
 * NEWER one. These tests pin that invariant at the message boundary.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Telemetry = {
  metadata: { sessionId?: string; id?: string };
  mousePoints: unknown[];
  clicks: unknown[];
  keystrokes: unknown[];
  inputEvents: unknown[];
  typingSessions: unknown[];
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function waitFor(cond: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!cond()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await flush();
  }
}

/** Dispatches a runtime message through the SW's registered listener and awaits its response. */
function dispatchToSw(message: any, sender: any = { id: 'test-extension' }): Promise<any> {
  const listener = (chrome.runtime.onMessage as any).listeners[0];
  if (!listener) throw new Error('the service worker did not register an onMessage listener');
  return new Promise<any>((resolve) => {
    let settled = false;
    const respond = (value: any) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const isAsync = listener(message, sender, respond);
    if (isAsync !== true) respond(undefined);
  });
}

function telemetry(sessionId: string): Telemetry {
  return {
    metadata: { id: sessionId, sessionId },
    mousePoints: [],
    clicks: [],
    keystrokes: [],
    inputEvents: [],
    typingSessions: []
  };
}

describe('Service worker: recording-session isolation', () => {
  beforeEach(async () => {
    vi.resetModules();
    await import('../../src/background/service-worker');
    await chrome.storage.session.clear();
    await chrome.storage.local.clear();
  });

  async function startSession(sessionId: string, tabId = 101) {
    const res = await dispatchToSw({ type: 'START_STUDIO_RECORDING', tabId, sessionId });
    expect(res, 'START must be acknowledged').toEqual(
      expect.objectContaining({ status: 'recording_started', sessionId })
    );
    const stored = await chrome.storage.session.get();
    expect(stored.isRecording).toBe(true);
    expect(stored.activeSessionId).toBe(sessionId);
  }

  it('a stop that arrives after the session ended never ends the recording that replaced it', async () => {
    await startSession('ses_A');
    const first = await dispatchToSw({ type: 'STOP_STUDIO_RECORDING', sessionId: 'ses_A' });
    expect(first.status).toBe('recording_stopped');
    expect((await chrome.storage.session.get()).isRecording).toBe(false);

    await startSession('ses_B');

    // The HUD/editor of ses_A retries its stop late: ses_B must survive.
    const late = await dispatchToSw({ type: 'STOP_STUDIO_RECORDING', sessionId: 'ses_A' });
    expect(late.status).toBe('stop_ignored');

    const stored = await chrome.storage.session.get();
    expect(stored.isRecording, 'ses_B must still be recording').toBe(true);
    expect(stored.activeSessionId).toBe('ses_B');
  });

  it('a start that lands while a stop is collecting telemetry is not overwritten by that stop', async () => {
    let heldStopResponse: ((response: any) => void) | null = null;
    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, message: any, callback?: (r: any) => void) => {
      if (message?.type === 'STOP_TELEMETRY') {
        heldStopResponse = callback || null;
        return Promise.resolve();
      }
      if (callback) callback({ success: true });
      return Promise.resolve();
    });

    await startSession('ses_A');

    // Legacy stop path (popup/HUD without a session id) while the response of
    // the recorded tab is still in flight.
    const stopPromise = dispatchToSw({ type: 'STOP_STUDIO_RECORDING' });
    await waitFor(() => heldStopResponse !== null, 'STOP_TELEMETRY dispatch');

    // A new recording starts in the meantime.
    await startSession('ses_B');

    // Only now does the old session's telemetry arrive.
    heldStopResponse!({ status: 'stopped', data: telemetry('ses_A') });
    const res = await stopPromise;
    expect(res.status).toBe('stop_superseded');

    const stored = await chrome.storage.session.get();
    expect(stored.isRecording, 'the newer recording must survive the late stop').toBe(true);
    expect(stored.activeSessionId).toBe('ses_B');
    expect(stored.activeRecordingTabId).toBe(101);
  });

  it('collects telemetry once for concurrent stop requests of the same session', async () => {
    let stopRequests = 0;
    let heldStopResponse: ((response: any) => void) | null = null;
    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, message: any, callback?: (r: any) => void) => {
      if (message?.type === 'STOP_TELEMETRY') {
        stopRequests++;
        heldStopResponse = callback || null;
        return Promise.resolve();
      }
      if (callback) callback({ success: true });
      return Promise.resolve();
    });

    await startSession('ses_A');

    const first = dispatchToSw({ type: 'STOP_STUDIO_RECORDING', sessionId: 'ses_A' });
    const second = dispatchToSw({ type: 'STOP_STUDIO_RECORDING', sessionId: 'ses_A' });
    await waitFor(() => heldStopResponse !== null, 'STOP_TELEMETRY dispatch');

    const payload = telemetry('ses_A');
    heldStopResponse!({ status: 'stopped', data: payload });

    const [a, b] = await Promise.all([first, second]);
    expect(stopRequests, 'the recorded tab must be asked exactly once').toBe(1);
    expect(a.telemetry).toEqual(payload);
    expect(b.telemetry).toEqual(payload);
    expect(a.sessionId).toBe('ses_A');
    expect(b.sessionId).toBe('ses_A');
  });

  it('a stop for the new session is not swallowed by the old session that is still stopping', async () => {
    const heldStops = new Map<string, (response: any) => void>();
    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, message: any, callback?: (r: any) => void) => {
      if (message?.type === 'STOP_TELEMETRY') {
        if (message.sessionId) heldStops.set(message.sessionId, callback || (() => {}));
        return Promise.resolve();
      }
      if (callback) callback({ success: true });
      return Promise.resolve();
    });

    await startSession('ses_A');
    const stopA = dispatchToSw({ type: 'STOP_STUDIO_RECORDING', sessionId: 'ses_A' });
    await waitFor(() => heldStops.has('ses_A'), 'A STOP_TELEMETRY');

    // B starts while A's stop is still waiting for A's telemetry, then the
    // user stops B too. B's stop must not be answered with A's result.
    await startSession('ses_B');
    const stopB = dispatchToSw({ type: 'STOP_STUDIO_RECORDING', sessionId: 'ses_B' });

    heldStops.get('ses_A')!({ status: 'stopped', data: telemetry('ses_A') });
    const resA = await stopA;
    expect(resA.status).toBe('stop_superseded');

    await waitFor(() => heldStops.has('ses_B'), 'B STOP_TELEMETRY');
    heldStops.get('ses_B')!({ status: 'stopped', data: telemetry('ses_B') });

    const resB = await stopB;
    expect(resB.status).toBe('recording_stopped');
    expect(resB.sessionId).toBe('ses_B');
    expect(resB.telemetry).toEqual(telemetry('ses_B'));

    const stored = await chrome.storage.session.get();
    expect(stored.isRecording).toBe(false);
    expect(stored.activeSessionId).toBeNull();
  });

  it('RECOVER_SESSION for an old id leaves the live session alone', async () => {
    await startSession('ses_B');

    const res = await dispatchToSw({ type: 'RECOVER_SESSION', sessionId: 'ses_A' });
    expect(res.status).toBe('not_recording');

    const stored = await chrome.storage.session.get();
    expect(stored.isRecording).toBe(true);
    expect(stored.activeSessionId).toBe('ses_B');
  });

  it('a stale stop never tells the editor to stop its capture', async () => {
    await startSession('ses_A');
    await startSession('ses_B'); // replaces A without a stop (editor restart)

    (chrome.tabs.sendMessage as any).mockClear();
    await dispatchToSw({ type: 'STOP_STUDIO_RECORDING', sessionId: 'ses_A' });

    const stopCapture = (chrome.tabs.sendMessage as any).mock.calls.filter(
      ([, message]: [number, any]) => message?.type === 'STUDIO_STOP_CAPTURE'
    );
    expect(stopCapture, 'a superseded session must not stop the new recorder').toHaveLength(0);
  });

  it('a popup stop without a session id ends the live session', async () => {
    await startSession('ses_A');
    const res = await dispatchToSw({ type: 'STOP_STUDIO_RECORDING' });
    expect(res.status).toBe('recording_stopped');
    expect(res.sessionId).toBe('ses_A');

    const stored = await chrome.storage.session.get();
    expect(stored.isRecording).toBe(false);
    expect(stored.activeSessionId).toBeNull();
    expect(stored.activeRecordingTabId).toBeNull();
  });

  it('stopping an already-ended session never returns the next session\'s telemetry', async () => {
    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, message: any, callback?: (r: any) => void) => {
      if (message?.type === 'STOP_TELEMETRY') {
        callback?.({ status: 'stopped', data: telemetry(message.sessionId) });
        return Promise.resolve();
      }
      callback?.({ success: true });
      return Promise.resolve();
    });

    await startSession('ses_A');
    const stopA = await dispatchToSw({ type: 'STOP_STUDIO_RECORDING', sessionId: 'ses_A' });
    expect(stopA.telemetry).toEqual(telemetry('ses_A'));

    await startSession('ses_B');
    const stopB = await dispatchToSw({ type: 'STOP_STUDIO_RECORDING', sessionId: 'ses_B' });
    expect(stopB.telemetry).toEqual(telemetry('ses_B'));

    // A late retry of A's stop now finds the machine idle. It must not hand out
    // B's stored telemetry as if it belonged to A.
    const late = await dispatchToSw({ type: 'STOP_STUDIO_RECORDING', sessionId: 'ses_A' });
    expect(late.status).toBe('not_recording');
    expect(late.sessionId).toBe('ses_B');
    expect(late.telemetry).toBeNull();
  });

  it('random start/stop sequences never cross session boundaries', async () => {
    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, message: any, callback?: (r: any) => void) => {
      if (message?.type === 'STOP_TELEMETRY') {
        callback?.({ status: 'stopped', data: telemetry(message.sessionId) });
        return Promise.resolve();
      }
      callback?.({ success: true });
      return Promise.resolve();
    });

    // Deterministic PRNG: the failure, when it happens, is reproducible.
    let seed = 0x5eed1234;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    let live: string | null = null;
    const ended: string[] = [];
    let counter = 0;

    for (let step = 0; step < 60; step++) {
      const action = live === null ? 'start' : rnd() < 0.45 ? 'start' : rnd() < 0.25 ? 'legacy-stop' : 'stop';
      if (action === 'start') {
        const id = `ses_${++counter}`;
        const res = await dispatchToSw({ type: 'START_STUDIO_RECORDING', tabId: 101, sessionId: id });
        expect(res.status, `step ${step}: start`).toBe('recording_started');
        if (live !== null) ended.push(live);
        live = id;
      } else if (action === 'legacy-stop') {
        const res = await dispatchToSw({ type: 'STOP_STUDIO_RECORDING' });
        expect(res.status, `step ${step}: legacy stop`).toBe('recording_stopped');
        expect(res.sessionId).toBe(live);
        ended.push(live!);
        live = null;
      } else {
        const target = rnd() < 0.7 || ended.length === 0 ? live! : ended[Math.floor(rnd() * ended.length)];
        const res = await dispatchToSw({ type: 'STOP_STUDIO_RECORDING', sessionId: target });
        if (target === live) {
          expect(res.status, `step ${step}: stop live`).toBe('recording_stopped');
          expect(res.telemetry?.metadata?.sessionId).toBe(target);
          ended.push(target);
          live = null;
        } else {
          expect(res.status, `step ${step}: stop stale ${target}`).toBe('stop_ignored');
          // A stale stop may hand out nothing, never another session's data.
          expect(res.telemetry?.metadata?.sessionId ?? null).toBeNull();
        }
      }

      const stored = await chrome.storage.session.get();
      expect(stored.isRecording, `step ${step}: live state`).toBe(live !== null);
      expect(stored.activeSessionId ?? null, `step ${step}: live id`).toBe(live);
    }
  });
});
