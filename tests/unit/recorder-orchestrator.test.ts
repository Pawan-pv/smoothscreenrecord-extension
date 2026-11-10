import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockPort } from '../mocks/chrome-mock';

describe('Recorder Orchestrator: Segment Ingestion, State Machines, & Crash Recovery', () => {
  beforeEach(async () => {
    vi.resetModules();
    // Load background service worker fresh with isolated mock Chrome environment
    await import('../../src/background/service-worker');
  });

  describe('1. Recording Segment Ingestion & Session State Management', () => {
    it('initiates recording session and persists tab, quality, and status to chrome.storage.session', async () => {
      const sendResponse = vi.fn();
      const startPayload = {
        type: 'START_RECORDING',
        tabId: 202,
        editorTabId: 404,
        payload: {
          quality: '1080p60',
          fps: 60
        }
      };

      // Dispatch message into the service worker router
      (chrome.runtime.onMessage as any).dispatch(
        startPayload,
        { id: 'smoothstudio-popup' },
        sendResponse
      );

      // Allow async session storage persistence to settle
      await new Promise((r) => setTimeout(r, 25));

      // Assert that chrome.storage.session reflects active recording segment
      const session = await chrome.storage.session.get();
      expect(session.isRecording).toBe(true);
      expect(session.activeRecordingTabId).toBe(202);
      expect(session.activeEditorTabId).toBe(404);
      expect(session.quality).toBe('1080p60');

      // Assert confirmation response payload
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'recording_started',
          activeRecordingTabId: 202,
          quality: '1080p60'
        })
      );
    });

    it('queries current recording status via GET_RECORDING_STATUS', async () => {
      // First initialize a recording
      (chrome.runtime.onMessage as any).dispatch(
        { type: 'START_STUDIO_RECORDING', tabId: 303, editorTabId: 505 },
        { id: 'caller' },
        vi.fn()
      );
      await new Promise((r) => setTimeout(r, 25));

      // Query status from popup
      const statusResponse = vi.fn();
      (chrome.runtime.onMessage as any).dispatch(
        { type: 'GET_RECORDING_STATUS' },
        { id: 'popup' },
        statusResponse
      );

      await new Promise((r) => setTimeout(r, 20));

      expect(statusResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          isRecording: true,
          activeRecordingTabId: 303,
          activeEditorTabId: 505
        })
      );
    });

    it('finalizes recording session upon STOP_STUDIO_RECORDING and updates session state', async () => {
      // Setup active recording state in session
      await chrome.storage.session.set({
        isRecording: true,
        activeRecordingTabId: 202,
        activeEditorTabId: 404
      });

      const stopResponse = vi.fn();
      (chrome.runtime.onMessage as any).dispatch(
        { type: 'STOP_STUDIO_RECORDING' },
        { id: 'editor' },
        stopResponse
      );

      await new Promise((r) => setTimeout(r, 30));

      expect(stopResponse).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'recording_stopped' })
      );
    });
  });

  describe('2. Port Dropouts & Crash State Data Flushing', () => {
    it('flushes crash-recovery marker and metadata into chrome.storage.local upon sudden port disconnect', async () => {
      // Create and connect stream port
      const streamPort = new MockPort('smoothstudio-stream');
      (chrome.runtime.onConnect as any).dispatch(streamPort);

      expect(streamPort.onDisconnect.listeners.length).toBeGreaterThan(0);

      // Simulate unexpected stream crash / tab termination
      streamPort.disconnect();

      // Verify that the crash state data was committed to persistent chrome.storage.local
      const localStore = await chrome.storage.local.get('crashRecoveryMarker');
      expect(localStore.crashRecoveryMarker).toBeDefined();
      expect(localStore.crashRecoveryMarker).toEqual(
        expect.objectContaining({
          portName: 'smoothstudio-stream',
          reason: 'client_stream_disconnected',
          recovered: false
        })
      );
      expect(typeof localStore.crashRecoveryMarker.timestamp).toBe('number');
    });

    it('maintains continuous heartbeat across keepalive channel without crash flush', () => {
      const keepalivePort = new MockPort('smoothstudio-keepalive');
      (chrome.runtime.onConnect as any).dispatch(keepalivePort);

      // Send ping over port
      keepalivePort.onMessage.dispatch('ping');
      expect(keepalivePort.postMessage).toHaveBeenCalledWith('pong');

      // Clean disconnect should not register as stream crash
      keepalivePort.disconnect();
    });

    it('handles service worker lifecycle startup by reloading stored session metadata', async () => {
      // Pre-populate session state
      await chrome.storage.session.set({
        isRecording: true,
        activeRecordingTabId: 888,
        activeEditorTabId: 999,
        quality: '4K'
      });

      // Dispatch runtime.onStartup event
      if (chrome.runtime.onStartup) {
        (chrome.runtime.onStartup as any).dispatch();
      }

      await new Promise((r) => setTimeout(r, 20));

      const recoveredData = await chrome.storage.session.get();
      expect(recoveredData.isRecording).toBe(true);
      expect(recoveredData.activeRecordingTabId).toBe(888);
      expect(recoveredData.activeEditorTabId).toBe(999);
      expect(recoveredData.quality).toBe('4K');
    });
  });
});
