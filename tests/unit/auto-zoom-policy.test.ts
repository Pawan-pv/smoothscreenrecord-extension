/**
 * Auto-zoom generation policy: resolution-aware scale caps, the conservative
 * misclick filter, double-click boost, typing that extends an active zoom, the
 * early release on a rapid cursor jump, and leaving the recorded tab.
 */
import { describe, it, expect } from 'vitest';
import {
  generateAutoZoomPills,
  autoZoomScaleCap,
  resolveSourcePixelWidth,
  AUTO_ZOOM
} from '../../src/engine/spring-physics';
import { buildCameraPath } from '../../src/engine/camera-path';
import type { ClickEvent, MousePoint, InputFocusEvent, TypingSession, KeystrokeEvent } from '../../src/types/telemetry';

const W = 1920;
const H = 1080;
const DURATION = 30_000;

/** A small button (100 px, < 20% of the width): the "punchy 2.1x" case before the cap. Bounds are CSS pixels, as captured. */
const smallButton = { x: 910, y: 515, width: 100, height: 50 };
const click = (t: number, x = 0.5, y = 0.5, over: Partial<ClickEvent> = {}): ClickEvent => ({
  t, x, y, button: 0, targetTag: 'BUTTON', containerBounds: smallButton, ...over
});
/** Still cursor samples every 16 ms between t0 and t1. */
const hold = (t0: number, t1: number, x: number, y: number): MousePoint[] => {
  const out: MousePoint[] = [];
  for (let t = t0; t <= t1; t += 16) out.push({ t, x, y, c: 'default' });
  return out;
};
const gen = (clicks: ClickEvent[], extra: Parameters<typeof generateAutoZoomPills>[7] = {}, typing?: TypingSession[], inputs: InputFocusEvent[] = [], duration = DURATION) =>
  generateAutoZoomPills(clicks, inputs, duration, W, H, undefined, typing, extra);

describe('resolution-aware scale caps (auto-generated zooms only)', () => {
  it.each([
    [640, 1.5], [1280, 1.5],
    [1281, 1.75], [1920, 1.75],
    [1921, 2.1], [2560, 2.1],
    [2561, 2.5], [3840, 2.5], [5120, 2.5]
  ])('a %ipx wide recording is capped at %fx', (width, cap) => {
    expect(autoZoomScaleCap(width)).toBe(cap);
  });

  it('an unknown width means no cap (older recordings keep their scales)', () => {
    expect(autoZoomScaleCap(undefined)).toBe(Infinity);
    expect(autoZoomScaleCap(0)).toBe(Infinity);
    expect(autoZoomScaleCap(NaN)).toBe(Infinity);
    expect(gen([click(2000)])[0].targetScale).toBe(2.1);
  });

  it.each([[1280, 1.5], [1920, 1.75], [2560, 2.1], [3840, 2.1]])(
    'the punchy 2.1x zoom on a %ipx recording becomes %fx',
    (width, expected) => {
      expect(gen([click(2000)], { sourcePixelWidth: width })[0].targetScale).toBe(expected);
    }
  );

  it('never raises a gentle zoom: a large form (1.35x) stays 1.35x even on 4K', () => {
    const wide = click(2000, 0.5, 0.5, { containerBounds: { x: 190, y: 100, width: 1500, height: 400 } });
    expect(gen([wide], { sourcePixelWidth: 3840 })[0].targetScale).toBe(1.35);
  });

  it('typing zooms are capped too', () => {
    const typing: TypingSession[] = [{ t: 3000, endT: 4000, text: 'a', sensitive: false, targetLabel: 'Name', targetTag: 'input' }];
    expect(gen([], { sourcePixelWidth: 1280 }, typing)[0].targetScale).toBe(1.5);
    expect(gen([], { sourcePixelWidth: 1920 }, typing)[0].targetScale).toBe(1.75);
    expect(gen([], { sourcePixelWidth: 3840 }, typing)[0].targetScale).toBe(1.8);
  });

  it('resolveSourcePixelWidth prefers the capture track, then the video, then CSS width x pixel ratio', () => {
    expect(resolveSourcePixelWidth(2880, 1920, { width: 1440, devicePixelRatio: 2 })).toBe(2880);
    expect(resolveSourcePixelWidth(undefined, 1920, { width: 1440, devicePixelRatio: 2 })).toBe(1920);
    expect(resolveSourcePixelWidth(undefined, 0, { width: 1440, devicePixelRatio: 2 })).toBe(2880);
    expect(resolveSourcePixelWidth(undefined, undefined, { width: 1280 })).toBe(1280);
    expect(resolveSourcePixelWidth()).toBeUndefined();
  });
});

describe('conservative misclick filter', () => {
  // The cursor sits at the click, then (after the click) is moved away by `awayPx` within `afterMs`.
  const pathWithExit = (clickT: number, awayPx: number, afterMs: number): MousePoint[] => [
    ...hold(clickT - 400, clickT, 0.5, 0.5),
    { t: clickT + afterMs, x: 0.5 + awayPx / W, y: 0.5, c: 'default' },
    ...hold(clickT + afterMs + 16, clickT + 1500, 0.5 + awayPx / W, 0.5)
  ];
  const stray = (t = 5000) => click(t, 0.5, 0.5, { targetTag: 'DIV', interactive: false, containerBounds: undefined });

  it('drops a stray click: plain content, cursor leaves > 120 px within 250 ms, nothing typed', () => {
    expect(gen([stray()], { mousePoints: pathWithExit(5000, 300, 200) })).toHaveLength(0);
  });

  it('keeps the click when ANY one condition fails', () => {
    // 1. interactive target
    expect(gen([click(5000, 0.5, 0.5, { interactive: true })], { mousePoints: pathWithExit(5000, 300, 200) })).toHaveLength(1);
    // 1b. older recording (flag absent) is never dropped on a guess
    expect(gen([click(5000)], { mousePoints: pathWithExit(5000, 300, 200) })).toHaveLength(1);
    // 2a. cursor moves only 100 px
    expect(gen([stray()], { mousePoints: pathWithExit(5000, 100, 200) })).toHaveLength(1);
    // 2b. cursor leaves, but after the 250 ms window
    expect(gen([stray()], { mousePoints: pathWithExit(5000, 300, 400) })).toHaveLength(1);
    // 3. a keystroke within 500 ms
    const key: KeystrokeEvent = { t: 5400, key: 'a', combo: 'A' };
    expect(gen([stray()], { mousePoints: pathWithExit(5000, 300, 200), keystrokes: [key] })).toHaveLength(1);
    // 3b. a typing session around it
    const typing: TypingSession[] = [{ t: 5300, endT: 5900, text: 'hi', sensitive: false, targetLabel: 'x', targetTag: 'input' }];
    expect(gen([stray()], { mousePoints: pathWithExit(5000, 300, 200) }, typing)).toHaveLength(1);
  });

  it('cannot verify the exit without a cursor path, so it keeps the click', () => {
    expect(gen([stray()])).toHaveLength(1);
  });

  it('only removes the stray click: the real ones around it still zoom', () => {
    const clicks = [click(2000, 0.3, 0.3, { interactive: true }), stray(12_000), click(20_000, 0.7, 0.7, { interactive: true })];
    const path = [...hold(1600, 2400, 0.3, 0.3), ...pathWithExit(12_000, 300, 200), ...hold(19_600, 20_400, 0.7, 0.7)];
    const pills = gen(clicks, { mousePoints: path });
    expect(pills).toHaveLength(2);
    expect(pills.map((p) => Math.round(p.startTime))).toEqual([1700, 19_700]);
  });
});

describe('double-click boost', () => {
  it('a double-click zooms 0.15x tighter', () => {
    const single = gen([click(2000, 0.5, 0.5, { containerBounds: undefined, clickCount: 1 })])[0];
    const double = gen([click(2000, 0.5, 0.5, { containerBounds: undefined, clickCount: 2 })])[0];
    expect(single.targetScale).toBeCloseTo(1.6, 9);
    expect(double.targetScale).toBeCloseTo(1.75, 9);
  });

  it('the boost is still limited by the resolution cap', () => {
    const double = click(2000, 0.5, 0.5, { clickCount: 2 }); // 2.1 + 0.15 = 2.25 before the cap
    expect(gen([double])[0].targetScale).toBeCloseTo(2.25, 9);
    expect(gen([double], { sourcePixelWidth: 2560 })[0].targetScale).toBe(2.1);
    expect(gen([double], { sourcePixelWidth: 1920 })[0].targetScale).toBe(1.75);
  });

  it('a double-click inside a cluster boosts the whole zoom', () => {
    const pills = gen([click(2000, 0.5, 0.5, { containerBounds: undefined }), click(2200, 0.5, 0.5, { containerBounds: undefined, clickCount: 2 })]);
    expect(pills).toHaveLength(1);
    expect(pills[0].targetScale).toBeCloseTo(1.75, 9);
  });
});

describe('typing and the zoom you are already in', () => {
  const field = (x: number, y: number): InputFocusEvent => ({ t: 3000, type: 'focus', bounds: { x: x - 0.05, y: y - 0.02, width: 0.1, height: 0.04 } });
  const typed = (t: number, endT: number): TypingSession => ({ t, endT, text: 'hello', sensitive: false, targetLabel: 'City', targetTag: 'input' });

  it('typing near an active zoom extends it: one zoom, no conflicting 1.8x', () => {
    const pills = gen([click(1000, 0.5, 0.5)], {}, [typed(2500, 6000)], [field(0.55, 0.52)]);
    expect(pills).toHaveLength(1);
    expect(pills[0].startTime).toBe(1000 - AUTO_ZOOM.PRE_ROLL_CLICK_MS);
    expect(pills[0].endTime).toBe(6000 + AUTO_ZOOM.COOLDOWN_MS);
    expect(pills[0].targetScale).toBe(2.1); // the click zoom keeps its scale; the dead-zone pan tracks the field
  });

  it('typing far from the active zoom (> 0.25) starts its own clean typing zoom', () => {
    const pills = gen([click(1000, 0.2, 0.2)], {}, [typed(2500, 4000)], [field(0.8, 0.8)]);
    expect(pills.length).toBe(2);
    const typing = pills.find((p) => p.label?.startsWith('Type'))!;
    expect(typing.targetScale).toBe(1.8);
    expect(typing.startTime).toBeGreaterThanOrEqual(2500 - AUTO_ZOOM.PRE_ROLL_TYPING_MS);
  });

  it('typing while idle starts a typing zoom 350 ms early and holds 1.8 s after the last key', () => {
    const [p] = gen([], {}, [typed(5000, 7000)], [field(0.5, 0.5)]);
    expect(p.startTime).toBe(5000 - AUTO_ZOOM.PRE_ROLL_TYPING_MS);
    expect(p.endTime).toBe(7000 + AUTO_ZOOM.COOLDOWN_MS);
  });

  it('typing just after a zoom ended (within the grace) still extends it', () => {
    // Click zoom is [700, 3000+...]: last click 1000 -> ends 2800. Typing at 3200 is within the 600 ms grace.
    const pills = gen([click(1000, 0.5, 0.5)], {}, [typed(3200, 4000)], [field(0.52, 0.5)]);
    expect(pills).toHaveLength(1);
    expect(pills[0].endTime).toBe(4000 + AUTO_ZOOM.COOLDOWN_MS);
  });

  it('a typing zoom can never outlive the recording', () => {
    const [p] = gen([], {}, [typed(9000, 9800)], [field(0.5, 0.5)], 10_000);
    expect(p.endTime).toBe(10_000);
  });
});

describe('locked timing', () => {
  it('pre-roll 300 ms, cooldown 1.8 s, minimum zoom 1.6 s', () => {
    expect(AUTO_ZOOM.PRE_ROLL_CLICK_MS).toBe(300);
    expect(AUTO_ZOOM.PRE_ROLL_TYPING_MS).toBe(350);
    expect(AUTO_ZOOM.COOLDOWN_MS).toBe(1800);
    expect(AUTO_ZOOM.MIN_PILL_MS).toBe(1600);
    const [p] = gen([click(5000)]);
    expect(p.startTime).toBe(4700);
    expect(p.endTime).toBe(5000 + 1800);
    expect(p.endTime - p.startTime).toBeGreaterThanOrEqual(1600);
  });

  it('the camera is >= 90% in as the click lands, using the generated zoom and the real ease', () => {
    const [p] = gen([click(5000)]);
    const path = buildCameraPath([p], { followCursor: false });
    expect((path.at(5000).scale - 1) / (p.targetScale - 1)).toBeGreaterThanOrEqual(0.9);
  });
});

describe('rapid cursor jump releases the zoom', () => {
  const clicks = [click(1000, 0.5, 0.5), click(2500, 0.5, 0.5)]; // one cluster: zoom [700, 4300]
  const base = hold(0, 3000, 0.5, 0.5);
  const sample = (t: number, x: number, y: number): MousePoint => ({ t, x, y, c: 'default' });

  it('a fast jump > 0.45 away that stays >= 400 ms ends the zoom when it is confirmed', () => {
    const path = [...base, sample(3050, 0.5, 0.5), sample(3150, 0.95, 0.1), ...hold(3166, 6000, 0.95, 0.1)];
    const [p] = gen(clicks, { mousePoints: path });
    expect(p.endTime).toBeGreaterThanOrEqual(3150 + AUTO_ZOOM.JUMP_STAY_MS - 20);
    expect(p.endTime).toBeLessThan(3150 + AUTO_ZOOM.JUMP_STAY_MS + 40);
    expect(p.endTime).toBeLessThan(4300);
  });

  it('never shorter than the minimum zoom length', () => {
    const early = [click(1000, 0.5, 0.5)];
    const path = [...hold(0, 1300, 0.5, 0.5), sample(1400, 0.5, 0.5), sample(1500, 0.95, 0.1), ...hold(1516, 6000, 0.95, 0.1)];
    const [p] = gen(early, { mousePoints: path });
    expect(p.endTime - p.startTime).toBeGreaterThanOrEqual(AUTO_ZOOM.MIN_PILL_MS);
  });

  it('a jump that comes straight back (< 400 ms) does not release it', () => {
    const path = [...base, sample(3050, 0.5, 0.5), sample(3150, 0.95, 0.1), sample(3400, 0.95, 0.1), sample(3500, 0.5, 0.5), ...hold(3516, 6000, 0.5, 0.5)];
    const [p] = gen(clicks, { mousePoints: path });
    expect(p.endTime).toBe(2500 + AUTO_ZOOM.COOLDOWN_MS);
  });

  it('a slow drift away is not a jump', () => {
    const drift: MousePoint[] = [];
    for (let t = 0; t <= 6000; t += 16) drift.push(sample(t, 0.5 + Math.min(0.45, Math.max(0, (t - 2700) / 8000)), 0.5));
    const [p] = gen(clicks, { mousePoints: drift });
    expect(p.endTime).toBe(2500 + AUTO_ZOOM.COOLDOWN_MS);
  });

  it('a jump to somewhere still close (< 0.45) is ignored', () => {
    const path = [...base, sample(3050, 0.5, 0.5), sample(3150, 0.85, 0.5), ...hold(3166, 6000, 0.85, 0.5)];
    const [p] = gen(clicks, { mousePoints: path });
    expect(p.endTime).toBe(2500 + AUTO_ZOOM.COOLDOWN_MS);
  });
});

describe('leaving the recorded tab releases the zoom', () => {
  const clicks = [click(1000, 0.5, 0.5), click(2500, 0.5, 0.5)]; // zoom [700, 4300]

  it('a hold is closed when the tab goes hidden', () => {
    const [p] = gen(clicks, { visibilityEvents: [{ t: 3000, state: 'hidden' }, { t: 9000, state: 'visible' }] });
    expect(p.endTime).toBe(3000);
  });

  it('a zoom that would start while the tab is hidden never happens', () => {
    const pills = gen([click(5000, 0.5, 0.5)], { visibilityEvents: [{ t: 4000, state: 'hidden' }, { t: 9000, state: 'visible' }] });
    expect(pills).toHaveLength(0);
  });

  it('zooms before and after the hidden stretch are kept', () => {
    const pills = gen(
      [click(1000, 0.3, 0.3), click(12_000, 0.7, 0.7)],
      { visibilityEvents: [{ t: 5000, state: 'hidden' }, { t: 9000, state: 'visible' }] }
    );
    expect(pills).toHaveLength(2);
  });

  it('without visibility events nothing changes', () => {
    expect(gen(clicks)[0].endTime).toBe(2500 + AUTO_ZOOM.COOLDOWN_MS);
  });
});
