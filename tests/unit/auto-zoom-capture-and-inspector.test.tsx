/**
 * Capture side of the smarter auto-zoom (click count, interactive flag, tab
 * visibility, segment merge) and the pill inspector controls (transition speed,
 * sharpness warning).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MagneticTimeline } from '../../src/editor/MagneticTimeline';
import { mergeTelemetrySegments, emptyBatch, TelemetrySegment } from '../../src/background/telemetry-merge';
import type { ZoomPill } from '../../src/types/telemetry';

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
const fireClick = (id: string, detail = 1) =>
  document.getElementById(id)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 40, clientY: 60, detail }));

describe('DOM tracker: what a click says about itself', () => {
  beforeEach(() => {
    (chrome.runtime as any).sendMessage = vi.fn((_m: any, cb?: (r: any) => void) => cb?.({ ok: true }));
    document.body.innerHTML = `
      <button id="btn">Save</button>
      <a id="link" href="#x">Go</a>
      <input id="field" />
      <div id="plain">Just text</div>
      <div id="role-btn" role="button">Custom</div>
      <div id="editable" contenteditable="true">Edit me</div>
      <div id="card"><span id="inside-btn-wrapper"><button><span id="icon">i</span></button></span></div>`;
  });

  const stopAndGetClicks = () => toTracker({ type: 'STOP_TELEMETRY', sessionId: 'ses' }).data.clicks;

  it('records event.detail as clickCount (single and double clicks)', async () => {
    await loadTracker();
    toTracker({ type: 'START_TELEMETRY', originEpoch: Date.now() - 1000, sessionId: 'ses', resume: true });
    fireClick('btn', 1);
    fireClick('btn', 2);
    const clicks = stopAndGetClicks();
    expect(clicks.map((c: any) => c.clickCount)).toEqual([1, 2]);
  });

  it.each([
    ['btn', true], ['link', true], ['field', true], ['role-btn', true], ['editable', true],
    ['icon', true], // a click on an icon INSIDE a button is a click on the button
    ['plain', false]
  ])('marks #%s interactive=%s', async (id, expected) => {
    await loadTracker();
    toTracker({ type: 'START_TELEMETRY', originEpoch: Date.now() - 1000, sessionId: 'ses', resume: true });
    fireClick(id);
    expect(stopAndGetClicks()[0].interactive).toBe(expected);
  });

  it('records the recorded tab leaving and coming back (visibilitychange)', async () => {
    await loadTracker();
    toTracker({ type: 'START_TELEMETRY', originEpoch: Date.now() - 5000, sessionId: 'ses', resume: true });
    let state: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    try {
      state = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      state = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      const data = toTracker({ type: 'STOP_TELEMETRY', sessionId: 'ses' }).data;
      expect(data.visibilityEvents.map((v: any) => v.state)).toEqual(['hidden', 'visible']);
      expect(data.visibilityEvents[0].t).toBeGreaterThanOrEqual(4900);
      expect(data.visibilityEvents[0].t).toBeLessThanOrEqual(data.visibilityEvents[1].t);
    } finally {
      delete (document as any).visibilityState;
    }
  });

  it('stops listening once the recording stops', async () => {
    await loadTracker();
    toTracker({ type: 'START_TELEMETRY', originEpoch: Date.now() - 1000, sessionId: 'ses', resume: true });
    toTracker({ type: 'STOP_TELEMETRY', sessionId: 'ses' });
    const spy = vi.fn();
    (chrome.runtime as any).sendMessage = spy;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('visibility events survive navigation segments', () => {
  const seg = (over: Partial<TelemetrySegment> & { vis?: Array<{ t: number; state: 'hidden' | 'visible' }> }): TelemetrySegment => ({
    sessionId: 's', loadId: 'a', seq: 0, originEpoch: 1_000_000,
    page: { url: 'https://example.com', title: 't', width: 1, height: 1, devicePixelRatio: 1 },
    batch: { ...emptyBatch(), visibilityEvents: over.vis || [] },
    ...over
  });

  it('are merged, ordered and re-based like every other stream', () => {
    const merged = mergeTelemetrySegments({
      sessionId: 's',
      referenceOrigin: 1_000_500,
      segments: [
        seg({ loadId: 'b', vis: [{ t: 3000, state: 'visible' }] }),
        seg({ loadId: 'a', vis: [{ t: 1000, state: 'hidden' }] })
      ],
      final: null
    })!;
    expect(merged.visibilityEvents).toEqual([{ t: 500, state: 'hidden' }, { t: 2500, state: 'visible' }]);
  });
});

describe('pill inspector', () => {
  afterEach(() => cleanup());
  const pill = (over: Partial<ZoomPill> = {}): ZoomPill => ({
    id: 'p1', startTime: 1000, endTime: 4000, targetX: 0.5, targetY: 0.5, targetScale: 1.6, tiltX: 0, tiltY: 0, spotlight: false, ...over
  });
  const mount = (p: ZoomPill, sourcePixelWidth?: number) => {
    const onUpdatePill = vi.fn();
    render(React.createElement(MagneticTimeline, {
      durationMs: 10_000, currentTimeMs: 0, isPlaying: false, onTogglePlay: vi.fn(), onSeek: vi.fn(),
      pills: [p], selectedPillId: p.id, onUpdatePill, onDeletePill: vi.fn(), onAddPillAtPlayhead: vi.fn(),
      silences: [], onToggleSilenceCut: vi.fn(), onCutAllSilences: vi.fn(), keystrokes: [], sourcePixelWidth
    } as any));
    return onUpdatePill;
  };

  it('offers Fast 300 / Smooth 450 / Slow 650 and defaults to Smooth for a zoom without a setting', () => {
    mount(pill());
    const select = screen.getByTestId('transition-speed') as HTMLSelectElement;
    expect(select.value).toBe('450');
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Fast 300ms', 'Smooth 450ms', 'Slow 650ms']);
  });

  it('shows the zoom\'s own speed and saves a change on that zoom only', () => {
    const onUpdatePill = mount(pill({ transitionDuration: 300 }));
    const select = screen.getByTestId('transition-speed') as HTMLSelectElement;
    expect(select.value).toBe('300');
    fireEvent.change(select, { target: { value: '650' } });
    expect(onUpdatePill).toHaveBeenCalledTimes(1);
    expect(onUpdatePill.mock.calls[0][0]).toMatchObject({ id: 'p1', transitionDuration: 650, targetScale: 1.6 });
  });

  it('warns about softness when a zoom is above the cap for the recording\'s resolution', () => {
    mount(pill({ targetScale: 2.4 }), 1920);
    expect(screen.getByTestId('sharpness-warning').textContent).toContain('1.75x');
  });

  it.each([
    ['at the cap', 1.7, 1920],
    ['on a 4K recording', 2.4, 3840],
    ['when the resolution is unknown', 2.8, undefined]
  ])('does not warn %s', (_label, scale, width) => {
    mount(pill({ targetScale: scale }), width as number | undefined);
    expect(screen.queryByTestId('sharpness-warning')).toBeNull();
  });

  it('does not limit the manual slider: it still goes to 2.8x', () => {
    mount(pill(), 1280);
    const slider = screen.getByDisplayValue('1.6') as HTMLInputElement;
    expect(slider.max).toBe('2.8');
  });
});
