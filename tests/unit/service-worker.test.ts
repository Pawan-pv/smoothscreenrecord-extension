import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockPort } from '../mocks/chrome-mock';

describe('Service Worker: Long-Lived Port & Background Message Processing', () => {
  beforeEach(async () => {
    vi.resetModules();
    // Dynamically import the service worker to re-bind listeners to fresh mock state
    await import('../../src/background/service-worker');
  });

  describe('1. Listener Verification & Registration', () => {
    it('isolates and registers active chrome event handlers', () => {
      expect(chrome.runtime.onInstalled.addListener).toHaveBeenCalled();
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
      expect(chrome.runtime.onConnect.addListener).toHaveBeenCalled();
      expect((chrome.runtime.onMessage as any).listeners.length).toBeGreaterThan(0);
      expect((chrome.runtime.onConnect as any).listeners.length).toBeGreaterThan(0);
    });

    it('initializes default session state schema on chrome.runtime.onInstalled', async () => {
      (chrome.runtime.onInstalled as any).dispatch();

      const sessionData = await chrome.storage.session.get();
      expect(sessionData).toEqual(
        expect.objectContaining({
          isRecording: false,
          activeRecordingTabId: null,
          activeEditorTabId: null
        })
      );
    });
  });

  describe('2. Asynchronous Message Ingestion (START_RECORDING)', () => {
    it('ingests START_RECORDING payload, mutates session storage asynchronously, and fires acknowledgement', async () => {
      const sendResponse = vi.fn();
      const messagePayload = {
        type: 'START_RECORDING',
        payload: { quality: '1080p' },
        tabId: 101,
        editorTabId: 505
      };

      // Isolate and dispatch directly through the registered onMessage listener
      const isAsync = (chrome.runtime.onMessage as any).dispatch(
        messagePayload,
        { id: 'caller-extension-id', tab: { id: 101 } },
        sendResponse
      );

      // MV3 pattern requires returning true for asynchronous response handling
      expect(isAsync).toBe(true);

      // Await persistence resolution
      await new Promise((resolve) => setTimeout(resolve, 30));

      // Assert storage.session state mutation
      const sessionData = await chrome.storage.session.get();
      expect(sessionData.isRecording).toBe(true);
      expect(sessionData.activeRecordingTabId).toBe(101);
      expect(sessionData.activeEditorTabId).toBe(505);
      expect(sessionData.quality).toBe('1080p');

      // Assert callback response
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'recording_started',
          activeRecordingTabId: 101,
          quality: '1080p'
        })
      );
    });

    it('handles diagnostics PING heartbeat synchronously', () => {
      const sendResponse = vi.fn();
      (chrome.runtime.onMessage as any).dispatch({ type: 'PING' }, { id: 'caller' }, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ok',
          pong: true
        })
      );
    });

    it('persists editor tab ID on REGISTER_EDITOR_TAB and notifies caller', async () => {
      const sendResponse = vi.fn();
      (chrome.runtime.onMessage as any).dispatch(
        { type: 'REGISTER_EDITOR_TAB', editorTabId: 999 },
        { id: 'caller' },
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 20));

      const sessionData = await chrome.storage.session.get();
      expect(sessionData.activeEditorTabId).toBe(999);
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'editor_registered',
          editorTabId: 999
        })
      );
    });
  });

  describe('3. Channel Lifecycle & Stream Drops', () => {
    it('flushes crash-recovery markers into chrome.storage.local upon sudden port teardown', async () => {
      const streamPort = new MockPort('smoothstudio-stream');

      // Simulate client connection handshake
      (chrome.runtime.onConnect as any).dispatch(streamPort);

      // Verify port has attached disconnect listeners
      expect(streamPort.onDisconnect.listeners.length).toBeGreaterThan(0);

      // Trigger unexpected channel disconnect
      streamPort.disconnect();

      // Assert that crash-recovery state was persisted directly to storage.local
      const localData = await chrome.storage.local.get('crashRecoveryMarker');
      expect(localData.crashRecoveryMarker).toBeDefined();
      expect(localData.crashRecoveryMarker.portName).toBe('smoothstudio-stream');
      expect(localData.crashRecoveryMarker.reason).toBe('client_stream_disconnected');
      expect(localData.crashRecoveryMarker.recovered).toBe(false);
      expect(typeof localData.crashRecoveryMarker.timestamp).toBe('number');
    });

    it('maintains continuous keepalive ping-pong loop over smoothstudio-keepalive port', () => {
      const keepalivePort = new MockPort('smoothstudio-keepalive');

      (chrome.runtime.onConnect as any).dispatch(keepalivePort);
      expect(keepalivePort.onMessage.listeners.length).toBeGreaterThan(0);

      keepalivePort.onMessage.dispatch('ping');
      expect(keepalivePort.postMessage).toHaveBeenCalledWith('pong');
    });
  });
});
