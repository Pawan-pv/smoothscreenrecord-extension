import type { BackgroundEffects, BackgroundSpec } from '../types/telemetry';
import { DEFAULT_BACKGROUND_EFFECTS } from '../types/telemetry';
import { getWallpaper } from '../engine/wallpapers';

/**
 * Remembers the editor's background between sessions, locally in this browser
 * (never uploaded anywhere): the last choice in localStorage, uploaded images in
 * IndexedDB.
 */

const CHOICE_KEY = 'smoothstudio.background';
const DB_NAME = 'smoothstudio-backgrounds';
const STORE = 'uploads';
/** Recent uploads kept; older ones are removed. */
export const MAX_RECENT_UPLOADS = 8;
/** Largest image file accepted. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Uploads are stored at most this large on their long side (enough for a 4K export). */
const MAX_UPLOAD_SIDE = 3840;

export interface StoredUpload {
  id: string;
  blob: Blob;
  name: string;
  addedAt: number;
}

// ---------------------------------------------------------------- the choice

const HEX = /^#[0-9a-f]{3,8}$/i;
const clamp100 = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : fallback);

/** A stored spec, checked: anything unknown or malformed is null. */
export function sanitizeBackgroundSpec(raw: unknown): BackgroundSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  switch (s.kind) {
    case 'backdrop':
      return { kind: 'backdrop' };
    case 'solid':
      return typeof s.color === 'string' && HEX.test(s.color) ? { kind: 'solid', color: s.color } : null;
    case 'gradient': {
      const colors = Array.isArray(s.colors) ? s.colors.filter((c): c is string => typeof c === 'string' && HEX.test(c)).slice(0, 3) : [];
      if (colors.length < 1) return null;
      const angle = typeof s.angle === 'number' && Number.isFinite(s.angle) ? s.angle : 135;
      return { kind: 'gradient', colors, angle, shape: s.shape === 'radial' ? 'radial' : 'linear' };
    }
    case 'wallpaper':
      return typeof s.id === 'string' && getWallpaper(s.id) ? { kind: 'wallpaper', id: s.id } : null;
    case 'image':
      return typeof s.uploadId === 'string' && s.uploadId ? { kind: 'image', uploadId: s.uploadId } : null;
    default:
      return null;
  }
}

export function loadBackgroundChoice(): { spec: BackgroundSpec; effects: BackgroundEffects } {
  const fallback = { spec: { kind: 'backdrop' } as BackgroundSpec, effects: { ...DEFAULT_BACKGROUND_EFFECTS } };
  try {
    const saved = JSON.parse(localStorage.getItem(CHOICE_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return fallback;
    return {
      spec: sanitizeBackgroundSpec(saved.spec) ?? fallback.spec,
      effects: {
        blur: clamp100(saved.effects?.blur, DEFAULT_BACKGROUND_EFFECTS.blur),
        dim: clamp100(saved.effects?.dim, DEFAULT_BACKGROUND_EFFECTS.dim),
        motion: clamp100(saved.effects?.motion, DEFAULT_BACKGROUND_EFFECTS.motion)
      }
    };
  } catch {
    return fallback;
  }
}

export function saveBackgroundChoice(spec: BackgroundSpec, effects: BackgroundEffects): void {
  try {
    // A session-only image (storage unavailable when it was added) cannot come back.
    const stored = spec.kind === 'image' && spec.uploadId === 'session' ? { kind: 'backdrop' } : spec;
    localStorage.setItem(CHOICE_KEY, JSON.stringify({ spec: stored, effects }));
  } catch {
    // Storage full or blocked: the choice is simply not remembered.
  }
}

// ---------------------------------------------------------------- uploads

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open the background store'));
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then((db) => new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = work(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('Background store error')); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('Background store aborted')); };
  }));
}

/** Newest first. */
export async function listUploads(): Promise<StoredUpload[]> {
  const all = (await run<StoredUpload[]>('readonly', (store) => store.getAll() as IDBRequest<StoredUpload[]>)) || [];
  return all.filter((u) => u && u.blob instanceof Blob).sort((a, b) => b.addedAt - a.addedAt);
}

export async function getUpload(id: string): Promise<StoredUpload | null> {
  const found = await run<StoredUpload>('readonly', (store) => store.get(id) as IDBRequest<StoredUpload>);
  return found && found.blob instanceof Blob ? found : null;
}

export async function deleteUpload(id: string): Promise<void> {
  await run('readwrite', (store) => { store.delete(id); });
}

/** Decodes an image file; one larger than MAX_UPLOAD_SIDE is scaled down (WebP). */
async function prepareImage(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!(w > 0) || !(h > 0)) throw new Error('The image has no size');
    const scale = Math.min(1, MAX_UPLOAD_SIDE / Math.max(w, h));
    if (scale >= 1) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92));
    return out || file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Why a file cannot be a background, or null when it can. */
export function rejectUpload(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith('image/')) return 'That file is not an image.';
  if (file.size > MAX_UPLOAD_BYTES) return `Images up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB are supported.`;
  return null;
}

/**
 * Checks, decodes (scaling down a huge one) and stores an image; keeps the newest
 * MAX_RECENT_UPLOADS. Throws with a message for the user when the file is unusable.
 * When storage itself is unavailable the image is still returned, as 'session' only.
 */
export async function addUpload(file: File): Promise<{ upload: StoredUpload; persisted: boolean }> {
  const reason = rejectUpload(file);
  if (reason) throw new Error(reason);
  let blob: Blob;
  try {
    blob = await prepareImage(file);
  } catch {
    throw new Error('The image could not be read.');
  }
  const upload: StoredUpload = {
    id: `bg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    blob,
    name: file.name || 'Pasted image',
    addedAt: Date.now()
  };
  try {
    await run('readwrite', (store) => { store.put(upload); });
    const all = await listUploads();
    for (const old of all.slice(MAX_RECENT_UPLOADS)) await deleteUpload(old.id);
    return { upload, persisted: true };
  } catch {
    return { upload: { ...upload, id: 'session' }, persisted: false };
  }
}
