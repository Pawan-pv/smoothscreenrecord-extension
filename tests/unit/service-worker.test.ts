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

  describe('4. Tab Messaging Safety Without "tabs" Permission', () => {
    it('dispatches START_TELEMETRY to target tab even when tab.url is undefined', async () => {
      (chrome.tabs as any)._tabs.length = 0;
      (chrome.tabs as any)._tabs.push(
        { id: 202, active: true, url: undefined },
        { id: 303, active: false, url: 'chrome://extensions' }
      );

      const sendResponse = vi.fn();
      (chrome.runtime.onMessage as any).dispatch(
        {
          type: 'START_RECORDING',
          payload: { quality: '1080p' },
          tabId: 202,
          originEpoch: 123456789,
          sessionId: 'test_ses'
        },
        { id: 'caller' },
        sendResponse
      );

      await new Promise((r) => setTimeout(r, 20));

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        202,
        expect.objectContaining({ type: 'START_TELEMETRY', originEpoch: 123456789, sessionId: 'test_ses' }),
        expect.any(Function)
      );

      expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
        303,
        expect.anything(),
        expect.any(Function)
      );
    });

    it('forwards privacy options to tabs when tab.url is undefined but skips chrome:// URLs', async () => {
      (chrome.tabs as any)._tabs.length = 0;
      (chrome.tabs as any)._tabs.push(
        { id: 404, active: true, url: undefined },
        { id: 505, active: false, url: 'chrome://settings' }
      );

      (chrome.tabs.sendMessage as any).mockClear();

      const sendResponse = vi.fn();
      (chrome.runtime.onMessage as any).dispatch(
        {
          type: 'APPLY_PRIVACY_OPTIONS',
          options: { blurEmails: true, blurRevenue: true, blurApiKeys: true }
        },
        { id: 'caller' },
        sendResponse
      );

      await new Promise((r) => setTimeout(r, 20));

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        404,
        expect.objectContaining({ type: 'APPLY_PRIVACY_OPTIONS' }),
        expect.any(Function)
      );

      expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
        505,
        expect.anything(),
        expect.any(Function)
      );
    });

    it('injects content scripts and retries START_TELEMETRY when the tab has no receiver', async () => {
      (chrome.tabs as any)._tabs.length = 0;
      (chrome.tabs as any)._tabs.push({ id: 606, active: true, url: 'https://example.com/already-open' });
      const responses: any[] = [];
      (chrome.tabs.sendMessage as any)
        .mockImplementationOnce((_tabId: number, _message: any, callback?: (response?: any) => void) => {
          chrome.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
          callback?.(undefined);
          chrome.runtime.lastError = null;
          return Promise.resolve();
        })
        .mockImplementationOnce((_tabId: number, message: any, callback?: (response?: any) => void) => {
          responses.push(message);
          callback?.({ ok: true, status: 'started' });
          return Promise.resolve({ ok: true, status: 'started' });
        });

      const sendResponse = vi.fn();
      (chrome.runtime.onMessage as any).dispatch(
        { type: 'START_RECORDING', tabId: 606, sessionId: 'reinject_ses' },
        { id: 'caller' },
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 30));

      // The shield goes into EVERY frame (cross-origin iframes included); the
      // tracker stays top-frame only so sub-frames emit no second telemetry stream.
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
        target: { tabId: 606, allFrames: true },
        files: ['content/privacy-redactor.js']
      });
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
        target: { tabId: 606 },
        files: ['content/dom-tracker.js']
      });
      for (const call of (chrome.scripting.executeScript as any).mock.calls) {
        if (call[0].files.includes('content/dom-tracker.js')) {
          expect(call[0].target.allFrames, 'dom-tracker must not be injected into sub-frames').toBeFalsy();
        }
      }
      expect(responses).toEqual([
        expect.objectContaining({ type: 'START_TELEMETRY', sessionId: 'reinject_ses' })
      ]);
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ status: 'recording_started' }));
    });

    it('reports restricted tabs instead of claiming privacy forwarding succeeded', async () => {
      (chrome.tabs as any)._tabs.length = 0;
      (chrome.tabs as any)._tabs.push({ id: 707, active: true, url: 'chrome://settings' });
      const sendResponse = vi.fn();

      (chrome.runtime.onMessage as any).dispatch(
        { type: 'APPLY_PRIVACY_OPTIONS', options: { blurEmails: true } },
        { id: 'caller' },
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
        status: 'forwarded',
        results: [expect.objectContaining({ tabId: 707, ok: false, reason: 'restricted_page' })]
      }));
    });
  });
});
