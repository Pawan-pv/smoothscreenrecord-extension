// SmoothStudio Manifest V3 Service Worker

let activeRecordingTabId: number | null = null;
let activeEditorTabId: number | null = null;
let isRecording = false;

chrome.runtime.onInstalled.addListener(() => {
  console.log('[SmoothStudio] Extension installed and ready.');
});

// Listen for messages from popup, content scripts, or editor tab
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'REGISTER_EDITOR_TAB') {
    activeEditorTabId = sender.tab?.id || message.editorTabId || null;
    sendResponse({ status: 'editor_registered', editorTabId: activeEditorTabId });
  } else if (message.type === 'START_STUDIO_RECORDING') {
    isRecording = true;
    if (message.tabId) activeRecordingTabId = message.tabId;
    if (message.editorTabId) activeEditorTabId = message.editorTabId;
    if (sender.tab?.id && sender.tab.id !== activeRecordingTabId) {
      if (!activeEditorTabId) activeEditorTabId = sender.tab.id;
    }

    // Broadcast START_TELEMETRY to target tab and active tabs so mouse tracking begins immediately
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id && (tab.id === activeRecordingTabId || tab.active)) {
          chrome.tabs.sendMessage(tab.id, { type: 'START_TELEMETRY' }).catch(() => {});
        }
      }
    });

    // If requested, focus the target tab so the user can begin demonstrating immediately
    if (message.focusTarget && activeRecordingTabId) {
      chrome.tabs.update(activeRecordingTabId, { active: true }).catch(() => {});
    }

    sendResponse({ status: 'recording_started', activeRecordingTabId });
  } else if (message.type === 'STOP_STUDIO_RECORDING') {
    isRecording = false;

    // Collect telemetry from the recorded tab and save to chrome.storage.local
    const collectAndFinish = (tabIdToQuery: number | null) => {
      if (tabIdToQuery) {
        chrome.tabs.sendMessage(tabIdToQuery, { type: 'STOP_TELEMETRY' }, (response) => {
          const telemetryData = response?.data || null;

          if (telemetryData) {
            chrome.storage.local.set({
              smoothstudio_telemetry: telemetryData,
              'smoothstudio_telemetry.json': telemetryData
            }, () => {
              notifyEditorAndFocus(telemetryData);
            });
          } else {
            notifyEditorAndFocus(null);
          }
        });
      } else {
        notifyEditorAndFocus(null);
      }
    };

    const notifyEditorAndFocus = (telemetryData: any) => {
      if (activeEditorTabId) {
        // Send stop message to existing editor tab
        chrome.tabs.sendMessage(activeEditorTabId, {
          type: 'STUDIO_STOP_CAPTURE',
          telemetry: telemetryData
        }).catch(() => {});

        // Bring editor tab to the foreground
        chrome.tabs.update(activeEditorTabId, { active: true }).catch(() => {
          // If editor tab was closed, create a fresh one
          chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
        });
      } else {
        // Find if editor.html tab is open
        chrome.tabs.query({ url: chrome.runtime.getURL('editor.html*') }, (tabs) => {
          if (tabs.length > 0 && tabs[0].id) {
            activeEditorTabId = tabs[0].id;
            chrome.tabs.sendMessage(activeEditorTabId, {
              type: 'STUDIO_STOP_CAPTURE',
              telemetry: telemetryData
            }).catch(() => {});
            chrome.tabs.update(activeEditorTabId, { active: true });
          } else {
            chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
          }
        });
      }
    };

    if (activeRecordingTabId) {
      collectAndFinish(activeRecordingTabId);
    } else {
      chrome.tabs.query({ active: true }, (tabs) => {
        collectAndFinish(tabs[0]?.id || null);
      });
    }

    sendResponse({ status: 'recording_stopped' });
  } else if (message.type === 'GET_RECORDING_STATUS') {
    sendResponse({ isRecording, activeRecordingTabId, activeEditorTabId });
  }

  return true;
});
