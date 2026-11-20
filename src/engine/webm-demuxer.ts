/**
 * WebM (Matroska) video-track demuxer for the MP4 exporter (QA-001).
 *
 * Why this exists:
 * The exporter used to read every output frame by seeking a <video> element.
 * Chrome answers each seek by decoding forward from the preceding keyframe, so
 * one seek costs O(distance to that keyframe). Measured on Chromium 158 with a
 * 1080p VP8 stream: seek_ms = 34 + 83 * seconds_since_keyframe (r = 0.988);
 * a 20 s export spent 246 s inside seeks, and a fixed per-seek deadline turned a
 * slow-but-healthy decode into "Seek timeout". Demuxing the recording once lets
 * the exporter decode every source frame exactly once, in order, with WebCodecs.
 *
 * Scope: the files MediaRecorder writes (SimpleBlocks, no lacing for video,
 * unknown-size Segment/Cluster allowed) plus BlockGroups. Anything this reader
 * cannot describe exactly returns `null` so the caller can use another path;
 * it never guesses a timestamp or invents a frame.
 */
import { readUint, readVint } from './webm-timestamps';

const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const TRACK_NUMBER = 0xd7;
const TRACK_TYPE = 0x83;
const CODEC_ID = 0x86;
const CODEC_PRIVATE = 0x63a2;
const VIDEO = 0xe0;
const PIXEL_WIDTH = 0xb0;
const PIXEL_HEIGHT = 0xba;
const CLUSTER = 0x1f43b675;
const TIMECODE = 0xe7;
const SIMPLE_BLOCK = 0xa3;
const BLOCK_GROUP = 0xa0;
const BLOCK = 0xa1;
const REFERENCE_BLOCK = 0xfb;

/** Level-1 elements: an unknown-size Cluster ends where one of these starts. */
const LEVEL1_IDS = new Set([
  CLUSTER,
  INFO,
  TRACKS,
  0x1c53bb6b, // Cues
  0x1254c367, // Tags
  0x114d9b74, // SeekHead
  0x1043a770, // Chapters
  0x1941a469, // Attachments
]);

const TRACK_TYPE_VIDEO = 1;
const DEFAULT_TIMECODE_SCALE_NS = 1_000_000;

export interface WebmVideoFrameRef {
  /** Presentation time on the container timeline, in microseconds. */
  timestampUs: number;
  keyframe: boolean;
  /** SimpleBlock "invisible" flag: decoded for reference, never displayed. */
  invisible: boolean;
  /** Byte range of the encoded frame inside the scanned buffer. */
  offset: number;
  length: number;
}

export interface WebmVideoTrack {
  trackNumber: number;
  codecId: string;
  codecPrivate: Uint8Array | null;
  width: number | null;
  height: number | null;
  /** Frames in file (decode) order. */
  frames: WebmVideoFrameRef[];
  /** The buffer ended inside a block (e.g. a crash-recovered recording); that block was dropped. */
  truncated: boolean;
}

export type WebmDemuxResult =
  | { ok: true; track: WebmVideoTrack }
  | { ok: false; reason: string };

interface Header {
  id: number;
  contentStart: number;
  /** Declared end; Infinity for an unknown size. */
  declaredEnd: number;
  unknownSize: boolean;
}

function readHeader(bytes: Uint8Array, pos: number, limit: number): Header | null {
  if (pos >= limit) return null;
  const first = bytes[pos];
  let idLength: number;
  if (first & 0x80) idLength = 1;
  else if (first & 0x40) idLength = 2;
  else if (first & 0x20) idLength = 3;
  else if (first & 0x10) idLength = 4;
  else return null;
  if (pos + idLength > limit) return null;
  let id = 0;
  for (let i = 0; i < idLength; i++) id = id * 256 + bytes[pos + i];
  const size = readVint(bytes, pos + idLength, limit);
  if (!size) return null;
  const contentStart = pos + idLength + size.length;
  return {
    id,
    contentStart,
    declaredEnd: size.unknown ? Infinity : contentStart + size.value,
    unknownSize: size.unknown,
  };
}

function readString(bytes: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end && bytes[i] !== 0; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

interface TrackInfo {
  number: number;
  type: number | null;
  codecId: string;
  codecPrivate: Uint8Array | null;
  width: number | null;
  height: number | null;
}

/**
 * Demuxes the first video track of a WebM buffer. Pure: no DOM, no WebCodecs.
 */
export function demuxWebmVideo(bytes: Uint8Array): WebmDemuxResult {
  if (!bytes || bytes.length < 8) return { ok: false, reason: 'the file is empty' };
  const limit = bytes.length;

  // Top level: EBML header, then the Segment.
  let pos = 0;
  let segment: Header | null = null;
  while (pos < limit) {
    const h = readHeader(bytes, pos, limit);
    if (!h) break;
    if (h.id === SEGMENT) {
      segment = h;
      break;
    }
    if (h.unknownSize) break;
    pos = h.declaredEnd;
  }
  if (!segment) return { ok: false, reason: 'no Matroska Segment' };

  let timecodeScale = DEFAULT_TIMECODE_SCALE_NS;
  const tracks: TrackInfo[] = [];
  let video: TrackInfo | null = null;
  const frames: WebmVideoFrameRef[] = [];
  let truncated = false;
  let unsupported: string | null = null;

  const parseTracks = (start: number, end: number) => {
    let p = start;
    while (p < end) {
      const entry = readHeader(bytes, p, end);
      if (!entry || entry.unknownSize) break;
      const entryEnd = Math.min(entry.declaredEnd, end);
      if (entry.id === TRACK_ENTRY) {
        const info: TrackInfo = { number: -1, type: null, codecId: '', codecPrivate: null, width: null, height: null };
        let q = entry.contentStart;
        while (q < entryEnd) {
          const child = readHeader(bytes, q, entryEnd);
          if (!child || child.unknownSize) break;
          const childEnd = Math.min(child.declaredEnd, entryEnd);
          if (child.id === TRACK_NUMBER) info.number = readUint(bytes, child.contentStart, childEnd);
          else if (child.id === TRACK_TYPE) info.type = readUint(bytes, child.contentStart, childEnd);
          else if (child.id === CODEC_ID) info.codecId = readString(bytes, child.contentStart, childEnd);
          else if (child.id === CODEC_PRIVATE) info.codecPrivate = bytes.slice(child.contentStart, childEnd);
          else if (child.id === VIDEO) {
            let v = child.contentStart;
            while (v < childEnd) {
              const vc = readHeader(bytes, v, childEnd);
              if (!vc || vc.unknownSize) break;
              const vcEnd = Math.min(vc.declaredEnd, childEnd);
              if (vc.id === PIXEL_WIDTH) info.width = readUint(bytes, vc.contentStart, vcEnd);
              else if (vc.id === PIXEL_HEIGHT) info.height = readUint(bytes, vc.contentStart, vcEnd);
              v = vcEnd;
            }
          }
          q = childEnd;
        }
        if (info.number >= 0) tracks.push(info);
      }
      p = entryEnd;
    }
    video = tracks.find((t) => t.type === TRACK_TYPE_VIDEO) ?? null;
  };

  /** Records one (Simple)Block of the video track. Returns false when the buffer ends inside it. */
  const readBlock = (start: number, declaredEnd: number, clusterTimecode: number, simple: boolean, keyFromGroup: boolean): boolean => {
    if (declaredEnd > limit) {
      truncated = true;
      return false;
    }
    const trackVint = readVint(bytes, start, declaredEnd);
    if (!trackVint) return true;
    const videoTrack = video as TrackInfo | null;
    if (!videoTrack || trackVint.value !== videoTrack.number) return true;
    const relPos = start + trackVint.length;
    if (relPos + 3 > declaredEnd) return true;
    let rel = (bytes[relPos] << 8) | bytes[relPos + 1];
    if (rel & 0x8000) rel -= 0x10000;
    const flags = bytes[relPos + 2];
    const lacing = (flags >> 1) & 0x03;
    if (lacing !== 0) {
      unsupported = 'laced video blocks';
      return true;
    }
    const dataStart = relPos + 3;
    const length = declaredEnd - dataStart;
    if (length <= 0) return true;
    const timestampNs = (clusterTimecode + rel) * timecodeScale;
    frames.push({
      timestampUs: Math.round(timestampNs / 1000),
      keyframe: simple ? (flags & 0x80) !== 0 : keyFromGroup,
      invisible: (flags & 0x08) !== 0,
      offset: dataStart,
      length,
    });
    return true;
  };

  let current = segment.contentStart;
  const segmentEnd = Math.min(segment.declaredEnd, limit);
  outer: while (current < segmentEnd) {
    const el = readHeader(bytes, current, segmentEnd);
    if (!el) break;
    const elEnd = Math.min(el.declaredEnd, segmentEnd);

    if (el.id === INFO) {
      let q = el.contentStart;
      while (q < elEnd) {
        const child = readHeader(bytes, q, elEnd);
        if (!child || child.unknownSize) break;
        const childEnd = Math.min(child.declaredEnd, elEnd);
        if (child.id === TIMECODE_SCALE) {
          const scale = readUint(bytes, child.contentStart, childEnd);
          if (scale > 0) timecodeScale = scale;
        }
        q = childEnd;
      }
    } else if (el.id === TRACKS) {
      parseTracks(el.contentStart, elEnd);
    } else if (el.id === CLUSTER) {
      let clusterTimecode = 0;
      let c = el.contentStart;
      while (c < elEnd) {
        const child = readHeader(bytes, c, segmentEnd);
        if (!child) break;
        // An unknown-size Cluster ends where the next level-1 element begins.
        if (el.unknownSize && LEVEL1_IDS.has(child.id)) {
          current = c;
          continue outer;
        }
        if (child.unknownSize) break outer;
        if (child.id === TIMECODE) {
          clusterTimecode = readUint(bytes, child.contentStart, Math.min(child.declaredEnd, limit));
        } else if (child.id === SIMPLE_BLOCK) {
          if (!readBlock(child.contentStart, child.declaredEnd, clusterTimecode, true, false)) break outer;
        } else if (child.id === BLOCK_GROUP) {
          if (child.declaredEnd > limit) {
            truncated = true;
            break outer;
          }
          let blockStart = -1;
          let blockEnd = -1;
          let referenced = false;
          let g = child.contentStart;
          while (g < child.declaredEnd) {
            const grand = readHeader(bytes, g, child.declaredEnd);
            if (!grand || grand.unknownSize) break;
            if (grand.id === BLOCK) {
              blockStart = grand.contentStart;
              blockEnd = grand.declaredEnd;
            } else if (grand.id === REFERENCE_BLOCK) {
              referenced = true;
            }
            g = grand.declaredEnd;
          }
          if (blockStart >= 0 && !readBlock(blockStart, blockEnd, clusterTimecode, false, !referenced)) break outer;
        }
        if (child.declaredEnd > limit) {
          truncated = true;
          break outer;
        }
        c = child.declaredEnd;
      }
      if (el.unknownSize) break;
    }

    if (el.unknownSize) break;
    if (el.declaredEnd > limit) {
      truncated = true;
      break;
    }
    current = el.declaredEnd;
  }

  const track = video as TrackInfo | null;
  if (!track) return { ok: false, reason: 'no video track' };
  if (unsupported) return { ok: false, reason: unsupported };
  if (frames.length === 0) return { ok: false, reason: 'the video track has no frames' };
  return {
    ok: true,
    track: {
      trackNumber: track.number,
      codecId: track.codecId,
      codecPrivate: track.codecPrivate,
      width: track.width,
      height: track.height,
      frames,
      truncated,
    },
  };
}

/**
 * WebCodecs decoder config for a demuxed track, or null when the codec is not
 * one this path handles (the caller then keeps the <video> path).
 */
export function webmVideoDecoderConfig(track: WebmVideoTrack): VideoDecoderConfig | null {
  const sized = (config: VideoDecoderConfig): VideoDecoderConfig => {
    if (track.width && track.height) {
      config.codedWidth = track.width;
      config.codedHeight = track.height;
    }
    return config;
  };
  switch (track.codecId) {
    case 'V_VP8':
      return sized({ codec: 'vp8' });
    case 'V_VP9':
      // MediaRecorder writes VP9 profile 0, 8 bit.
      return sized({ codec: 'vp09.00.10.08' });
    case 'V_MPEG4/ISO/AVC': {
      const avcc = track.codecPrivate;
      if (!avcc || avcc.length < 7 || avcc[0] !== 1) return null;
      const hex = (b: number) => b.toString(16).padStart(2, '0');
      return sized({ codec: `avc1.${hex(avcc[1])}${hex(avcc[2])}${hex(avcc[3])}`, description: avcc });
    }
    default:
      return null;
  }
}
