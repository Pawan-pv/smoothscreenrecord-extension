import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Service Worker Background Architecture', () => {
  beforeEach(async () => {
    // Reset modules so service-worker is re-executed fresh
    vi.resetModules();
    await import('../../src/background/service-worker');
  });

  it('registers onInstalled listener and initializes session storage', async () => {
    // Trigger onInstalled event
    (chrome.runtime.onInstalled as any).dispatch();

    // Verify storage.session was updated with default clean state
    const data = await chrome.storage.session.get();
    expect(data.isRecording).toBe(false);
    expect(data.activeRecordingTabId).toBe(null);
    expect(data.activeEditorTabId).toBe(null);
  });

  it('responds with pong on PING message', async () => {
    const sendResponse = vi.fn();
    (chrome.runtime.onMessage as any).dispatch(
      { type: 'PING' },
      { id: 'caller' },
      sendResponse
    );

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', pong: true })
    );
  });

  it('persists editor tab ID on REGISTER_EDITOR_TAB', async () => {
    const sendResponse = vi.fn();
    (chrome.runtime.onMessage as any).dispatch(
      { type: 'REGISTER_EDITOR_TAB', editorTabId: 777 },
      { id: 'caller' },
      sendResponse
    );

    // Wait for async persistence
    await new Promise((r) => setTimeout(r, 20));

    const data = await chrome.storage.session.get();
    expect(data.activeEditorTabId).toBe(777);
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'editor_registered', editorTabId: 777 })
    );
  });

  it('handles keepalive port connection and responds to ping with pong', () => {
    const port = (chrome.runtime as any).connect({ name: 'smoothstudio-keepalive' });

    // Port should have listeners registered by SW
    expect(port.onMessage.listeners.length).toBeGreaterThan(0);

    port.onMessage.dispatch('ping');
    expect(port.postMessage).toHaveBeenCalledWith('pong');
  });
});
