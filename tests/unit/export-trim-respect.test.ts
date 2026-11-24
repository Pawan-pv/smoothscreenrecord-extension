/**
 * The SOP guide and the HTML widget list steps. A step the user trimmed away
 * (or cut with a silence) is not in the video, so it must not be in the guide
 * either: not the step, not its screenshot, not the text typed in it.
 */
import { describe, it, expect } from 'vitest';
import { SopGuideExporter } from '../../src/engine/sop-guide-exporter';
import { HtmlWidgetExporter } from '../../src/engine/html-widget-exporter';
import { createExportTimelineFilter } from '../../src/engine/export-timeline';
import { redactUrlForExport } from '../../src/engine/export-safety';
import type { TelemetryData } from '../../src/types/telemetry';

const click = (t: number, label: string) => ({ t, x: 0.4, y: 0.5, button: 0, targetTag: 'button', targetText: label, targetLabel: label });

function telemetry(url = 'https://app.example.com/dashboard'): TelemetryData {
  return {
    metadata: { id: 'r', startTime: 1_700_000_000_000, endTime: 1_700_000_012_000, durationMs: 12000, width: 1280, height: 720, devicePixelRatio: 1, title: 'Demo', url },
    mousePoints: [],
    clicks: [click(1000, 'Alpha-Early'), click(5000, 'Bravo-Kept'), click(6000, 'Charlie-Cut'), click(7000, 'Delta-Kept'), click(10000, 'Echo-Late')],
    keystrokes: [
      { t: 1100, key: 'k', combo: 'Ctrl + K' },
      { t: 5100, key: 's', combo: 'Ctrl + S' },
      { t: 10100, key: 'p', combo: 'Ctrl + P' }
    ],
    inputEvents: [],
    typingSessions: [
      { t: 1200, endT: 1600, text: 'typed-early', sensitive: false, targetLabel: 'Name', targetTag: 'input' },
      { t: 5200, endT: 5600, text: 'typed-kept', sensitive: false, targetLabel: 'City', targetTag: 'input' },
      { t: 10200, endT: 10600, text: 'typed-late', sensitive: false, targetLabel: 'Zip', targetTag: 'input' }
    ]
  };
}

const snaps = [1000, 5000, 6000, 7000, 10000].map((timestamp) => ({ timestamp, dataUrl: `data:image/png;base64,SNAP${timestamp}` }));
const timeline = { durationMs: 12000, trimStartMs: 4000, trimEndMs: 8000, cutRanges: [{ startTime: 5500, endTime: 6500 }] };

describe('createExportTimelineFilter', () => {
  it('is a pass-through when nothing was trimmed or cut', () => {
    const f = createExportTimelineFilter({ durationMs: 12000 });
    expect(f.active).toBe(false);
    expect(f.keeps(99999)).toBe(true);
    expect(f.toExportTime(4321)).toBe(4321);
    expect(createExportTimelineFilter(undefined).active).toBe(false);
  });

  it('keeps only the trim window minus the cuts, and re-bases onto the exported timeline', () => {
    const f = createExportTimelineFilter(timeline);
    expect(f.active).toBe(true);
    expect(f.exportedDurationMs).toBe(3000); // 4000 trimmed, minus a 1000 ms cut
    expect(f.keeps(3999)).toBe(false);
    expect(f.keeps(5000)).toBe(true);
    expect(f.keeps(6000)).toBe(false); // inside the cut
    expect(f.keeps(8001)).toBe(false);
    expect(f.toExportTime(4000)).toBe(0);
    expect(f.toExportTime(5000)).toBe(1000);
    expect(f.toExportTime(7000)).toBe(2000); // the 1 s cut before it is gone from the video
  });

  it('a trim-only window re-bases to the trim start', () => {
    const f = createExportTimelineFilter({ durationMs: 12000, trimStartMs: 3000 });
    expect(f.toExportTime(3000)).toBe(0);
    expect(f.toExportTime(5000)).toBe(2000);
    expect(f.exportedDurationMs).toBe(9000);
  });
});

describe('SOP guide respects trim and cuts', () => {
  it('without a timeline every step is listed (unchanged behaviour)', () => {
    const md = SopGuideExporter.generateMarkdownGuide(telemetry(), snaps);
    for (const label of ['Alpha-Early', 'Bravo-Kept', 'Charlie-Cut', 'Delta-Kept', 'Echo-Late', 'typed-early', 'typed-late']) {
      expect(md).toContain(label);
    }
  });

  it('lists only what is inside the trim window and outside the cuts', () => {
    const md = SopGuideExporter.generateMarkdownGuide(telemetry(), snaps, true, timeline);
    expect(md).toContain('Bravo-Kept');
    expect(md).toContain('Delta-Kept');
    expect(md).toContain('typed-kept');
    expect(md).toContain('`Ctrl + S`');
    for (const gone of ['Alpha-Early', 'Charlie-Cut', 'Echo-Late', 'typed-early', 'typed-late', 'Ctrl + K', 'Ctrl + P']) {
      expect(md, `"${gone}" was trimmed or cut away and must not be in the guide`).not.toContain(gone);
    }
  });

  it('never attaches a screenshot from outside the exported window', () => {
    const md = SopGuideExporter.generateMarkdownGuide(telemetry(), snaps, true, timeline);
    expect(md).toContain('SNAP5000');
    expect(md).toContain('SNAP7000');
    for (const gone of ['SNAP1000', 'SNAP6000', 'SNAP10000']) expect(md).not.toContain(gone);
  });

  it('numbers the remaining steps from 1 and shows times from 0:00 of the exported video', () => {
    const md = SopGuideExporter.generateMarkdownGuide(telemetry(), [], true, timeline);
    expect(md).toMatch(/### Step 1: Click on \*\*"Bravo-Kept"\*\*[^\n]*`\[1\.0s\]`/); // 5000 - 4000
    expect(md).toMatch(/### Step 2: Press Shortcut `Ctrl \+ S` `\[1\.1s\]`/);
    expect(md).toMatch(/### Step 3: Type \*\*"typed-kept"\*\*[^\n]*`\[1\.2s\]`/);
    expect(md).toMatch(/### Step 4: Click on \*\*"Delta-Kept"\*\*[^\n]*`\[2\.0s\]`/); // 7000 - 4000 - 1000 cut
    expect(md).not.toMatch(/Step 5/);
    expect(md).toContain('**Duration**: 3.0s');
    expect(md).toContain('2 clicks, 1 keystrokes');
  });

  it('a recording trimmed to a span with no actions says so instead of inventing steps', () => {
    const md = SopGuideExporter.generateMarkdownGuide(telemetry(), snaps, true, { durationMs: 12000, trimStartMs: 2000, trimEndMs: 4500 });
    expect(md).toContain('No discrete click or keyboard actions were recorded');
    expect(md).not.toContain('Alpha-Early');
  });
});

describe('HTML widget respects trim and cuts', () => {
  const stepsOf = (html: string): any[] => {
    const m = html.match(/const steps = window\.steps = (\[.*?\]);\n/s);
    if (!m) throw new Error('steps array not found in the widget');
    return JSON.parse(m[1]);
  };

  it('contains only the kept steps and only their screenshots', () => {
    const html = HtmlWidgetExporter.generateInteractiveWidget(telemetry(), snaps, true, timeline);
    const steps = stepsOf(html);
    expect(steps.map((s) => s.title)).toEqual(['Click "Bravo-Kept"', 'Click "Delta-Kept"']);
    expect(steps.map((s) => s.step)).toEqual([1, 2]);
    expect(html).toContain('Step 1 of 2');
    for (const gone of ['Alpha-Early', 'Charlie-Cut', 'Echo-Late', 'SNAP1000', 'SNAP6000', 'SNAP10000']) {
      expect(html, `"${gone}" must not be in the widget`).not.toContain(gone);
    }
    expect(steps[0].img).toContain('SNAP5000');
  });

  it('without a timeline every step is present', () => {
    const steps = stepsOf(HtmlWidgetExporter.generateInteractiveWidget(telemetry(), snaps));
    expect(steps).toHaveLength(5);
  });
});

describe('SOP "Source URL" redaction', () => {
  const url = 'https://user:hunter2@app.example.com/reports/jane.doe@corp.io?token=abc123&view=week&api_key=sk\u005flive_1234567890abcdef&q=hello#access_token=zzz&tab=a';

  it('removes credentials, secret-looking query/hash values and emails from the printed URL', () => {
    const out = redactUrlForExport(url)!;
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('sk\u005flive_1234567890abcdef');
    expect(out).not.toContain('jane.doe@corp.io');
    expect(out).not.toContain('zzz');
    expect(out).toContain('view=week'); // harmless parts stay
    expect(out).toContain('q=hello');
    expect(out).toContain('app.example.com/reports');
  });

  it('is applied to the guide header, and not when the shield is off', () => {
    const on = SopGuideExporter.generateMarkdownGuide(telemetry(url), [], true);
    expect(on).toContain('**Source URL**');
    expect(on).not.toContain('abc123');
    expect(on).not.toContain('hunter2');
    const off = SopGuideExporter.generateMarkdownGuide(telemetry(url), [], { blurEmails: false, blurRevenue: false, blurApiKeys: false });
    expect(off).toContain('token=abc123');
  });

  it('leaves an ordinary URL alone', () => {
    expect(redactUrlForExport('https://example.com/app?page=2')).toBe('https://example.com/app?page=2');
    expect(redactUrlForExport(undefined)).toBeUndefined();
  });
});
