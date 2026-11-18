/**
 * Recording storage: the chunk stream is closed once the session stops.
 *
 * finalizeVideo() marks the session "stopping". A frame that arrives after
 * that point belongs to no session and must not extend the recording that is
 * about to be assembled and committed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function freshStore() {
  vi.resetModules();
  const store = await import('../../src/engine/opfs-storage');
  store.setUseOpfs(false); // deterministic memory backend, no OPFS fake needed
  return store;
}

const blob = (text: string) => new Blob([text], { type: 'video/webm' });

describe('recording storage: late chunks after finalize', () => {
  beforeEach(() => {
    localStorage.clear();
    (globalThis as any).indexedDB = undefined;
  });

  it('drops a chunk that arrives after finalizeVideo()', async () => {
    const store = await freshStore();
    await store.initStorage('sess-late');
    await store.appendVideoChunk(blob('p1'));
    await store.finalizeVideo();

    await store.appendVideoChunk(blob('-late'));

    const assembled = await store.getRecordingBlob();
    expect(await assembled!.text()).toBe('p1');
    expect(store.readSessionManifest()?.chunkCount).toBe(1);
  });

  it('drops a chunk that arrives after the recording was committed', async () => {
    const store = await freshStore();
    await store.initStorage('sess-done');
    await store.appendVideoChunk(blob('p1'));
    await store.finalizeVideo();
    await store.commitRecording(blob('final'));

    await store.appendVideoChunk(blob('-late'));

    const current = await store.getRecordingBlob();
    expect(await current!.text()).toBe('final');
  });

  it('still accepts chunks while the session is recording', async () => {
    const store = await freshStore();
    await store.initStorage('sess-live');
    await store.appendVideoChunk(blob('a'));
    await store.appendVideoChunk(blob('b'));
    const assembled = await store.getRecordingBlob();
    expect(await assembled!.text()).toBe('ab');
  });
});
