// SmoothStudio Manifest V3 Service Worker

let activeRecordingTabId: number | null = null;
let isRecording = false;

chrome.runtime.onInstalled.addListener(() => {
  console.log('[SmoothStudio] Extension installed and ready.');
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_STUDIO_RECORDING') {
    isRecording = true;
    activeRecordingTabId = message.tabId || sender.tab?.id || null;

    // Broadcast START_TELEMETRY to active tabs so mouse tracking begins immediately
    chrome.tabs.query({ active: true }, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: 'START_TELEMETRY' }).catch(() => {});
        }
      }
    });

    sendResponse({ status: 'recording_started' });
  } else if (message.type === 'STOP_STUDIO_RECORDING') {
    isRecording = false;

    // Collect telemetry from active tab and save to chrome.storage.local
    chrome.tabs.query({ active: true }, (tabs) => {
      const tabToQuery = (activeRecordingTabId ? tabs.find(t => t.id === activeRecordingTabId) : null) || tabs[0];
      if (tabToQuery?.id) {
        chrome.tabs.sendMessage(tabToQuery.id, { type: 'STOP_TELEMETRY' }, (response) => {
          if (response && response.data) {
            chrome.storage.local.set({
              smoothstudio_telemetry: response.data,
              'smoothstudio_telemetry.json': response.data
            }, () => {
              chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
            });
          } else {
            chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
          }
        });
      } else {
        chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
      }
    });

    sendResponse({ status: 'recording_stopped' });
  } else if (message.type === 'GET_RECORDING_STATUS') {
    sendResponse({ isRecording, activeRecordingTabId });
  }

  return true;
});
