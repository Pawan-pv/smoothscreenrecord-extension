import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { untrackablePage } from '../engine/restricted-pages';
import { Video, Mic, EyeOff, Shield, Sparkles, Sliders, ExternalLink } from 'lucide-react';
import { ensureDevChromeMocks } from '../engine/dev-environment';
import { loadPrivacyPrefs, savePrivacyPrefs } from '../engine/privacy-prefs';
import { describeShieldOutcome } from './shield-feedback';
import { BrandMark } from '../editor/ui-primitives';
import '../index.css';

ensureDevChromeMocks();

const isLikelyWebTab = (t?: chrome.tabs.Tab): boolean => {
  if (!t?.id) return false;
  // If url is known, ensure it is http/https (skip chrome://, chrome-extension://, etc.)
  // If url is undefined (due to omitted "tabs" permission), assume valid web tab
  if (t.url) {
    // https but closed to extensions (Chrome Web Store, New Tab): clicks there cannot be tracked.
    return (t.url.startsWith('http://') || t.url.startsWith('https://')) && !untrackablePage(t.url);
  }
  return true;
};

export function PopupApp() {
  const [isRecording, setIsRecording] = useState(false);
  const [includeMic, setIncludeMic] = useState(true);
  const [blurEmails, setBlurEmails] = useState(true);
  const [blurRevenue, setBlurRevenue] = useState(true);
  const [blurApiKeys, setBlurApiKeys] = useState(true);
  const [pickerActive, setPickerActive] = useState(false);
  /** The current tab is a page Chrome lets no extension track (Web Store, chrome:// ...). */
  const [untrackable, setUntrackable] = useState<string | null>(null);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime?.lastError) return;
      setUntrackable(untrackablePage(tabs?.[0]?.url));
    });
  }, []);
  // Shown when the privacy shield could not be attached to the page being recorded.
  const [shieldNotice, setShieldNotice] = useState<{ text: string; proceed?: () => void } | null>(null);

  // The toggles are remembered: reopen the popup (or start from the editor) and
  // the categories are as the user left them.
  useEffect(() => {
    loadPrivacyPrefs().then((prefs) => {
      setBlurEmails(prefs.blurEmails);
      setBlurRevenue(prefs.blurRevenue);
      setBlurApiKeys(prefs.blurApiKeys);
    });
  }, []);

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' }, (res) => {
        if (chrome.runtime?.lastError) return;
        if (res && res.isRecording) {
          setIsRecording(true);
        }
      });
    }
  }, []);

  const handleTogglePrivacy = (key: 'emails' | 'revenue' | 'keys', val: boolean) => {
    if (key === 'emails') setBlurEmails(val);
    if (key === 'revenue') setBlurRevenue(val);
    if (key === 'keys') setBlurApiKeys(val);

    const options = {
      blurEmails: key === 'emails' ? val : blurEmails,
      blurRevenue: key === 'revenue' ? val : blurRevenue,
      blurApiKeys: key === 'keys' ? val : blurApiKeys
    };

    void savePrivacyPrefs(options);

    // Forward via service worker to broadcast to all matching web tabs. The
    // service worker answers with a per-tab result: tell the user when the
    // shield did not reach the page they are looking at.
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        type: 'APPLY_PRIVACY_OPTIONS',
        options
      }, (res) => {
        if (chrome.runtime?.lastError) return;
        const anyOn = options.blurEmails || options.blurRevenue || options.blurApiKeys;
        if (!anyOn) {
          setShieldNotice(null);
          return;
        }
        chrome.tabs?.query?.({ active: true, currentWindow: true }, (tabs) => {
          const text = describeShieldOutcome(res?.results, tabs?.[0]?.id);
          setShieldNotice(text ? { text } : null);
        });
      });
    }

    // Also send directly to the active tab if on a web page
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab?.id && isLikelyWebTab(tab)) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'APPLY_PRIVACY_OPTIONS',
            options
          }, () => {
            void chrome.runtime?.lastError;
          });
        }
      });
    }
  };

  const handleTogglePicker = () => {
    const nextState = !pickerActive;
    setPickerActive(nextState);

    const msgType = nextState ? 'START_PICKER' : 'STOP_PICKER';

    // Forward via service worker to broadcast to all matching web tabs
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        type: msgType
      }, () => {
        void chrome.runtime?.lastError;
      });
    }

    // Also send directly to the active tab if on a web page
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab?.id && isLikelyWebTab(tab)) {
          chrome.tabs.sendMessage(tab.id, {
            type: msgType
          }, () => {
            void chrome.runtime?.lastError;
          });
        }
      });
    }
  };

  const handleStartRecording = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentActive = tabs[0];

        const launchWithTarget = (targetTab?: chrome.tabs.Tab) => {
          const targetTabId = targetTab?.id;
          const openEditor = () => {
            const url = chrome.runtime.getURL(`editor.html?record=true&includeMic=${includeMic}&sourceTab=${targetTabId || ''}`);
            chrome.tabs.create({ url });
            window.close();
          };
          const options = { blurEmails, blurRevenue, blurApiKeys };
          void savePrivacyPrefs(options);
          if (!(targetTabId && isLikelyWebTab(targetTab))) {
            openEditor();
            return;
          }
          // Shield the page that is about to be recorded, and listen to the
          // answer: if the shield cannot reach it, say so BEFORE recording
          // starts instead of recording unblurred data without a word.
          chrome.runtime.sendMessage({ type: 'APPLY_PRIVACY_OPTIONS', options, tabId: targetTabId }, (res) => {
            void chrome.runtime?.lastError;
            const anyOn = options.blurEmails || options.blurRevenue || options.blurApiKeys;
            const text = anyOn ? describeShieldOutcome(res?.results, targetTabId) : null;
            if (text) {
              setShieldNotice({ text, proceed: openEditor });
              return;
            }
            openEditor();
          });
        };

        if (currentActive && isLikelyWebTab(currentActive)) {
          launchWithTarget(currentActive);
        } else {
          // If the active tab is not an HTTP/HTTPS page (e.g. popup opened as its own tab), find the target web tab
          chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }, (webTabs) => {
            const trackable = (webTabs || []).filter((t) => isLikelyWebTab(t));
            const chosen = trackable.find((t) => t.active) || trackable[trackable.length - 1] || currentActive;
            launchWithTarget(chosen);
          });
        }
      });
    } else {
      // In standalone browser mode, redirect to studio editor with recording prompt
      window.open(`/editor.html?record=true&includeMic=${includeMic}`, '_blank');
    }
  };

  const handleOpenStudio = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime) {
      chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
    } else {
      window.open('/editor.html', '_blank');
    }
  };

  return (
    <div className="ss-app ss-enter w-[360px] rounded-2xl border border-studio-border bg-studio-panel/95 p-4 font-sans text-studio-text shadow-[0_24px_64px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl select-none">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-studio-border">
        <div className="flex items-center gap-2.5">
          <BrandMark size={30} />
          <div>
            <h1 className="ss-title-tight text-[13px] font-semibold text-studio-text flex items-center gap-2">
              SmoothStudio
              <span className="ss-num text-[10px] px-1.5 py-0.5 rounded-md border border-[#60A5FA]/25 bg-[#60A5FA]/10 text-[#93C5FD]">v1.0</span>
            </h1>
            <p className="text-[11px] text-studio-muted">Cinematic 3D Auto-Zoom Recorder</p>
          </div>
        </div>
        <button
          onClick={handleOpenStudio}
          title="Open Studio Workspace"
          className="ss-btn p-1.5 text-studio-muted hover:text-studio-text"
        >
          <ExternalLink className="w-4 h-4" strokeWidth={1.75} />
        </button>
      </div>

      {/* Primary Record Action */}
      <div className="mb-4 relative z-10">
        {isRecording ? (
          <button
            onClick={() => {
              if (typeof chrome !== 'undefined' && chrome.runtime) {
                chrome.runtime.sendMessage({ type: 'STOP_STUDIO_RECORDING' }, () => {
                  if (chrome.runtime?.lastError) {}
                });
                setIsRecording(false);
              }
            }}
            className="ss-btn ss-btn-danger w-full py-3 px-4"
          >
            <span className="ss-live-dot w-2.5 h-2.5 rounded-sm" />
            Stop Recording & Open Studio
          </button>
        ) : (
          <button
            onClick={handleStartRecording}
            className="ss-btn ss-btn-primary w-full py-3 px-4 group"
          >
            <Sparkles className="w-4 h-4 text-white group-hover:rotate-12 transition-transform" strokeWidth={1.75} />
            Start Studio Recording
          </button>
        )}
      </div>

      {shieldNotice && (
        <div
          id="shield-notice"
          role="alert"
          className="ss-enter mb-4 rounded-xl border border-[#FBBF24]/35 bg-[#FBBF24]/10 p-3 text-[11px] leading-relaxed text-[#FEF3C7]"
        >
          <p>{shieldNotice.text}</p>
          <div className="mt-2 flex items-center gap-2">
            {shieldNotice.proceed && (
              <button
                id="shield-notice-proceed"
                onClick={() => {
                  const go = shieldNotice.proceed;
                  setShieldNotice(null);
                  go?.();
                }}
                className="ss-btn px-2.5 py-1 border border-[#FBBF24]/40 bg-[#FBBF24]/18 text-[#FEF3C7] hover:bg-[#FBBF24]/28"
              >
                Record anyway
              </button>
            )}
            <button
              id="shield-notice-dismiss"
              onClick={() => setShieldNotice(null)}
              className="ss-btn ss-btn-secondary px-2.5 py-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {untrackable && (
        <div className="ss-enter mb-3 p-2.5 rounded-xl bg-[#FBBF24]/10 border border-[#FBBF24]/30 text-[11px] leading-relaxed text-[#FDE68A]">
          Chrome does not let extensions work on {untrackable}, so clicks here cannot be tracked: the recording will have
          no auto-zoom and no styled cursor. Open a normal website to record with auto-zoom.
        </div>
      )}

      {/* Recording Controls */}
      <div className="ss-card space-y-3 p-3 mb-4">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-2 text-[#CBD5E1]">
            <Mic className="w-3.5 h-3.5 text-[#818CF8]" strokeWidth={1.75} />
            Microphone Audio
          </span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={includeMic}
              onChange={(e) => setIncludeMic(e.target.checked)}
              className="sr-only"
            />
            <span className={`ss-toggle ${includeMic ? 'ss-toggle-on' : ''}`} />
          </label>
        </div>
      </div>

      {/* Privacy Shield */}
      <div className="ss-card space-y-2 p-3 mb-4">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[#E2E8F0] mb-2">
          <Shield className="w-3.5 h-3.5 text-studio-success" strokeWidth={1.75} />
          Pre-Recording Privacy Shield
          <span className="ss-status-badge text-studio-success border-[#34D399]/30 bg-[#34D399]/10">$0 Leak</span>
        </div>

        <div className="space-y-1 text-[11px]">
          <label className="flex items-center justify-between text-[#CBD5E1] hover:text-studio-text cursor-pointer py-1">
            <span>Auto-Blur Emails</span>
            <input
              type="checkbox"
              checked={blurEmails}
              onChange={(e) => handleTogglePrivacy('emails', e.target.checked)}
              className="ss-checkbox"
            />
          </label>

          <label className="flex items-center justify-between text-[#CBD5E1] hover:text-studio-text cursor-pointer py-1">
            <span>Auto-Blur Revenue & Numbers</span>
            <input
              type="checkbox"
              checked={blurRevenue}
              onChange={(e) => handleTogglePrivacy('revenue', e.target.checked)}
              className="ss-checkbox"
            />
          </label>

          <label className="flex items-center justify-between text-[#CBD5E1] hover:text-studio-text cursor-pointer py-1">
            <span>Auto-Blur API Keys & Secrets</span>
            <input
              type="checkbox"
              checked={blurApiKeys}
              onChange={(e) => handleTogglePrivacy('keys', e.target.checked)}
              className="ss-checkbox"
            />
          </label>
        </div>

        <button
          onClick={handleTogglePicker}
          className={`ss-btn w-full py-2 mt-1 ${
            pickerActive
              ? 'border border-[#818CF8] bg-[#6366F1]/18 text-[#C7D2FE]'
              : 'ss-btn-secondary'
          }`}
        >
          <EyeOff className="w-3.5 h-3.5" strokeWidth={1.75} />
          {pickerActive ? 'Active: Click Elements on Page to Blur' : 'Interactive Click-to-Blur Picker'}
        </button>
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between gap-2 whitespace-nowrap text-[9px] tracking-tight text-studio-meta px-1">
        <span className="ss-num shrink-0">Hardware 60fps · $0 Server Cost</span>
        <button
          onClick={handleOpenStudio}
          className="ss-btn p-0 shrink-0 text-[#818CF8] hover:text-[#A5B4FC] underline underline-offset-2 transition-colors"
        >
          Open Studio Workspace →
        </button>
      </div>
    </div>
  );
}

const rootEl = document.getElementById('popup-root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<PopupApp />);
}
