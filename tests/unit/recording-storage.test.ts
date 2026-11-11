/**
 * M1 — recording storage, session IDs and crash recovery (unit level).
 *
 * The fake OPFS below models the one property of the real
 * FileSystemWritableFileStream that matters for crash safety: what is written
 * is NOT visible in the file until close() commits it (Chromium writes to a
 * .crswap file and swaps it in on close). A renderer crash therefore loses
 * everything written to a stream that was never closed.
 *
 * "Crash" in these tests = the module is thrown away (vi.resetModules) without
 * finalize/close, exactly like a renderer that dies mid-recording. Only what
 * was committed to the fake disk and localStorage survives.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Disk = Map<string, Uint8Array>;

function makeFakeOpfs(disk: Disk) {
  const handle = (name: string) => ({
    kind: 'file',
    name,
    async getFile() {
      const bytes = disk.get(name);
      if (!bytes) throw new DOMException('not found', 'NotFoundError');
      return new File([bytes], name);
    },
    async createWritable(opts?: { keepExistingData?: boolean }) {
      let pending: Uint8Array[] = opts?.keepExistingData && disk.get(name) ? [disk.get(name)!] : [];
      let closed = false;
      return {
        async write(data: Blob | ArrayBuffer | Uint8Array | string) {
          if (closed) throw new TypeError('closed');
          let bytes: Uint8Array;
          if (data instanceof Blob) bytes = new Uint8Array(await data.arrayBuffer());
          else if (typeof data === 'string') bytes = new TextEncoder().encode(data);
          else bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
          pending.push(bytes);
        },
        async close() {
          closed = true;
          const total = pending.reduce((n, b) => n + b.length, 0);
          const out = new Uint8Array(total);
          let o = 0;
          for (const b of pending) { out.set(b, o); o += b.length; }
          disk.set(name, out); // commit happens ONLY here
          pending = [];
        },
        async abort() { closed = true; pending = []; }
      };
    }
  });
  const root = {
    kind: 'directory',
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      if (!disk.has(name)) {
        if (!opts?.create) throw new DOMException('not found', 'NotFoundError');
        disk.set(name, new Uint8Array(0));
      }
      return handle(name);
    },
    async removeEntry(name: string) {
      if (!disk.has(name)) throw new DOMException('not found', 'NotFoundError');
      disk.delete(name);
    },
    async *keys() { for (const k of Array.from(disk.keys())) yield k; },
    async *entries() { for (const k of Array.from(disk.keys())) yield [k, handle(k)]; }
  };
  return root;
}

function installOpfs(disk: Disk | null) {
  const storage: any = (navigator as any).storage || {};
  if (disk) {
    storage.getDirectory = async () => makeFakeOpfs(disk);
  } else {
    storage.getDirectory = async () => { throw new DOMException('OPFS blocked', 'SecurityError'); };
  }
  Object.defineProperty(navigator, 'storage', { value: storage, configurable: true });
}

const chunk = (s: string) => new Blob([s], { type: 'video/webm' });
const text = async (b: Blob | null) => (b ? await b.text() : null);
const committedBytes = (disk: Disk) =>
  Array.from(disk.entries()).reduce((n, [, b]) => n + b.length, 0);

async function freshStore() {
  vi.resetModules();
  return await import('../../src/engine/opfs-storage');
}

describe('M1 recording storage (OPFS, durability, session IDs, recovery)', () => {
  let disk: Disk;

  beforeEach(() => {
    disk = new Map();
    installOpfs(disk);
    localStorage.clear();
    // the IndexedDB fallback is exercised in the real browser (m1 idb fallback)
    (globalThis as any).indexedDB = undefined;
  });

  it('M1-05: every appended chunk is committed to OPFS while the recording is still running', async () => {
    const store = await freshStore();
    await store.initStorage('sess-A');
    await store.appendVideoChunk(chunk('AAAA'));
    await store.appendVideoChunk(chunk('BBBB'));
    await store.appendVideoChunk(chunk('CCCC'));
    // no finalizeVideo(): the recording is still live
    expect(committedBytes(disk), 'bytes committed to disk before stop').toBeGreaterThanOrEqual(12);
  });

  it('M1-05: the session manifest tracks the live session (id, status, chunk count)', async () => {
    const store = await freshStore();
    await store.initStorage('sess-B');
    await store.appendVideoChunk(chunk('x1'));
    await store.appendVideoChunk(chunk('x2'));
    const m = store.readSessionManifest();
    expect(m?.id).toBe('sess-B');
    expect(m?.status).toBe('recording');
    expect(m?.chunkCount).toBe(2);
    expect(m?.backend).toBe('opfs');
  });

  it('M1-06: after a crash the interrupted session is recovered from what was committed, in order', async () => {
    let store = await freshStore();
    await store.initStorage('sess-C');
    store.setSessionOrigin(Date.now() - 3000);
    await store.appendVideoChunk(chunk('one-'));
    await store.appendVideoChunk(chunk('two-'));
    await store.appendVideoChunk(chunk('three'));

    store = await freshStore(); // the renderer died: no finalize, no close
    const recovered = await store.recoverInterruptedSession({ isSessionAlive: async () => false });
    expect(recovered, 'an interrupted session must be recoverable').not.toBeNull();
    expect(recovered!.sessionId).toBe('sess-C');
    expect(await text(recovered!.blob)).toBe('one-two-three');
    expect(recovered!.durationMs).toBeGreaterThanOrEqual(2900);
    expect(store.readSessionManifest()?.status).toBe('recovered');
    // the recovered recording is now THE recording
    expect(await text(await store.getRecordingBlob())).toBe('one-two-three');
  });

  it('M1-06: a session that is still alive (another editor holds it) is never "recovered"', async () => {
    let store = await freshStore();
    await store.initStorage('sess-D');
    await store.appendVideoChunk(chunk('live'));
    store = await freshStore();
    const r = await store.recoverInterruptedSession({ isSessionAlive: async () => true });
    expect(r).toBeNull();
    expect(store.readSessionManifest()?.status).toBe('recording');
  });

  it('M1-06: a finalized session is not recovered again', async () => {
    let store = await freshStore();
    await store.initStorage('sess-E');
    await store.appendVideoChunk(chunk('done'));
    await store.finalizeVideo();
    await store.commitRecording(chunk('done'));
    store = await freshStore();
    expect(await store.recoverInterruptedSession({ isSessionAlive: async () => false })).toBeNull();
    expect(await text(await store.getRecordingBlob())).toBe('done');
  });

  it('M1-05: committing writes the final file and removes the temporary pieces', async () => {
    const store = await freshStore();
    await store.initStorage('sess-F');
    await store.appendVideoChunk(chunk('p1'));
    await store.appendVideoChunk(chunk('p2'));
    await store.finalizeVideo();
    const assembled = await store.getRecordingBlob();
    expect(await text(assembled)).toBe('p1p2');
    await store.commitRecording(new Blob(['patched'], { type: 'video/webm' }));
    expect(Array.from(disk.keys()).sort()).toEqual(['smoothstudio_recording.webm']);
    expect(new TextDecoder().decode(disk.get('smoothstudio_recording.webm'))).toBe('patched');
    expect(store.readSessionManifest()?.status).toBe('finalized');
  });

  it('M1-08: a new session with no video yet never hands out the PREVIOUS recording', async () => {
    let store = await freshStore();
    await store.initStorage('old');
    await store.appendVideoChunk(chunk('old-video'));
    await store.finalizeVideo();
    await store.commitRecording(chunk('old-video'));

    store = await freshStore();
    await store.initStorage('new');
    expect(await store.getRecordingBlob(), 'no chunk recorded yet in the new session').toBeNull();
  });

  it('M1-08: the previous recording survives until the new one is committed', async () => {
    let store = await freshStore();
    await store.initStorage('old');
    await store.appendVideoChunk(chunk('old-video'));
    await store.finalizeVideo();
    await store.commitRecording(chunk('old-video'));
    store = await freshStore();
    await store.initStorage('new');
    expect(new TextDecoder().decode(disk.get('smoothstudio_recording.webm'))).toBe('old-video');
  });

  it('M1-08: telemetry is stored with its session ID and stale telemetry is never returned for another session', async () => {
    const store = await freshStore();
    const tel = (sessionId: string) => ({
      metadata: { id: sessionId, sessionId, startTime: 0, endTime: 1, durationMs: 1, width: 1, height: 1, devicePixelRatio: 1, title: 't' },
      mousePoints: [], clicks: [], keystrokes: [], inputEvents: []
    });
    await store.saveTelemetry(tel('first') as any);
    expect((await store.loadTelemetry('first'))?.metadata.sessionId).toBe('first');
    expect(await store.loadTelemetry('second'), 'telemetry of "first" must not be handed to "second"').toBeNull();
  });

  it('M1-08: session IDs are unique', async () => {
    const store = await freshStore();
    const ids = new Set(Array.from({ length: 200 }, () => store.newSessionId()));
    expect(ids.size).toBe(200);
  });

  it('M1-10: without OPFS (and without IndexedDB) the recording is kept in memory and still returned', async () => {
    installOpfs(null);
    const store = await freshStore();
    await store.initStorage('sess-ram');
    await store.appendVideoChunk(chunk('m1'));
    await store.appendVideoChunk(chunk('m2'));
    await store.finalizeVideo();
    expect(store.readSessionManifest()?.backend).toBe('ram');
    expect(await text(await store.getRecordingBlob())).toBe('m1m2');
  });
});
