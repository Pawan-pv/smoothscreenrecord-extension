import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { untrackablePage } from '../engine/restricted-pages';
import { Video, Mic, EyeOff, Shield, Sparkles, ExternalLink, Trash2 } from 'lucide-react';
import { ensureDevChromeMocks } from '../engine/dev-environment';
import {
  DEFAULT_PRIVACY_PREFS,
  PrivacyPrefs,
  loadPrivacyPrefs,
  savePrivacyPrefs,
  privacyOptionsFromPrefs
} from '../engine/privacy-prefs';
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

type CategoryKey = 'secrets' | 'pii' | 'financial';
const CATEGORIES: Array<{ key: CategoryKey; label: string }> = [
  { key: 'secrets', label: 'Secrets' },
  { key: 'pii', label: 'Emails & PII' },
  { key: 'financial', label: 'Financial' }
];

export function PopupApp() {
  const [isRecording, setIsRecording] = useState(false);
  const [includeMic, setIncludeMic] = useState(true);
  /** Opt-in: with no saved preference the shield is OFF and the page stays sharp. */
  const [prefs, setPrefs] = useState<PrivacyPrefs>({ ...DEFAULT_PRIVACY_PREFS });
  const [maskedCount, setMaskedCount] = useState(0);
  const [pickerActive, setPickerActive] = useState(false);
  const activeTabIdRef = useRef<number | null>(null);
  /** The current tab is a page Chrome lets no extension track (Web Store, chrome:// ...). */
  const [untrackable, setUntrackable] = useState<string | null>(null);
  // Shown when the privacy shield could not be attached to the page being recorded.
  const [shieldNotice, setShieldNotice] = useState<{ text: string; proceed?: () => void } | null>(null);

  /** Ask the active tab for the live number of masked items. */
  const refreshCount = () => {
    if (typeof chrome === 'undefined' || !chrome.runtime) return;
    chrome.runtime.sendMessage({
      type: 'GET_PRIVACY_STATUS',
      ...(activeTabIdRef.current ? { tabId: activeTabIdRef.current } : {})
    }, (res) => {
      void chrome.runtime?.lastError;
      if (res && typeof res.count === 'number') setMaskedCount(res.count);
    });
  };

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime?.lastError) return;
      const tab = tabs?.[0];
      activeTabIdRef.current = typeof tab?.id === 'number' ? tab.id : null;
      setUntrackable(untrackablePage(tab?.url));
    });
  }, []);

  // The toggles are remembered: reopen the popup (or start from the editor) and
  // the shield is exactly as the user left it — OFF unless they opted in.
  useEffect(() => {
    loadPrivacyPrefs().then((saved) => {
      setPrefs(saved);
      refreshCount();
    });
  }, []);

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' }, (res) => {
        if (chrome.runtime?.lastError) return;
        if (res && res.isRecording) setIsRecording(true);
      });
    }
    // Keep the masked-item count live while the popup is open, including
    // changes made from the page via the picker.
    const interval = window.setInterval(refreshCount, 2500);
    return () => window.clearInterval(interval);
  }, []);

  const sendApply = (next: PrivacyPrefs) => {
    if (typeof chrome === 'undefined' || !chrome.runtime) return;
    const options = privacyOptionsFromPrefs(next);
    chrome.runtime.sendMessage({
      type: 'APPLY_PRIVACY_OPTIONS',
      options,
      ...(isRecording ? { recording: true } : {}),
      ...(activeTabIdRef.current ? { tabId: activeTabIdRef.current } : {})
    }, (res) => {
      void chrome.runtime?.lastError;
      if (!next.enabled) { setShieldNotice(null); return; }
      chrome.tabs?.query?.({ active: true, currentWindow: true }, (tabs) => {
        const text = describeShieldOutcome(res?.results, tabs?.[0]?.id);
        setShieldNotice(text ? { text } : null);
      });
    });
    window.setTimeout(refreshCount, 150);
  };

  /** One place for every preference change: save, apply, count. */
  const applyAndSave = (next: PrivacyPrefs) => {
    setPrefs(next);
    void savePrivacyPrefs(next);
    sendApply(next);
  };

  const sendPrivacyMessage = (type: 'START_PICKER' | 'STOP_PICKER' | 'CLEAR_PICKS') => {
    if (typeof chrome === 'undefined') return;
    // Through the service worker (broadcast to armed tabs) and directly to the
    // tab in front, so the picker responds even if the SW is restarting.
    if (chrome.runtime) {
      chrome.runtime.sendMessage({
        type,
        ...(activeTabIdRef.current ? { tabId: activeTabIdRef.current } : {})
      }, () => { void chrome.runtime?.lastError; });
    }
    const tabId = activeTabIdRef.current;
    if (tabId && chrome.tabs?.sendMessage && isLikelyWebTab({ id: tabId } as chrome.tabs.Tab)) {
      chrome.tabs.sendMessage(tabId, { type }, () => { void chrome.runtime?.lastError; });
    }
    window.setTimeout(refreshCount, 150);
  };

  const handleTogglePicker = () => {
    const next = !pickerActive;
    setPickerActive(next);
    sendPrivacyMessage(next ? 'START_PICKER' : 'STOP_PICKER');
  };

  const handleClearPicks = () => {
    sendPrivacyMessage('CLEAR_PICKS');
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
          // Saved opt-in preferences only. Turning the shield OFF never applies
          // it, and no category is silently forced back ON here.
          const options = privacyOptionsFromPrefs(prefs);
          void savePrivacyPrefs(options);
          if (!options.enabled || !(targetTabId && isLikelyWebTab(targetTab))) {
            openEditor();
            return;
          }
          // Check the shield reached the page BEFORE recording starts: if it
          // did not, say so instead of recording unblurred data without a word.
          chrome.runtime.sendMessage({ type: 'APPLY_PRIVACY_OPTIONS', options, tabId: targetTabId }, (res) => {
            void chrome.runtime?.lastError;
            const text = describeShieldOutcome(res?.results, targetTabId);
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
          // Popup opened as its own tab: find a real web page to record.
          chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }, (webTabs) => {
            const trackable = (webTabs || []).filter((t) => isLikelyWebTab(t));
            const chosen = trackable.find((t) => t.active) || trackable[trackable.length - 1] || currentActive;
            launchWithTarget(chosen);
          });
        }
      });
    } else {
      // Standalone browser mode.
      window.open(`/editor.html?record=true&includeMic=${includeMic}`, '_blank');
    }
  };

  const handleStopRecording = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      // Unblur first, then end the recording.
      chrome.runtime.sendMessage({ type: 'STOP_PRIVACY' }, () => { void chrome.runtime?.lastError; });
      chrome.runtime.sendMessage({ type: 'STOP_STUDIO_RECORDING' }, () => { void chrome.runtime?.lastError; });
      setIsRecording(false);
      setMaskedCount(0);
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
          aria-label="Open Studio Workspace"
          className="ss-btn p-1.5 rounded-lg border border-transparent text-studio-muted hover:text-studio-text hover:bg-studio-cardHover hover:border-studio-border"
        >
          <ExternalLink className="w-4 h-4" strokeWidth={1.75} />
        </button>
      </div>

      {/* Primary Record Action */}
      <div className="mb-4 relative z-10">
        {isRecording ? (
          <button
            onClick={handleStopRecording}
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

      {/* Privacy Shield — strictly opt-in and surgical */}
      <div className="ss-card space-y-2.5 p-3 mb-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[#E2E8F0]">
            <Shield
              className={`w-3.5 h-3.5 ${prefs.enabled ? 'text-studio-success' : 'text-studio-meta'}`}
              strokeWidth={1.75}
            />
            <span>Privacy Shield</span>
            <span
              className={`ss-status-badge ${
                prefs.enabled
                  ? 'text-studio-success border-[#34D399]/30 bg-[#34D399]/10'
                  : 'text-studio-meta border-studio-border bg-white/[0.03]'
              }`}
            >
              {prefs.enabled ? 'ON' : 'OFF'}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.enabled}
            aria-label="Privacy Shield"
            onClick={() => applyAndSave({ ...prefs, enabled: !prefs.enabled })}
            className={`ss-toggle cursor-pointer ${prefs.enabled ? 'ss-toggle-on' : ''}`}
          />
        </div>

        {prefs.enabled && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {CATEGORIES.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                aria-pressed={prefs[key]}
                onClick={() => applyAndSave({ ...prefs, [key]: !prefs[key] })}
                className={`ss-btn rounded-full px-2.5 py-1 text-[10px] font-medium ${
                  prefs[key]
                    ? 'ss-chip ss-chip-active text-studio-text'
                    : 'ss-chip'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-0.5">
          <span className="ss-num text-[10px] text-studio-muted" aria-live="polite">
            {maskedCount} item{maskedCount === 1 ? '' : 's'} masked
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleTogglePicker}
              className={`ss-btn px-2 py-1 text-[10px] ${
                pickerActive
                  ? 'ss-chip ss-chip-active text-studio-text'
                  : 'ss-btn-secondary'
              }`}
            >
              <EyeOff className="w-3.5 h-3.5" strokeWidth={1.75} />
              {pickerActive ? 'Click page to blur · Esc' : 'Pick areas to blur'}
            </button>
            <button
              type="button"
              onClick={handleClearPicks}
              title="Clear manually picked areas"
              className="ss-btn ss-btn-secondary px-2 py-1 text-[10px]"
            >
              <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
              Clear
            </button>
          </div>
        </div>
        <p className="text-[10px] leading-relaxed text-studio-meta">
          Only credentials, {prefs.enabled ? 'the enabled categories' : 'chosen categories'} and areas you pick are masked.
          Turning this off or stopping the recording restores the page instantly.
        </p>
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between gap-2 whitespace-nowrap text-[10px] tracking-tight text-studio-meta px-1">
        <span className="ss-num shrink-0">Hardware 60fps · $0 Server Cost</span>
        <button
          onClick={handleOpenStudio}
          className="ss-btn p-0 shrink-0 text-[10px] text-[#93C5FD] hover:text-[#DBEAFE] underline underline-offset-2"
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
