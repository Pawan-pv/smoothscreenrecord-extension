import { TelemetryData } from '../types/telemetry';

const VIDEO_FILE_NAME = 'smoothstudio_recording.webm';
const TELEMETRY_FILE_NAME = 'smoothstudio_telemetry.json';

// In-memory fallback if OPFS is unavailable
let memoryVideoChunks: Blob[] = [];
let memoryTelemetry: TelemetryData | null = null;
let opfsWritable: FileSystemWritableFileStream | null = null;
let useOpfs = true;

export async function isOpfsSupported(): Promise<boolean> {
  return typeof navigator !== 'undefined' && !!navigator.storage && typeof navigator.storage.getDirectory === 'function';
}

export async function initStorage(): Promise<void> {
  memoryVideoChunks = [];
  memoryTelemetry = null;

  try {
    if (await isOpfsSupported()) {
      const root = await navigator.storage.getDirectory();
      const videoHandle = await root.getFileHandle(VIDEO_FILE_NAME, { create: true });
      opfsWritable = await videoHandle.createWritable();
      useOpfs = true;
      console.log('[SmoothStudio OPFS] Storage initialized successfully on disk.');
      return;
    }
  } catch (err) {
    console.warn('[SmoothStudio OPFS] OPFS unavailable, falling back to memory chunks:', err);
  }

  useOpfs = false;
}

export async function appendVideoChunk(chunk: Blob): Promise<void> {
  if (useOpfs && opfsWritable) {
    try {
      await opfsWritable.write(chunk);
      return;
    } catch (err) {
      console.warn('[SmoothStudio OPFS] Error writing chunk to disk, falling back to RAM:', err);
      useOpfs = false;
    }
  }

  memoryVideoChunks.push(chunk);
}

export async function finalizeVideo(): Promise<void> {
  if (useOpfs && opfsWritable) {
    try {
      await opfsWritable.close();
      opfsWritable = null;
      console.log('[SmoothStudio OPFS] Video file finalized on disk.');
    } catch (err) {
      console.warn('[SmoothStudio OPFS] Error closing OPFS stream:', err);
    }
  }
}

export async function saveTelemetry(telemetry: TelemetryData): Promise<void> {
  memoryTelemetry = telemetry;

  if (await isOpfsSupported()) {
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(TELEMETRY_FILE_NAME, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(telemetry));
      await writable.close();
      console.log('[SmoothStudio OPFS] Telemetry saved to disk.');
      return;
    } catch (err) {
      console.warn('[SmoothStudio OPFS] Could not write telemetry to OPFS:', err);
    }
  }

  // Fallback to localStorage or chrome.storage
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [TELEMETRY_FILE_NAME]: telemetry });
    } else {
      localStorage.setItem(TELEMETRY_FILE_NAME, JSON.stringify(telemetry));
    }
  } catch (err) {
    console.warn('[SmoothStudio] Fallback storage failed:', err);
  }
}

export async function getRecordingBlob(): Promise<Blob | null> {
  if (await isOpfsSupported()) {
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(VIDEO_FILE_NAME);
      const file = await fileHandle.getFile();
      if (file && file.size > 0) {
        return file;
      }
    } catch {
      // Fallback
    }
  }

  if (memoryVideoChunks.length > 0) {
    return new Blob(memoryVideoChunks, { type: 'video/webm' });
  }

  return null;
}

export async function loadTelemetry(): Promise<TelemetryData | null> {
  if (await isOpfsSupported()) {
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(TELEMETRY_FILE_NAME);
      const file = await fileHandle.getFile();
      const text = await file.text();
      return JSON.parse(text) as TelemetryData;
    } catch {
      // Fallback
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    const data = await chrome.storage.local.get(['smoothstudio_telemetry', TELEMETRY_FILE_NAME]);
    if (data && data.smoothstudio_telemetry) {
      return data.smoothstudio_telemetry as TelemetryData;
    }
    if (data && data[TELEMETRY_FILE_NAME]) {
      return data[TELEMETRY_FILE_NAME] as TelemetryData;
    }
  }

  try {
    const stored = localStorage.getItem(TELEMETRY_FILE_NAME);
    if (stored) return JSON.parse(stored) as TelemetryData;
  } catch {
    // Ignore
  }

  return memoryTelemetry;
}

export async function clearAllStorage(): Promise<void> {
  memoryVideoChunks = [];
  memoryTelemetry = null;
  if (opfsWritable) {
    try { await opfsWritable.close(); } catch { /* ignore */ }
    opfsWritable = null;
  }

  if (await isOpfsSupported()) {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(VIDEO_FILE_NAME).catch(() => {});
      await root.removeEntry(TELEMETRY_FILE_NAME).catch(() => {});
    } catch {
      // Ignore
    }
  }
}
