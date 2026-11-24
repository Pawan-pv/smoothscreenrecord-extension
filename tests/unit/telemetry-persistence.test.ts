/**
 * Multi-page recordings: a navigation or reload throws away the page's memory,
 * so telemetry is handed to the service worker in segments and stitched back
 * together at stop time. These tests pin the merge, the service-worker segment
 * store, the re-arm of the recorded tab, and the content script's hand-over.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mergeTelemetrySegments, TelemetrySegment, emptyBatch } from '../../src/background/telemetry-merge';

const click = (t: number, x = 0.5, y = 0.5) => ({ t, x, y, button: 0, targetTag: 'button' });
const pt = (t: number, x = 0.1, y = 0.1) => ({ t, x, y, c: 'default' as const });

function seg(over: Partial<Omit<TelemetrySegment, 'batch'>> & { batch?: Partial<ReturnType<typeof emptyBatch>> }): TelemetrySegment {
  return {
    sessionId: 'ses_A',
    loadId: 'pageA',
    seq: 0,
    originEpoch: 1_000_000,
    page: { url: 'https://example.com/a', title: 'Page A', width: 1280, height: 720, devicePixelRatio: 1 },
    ...over,
    batch: { ...emptyBatch(), ...(over.batch || {}) }
  };
}

describe('mergeTelemetrySegments', () => {
  it('returns null when nothing was captured', () => {
    expect(mergeTelemetrySegments({ sessionId: 'ses_A', referenceOrigin: 1_000_000, segments: [], final: null })).toBeNull();
    expect(mergeTelemetrySegments({ sessionId: 'ses_A', referenceOrigin: 1_000_000, segments: [], final: { data: null, originEpoch: null } })).toBeNull();
  });

  it('returns a single-page recording untouched', () => {
    const data: any = { metadata: { id: 'x', startTime: 1, endTime: 2, durationMs: 1, width: 1, height: 1, devicePixelRatio: 1, title: 't' }, mousePoints: [pt(5)], clicks: [click(5)], keystrokes: [], inputEvents: [] };
    expect(mergeTelemetrySegments({ sessionId: 'x', referenceOrigin: 1_000_000, segments: [], final: { data, originEpoch: 1_000_000 } })).toBe(data);
  });

  it('keeps pre-navigation AND post-navigation data, in chronological order', () => {
    const merged = mergeTelemetrySegments({
      sessionId: 'ses_A',
      referenceOrigin: 1_000_000,
      segments: [
        seg({ loadId: 'pageB', seq: 0, batch: { clicks: [click(9000)], mousePoints: [pt(8900), pt(9000)] }, page: { url: 'https://example.com/b', title: 'Page B' } }),
        seg({ loadId: 'pageA', seq: 0, batch: { clicks: [click(2000)], mousePoints: [pt(1000), pt(2000)] } })
      ],
      final: {
        data: { metadata: { id: 'ses_A', sessionId: 'ses_A', startTime: 1, endTime: 2, durationMs: 12000, width: 1280, height: 720, devicePixelRatio: 1, title: 'Page B', url: 'https://example.com/b' }, mousePoints: [pt(11000)], clicks: [click(11500)], keystrokes: [], inputEvents: [] } as any,
        originEpoch: 1_000_000
      }
    })!;
    expect(merged.clicks.map((c) => c.t)).toEqual([2000, 9000, 11500]);
    expect(merged.mousePoints.map((p) => p.t)).toEqual([1000, 2000, 8900, 9000, 11000]);
    // The guide starts on the FIRST page.
    expect(merged.metadata.url).toBe('https://example.com/a');
    expect(merged.metadata.title).toBe('Page A');
    expect(merged.metadata.durationMs).toBe(12000);
    expect(merged.metadata.sessionId).toBe('ses_A');
  });

  it('de-duplicates a segment delivered twice (same loadId + seq)', () => {
    const s = seg({ batch: { clicks: [click(2000)] } });
    const merged = mergeTelemetrySegments({ sessionId: 'ses_A', referenceOrigin: 1_000_000, segments: [s, { ...s }, s], final: null })!;
    expect(merged.clicks).toHaveLength(1);
  });

  it('re-bases a segment captured against another origin and drops what precedes the video', () => {
    // The segment's origin is 500 ms EARLIER than the recording's.
    const merged = mergeTelemetrySegments({
      sessionId: 'ses_A',
      referenceOrigin: 1_000_500,
      segments: [seg({ originEpoch: 1_000_000, batch: { clicks: [click(300), click(700)] } })],
      final: null
    })!;
    expect(merged.clicks.map((c) => c.t)).toEqual([200]); // 300-500 < 0 dropped, 700-500 = 200
  });
});

describe('Service worker: telemetry survives navigation', () => {
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));
  function dispatch(message: any, sender: any = { id: 'ext' }): Promise<any> {
    const listener = (chrome.runtime.onMessage as any).listeners[0];
    return new Promise((resolve) => {
      const isAsync = listener(message, sender, resolve);
      if (isAsync !== true) resolve(undefined);
    });
  }
  const recordedTab = { id: 101, url: 'https://example.com/a' };

  beforeEach(async () => {
    vi.resetModules();
    await import('../../src/background/service-worker');
    await chrome.storage.session.clear();
    await chrome.storage.local.clear();
  });

  async function start(sessionId = 'ses_A', originEpoch = 5_000_000) {
    const res = await dispatch({ type: 'START_STUDIO_RECORDING', tabId: 101, sessionId, originEpoch });
    expect(res.status).toBe('recording_started');
  }

  it('stores segments only from the recorded tab of the live session', async () => {
    await start();
    const good = seg({ originEpoch: 5_000_000, batch: { clicks: [click(1000)] } });
    expect(await dispatch({ type: 'TELEMETRY_SEGMENT', segment: good }, { id: 'ext', tab: recordedTab })).toEqual({ ok: true });
    expect((await dispatch({ type: 'TELEMETRY_SEGMENT', segment: good }, { id: 'ext', tab: { id: 999 } })).ok).toBe(false);
    expect((await dispatch({ type: 'TELEMETRY_SEGMENT', segment: { ...good, sessionId: 'ses_OLD' } }, { id: 'ext', tab: recordedTab })).ok).toBe(false);
    expect((await dispatch({ type: 'TELEMETRY_SEGMENT', segment: good })).ok).toBe(false); // no tab at all
  });

  it('STOP returns the pre-navigation telemetry when the last page has nothing to give', async () => {
    await start();
    await dispatch({ type: 'TELEMETRY_SEGMENT', segment: seg({ sessionId: 'ses_A', loadId: 'pageA', seq: 0, originEpoch: 5_000_000, batch: { clicks: [click(1500)], mousePoints: [pt(1400), pt(1500)] } }) }, { id: 'ext', tab: recordedTab });
    // The tab is mid-navigation: STOP_TELEMETRY is never answered.
    (chrome.tabs.sendMessage as any).mockImplementation((_id: number, m: any, cb?: (r: any) => void) => {
      if (m?.type === 'STOP_TELEMETRY') { chrome.runtime.lastError = { message: 'Receiving end does not exist.' }; cb?.(undefined); chrome.runtime.lastError = null; }
      else cb?.({ ok: true });
      return Promise.resolve();
    });
    const res = await dispatch({ type: 'STOP_STUDIO_RECORDING', sessionId: 'ses_A' });
    expect(res.status).toBe('recording_stopped');
    expect(res.telemetry, 'telemetry must not be null after a navigation').not.toBeNull();
    expect(res.telemetry.clicks.map((c: any) => c.t)).toEqual([1500]);
    expect(res.telemetry.metadata.sessionId).toBe('ses_A');
    expect(res.telemetry.metadata.url).toBe('https://example.com/a');
    // Segments are gone once merged.
    const left = Object.keys(await chrome.storage.session.get()).filter((k) => k.startsWith('smoothstudio_seg:'));
    expect(left).toEqual([]);
  });

  it('merges stored segments with the final page and the segments the page never got an ack for', async () => {
    await start();
    const stored = seg({ loadId: 'pageA', seq: 0, originEpoch: 5_000_000, batch: { clicks: [click(1000)] } });
    await dispatch({ type: 'TELEMETRY_SEGMENT', segment: stored }, { id: 'ext', tab: recordedTab });
    const unacked = seg({ loadId: 'pageB', seq: 0, originEpoch: 5_000_000, batch: { clicks: [click(4000)] }, page: { url: 'https://example.com/b' } });
    (chrome.tabs.sendMessage as any).mockImplementation((_id: number, m: any, cb?: (r: any) => void) => {
      if (m?.type === 'STOP_TELEMETRY') {
        cb?.({
          status: 'stopped',
          originEpoch: 5_000_000,
          unacked: [unacked, stored /* its ack was lost, but the SW had it */],
          data: { metadata: { id: 'ses_A', startTime: 1, endTime: 2, durationMs: 6000, width: 1, height: 1, devicePixelRatio: 1, title: 'B', url: 'https://example.com/b' }, mousePoints: [], clicks: [click(5000)], keystrokes: [], inputEvents: [] }
        });
      } else cb?.({ ok: true });
      return Promise.resolve();
    });
    const res = await dispatch({ type: 'STOP_STUDIO_RECORDING', sessionId: 'ses_A' });
    expect(res.telemetry.clicks.map((c: any) => c.t)).toEqual([1000, 4000, 5000]); // no duplicate of t=1000
    expect(res.telemetry.metadata.url).toBe('https://example.com/a');
  });

  it('a new recording never inherits the segments of the previous one', async () => {
    await start('ses_A');
    await dispatch({ type: 'TELEMETRY_SEGMENT', segment: seg({ sessionId: 'ses_A', batch: { clicks: [click(1000)] } }) }, { id: 'ext', tab: recordedTab });
    await start('ses_B');
    (chrome.tabs.sendMessage as any).mockImplementation((_id: number, m: any, cb?: (r: any) => void) => {
      if (m?.type === 'STOP_TELEMETRY') cb?.({ status: 'stopped', data: null });
      else cb?.({ ok: true });
      return Promise.resolve();
    });
    const res = await dispatch({ type: 'STOP_STUDIO_RECORDING', sessionId: 'ses_B' });
    expect(res.telemetry).toBeNull();
  });

  describe('chrome.tabs.onUpdated', () => {
    const fire = async (tabId: number, changeInfo: any, tab: any) => {
      (chrome.tabs as any).onUpdated.dispatch(tabId, changeInfo, tab);
      for (let i = 0; i < 20; i++) await flush();
    };
    const sent = () => (chrome.tabs.sendMessage as any).mock.calls.map((c: any[]) => c[1]);

    it('re-arms the recorded tab with the SAME session and origin, and re-applies the privacy shield', async () => {
      await dispatch({ type: 'APPLY_PRIVACY_OPTIONS', options: { blurEmails: true, blurRevenue: false, blurApiKeys: true } });
      await start('ses_A', 5_000_000);
      await dispatch({ type: 'RECORDING_LIVE', epoch: 5_000_250, sessionId: 'ses_A' });
      (chrome.tabs.sendMessage as any).mockClear();

      await fire(101, { status: 'complete' }, { id: 101, url: 'https://example.com/b' });

      const messages = sent();
      const privacy = messages.findIndex((m: any) => m.type === 'APPLY_PRIVACY_OPTIONS');
      const tracker = messages.findIndex((m: any) => m.type === 'START_TELEMETRY');
      expect(privacy, 'privacy re-applied').toBeGreaterThanOrEqual(0);
      expect(messages[privacy].options).toEqual({ blurEmails: true, blurRevenue: false, blurApiKeys: true });
      expect(messages[tracker]).toEqual(expect.objectContaining({ sessionId: 'ses_A', originEpoch: 5_000_250, resume: true }));
      expect(privacy, 'the shield goes up before the tracker').toBeLessThan(tracker);
    });

    it('ignores other tabs, partial loads and idle state', async () => {
      await start('ses_A', 5_000_000);
      (chrome.tabs.sendMessage as any).mockClear();
      await fire(555, { status: 'complete' }, { id: 555, url: 'https://example.com/x' });
      await fire(101, { status: 'loading' }, { id: 101, url: 'https://example.com/b' });
      expect(sent().filter((m: any) => m.type === 'START_TELEMETRY')).toHaveLength(0);

      await dispatch({ type: 'STOP_STUDIO_RECORDING', sessionId: 'ses_A' });
      (chrome.tabs.sendMessage as any).mockClear();
      await fire(101, { status: 'complete' }, { id: 101, url: 'https://example.com/b' });
      expect(sent().filter((m: any) => m.type === 'START_TELEMETRY')).toHaveLength(0);
    });

    it('re-injects the content scripts when the new page has no receiver', async () => {
      await start('ses_A', 5_000_000);
      (chrome.scripting.executeScript as any).mockClear();
      let first = true;
      (chrome.tabs.sendMessage as any).mockImplementation((_id: number, m: any, cb?: (r: any) => void) => {
        if (m?.type === 'START_TELEMETRY' && first) {
          first = false;
          chrome.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
          cb?.(undefined);
          chrome.runtime.lastError = null;
        } else cb?.({ ok: true });
        return Promise.resolve();
      });
      await fire(101, { status: 'complete' }, { id: 101, url: 'https://example.com/b' });
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 101 }, files: ['content/dom-tracker.js'] });
    });
  });
});

describe('DOM tracker: hand-over across page loads', () => {
  async function loadTracker() {
    delete (window as any).__smoothstudio_dom_listener_registered;
    vi.resetModules();
    return await import('../../src/content/dom-tracker');
  }
  function toTracker(message: any): any {
    let response: any;
    for (const l of [...((chrome.runtime.onMessage as any).listeners as Function[])]) {
      l(message, { id: 'sw' }, (r: any) => { if (r !== undefined) response = r; });
    }
    return response;
  }
  function clickIt() {
    document.getElementById('cta')!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 40, clientY: 60 }));
  }
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  beforeEach(() => { document.body.innerHTML = '<button id="cta">Next</button>'; });

  it('pagehide hands the captured telemetry to the service worker', async () => {
    const sent: any[] = [];
    (chrome.runtime as any).sendMessage = vi.fn((m: any, cb?: (r: any) => void) => { sent.push(m); cb?.({ ok: true }); });
    await loadTracker();
    toTracker({ type: 'START_TELEMETRY', originEpoch: Date.now() - 1000, sessionId: 'ses_A' });
    clickIt();
    window.dispatchEvent(new Event('pagehide'));
    const segments = sent.filter((m) => m.type === 'TELEMETRY_SEGMENT');
    expect(segments).toHaveLength(1);
    expect(segments[0].segment.sessionId).toBe('ses_A');
    expect(segments[0].segment.batch.clicks).toHaveLength(1);
    expect(segments[0].segment.page.url).toBe(window.location.href);
    expect(segments[0].segment.page.brandColors).toBeTruthy();
    // Nothing left to report: the acknowledged data is not returned twice.
    const stopped = toTracker({ type: 'STOP_TELEMETRY', sessionId: 'ses_A' });
    expect(stopped.data.clicks).toHaveLength(0);
    expect(stopped.unacked).toEqual([]);
  });

  it('the periodic flush sends only what is new', async () => {
    const sent: any[] = [];
    (chrome.runtime as any).sendMessage = vi.fn((m: any, cb?: (r: any) => void) => { sent.push(m); cb?.({ ok: true }); });
    const tracker = await loadTracker();
    toTracker({ type: 'START_TELEMETRY', originEpoch: Date.now() - 1000, sessionId: 'ses_A' });
    clickIt();
    tracker.flushTelemetry();
    tracker.flushTelemetry(); // nothing new: no message
    clickIt();
    tracker.flushTelemetry();
    const segs = sent.filter((m) => m.type === 'TELEMETRY_SEGMENT').map((m) => m.segment);
    expect(segs.map((s) => [s.seq, s.batch.clicks.length])).toEqual([[0, 1], [1, 1]]);
    toTracker({ type: 'STOP_TELEMETRY', sessionId: 'ses_A' });
  });

  it('a segment the service worker never acknowledged comes back with the final capture', async () => {
    (chrome.runtime as any).sendMessage = vi.fn((_m: any, cb?: (r: any) => void) => { cb?.(undefined); });
    await loadTracker();
    toTracker({ type: 'START_TELEMETRY', originEpoch: Date.now() - 1000, sessionId: 'ses_A' });
    clickIt();
    window.dispatchEvent(new Event('pagehide'));
    const stopped = toTracker({ type: 'STOP_TELEMETRY', sessionId: 'ses_A' });
    expect(stopped.unacked).toHaveLength(1);
    expect(stopped.unacked[0].batch.clicks).toHaveLength(1);
    expect(typeof stopped.originEpoch).toBe('number');
  });

  it('a resumed page keeps the recording origin and neither waits for nor wipes on a live signal', async () => {
    const sent: any[] = [];
    (chrome.runtime as any).sendMessage = vi.fn((m: any, cb?: (r: any) => void) => { sent.push(m); cb?.({ ok: true }); });
    await loadTracker();
    const origin = Date.now() - 5000;
    toTracker({ type: 'START_TELEMETRY', originEpoch: origin, sessionId: 'ses_A', resume: true });
    clickIt();
    await wait(120); // a normal start would wipe pre-live data here (two animation frames)
    const stopped = toTracker({ type: 'STOP_TELEMETRY', sessionId: 'ses_A' });
    expect(stopped.originEpoch).toBe(origin);
    expect(stopped.data.clicks).toHaveLength(1);
    expect(stopped.data.clicks[0].t).toBeGreaterThanOrEqual(4900); // measured from the SHARED origin, not from this page load
    expect(sent.some((m) => m.type === 'HUD_VISIBLE')).toBe(false);
  });

  it('a resumed page shows the recording HUD', async () => {
    (chrome.runtime as any).sendMessage = vi.fn((_m: any, cb?: (r: any) => void) => cb?.({ ok: true }));
    await loadTracker();
    toTracker({ type: 'START_TELEMETRY', originEpoch: Date.now() - 65_000, sessionId: 'ses_A', resume: true });
    expect(document.getElementById('smoothstudio-stop-btn')).not.toBeNull();
    expect(document.getElementById('smoothstudio-timer')!.innerText).toBe('01:05');
    toTracker({ type: 'STOP_TELEMETRY', sessionId: 'ses_A' });
  });
});
