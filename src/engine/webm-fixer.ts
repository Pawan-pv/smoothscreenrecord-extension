/**
 * Lightweight EBML WebM Duration Patcher
 * Injects or updates the Matroska Segment Info Duration element (0x4489)
 * so that Chrome's HTMLVideoElement and ffprobe report the exact duration
 * rather than duration=Infinity or duration=N/A.
 */

function readVint(buffer: Uint8Array, offset: number): { length: number; value: number } | null {
  const firstByte = buffer[offset];
  if (firstByte === undefined) return null;
  let length = 1;
  let mask = 0x80;
  while ((firstByte & mask) === 0 && length < 8) {
    length++;
    mask >>= 1;
  }
  if (length > 8) return null;

  let value = firstByte & (mask - 1);
  for (let i = 1; i < length; i++) {
    value = (value << 8) | buffer[offset + i];
  }
  return { length, value };
}

function readUInt32(buffer: Uint8Array, offset: number): number {
  return (
    ((buffer[offset] << 24) >>> 0) +
    (buffer[offset + 1] << 16) +
    (buffer[offset + 2] << 8) +
    buffer[offset + 3]
  );
}

function readUInt16(buffer: Uint8Array, offset: number): number {
  return (buffer[offset] << 8) | buffer[offset + 1];
}

export async function patchWebmBlobDuration(blob: Blob, durationMs: number): Promise<Blob> {
  if (!blob || blob.size < 32 || durationMs <= 0) return blob;

  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // 1. Validate EBML Header ID (0x1A 0x45 0xDF 0xA3)
  if (readUInt32(bytes, 0) !== 0x1A45DFA3) {
    return blob;
  }

  // 2. Find Segment (0x18 0x53 0x80 0x67)
  let pos = 4;
  const ebmlHeaderLen = readVint(bytes, pos);
  if (!ebmlHeaderLen) return blob;
  pos += ebmlHeaderLen.length + ebmlHeaderLen.value;

  if (pos + 4 > bytes.length || readUInt32(bytes, pos) !== 0x18538067) {
    return blob;
  }
  pos += 4;
  const segmentLenVint = readVint(bytes, pos);
  if (!segmentLenVint) return blob;
  pos += segmentLenVint.length;

  // 3. Search inside Segment for Info element (0x15 0x49 0xA9 0x66)
  let infoPos = -1;
  let infoLen: { length: number; value: number } | null = null;
  while (pos < bytes.length - 8) {
    const id = readUInt32(bytes, pos);
    if (id === 0x1549A966) {
      infoPos = pos;
      pos += 4;
      infoLen = readVint(bytes, pos);
      break;
    }
    pos++;
  }

  if (infoPos === -1 || !infoLen) {
    return blob;
  }

  const infoContentPos = pos + infoLen.length;
  const infoEnd = infoContentPos + infoLen.value;

  // 4. Look for TimecodeScale (0x2AD7B1) and Duration (0x4489)
  let timecodeScale = 1_000_000; // default 1ms
  let durationPos = -1;
  let current = infoContentPos;

  while (current < infoEnd) {
    // 3-byte ID for TimecodeScale: 0x2A 0xD7 0xB1
    if (
      current + 3 <= infoEnd &&
      bytes[current] === 0x2A &&
      bytes[current + 1] === 0xD7 &&
      bytes[current + 2] === 0xB1
    ) {
      current += 3;
      const v = readVint(bytes, current);
      if (!v) break;
      current += v.length;
      let scaleVal = 0;
      for (let i = 0; i < v.value; i++) {
        scaleVal = (scaleVal << 8) | bytes[current + i];
      }
      if (scaleVal > 0) timecodeScale = scaleVal;
      current += v.value;
      continue;
    }

    // 2-byte ID for Duration: 0x44 0x89
    if (current + 2 <= infoEnd && readUInt16(bytes, current) === 0x4489) {
      durationPos = current;
      break;
    }

    current++;
  }

  const durationValInScale = (durationMs * 1_000_000) / timecodeScale;

  // 5. If Duration element already exists in Info, overwrite float64/float32
  if (durationPos !== -1) {
    const durVint = readVint(bytes, durationPos + 2);
    if (!durVint) return blob;
    const floatLen = durVint.value;
    const floatOffset = durationPos + 2 + durVint.length;
    const patchedBuf = new ArrayBuffer(arrayBuffer.byteLength);
    new Uint8Array(patchedBuf).set(bytes);
    const view = new DataView(patchedBuf);

    if (floatLen === 4) {
      view.setFloat32(floatOffset, durationValInScale, false); // Big-Endian
    } else if (floatLen === 8) {
      view.setFloat64(floatOffset, durationValInScale, false); // Big-Endian
    }
    return new Blob([patchedBuf], { type: blob.type || 'video/webm' });
  }

  // 6. If Duration does not exist, insert it into Info
  // Duration element: ID 0x44 0x89 (2 bytes), VINT size 0x88 (8 bytes float), 8 bytes IEEE-754 double
  const durElement = new Uint8Array(11);
  durElement[0] = 0x44;
  durElement[1] = 0x89;
  durElement[2] = 0x88;
  new DataView(durElement.buffer).setFloat64(3, durationValInScale, false);

  // New Info length
  const newInfoLen = infoLen.value + 11;
  let newInfoLenVint: Uint8Array;
  if (infoLen.length === 1 && newInfoLen < 127) {
    newInfoLenVint = new Uint8Array([0x80 | newInfoLen]);
  } else if (infoLen.length === 2 && newInfoLen < 16383) {
    newInfoLenVint = new Uint8Array([0x40 | (newInfoLen >> 8), newInfoLen & 0xff]);
  } else {
    newInfoLenVint = new Uint8Array([
      0x10 | ((newInfoLen >> 24) & 0x0f),
      (newInfoLen >> 16) & 0xff,
      (newInfoLen >> 8) & 0xff,
      newInfoLen & 0xff
    ]);
  }

  const totalLength = (infoPos + 4) + newInfoLenVint.length + (infoEnd - infoContentPos) + 11 + (bytes.length - infoEnd);
  const result = new Uint8Array(totalLength);
  let w = 0;

  // [0 .. infoPos + 4]
  result.set(bytes.subarray(0, infoPos + 4), w);
  w += infoPos + 4;

  // [newInfoLenVint]
  result.set(newInfoLenVint, w);
  w += newInfoLenVint.length;

  // [infoContent .. infoEnd]
  result.set(bytes.subarray(infoContentPos, infoEnd), w);
  w += infoEnd - infoContentPos;

  // [durElement]
  result.set(durElement, w);
  w += durElement.length;

  // [infoEnd .. end of file]
  result.set(bytes.subarray(infoEnd), w);

  return new Blob([result], { type: blob.type || 'video/webm' });
}
