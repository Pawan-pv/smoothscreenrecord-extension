import type {
  TelemetryData,
  MousePoint,
  ClickEvent,
  PressEvent,
  KeystrokeEvent,
  InputFocusEvent,
  TypingSession,
  ScrollEvent,
  VisibilityEvent,
  RecordingMetadata,
  PageGeometry
} from '../types/telemetry';

/**
 * A page load of the recorded tab only lives as long as the page: a navigation
 * or a reload throws its in-memory telemetry away. The content script therefore
 * hands what it has captured to the service worker in SEGMENTS (periodically
 * and on pagehide), and the service worker stitches the segments, plus the last
 * page's final capture, back into ONE telemetry stream when the recording stops.
 */
export interface TelemetryBatch {
  mousePoints: MousePoint[];
  clicks: ClickEvent[];
  pressEvents: PressEvent[];
  keystrokes: KeystrokeEvent[];
  inputEvents: InputFocusEvent[];
  typingSessions: TypingSession[];
  scrollEvents: ScrollEvent[];
  visibilityEvents?: VisibilityEvent[];
}

export interface SegmentPageInfo {
  url?: string;
  title?: string;
  width?: number;
  height?: number;
  devicePixelRatio?: number;
  screenLayout?: RecordingMetadata['screenLayout'];
  brandColors?: RecordingMetadata['brandColors'];
}

export interface TelemetrySegment {
  sessionId: string;
  /** Random id of the page load that produced the segment. */
  loadId: string;
  /** Monotonic per page load; (loadId, seq) identifies a segment for de-duplication. */
  seq: number;
  /** The timeline origin the segment's timestamps are measured against. */
  originEpoch: number;
  batch: TelemetryBatch;
  page: SegmentPageInfo;
}

export function emptyBatch(): TelemetryBatch {
  return {
    mousePoints: [],
    clicks: [],
    pressEvents: [],
    keystrokes: [],
    inputEvents: [],
    typingSessions: [],
    scrollEvents: [],
    visibilityEvents: []
  };
}

export function batchIsEmpty(b: TelemetryBatch): boolean {
  return b.mousePoints.length === 0 && b.clicks.length === 0 && b.pressEvents.length === 0 &&
    b.keystrokes.length === 0 && b.inputEvents.length === 0 && b.typingSessions.length === 0 &&
    b.scrollEvents.length === 0 && (b.visibilityEvents?.length ?? 0) === 0;
}

export function segmentKey(s: Pick<TelemetrySegment, 'sessionId' | 'loadId' | 'seq'>): string {
  return `smoothstudio_seg:${s.sessionId}:${s.loadId}:${s.seq}`;
}

const DEFAULT_BRAND = { primary: '#8B5CF6', secondary: '#6366F1', accent: '#EC4899', background: '#0B0C10' };

function shifted<T extends { t: number }>(items: T[], delta: number): T[] {
  if (!delta) return items.slice();
  // Items that now sit before the recording origin are not in the video.
  return items.map((i) => ({ ...i, t: Math.round(i.t + delta) })).filter((i) => i.t >= 0);
}

/** Tags pointer events with the index of the page geometry they were measured in. */
function tagged<T extends { g?: number }>(items: T[], g: number | undefined): T[] {
  return g === undefined ? items : items.map((i) => ({ ...i, g }));
}

function geometryOf(page: { width?: number; height?: number; screenLayout?: RecordingMetadata['screenLayout'] } | undefined): PageGeometry | null {
  if (!page || !(Number(page.width) > 0) || !(Number(page.height) > 0)) return null;
  return { width: page.width as number, height: page.height as number, ...(page.screenLayout ? { screenLayout: page.screenLayout } : {}) };
}

function shiftedTyping(items: TypingSession[], delta: number): TypingSession[] {
  if (!delta) return items.slice();
  return items
    .map((i) => ({ ...i, t: Math.round(i.t + delta), endT: Math.round(i.endT + delta) }))
    .filter((i) => i.endT >= 0);
}

const byTime = (a: { t: number }, b: { t: number }) => a.t - b.t;

export interface MergeInput {
  sessionId: string | null;
  /** The recording's authoritative timeline origin (ms since epoch). */
  referenceOrigin: number;
  segments: TelemetrySegment[];
  /** What the last page still held when the recording stopped (null when it was gone). */
  final: { data: TelemetryData | null; originEpoch: number | null } | null;
}

/**
 * Merges the buffered segments and the final capture into one telemetry stream.
 * - Segments are de-duplicated by (loadId, seq): a retried delivery never doubles data.
 * - Every timestamp is re-based onto `referenceOrigin`, so a segment captured
 *   against a provisional origin lines up with the video.
 * - Each stream is returned in chronological order.
 * Returns null when nothing at all was captured.
 */
export function mergeTelemetrySegments(input: MergeInput): TelemetryData | null {
  const seen = new Set<string>();
  const unique: TelemetrySegment[] = [];
  for (const s of input.segments) {
    const k = `${s.loadId}:${s.seq}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(s);
  }
  const finalData = input.final?.data ?? null;
  if (unique.length === 0 && !finalData) return null;
  // A single-page recording (nothing was ever handed over) is returned untouched.
  if (unique.length === 0 && finalData &&
      Math.abs((input.final?.originEpoch ?? input.referenceOrigin) - input.referenceOrigin) < 1) {
    return finalData;
  }

  // Pages can differ (tabs followed during a screen recording): every segment's pointer
  // events are tagged with its page geometry, so each is placed with its own page's
  // viewport and screen position.
  const geometries: PageGeometry[] = [];
  const geometryIndex = (geometry: PageGeometry | null): number | undefined => {
    if (!geometry) return undefined;
    const key = JSON.stringify(geometry);
    const found = geometries.findIndex((g) => JSON.stringify(g) === key);
    if (found >= 0) return found;
    geometries.push(geometry);
    return geometries.length - 1;
  };

  const out = emptyBatch();
  const add = (batch: Partial<TelemetryBatch>, origin: number, g?: number) => {
    const delta = origin - input.referenceOrigin;
    out.mousePoints.push(...tagged(shifted(batch.mousePoints || [], delta), g));
    out.clicks.push(...tagged(shifted(batch.clicks || [], delta), g));
    out.pressEvents.push(...tagged(shifted(batch.pressEvents || [], delta), g));
    out.keystrokes.push(...shifted(batch.keystrokes || [], delta));
    out.inputEvents.push(...tagged(shifted(batch.inputEvents || [], delta), g));
    out.typingSessions.push(...shiftedTyping(batch.typingSessions || [], delta));
    out.scrollEvents.push(...shifted(batch.scrollEvents || [], delta));
    out.visibilityEvents!.push(...shifted(batch.visibilityEvents || [], delta));
  };

  for (const s of unique) add(s.batch, s.originEpoch, geometryIndex(geometryOf(s.page)));
  if (finalData) {
    add(finalData, input.final?.originEpoch ?? input.referenceOrigin, geometryIndex(geometryOf(finalData.metadata)));
  }

  out.mousePoints.sort(byTime);
  out.clicks.sort(byTime);
  out.pressEvents.sort(byTime);
  out.keystrokes.sort(byTime);
  out.inputEvents.sort(byTime);
  out.typingSessions.sort(byTime);
  out.scrollEvents.sort(byTime);
  out.visibilityEvents!.sort(byTime);

  // Metadata: the recording starts on the FIRST page (its url/title identify
  // the guide), while the viewport and brand colours come from the freshest page.
  // Order the page loads by when their first captured event happened.
  const startsAt = (x: TelemetrySegment) => {
    const ts = [x.batch.mousePoints, x.batch.clicks, x.batch.pressEvents, x.batch.keystrokes, x.batch.inputEvents, x.batch.scrollEvents, x.batch.visibilityEvents || []]
      .flat().map((i) => i.t);
    return x.originEpoch + (ts.length ? Math.min(...ts) : 0);
  };
  const ordered = [...unique].sort((a, b) => startsAt(a) - startsAt(b) || a.seq - b.seq);
  const firstPage = ordered.find((s) => s.page.url)?.page;
  const lastPage = [...ordered].reverse().find((s) => s.page.width)?.page;
  const fm = finalData?.metadata;
  const now = Date.now();
  const durationMs = Math.max(0, Math.round(fm?.durationMs ?? (now - input.referenceOrigin)));
  const screenLayout = fm?.screenLayout ?? [...ordered].reverse().find((s) => s.page.screenLayout)?.page.screenLayout;
  const metadata: RecordingMetadata = {
    id: input.sessionId || fm?.id || ('rec_' + now),
    ...(input.sessionId || fm?.sessionId ? { sessionId: (input.sessionId || fm?.sessionId) as string } : {}),
    startTime: input.referenceOrigin,
    endTime: fm?.endTime ?? now,
    durationMs,
    width: fm?.width ?? lastPage?.width ?? 0,
    height: fm?.height ?? lastPage?.height ?? 0,
    devicePixelRatio: fm?.devicePixelRatio ?? lastPage?.devicePixelRatio ?? 1,
    title: firstPage?.title ?? fm?.title ?? 'Screen Recording',
    url: firstPage?.url ?? fm?.url,
    ...(screenLayout ? { screenLayout } : {}),
    ...(geometries.length > 0 ? { pageGeometries: geometries } : {}),
    brandColors: fm?.brandColors ?? [...ordered].reverse().find((s) => s.page.brandColors)?.page.brandColors ?? DEFAULT_BRAND
  };

  return { metadata, ...out };
}
