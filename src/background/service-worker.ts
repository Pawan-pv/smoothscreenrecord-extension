// SmoothStudio Manifest V3 Service Worker with Persistent Session State & Keepalive

interface SessionState {
  activeRecordingTabId: number | null;
  activeEditorTabId: number | null;
  isRecording: boolean;
}

// Memory cache of session state (synced with storage.session to survive worker sleep)
let state: SessionState = {
  activeRecordingTabId: null,
  activeEditorTabId: null,
  isRecording: false
};

// Safe storage access (session storage in MV3, fallback to local)
const getStorageArea = () => {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    return chrome.storage.session;
  }
  return chrome.storage.local;
};

async function loadSessionState(): Promise<SessionState> {
  try {
    const data: Record<string, any> = await getStorageArea().get(['activeRecordingTabId', 'activeEditorTabId', 'isRecording']);
    state = {
      activeRecordingTabId: typeof data.activeRecordingTabId === 'number' ? data.activeRecordingTabId : (data.activeRecordingTabId === null ? null : state.activeRecordingTabId),
      activeEditorTabId: typeof data.activeEditorTabId === 'number' ? data.activeEditorTabId : (data.activeEditorTabId === null ? null : state.activeEditorTabId),
      isRecording: Boolean(data.isRecording)
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
  if (message.type === 'START_STUDIO_RECORDING') {
    const recordingTabId = message.tabId || state.activeRecordingTabId;
    let editorTabId = message.editorTabId || state.activeEditorTabId;
    if (sender.tab?.id && sender.tab.id !== recordingTabId) {
      editorTabId = sender.tab.id;
    }

    persistSessionState({
      isRecording: true,
      activeRecordingTabId: recordingTabId,
      activeEditorTabId: editorTabId
    }).then(() => {
      // Broadcast START_TELEMETRY to target tab and active tabs
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id && (tab.id === recordingTabId || tab.active)) {
            chrome.tabs.sendMessage(tab.id, { type: 'START_TELEMETRY' }).catch(() => {});
          }
        }
      });

      // Focus target tab if requested
      if (message.focusTarget && recordingTabId) {
        chrome.tabs.update(recordingTabId, { active: true }).catch(() => {});
      }

      sendResponse({ status: 'recording_started', activeRecordingTabId: recordingTabId });
    });
    return true;
  }

  // 4. Stop Studio Recording
  if (message.type === 'STOP_STUDIO_RECORDING') {
    loadSessionState().then((currState) => {
      const tabIdToQuery = currState.activeRecordingTabId;
      const editorTabId = currState.activeEditorTabId;

      const collectAndFinish = (tabId: number | null) => {
        if (tabId) {
          chrome.tabs.sendMessage(tabId, { type: 'STOP_TELEMETRY' }, (response) => {
            const telemetryData = response?.data || null;
            if (telemetryData) {
              chrome.storage.local.set({
                smoothstudio_telemetry: telemetryData,
                'smoothstudio_telemetry.json': telemetryData
              }, () => {
                notifyEditorAndFocus(telemetryData, editorTabId);
              });
            } else {
              notifyEditorAndFocus(null, editorTabId);
            }
          });
        } else {
          notifyEditorAndFocus(null, editorTabId);
        }
      };

      const notifyEditorAndFocus = (telemetryData: any, targetEditorTabId: number | null) => {
        persistSessionState({ isRecording: false, activeRecordingTabId: null }).catch(() => {});

        if (targetEditorTabId) {
          chrome.tabs.sendMessage(targetEditorTabId, {
            type: 'STUDIO_STOP_CAPTURE',
            telemetry: telemetryData
          }).catch(() => {});

          chrome.tabs.update(targetEditorTabId, { active: true }).catch(() => {
            chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
          });
        } else {
          chrome.tabs.query({ url: chrome.runtime.getURL('editor.html*') }, (tabs) => {
            if (tabs.length > 0 && tabs[0].id) {
              persistSessionState({ activeEditorTabId: tabs[0].id }).catch(() => {});
              chrome.tabs.sendMessage(tabs[0].id, {
                type: 'STUDIO_STOP_CAPTURE',
                telemetry: telemetryData
              }).catch(() => {});
              chrome.tabs.update(tabs[0].id, { active: true });
            } else {
              chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
            }
          });
        }
      };

      if (tabIdToQuery) {
        collectAndFinish(tabIdToQuery);
      } else {
        chrome.tabs.query({ active: true }, (tabs) => {
          collectAndFinish(tabs[0]?.id || null);
        });
      }

      sendResponse({ status: 'recording_stopped' });
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

  return false;
});
