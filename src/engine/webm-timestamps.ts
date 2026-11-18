/**
 * WebM (Matroska/EBML) track start-time reader.
 *
 * Why this exists (QA-011 / QA-002):
 * MediaRecorder does not start every track at media time 0. In a real recording
 * the Opus track frequently starts tens of milliseconds after the video track
 * (measured 22-26 ms), and on a cold encoder it can start hundreds of
 * milliseconds later. Chrome's playback honours that offset, but
 * `decodeAudioData()` returns the audio from its FIRST SAMPLE with no offset.
 * Placing that PCM at MP4 time 0 shifts all audio earlier by the track start
 * offset: audio leads video. The same offset also decides where a detected
 * silence / cut lands on the media timeline.
 *
 * This module reads the first block timestamp of the audio and video tracks so
 * the audio can be placed on the same timeline the video element uses.
 */

const EBML_HEADER = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const TRACK_NUMBER = 0xd7;
const TRACK_TYPE = 0x83;
const CLUSTER = 0x1f43b675;
const TIMECODE = 0xe7;
const SIMPLE_BLOCK = 0xa3;
const BLOCK_GROUP = 0xa0;
const BLOCK = 0xa1;

const DEFAULT_TIMECODE_SCALE_NS = 1_000_000;
/** MediaRecorder puts Tracks before the first Cluster; 16 MB covers several seconds of capture. */
const DEFAULT_SCAN_BYTES = 16 * 1024 * 1024;

interface Element {
  id: number;
  /** Offset of the element ID. */
  start: number;
  /** Offset of the first content byte. */
  contentStart: number;
  /** Offset one past the last content byte. */
  contentEnd: number;
  unknownSize: boolean;
}

function readVint(bytes: Uint8Array, pos: number, limit: number): { length: number; value: number; unknown: boolean } | null {
  if (pos >= limit) return null;
  const first = bytes[pos];
  if (first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while ((first & mask) === 0) {
    mask >>= 1;
    length++;
    if (length > 8 || pos + length > limit) return null;
  }
  let value = first & (mask - 1);
  let allOnes = value === mask - 1;
  for (let i = 1; i < length; i++) {
    const b = bytes[pos + i];
    value = value * 256 + b;
    if (b !== 0xff) allOnes = false;
  }
  return { length, value, unknown: allOnes };
}

function readElement(bytes: Uint8Array, pos: number, limit: number): Element | null {
  if (pos + 1 > limit) return null;
  const first = bytes[pos];
  if (first === 0) return null;
  // IDs are 1..4 bytes; their marker bits are part of the ID value.
  let idLength = 1;
  if (first & 0x80) idLength = 1;
  else if (first & 0x40) idLength = 2;
  else if (first & 0x20) idLength = 3;
  else if (first & 0x10) idLength = 4;
  else return null;
  if (pos + idLength > limit) return null;
  let id = 0;
  for (let i = 0; i < idLength; i++) id = id * 256 + bytes[pos + i];
  const sizePos = pos + idLength;
  const size = readVint(bytes, sizePos, limit);
  if (!size) return null;
  const contentStart = sizePos + size.length;
  const contentEnd = size.unknown ? limit : Math.min(limit, contentStart + size.value);
  if (contentEnd < contentStart) return null;
  return { id, start: pos, contentStart, contentEnd, unknownSize: size.unknown };
}

function readUint(bytes: Uint8Array, start: number, end: number): number {
  let value = 0;
  for (let i = start; i < end; i++) value = value * 256 + bytes[i];
  return value;
}

/** Reads the track number + relative time of a (Simple)Block. */
function readBlockHeader(bytes: Uint8Array, start: number, end: number): { track: number; relTime: number } | null {
  const trackVint = readVint(bytes, start, end);
  if (!trackVint) return null;
  const relPos = start + trackVint.length;
  if (relPos + 2 > end) return null;
  let rel = (bytes[relPos] << 8) | bytes[relPos + 1];
  if (rel & 0x8000) rel -= 0x10000;
  return { track: trackVint.value, relTime: rel };
}

export interface WebmTrackStartTimes {
  /** First video block time, ms from the start of the Segment. */
  videoStartMs: number | null;
  /** First audio block time, ms from the start of the Segment. */
  audioStartMs: number | null;
  videoTrackNumber: number | null;
  audioTrackNumber: number | null;
  /** MediaRecorder sometimes declares Size as "unknown"; reported for diagnostics. */
  unknownSegmentSize: boolean;
}

const EMPTY_TRACK_TIMES: WebmTrackStartTimes = {
  videoStartMs: null,
  audioStartMs: null,
  videoTrackNumber: null,
  audioTrackNumber: null,
  unknownSegmentSize: false,
};

/**
 * Parses a WebM prefix. Returns null times when the element is absent from the
 * scanned prefix; it never guesses a timestamp.
 */
export function readWebmTrackStartTimes(bytes: Uint8Array): WebmTrackStartTimes {
  if (!bytes || bytes.length < 8) return { ...EMPTY_TRACK_TIMES };
  const limit = bytes.length;

  // Top level: EBML header then Segment.
  let segment: Element | null = null;
  let pos = 0;
  while (pos < limit) {
    const el = readElement(bytes, pos, limit);
    if (!el) break;
    if (el.id === SEGMENT) {
      segment = el;
      break;
    }
    if (el.unknownSize) break;
    pos = el.contentEnd;
  }
  if (!segment) return { ...EMPTY_TRACK_TIMES };

  const trackTypes = new Map<number, number>();
  let timecodeScale = DEFAULT_TIMECODE_SCALE_NS;
  let audioStartTicks: number | null = null;
  let videoStartTicks: number | null = null;

  const parseTracks = (tracks: Element) => {
    let p = tracks.contentStart;
    while (p < tracks.contentEnd) {
      const entry = readElement(bytes, p, tracks.contentEnd);
      if (!entry) break;
      if (entry.id === TRACK_ENTRY) {
        let number: number | null = null;
        let type: number | null = null;
        let q = entry.contentStart;
        while (q < entry.contentEnd) {
          const child = readElement(bytes, q, entry.contentEnd);
          if (!child) break;
          if (child.id === TRACK_NUMBER) number = readUint(bytes, child.contentStart, child.contentEnd);
          else if (child.id === TRACK_TYPE) type = readUint(bytes, child.contentStart, child.contentEnd);
          if (child.unknownSize) break;
          q = child.contentEnd;
        }
        if (number !== null && type !== null) trackTypes.set(number, type);
      }
      if (entry.unknownSize) break;
      p = entry.contentEnd;
    }
  };

  const recordBlock = (clusterTimecode: number, block: Element) => {
    const header = readBlockHeader(bytes, block.contentStart, block.contentEnd);
    if (!header) return;
    const type = trackTypes.get(header.track);
    const absolute = clusterTimecode + header.relTime;
    if (type === 2 && audioStartTicks === null) audioStartTicks = absolute;
    else if (type === 1 && videoStartTicks === null) videoStartTicks = absolute;
  };

  let current = segment.contentStart;
  while (current < limit) {
    const el = readElement(bytes, current, limit);
    if (!el) break;

    if (el.id === TRACKS) {
      parseTracks(el);
    } else if (el.id === INFO) {
      let q = el.contentStart;
      while (q < el.contentEnd) {
        const child = readElement(bytes, q, el.contentEnd);
        if (!child) break;
        if (child.id === TIMECODE_SCALE) {
          const scale = readUint(bytes, child.contentStart, child.contentEnd);
          if (scale > 0) timecodeScale = scale;
        }
        if (child.unknownSize) break;
        q = child.contentEnd;
      }
    } else if (el.id === CLUSTER) {
      let clusterTimecode = 0;
      let c = el.contentStart;
      while (c < el.contentEnd) {
        // An unknown-size Cluster ends where the next top-level element begins.
        if (c + 4 <= limit && readUint(bytes, c, c + 4) === CLUSTER) break;
        const child = readElement(bytes, c, el.contentEnd);
        if (!child) break;
        if (child.id === TIMECODE) {
          clusterTimecode = readUint(bytes, child.contentStart, child.contentEnd);
        } else if (child.id === SIMPLE_BLOCK) {
          recordBlock(clusterTimecode, child);
        } else if (child.id === BLOCK_GROUP) {
          let g = child.contentStart;
          while (g < child.contentEnd) {
            const grand = readElement(bytes, g, child.contentEnd);
            if (!grand) break;
            if (grand.id === BLOCK) recordBlock(clusterTimecode, grand);
            if (grand.unknownSize) break;
            g = grand.contentEnd;
          }
        }
        if (child.unknownSize) break;
        c = child.contentEnd;
      }
      if (audioStartTicks !== null && videoStartTicks !== null) break;
    }

    if (el.unknownSize) break;
    current = el.contentEnd;
  }

  const ticksToMs = (ticks: number) => (ticks * timecodeScale) / 1_000_000;
  let audioTrackNumber: number | null = null;
  let videoTrackNumber: number | null = null;
  for (const [num, type] of trackTypes) {
    if (type === 2 && audioTrackNumber === null) audioTrackNumber = num;
    if (type === 1 && videoTrackNumber === null) videoTrackNumber = num;
  }
  return {
    audioStartMs: audioStartTicks === null ? null : ticksToMs(audioStartTicks),
    videoStartMs: videoStartTicks === null ? null : ticksToMs(videoStartTicks),
    audioTrackNumber,
    videoTrackNumber,
    unknownSegmentSize: segment.unknownSize,
  };
}

/**
 * Reads the audio track start offset of a recording. Returns 0 when it cannot
 * be determined; a 0 offset is the pre-existing behaviour, never an invented
 * delay.
 */
export async function readWebmAudioStartMs(blob: Blob, scanBytes = DEFAULT_SCAN_BYTES): Promise<number> {
  if (!blob || blob.size < 8) return 0;
  try {
    const slice = blob.slice(0, Math.min(blob.size, scanBytes));
    const bytes = new Uint8Array(await slice.arrayBuffer());
    const info = readWebmTrackStartTimes(bytes);
    if (info.audioStartMs === null) return 0;
    return Math.max(0, Math.round(info.audioStartMs * 1000) / 1000);
  } catch {
    return 0;
  }
}
