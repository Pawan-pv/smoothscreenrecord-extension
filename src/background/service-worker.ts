// SmoothStudio Manifest V3 Service Worker with Persistent Session State & Keepalive

interface SessionState {
  activeRecordingTabId: number | null;
  activeEditorTabId: number | null;
  isRecording: boolean;
  quality?: string;
  /** Recording session id (M1-08): shared by the video, the telemetry and the editor. */
  activeSessionId?: string | null;
}

// Memory cache of session state (synced with storage.session to survive worker sleep)
let state: SessionState = {
  activeRecordingTabId: null,
  activeEditorTabId: null,
  isRecording: false,
  quality: '1080p',
  activeSessionId: null
};

const STOP_TELEMETRY_TIMEOUT_MS = 3000;

// Safe storage access (session storage in MV3, fallback to local)
const getStorageArea = () => {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    return chrome.storage.session;
  }
  return chrome.storage.local;
};

async function loadSessionState(): Promise<SessionState> {
  try {
    const data: Record<string, any> = await getStorageArea().get(['activeRecordingTabId', 'activeEditorTabId', 'isRecording', 'quality', 'activeSessionId']);
    state = {
      activeRecordingTabId: typeof data.activeRecordingTabId === 'number' ? data.activeRecordingTabId : (data.activeRecordingTabId === null ? null : state.activeRecordingTabId),
      activeEditorTabId: typeof data.activeEditorTabId === 'number' ? data.activeEditorTabId : (data.activeEditorTabId === null ? null : state.activeEditorTabId),
      isRecording: Boolean(data.isRecording),
      quality: typeof data.quality === 'string' ? data.quality : '1080p',
      activeSessionId: typeof data.activeSessionId === 'string' ? data.activeSessionId : (data.activeSessionId === null ? null : state.activeSessionId ?? null)
    };
  } catch (err) {
    console.warn('[SmoothStudio SW] Failed to load session state:', err);
  }
  return state;
}

async function persistSessionState(partial: Partial<SessionState>): Promise<void> {
  state = { ...state, ...partial };
  try {
    await getStorageArea().set(partial);
  } catch (err) {
    console.warn('[SmoothStudio SW] Failed to persist session state:', err);
  }
}

/**
 * Ends the recording session on the RECORDED tab: STOP_TELEMETRY removes the
 * HUD and returns the telemetry, which is tagged with the session id and
 * persisted. The SW state is reset. Every stop path goes through here, so the
 * telemetry of a session is collected exactly once and never mixed with
 * another session's.
 */
let endInFlight: Promise<{ telemetry: any; sessionId: string | null }> | null = null;
async function endRecordingSession(): Promise<{ telemetry: any; sessionId: string | null }> {
  if (endInFlight) return endInFlight;
  endInFlight = (async () => {
    const curr = await loadSessionState();
    const sessionId = curr.activeSessionId || null;
    if (!curr.isRecording) {
      // Already ended (another stop path got here first): hand out what was
      // stored for this session, if anything.
      const stored = await chrome.storage.local.get(['smoothstudio_telemetry']).catch(() => ({} as any));
      const t = (stored as any)?.smoothstudio_telemetry || null;
      const lastId = (await getStorageArea().get(['lastSessionId']).catch(() => ({} as any)) as any)?.lastSessionId || null;
      return { telemetry: t && lastId && t.metadata?.sessionId === lastId ? t : null, sessionId: lastId };
    }
    const tabId = curr.activeRecordingTabId;
    let telemetry: any = null;
    if (tabId) {
      telemetry = await new Promise<any>((resolve) => {
        let done = false;
        const finish = (v: any) => { if (!done) { done = true; resolve(v); } };
        try {
          chrome.tabs.sendMessage(tabId, { type: 'STOP_TELEMETRY', sessionId }, (response) => {
            void chrome.runtime?.lastError; // the tab may be gone
            finish(response?.data || null);
          });
        } catch { finish(null); }
        setTimeout(() => finish(null), STOP_TELEMETRY_TIMEOUT_MS);
      });
    }
    if (telemetry && telemetry.metadata) {
      telemetry.metadata.sessionId = sessionId || telemetry.metadata.sessionId;
      await chrome.storage.local.set({
        smoothstudio_telemetry: telemetry,
        'smoothstudio_telemetry.json': telemetry
      }).catch(() => undefined);
    }
    await persistSessionState({ isRecording: false, activeRecordingTabId: null, activeSessionId: null });
    await getStorageArea().set({ lastSessionId: sessionId }).catch(() => undefined);
    return { telemetry: telemetry && telemetry.metadata ? telemetry : null, sessionId };
  })();
  try {
    return await endInFlight;
  } finally {
    endInFlight = null;
  }
}

// The editor (which owns the recorder) was closed while recording: the
// capture died with it. End the session so the HUD leaves the page and the
// telemetry is kept for the recovered recording.
chrome.tabs?.onRemoved?.addListener((tabId) => {
  loadSessionState().then((curr) => {
    if (curr.isRecording && curr.activeEditorTabId === tabId) {
      endRecordingSession().catch(() => undefined);
    }
  }).catch(() => undefined);
});

// Initialize on install or startup
chrome.runtime.onInstalled.addListener(() => {
  console.log('[SmoothStudio] Extension installed and ready.');
  persistSessionState({ isRecording: false, activeRecordingTabId: null, activeEditorTabId: null });
});

chrome.runtime.onStartup?.addListener(() => {
  loadSessionState().catch(() => {});
});

// Maintain active worker connection during recording
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'smoothstudio-keepalive') {
    port.onMessage.addListener((msg) => {
      if (msg === 'ping') {
        port.postMessage('pong');
      }
    });
  } else if (port.name === 'smoothstudio-stream') {
    port.onDisconnect.addListener(() => {
      // Channel teardown / crash recovery flush to storage.local
      chrome.storage.local.set({
        crashRecoveryMarker: {
          timestamp: Date.now(),
          portName: 'smoothstudio-stream',
          reason: 'client_stream_disconnected',
          recovered: false
        }
      });
    });
  }
});

// Listen for messages from popup, content scripts, or editor tab
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 1. Diagnostics Ping
  if (message.type === 'PING') {
    sendResponse({ status: 'ok', pong: true, time: Date.now() });
    return true;
  }

  // 2. Register Editor Tab
  if (message.type === 'REGISTER_EDITOR_TAB') {
    const editorTabId = sender.tab?.id || message.editorTabId || state.activeEditorTabId;
    persistSessionState({ activeEditorTabId: editorTabId }).then(() => {
      sendResponse({ status: 'editor_registered', editorTabId });
    });
    return true;
  }

  // 3. Start Studio Recording
  if (message.type === 'START_STUDIO_RECORDING' || message.type === 'START_RECORDING') {
    let recordingTabId = message.tabId || state.activeRecordingTabId;
    let editorTabId = message.editorTabId || state.activeEditorTabId;
    if (sender.tab?.id && sender.tab.id !== recordingTabId) {
      editorTabId = sender.tab.id;
    }
    const quality = message.payload?.quality || message.quality || '1080p';

    const sessionId: string | null = typeof message.sessionId === 'string' ? message.sessionId : null;
    const dispatchStart = (targetRecordingTabId: number | null) => {
      persistSessionState({
        isRecording: true,
        activeRecordingTabId: targetRecordingTabId,
        activeEditorTabId: editorTabId,
        quality,
        activeSessionId: sessionId
      }).then(() => {
        // Broadcast START_TELEMETRY to target tab and active web page tabs (http/https only).
        // `originEpoch` is the wall-clock timestamp of the first captured video
        // frame: sharing it makes telemetry time and video time use ONE clock.
        const originEpoch = message.originEpoch;
        chrome.tabs.query({}, (tabs) => {
          for (const tab of tabs) {
            if (tab.id && (tab.id === targetRecordingTabId || tab.active)) {
              // Guard: Content scripts only run on http/https web pages. Never dispatch to chrome:// or extension pages.
              if (!tab.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) {
                continue;
              }
              chrome.tabs.sendMessage(tab.id, { type: 'START_TELEMETRY', originEpoch, sessionId }, () => {
                void chrome.runtime?.lastError;
              });
            }
          }
        });

        // Focus target tab if requested
        if (message.focusTarget && targetRecordingTabId) {
          chrome.tabs.update(targetRecordingTabId, { active: true }).catch(() => {});
        }

        sendResponse({ status: 'recording_started', activeRecordingTabId: targetRecordingTabId, quality, sessionId });
      });
    };

    if (recordingTabId) {
      dispatchStart(recordingTabId);
    } else {
      chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }, (webTabs) => {
        const chosen = webTabs.find((t) => t.active) || webTabs[0];
        dispatchStart(chosen?.id || null);
      });
    }
    return true;
  }

  // 4. Stop Studio Recording
  // Stop paths: the on-page HUD, the popup, and the editor itself (its Stop
  // button, Chrome's "Stop sharing" bar). The response carries the session's
  // telemetry once it has been collected.
  if (message.type === 'STOP_STUDIO_RECORDING') {
    loadSessionState().then(async (currState) => {
      const editorTabId = currState.activeEditorTabId;
      const fromEditor = Boolean(sender.tab?.id && editorTabId && sender.tab.id === editorTabId);
      const { telemetry, sessionId } = await endRecordingSession();

      // The recorder lives in the editor: tell it to stop (unless it asked).
      const notify = (tabId: number) => {
        chrome.tabs.sendMessage(tabId, { type: 'STUDIO_STOP_CAPTURE', telemetry, sessionId }, () => {
          void chrome.runtime?.lastError;
        });
      };
      if (!fromEditor) {
        if (editorTabId) {
          notify(editorTabId);
          chrome.tabs.update(editorTabId, { active: true }).catch(() => {
            chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
          });
        } else {
          chrome.tabs.query({ url: chrome.runtime.getURL('editor.html*') }, (tabs) => {
            if (tabs.length > 0 && tabs[0].id) {
              persistSessionState({ activeEditorTabId: tabs[0].id }).catch(() => {});
              notify(tabs[0].id);
              chrome.tabs.update(tabs[0].id, { active: true });
            } else {
              chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
            }
          });
        }
      }

      sendResponse({ status: 'recording_stopped', telemetry, sessionId });
    });
    return true;
  }

  // A newly opened editor found an interrupted session (the editor that
  // recorded it crashed): end it on the recorded tab and return its telemetry.
  if (message.type === 'RECOVER_SESSION') {
    loadSessionState().then(async (currState) => {
      const wanted: string | null = message.sessionId || null;
      if (currState.isRecording && (!wanted || !currState.activeSessionId || currState.activeSessionId === wanted)) {
        const res = await endRecordingSession();
        sendResponse({ status: 'session_recovered', ...res });
      } else {
        const res = await endRecordingSession(); // not recording: returns what was stored
        sendResponse({ status: 'not_recording', telemetry: res.telemetry && res.sessionId === wanted ? res.telemetry : null, sessionId: res.sessionId });
      }
    });
    return true;
  }

  // 5. Query Status
  if (message.type === 'GET_RECORDING_STATUS') {
    loadSessionState().then((currState) => {
      sendResponse({
        isRecording: currState.isRecording,
        activeRecordingTabId: currState.activeRecordingTabId,
        activeEditorTabId: currState.activeEditorTabId
      });
    });
    return true;
  }

  // 6. Forward Privacy & Redaction Messages to Tabs
  if (['APPLY_PRIVACY_OPTIONS', 'START_PICKER', 'STOP_PICKER', 'RESET_PRIVACY'].includes(message.type)) {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id && tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
          chrome.tabs.sendMessage(tab.id, message, () => {
            void chrome.runtime?.lastError;
          });
        }
      }
    });
    sendResponse({ status: 'forwarded' });
    return true;
  }

  return false;
});

// Development Auto-Reloader (stripped in production builds via Vite dead-code elimination)
if (import.meta.env.DEV) {
  const initDevReloader = () => {
    try {
      const ws = new WebSocket('ws://localhost:8989');

      ws.onopen = () => {
        console.log('[Dev Reloader] Connected to Vite extension reloader server on ws://localhost:8989');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'EXTENSION_RELOAD') {
            console.log('[Dev Reloader] Extension files changed. Triggering chrome.runtime.reload()...');
            chrome.runtime.reload();
          } else if (msg.type === 'CONTENT_SCRIPT_UPDATED') {
            console.log('[Dev Reloader] Content script updated. Refreshing active tabs...');
            chrome.tabs.query({ active: true }, (tabs) => {
              for (const tab of tabs) {
                if (tab.id && tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
                  chrome.tabs.reload(tab.id);
                }
              }
            });
          }
        } catch (err) {
          console.warn('[Dev Reloader] Error handling message:', err);
        }
      };

      ws.onclose = () => {
        setTimeout(initDevReloader, 2500);
      };

      ws.onerror = () => {
        // Reloader server may not be active; retry gracefully
      };
    } catch {
      setTimeout(initDevReloader, 3000);
    }
  };

  initDevReloader();
}
