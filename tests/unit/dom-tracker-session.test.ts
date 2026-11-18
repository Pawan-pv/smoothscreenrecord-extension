/**
 * Content-script telemetry lifecycle.
 *
 * Every START_TELEMETRY opens a session, every STOP_TELEMETRY closes it. The
 * session id tags the telemetry, and a stop that belongs to a previous session
 * must neither stop nor return the current one.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function loadTracker() {
  // The listener-registration guard lives on `window` and would survive a
  // module reset, leaving the fresh module unbound to the fresh chrome mock.
  delete (window as any).__smoothstudio_dom_listener_registered;
  vi.resetModules();
  return await import('../../src/content/dom-tracker');
}

function sendToTracker(message: any): any {
  // privacy-redactor also owns a runtime listener; the tracker is the one that
  // answers telemetry messages.
  let response: any;
  for (const listener of [...((chrome.runtime.onMessage as any).listeners as Function[])]) {
    listener(message, { id: 'service-worker' }, (r: any) => {
      if (r !== undefined) response = r;
    });
  }
  return response;
}

function clickButton(id = 'cta') {
  const button = document.getElementById(id);
  if (!button) throw new Error(`missing fixture button #${id}`);
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }));
}

describe('DOM tracker: telemetry session isolation', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="cta">Buy now</button>';
  });

  it('a repeated START for the same session does not wipe what was already captured', async () => {
    await loadTracker();
    sendToTracker({ type: 'START_TELEMETRY', originEpoch: Date.now() - 1000, sessionId: 'ses_A' });
    clickButton();
    sendToTracker({ type: 'START_TELEMETRY', originEpoch: Date.now() - 1000, sessionId: 'ses_A' });

    const stopped = sendToTracker({ type: 'STOP_TELEMETRY', sessionId: 'ses_A' });
    expect(stopped.status).toBe('stopped');
    expect(stopped.data.metadata.sessionId).toBe('ses_A');
    expect(stopped.data.clicks).toHaveLength(1);
  });

  it('ignores a stop for another session and keeps the current one recording', async () => {
    await loadTracker();
    sendToTracker({ type: 'START_TELEMETRY', originEpoch: Date.now() - 1000, sessionId: 'ses_A' });
    clickButton();

    const stale = sendToTracker({ type: 'STOP_TELEMETRY', sessionId: 'ses_B' });
    expect(stale.status).toBe('ignored');
    expect(stale.data).toBeNull();

    const real = sendToTracker({ type: 'STOP_TELEMETRY', sessionId: 'ses_A' });
    expect(real.status).toBe('stopped');
    expect(real.data.metadata.sessionId).toBe('ses_A');
    expect(real.data.clicks).toHaveLength(1);
  });

  it('never returns a second, fabricated telemetry payload for a session already stopped', async () => {
    await loadTracker();
    sendToTracker({ type: 'START_TELEMETRY', originEpoch: Date.now() - 1000, sessionId: 'ses_A' });
    clickButton();

    const first = sendToTracker({ type: 'STOP_TELEMETRY', sessionId: 'ses_A' });
    expect(first.status).toBe('stopped');
    expect(first.data.clicks).toHaveLength(1);

    const second = sendToTracker({ type: 'STOP_TELEMETRY', sessionId: 'ses_A' });
    expect(second.status).toBe('not_recording');
    expect(second.data).toBeNull();
  });

  it('isolates the data of a new session from the previous one', async () => {
    await loadTracker();
    sendToTracker({ type: 'START_TELEMETRY', originEpoch: Date.now() - 1000, sessionId: 'ses_A' });
    clickButton();

    document.body.innerHTML = '<button id="cta">Buy now</button><button id="cta2">Next</button>';
    sendToTracker({ type: 'START_TELEMETRY', originEpoch: Date.now() - 500, sessionId: 'ses_B' });
    clickButton('cta');
    clickButton('cta2');

    const stale = sendToTracker({ type: 'STOP_TELEMETRY', sessionId: 'ses_A' });
    expect(stale.status).toBe('ignored');

    const stopped = sendToTracker({ type: 'STOP_TELEMETRY', sessionId: 'ses_B' });
    expect(stopped.data.metadata.sessionId).toBe('ses_B');
    expect(stopped.data.clicks, 'ses_B must not contain ses_A clicks').toHaveLength(2);
  });

  it('the on-page HUD stop button asks the SW to stop THIS session only', async () => {
    await loadTracker();
    sendToTracker({ type: 'START_TELEMETRY', originEpoch: Date.now() - 1000, sessionId: 'ses_A' });

    const stopButton = document.getElementById('smoothstudio-stop-btn') as HTMLButtonElement | null;
    expect(stopButton, 'the recording HUD must offer a stop button').not.toBeNull();
    stopButton!.click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'STOP_STUDIO_RECORDING', sessionId: 'ses_A' },
      expect.any(Function)
    );

    sendToTracker({ type: 'STOP_TELEMETRY', sessionId: 'ses_A' });
  });
});
