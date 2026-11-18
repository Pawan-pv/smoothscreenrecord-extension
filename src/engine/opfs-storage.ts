import { TelemetryData } from '../types/telemetry';
import { diagnosticChannel } from './diagnostic-channel';

/**
 * Recording storage (spec item 1: OPFS with an IndexedDB / memory fallback).
 *
 * DURABILITY: a FileSystemWritableFileStream only commits on close() (Chromium
 * writes to a .crswap file first), so streaming a whole recording into one
 * open writable loses EVERYTHING when the editor renderer dies. Every encoded
 * chunk (one per MediaRecorder timeslice) is therefore committed as its own
 * small file / IndexedDB record. A crash loses at most the chunk in flight.
 *
 * SESSIONS: every recording has a session id. The live session is described by
 * a manifest in localStorage (synchronous, survives a renderer crash). The
 * committed recording ("final") remembers which session it belongs to, and
 * telemetry is only ever handed out for its own session.
 */

export type StorageBackend = 'opfs' | 'idb' | 'ram';
export type SessionStatus = 'recording' | 'stopping' | 'finalized' | 'recovered';

export interface SessionManifest {
  id: string;
  status: SessionStatus;
  backend: StorageBackend;
  startedAt: number;
  /** Wall-clock epoch of the first captured frame (timeline zero). */
  originEpoch: number;
  /** Wall-clock epoch at which the last chunk was committed. */
  lastChunkAt: number;
  chunkCount: number;
}

export interface FinalRecordingInfo {
  id: string;
  backend: StorageBackend;
  size: number;
  committedAt: number;
}

const FINAL_VIDEO = 'smoothstudio_recording.webm';
const TELEMETRY_FILE = 'smoothstudio_telemetry.json';
const PART_PREFIX = 'smoothstudio_part_';
const MANIFEST_KEY = 'smoothstudio_session_manifest';
const FINAL_KEY = 'smoothstudio_final_recording';
const IDB_NAME = 'smoothstudio-recordings';
const IDB_PARTS = 'parts';
const IDB_FINAL = 'final';

let forceRam = false;
let active: SessionManifest | null = null;
let writeQueue: Promise<void> = Promise.resolve();
/** Where each chunk of the ACTIVE session lives (a failed disk write falls back to RAM). */
let chunkHome: StorageBackend[] = [];
const ramChunks = new Map<number, Blob>();
let ramFinal: { id: string; blob: Blob } | null = null;
let memoryTelemetry: TelemetryData | null = null;

/* ----------------------------------------------------------- small helpers */

export function newSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* fall through */ }
  return 'ss-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
}

const partName = (sid: string, idx: number) => `${PART_PREFIX}${sid}_${String(idx).padStart(6, '0')}.webm`;
const partIndex = (name: string, sid: string): number | null => {
  const prefix = `${PART_PREFIX}${sid}_`;
  if (!name.startsWith(prefix)) return null;
  const n = parseInt(name.slice(prefix.length), 10);
  return Number.isFinite(n) ? n : null;
};

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}
function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full / unavailable */ }
}

function persistManifest(): void {
  if (active) writeJson(MANIFEST_KEY, active);
}

export function readSessionManifest(): SessionManifest | null {
  return readJson<SessionManifest>(MANIFEST_KEY);
}

export function readFinalRecordingInfo(): FinalRecordingInfo | null {
  return readJson<FinalRecordingInfo>(FINAL_KEY);
}

/** The session id the committed recording belongs to (null if none). */
export function getFinalSessionId(): string | null {
  return readFinalRecordingInfo()?.id ?? null;
}

export function getActiveSession(): SessionManifest | null {
  return active ? { ...active } : null;
}

export async function isOpfsSupported(): Promise<boolean> {
  return typeof navigator !== 'undefined' && !!navigator.storage && typeof navigator.storage.getDirectory === 'function';
}

async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (!(await isOpfsSupported())) return null;
  try { return await navigator.storage.getDirectory(); } catch { return null; }
}

async function opfsWrite(root: FileSystemDirectoryHandle, name: string, data: Blob | string): Promise<void> {
  const handle = await root.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
    await writable.close(); // the commit point
  } catch (err) {
    try { await (writable as any).abort?.(); } catch { /* ignore */ }
    throw err;
  }
}

async function opfsNames(root: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  const it = (root as any).keys?.();
  if (!it) return names;
  for await (const name of it as AsyncIterable<string>) names.push(name);
  return names;
}

/* --------------------------------------------------------------- IndexedDB */

function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && !!indexedDB && typeof indexedDB.open === 'function';
}

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_PARTS)) db.createObjectStore(IDB_PARTS);
      if (!db.objectStoreNames.contains(IDB_FINAL)) db.createObjectStore(IDB_FINAL);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbTx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await idbOpen();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      let result: T | undefined;
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function idbPartKeys(sid: string): Promise<number[]> {
  const keys = (await idbTx<IDBValidKey[]>(IDB_PARTS, 'readonly', (s) => s.getAllKeys())) || [];
  return keys
    .map((k) => (Array.isArray(k) && k[0] === sid ? Number(k[1]) : null))
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
}

/* ----------------------------------------------------------- backend probe */

async function chooseBackend(): Promise<StorageBackend> {
  if (forceRam || diagnosticChannel.getStorageMode() === 'ram') return 'ram';
  const root = await opfsRoot();
  if (root) {
    try {
      // A real write proves the backend works (quota, policy, permissions).
      await opfsWrite(root, `${PART_PREFIX}probe.tmp`, 'ok');
      await root.removeEntry(`${PART_PREFIX}probe.tmp`).catch(() => undefined);
      return 'opfs';
    } catch (err: any) {
      console.warn('[SmoothStudio Storage] OPFS not writable, trying IndexedDB:', err?.message || err);
      diagnosticChannel.recordStorageCap(err?.message || String(err));
    }
  }
  if (idbAvailable()) {
    try {
      await idbTx(IDB_PARTS, 'readonly', (s) => s.count());
      return 'idb';
    } catch (err: any) {
      console.warn('[SmoothStudio Storage] IndexedDB unavailable, using memory:', err?.message || err);
    }
  }
  return 'ram';
}

/* ------------------------------------------------------------ public API */

export function setUseOpfs(enabled: boolean): void {
  forceRam = !enabled;
  diagnosticChannel.setStorageMode(enabled ? 'opfs' : 'ram');
}

export function isUseOpfs(): boolean {
  return !forceRam && (active ? active.backend === 'opfs' : true);
}

/**
 * Starts a new recording session. Nothing of the previous recording is
 * touched: it stays THE recording until the new one is committed.
 */
export async function initStorage(sessionId?: string): Promise<SessionManifest> {
  await writeQueue.catch(() => undefined);
  writeQueue = Promise.resolve();
  chunkHome = [];
  ramChunks.clear();
  const backend = await chooseBackend();
  const now = Date.now();
  active = {
    id: sessionId || newSessionId(),
    status: 'recording',
    backend,
    startedAt: now,
    originEpoch: 0,
    lastChunkAt: now,
    chunkCount: 0
  };
  persistManifest();
  console.log(`[SmoothStudio Storage] session ${active.id} started on ${backend}`);
  return { ...active };
}

export function setSessionOrigin(originEpoch: number): void {
  if (!active) return;
  active.originEpoch = originEpoch;
  persistManifest();
}

export function appendVideoChunk(chunk: Blob): Promise<void> {
  // The chunk stream is closed once the session stops: a late frame (a pump
  // that was not stopped yet) must not extend the recording that is being
  // finalized/committed.
  if (!active || active.status !== 'recording') return Promise.resolve();
  const session = active;
  const idx = chunkHome.length;
  chunkHome.push(session.backend);
  const job = async () => {
    let home: StorageBackend = session.backend;
    try {
      if (home === 'opfs') {
        const root = await opfsRoot();
        if (!root) throw new Error('OPFS root unavailable');
        await opfsWrite(root, partName(session.id, idx), chunk);
      } else if (home === 'idb') {
        await idbTx(IDB_PARTS, 'readwrite', (s) => s.put(chunk, [session.id, idx]));
      } else {
        ramChunks.set(idx, chunk);
      }
    } catch (err: any) {
      console.warn(`[SmoothStudio Storage] chunk ${idx} could not be written to ${home}, keeping it in memory:`, err?.message || err);
      diagnosticChannel.recordStorageCap(err?.message || String(err));
      home = 'ram';
      ramChunks.set(idx, chunk);
    }
    chunkHome[idx] = home;
    if (active === session) {
      session.chunkCount = Math.max(session.chunkCount, idx + 1);
      session.lastChunkAt = Date.now();
      persistManifest();
    }
  };
  writeQueue = writeQueue.then(job, job);
  return writeQueue;
}

/** Waits for every pending chunk write. The session is now "stopping". */
export async function finalizeVideo(): Promise<void> {
  await writeQueue.catch(() => undefined);
  if (active && active.status === 'recording') {
    active.status = 'stopping';
    persistManifest();
  }
}

async function assembleChunks(sid: string, backend: StorageBackend, homes?: StorageBackend[]): Promise<Blob | null> {
  const parts: Blob[] = [];
  if (homes) {
    // live session of this page: every chunk's location is known
    const root = homes.includes('opfs') ? await opfsRoot() : null;
    for (let i = 0; i < homes.length; i++) {
      const home = homes[i];
      try {
        if (home === 'opfs' && root) parts.push(await (await root.getFileHandle(partName(sid, i))).getFile());
        else if (home === 'idb') {
          const b = await idbTx<Blob>(IDB_PARTS, 'readonly', (s) => s.get([sid, i]));
          if (b) parts.push(b);
        } else {
          const b = ramChunks.get(i);
          if (b) parts.push(b);
        }
      } catch (err) {
        console.warn(`[SmoothStudio Storage] chunk ${i} of ${sid} is missing:`, err);
      }
    }
  } else if (backend === 'opfs') {
    // after a crash: whatever was committed, in index order
    const root = await opfsRoot();
    if (!root) return null;
    const names = (await opfsNames(root))
      .map((n) => ({ n, i: partIndex(n, sid) }))
      .filter((x): x is { n: string; i: number } => x.i !== null)
      .sort((a, b) => a.i - b.i);
    for (const { n } of names) parts.push(await (await root.getFileHandle(n)).getFile());
  } else if (backend === 'idb') {
    for (const i of await idbPartKeys(sid)) {
      const b = await idbTx<Blob>(IDB_PARTS, 'readonly', (s) => s.get([sid, i]));
      if (b) parts.push(b);
    }
  }
  if (!parts.length) return null;
  return new Blob(parts, { type: 'video/webm' });
}

async function deleteChunks(sid: string): Promise<void> {
  const root = await opfsRoot();
  if (root) {
    for (const n of await opfsNames(root)) {
      if (partIndex(n, sid) !== null) await root.removeEntry(n).catch(() => undefined);
    }
  }
  if (idbAvailable()) {
    try {
      for (const i of await idbPartKeys(sid)) await idbTx(IDB_PARTS, 'readwrite', (s) => s.delete([sid, i]));
    } catch { /* ignore */ }
  }
  if (active?.id === sid) ramChunks.clear();
}

async function readFinal(): Promise<Blob | null> {
  const info = readFinalRecordingInfo();
  const backend = info?.backend;
  if (backend === 'ram' || (!info && ramFinal)) return ramFinal?.blob ?? null;
  if (backend === 'idb') {
    try {
      const rec = await idbTx<{ id: string; blob: Blob }>(IDB_FINAL, 'readonly', (s) => s.get('recording'));
      return rec?.blob ?? null;
    } catch { return null; }
  }
  const root = await opfsRoot();
  if (!root) return ramFinal?.blob ?? null;
  try {
    const file = await (await root.getFileHandle(FINAL_VIDEO)).getFile();
    return file.size > 0 ? file : null;
  } catch {
    return ramFinal?.blob ?? null;
  }
}

/**
 * The recording to show: the live/stopping session's own chunks while a
 * session is in progress in this page (null if it has none yet - the previous
 * recording is NEVER handed out instead), otherwise the committed recording.
 */
export async function getRecordingBlob(): Promise<Blob | null> {
  await writeQueue.catch(() => undefined);
  if (active && (active.status === 'recording' || active.status === 'stopping')) {
    return assembleChunks(active.id, active.backend, chunkHome);
  }
  return readFinal();
}

/**
 * Commits `blob` as THE recording of session `sessionId` (default: the active
 * one), then removes that session's temporary chunks.
 */
export async function commitRecording(blob: Blob, sessionId?: string): Promise<void> {
  await writeQueue.catch(() => undefined);
  const sid = sessionId || active?.id || newSessionId();
  const preferred: StorageBackend = active?.id === sid ? active.backend : (readSessionManifest()?.id === sid ? readSessionManifest()!.backend : 'opfs');
  let stored: StorageBackend = 'ram';
  if (preferred === 'opfs') {
    const root = await opfsRoot();
    if (root) {
      try { await opfsWrite(root, FINAL_VIDEO, blob); stored = 'opfs'; }
      catch (err) { console.warn('[SmoothStudio Storage] could not commit the recording to OPFS:', err); }
    }
  }
  if (stored === 'ram' && (preferred === 'idb' || preferred === 'opfs') && idbAvailable()) {
    try { await idbTx(IDB_FINAL, 'readwrite', (s) => s.put({ id: sid, blob }, 'recording')); stored = 'idb'; }
    catch (err) { console.warn('[SmoothStudio Storage] could not commit the recording to IndexedDB:', err); }
  }
  // Keep a memory copy only when nothing durable worked.
  ramFinal = stored === 'ram' ? { id: sid, blob } : null;
  writeJson(FINAL_KEY, { id: sid, backend: stored, size: blob.size, committedAt: Date.now() } satisfies FinalRecordingInfo);
  await deleteChunks(sid);
  if (active?.id === sid) {
    active.status = 'finalized';
    persistManifest();
    chunkHome = [];
  } else {
    const m = readSessionManifest();
    if (m && m.id === sid) writeJson(MANIFEST_KEY, { ...m, status: 'finalized' });
  }
  console.log(`[SmoothStudio Storage] recording ${sid} committed to ${stored} (${blob.size} bytes)`);
}

/** Backwards-compatible name used by the recorder. */
export async function overwriteRecordingBlob(blob: Blob): Promise<void> {
  return commitRecording(blob);
}

export interface RecoveredSession {
  sessionId: string;
  blob: Blob;
  durationMs: number;
  manifest: SessionManifest;
}

/**
 * Recovers a session that was interrupted (the editor that recorded it
 * crashed or was closed): assembles every committed chunk, optionally
 * transforms the result (duration patch) and commits it as THE recording.
 * A session that is still alive in another page is left alone.
 */
export async function recoverInterruptedSession(opts: {
  isSessionAlive: (sessionId: string) => Promise<boolean>;
  transform?: (blob: Blob, durationMs: number) => Promise<Blob>;
}): Promise<RecoveredSession | null> {
  const m = readSessionManifest();
  if (!m || (m.status !== 'recording' && m.status !== 'stopping')) return null;
  if (active && active.id === m.id) return null; // it is this page's own live session
  if (await opts.isSessionAlive(m.id)) return null;
  if (m.backend === 'ram') {
    writeJson(MANIFEST_KEY, { ...m, status: 'recovered' });
    return null; // memory died with the page
  }
  const raw = await assembleChunks(m.id, m.backend);
  if (!raw || raw.size === 0) {
    writeJson(MANIFEST_KEY, { ...m, status: 'recovered' });
    return null;
  }
  const durationMs = m.originEpoch > 0 ? Math.max(0, m.lastChunkAt - m.originEpoch) : Math.max(0, m.lastChunkAt - m.startedAt);
  let blob = raw;
  if (opts.transform) {
    try { blob = (await opts.transform(raw, durationMs)) || raw; } catch (err) { console.warn('[SmoothStudio Storage] recovery transform failed:', err); }
  }
  await commitRecording(blob, m.id);
  const recovered: SessionManifest = { ...m, status: 'recovered' };
  writeJson(MANIFEST_KEY, recovered);
  console.log(`[SmoothStudio Storage] recovered interrupted session ${m.id}: ${blob.size} bytes, ~${durationMs} ms`);
  return { sessionId: m.id, blob, durationMs, manifest: recovered };
}

/* ------------------------------------------------- session liveness (locks) */

const lockName = (sid: string) => `smoothstudio-recording-${sid}`;

/** Holds a Web Lock for the session while this page records it. Returns the release function. */
export function holdSessionLock(sid: string): () => void {
  let release: () => void = () => undefined;
  try {
    const locks = (navigator as any).locks;
    if (locks?.request) {
      const held = new Promise<void>((r) => { release = r; });
      locks.request(lockName(sid), () => held).catch(() => undefined);
    }
  } catch { /* no Web Locks */ }
  return () => release();
}

/** True while some page (alive) holds the session's lock. */
export async function isSessionLockHeld(sid: string): Promise<boolean> {
  try {
    const locks = (navigator as any).locks;
    if (!locks?.query) return false;
    const snapshot = await locks.query();
    return (snapshot.held || []).some((l: any) => l.name === lockName(sid));
  } catch { return false; }
}

/* ---------------------------------------------------------------- telemetry */

export async function saveTelemetry(telemetry: TelemetryData): Promise<void> {
  memoryTelemetry = telemetry;
  const root = await opfsRoot();
  if (root) {
    try {
      await opfsWrite(root, TELEMETRY_FILE, JSON.stringify(telemetry));
    } catch (err) {
      console.warn('[SmoothStudio Storage] could not write telemetry to OPFS:', err);
    }
  }
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ smoothstudio_telemetry: telemetry, [TELEMETRY_FILE]: telemetry });
    } else {
      localStorage.setItem(TELEMETRY_FILE, JSON.stringify(telemetry));
    }
  } catch (err) {
    console.warn('[SmoothStudio Storage] fallback telemetry storage failed:', err);
  }
}

const sessionOf = (t: TelemetryData | null | undefined) => t?.metadata?.sessionId || null;

/**
 * Persisted telemetry. With a session id only telemetry of THAT session is
 * returned (null otherwise): telemetry of another recording is never handed out.
 */
export async function loadTelemetry(sessionId?: string | null): Promise<TelemetryData | null> {
  const candidates: TelemetryData[] = [];
  const root = await opfsRoot();
  if (root) {
    try {
      const text = await (await (await root.getFileHandle(TELEMETRY_FILE)).getFile()).text();
      if (text) candidates.push(JSON.parse(text) as TelemetryData);
    } catch { /* none */ }
  }
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const data: Record<string, any> = await chrome.storage.local.get(['smoothstudio_telemetry', TELEMETRY_FILE]);
      if (data?.smoothstudio_telemetry) candidates.push(data.smoothstudio_telemetry as TelemetryData);
      if (data?.[TELEMETRY_FILE]) candidates.push(data[TELEMETRY_FILE] as TelemetryData);
    }
  } catch { /* none */ }
  try {
    const stored = localStorage.getItem(TELEMETRY_FILE);
    if (stored) candidates.push(JSON.parse(stored) as TelemetryData);
  } catch { /* none */ }
  if (memoryTelemetry) candidates.push(memoryTelemetry);

  const valid = candidates.filter((t) => t && t.metadata);
  if (sessionId) return valid.find((t) => sessionOf(t) === sessionId) || null;
  return valid[0] || null;
}

export async function clearAllStorage(): Promise<void> {
  await writeQueue.catch(() => undefined);
  const sid = active?.id;
  if (sid) await deleteChunks(sid);
  active = null;
  chunkHome = [];
  ramChunks.clear();
  ramFinal = null;
  memoryTelemetry = null;
  try { localStorage.removeItem(MANIFEST_KEY); localStorage.removeItem(FINAL_KEY); } catch { /* ignore */ }
  const root = await opfsRoot();
  if (root) {
    await root.removeEntry(FINAL_VIDEO).catch(() => undefined);
    await root.removeEntry(TELEMETRY_FILE).catch(() => undefined);
  }
  if (idbAvailable()) {
    try { await idbTx(IDB_FINAL, 'readwrite', (s) => s.delete('recording')); } catch { /* ignore */ }
  }
}
