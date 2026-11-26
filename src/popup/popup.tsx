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
    chrome.runtime.sendMessage({ type: 'GET_PRIVACY_STATUS' }, (res) => {
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
    <div className="w-[360px] bg-[#0B0C10] text-[#F3F4F6] p-4 select-none font-sans border border-white/10 rounded-xl shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-purple-500/30">
            <Video className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-white flex items-center gap-1.5">
              SmoothStudio <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded font-mono">v1.0</span>
            </h1>
            <p className="text-[11px] text-gray-400">Cinematic 3D Auto-Zoom Screen Recorder</p>
          </div>
        </div>
        <button
          onClick={handleOpenStudio}
          title="Open Studio Workspace"
          className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
        </button>
      </div>

      {/* Main Action Button */}
      <div className="mb-4">
        {isRecording ? (
          <button
            onClick={handleStopRecording}
            className="w-full py-3 px-4 bg-red-600 hover:bg-red-500 text-white font-medium rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-red-600/30 transition-all active:scale-[0.98]"
          >
            <div className="w-2.5 h-2.5 rounded-sm bg-white animate-pulse" />
            Stop Recording & Open Studio
          </button>
        ) : (
          <button
            onClick={handleStartRecording}
            className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-purple-600/30 transition-all active:scale-[0.98] group"
          >
            <Sparkles className="w-4 h-4 text-purple-200 group-hover:rotate-12 transition-transform" />
            Start Studio Recording
          </button>
        )}
      </div>

      {shieldNotice && (
        <div
          id="shield-notice"
          role="alert"
          className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-100"
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
                className="rounded-lg bg-amber-500/25 px-2.5 py-1 font-medium text-amber-50 hover:bg-amber-500/40"
              >
                Record anyway
              </button>
            )}
            <button
              id="shield-notice-dismiss"
              onClick={() => setShieldNotice(null)}
              className="rounded-lg border border-white/15 px-2.5 py-1 text-gray-300 hover:bg-white/10"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {untrackable && (
        <div className="mb-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] leading-relaxed text-amber-200">
          Chrome does not let extensions work on {untrackable}, so clicks here cannot be tracked: the recording will have
          no auto-zoom and no styled cursor. Open a normal website to record with auto-zoom.
        </div>
      )}

      {/* Recording Controls */}
      <div className="space-y-3 bg-[#14161D] p-3 rounded-xl border border-white/5 mb-4">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-2 text-gray-300">
            <Mic className="w-3.5 h-3.5 text-purple-400" />
            Microphone Audio
          </span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={includeMic}
              onChange={(e) => setIncludeMic(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-8 h-4 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-purple-600"></div>
          </label>
        </div>
      </div>

      {/* Privacy Shield — strictly opt-in and surgical */}
      <div className="space-y-2 bg-[#14161D] p-3 rounded-xl border border-white/5 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-medium text-gray-200">
            <Shield className={`w-3.5 h-3.5 ${prefs.enabled ? 'text-emerald-400' : 'text-gray-500'}`} />
            Privacy Shield
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.enabled}
            aria-label="Privacy Shield"
            onClick={() => applyAndSave({ ...prefs, enabled: !prefs.enabled })}
            className={`relative w-10 h-5 rounded-full transition-colors ${prefs.enabled ? 'bg-emerald-500' : 'bg-gray-700'}`}
          >
            <span
              className={`absolute top-[2px] left-[2px] w-4 h-4 rounded-full bg-white transition-transform ${prefs.enabled ? 'translate-x-5' : ''}`}
            />
          </button>
        </div>

        {prefs.enabled && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {CATEGORIES.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                aria-pressed={prefs[key]}
                onClick={() => applyAndSave({ ...prefs, [key]: !prefs[key] })}
                className={`rounded-full px-2.5 py-1 text-[10px] border transition-colors ${
                  prefs[key]
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-gray-400" aria-live="polite">
            {maskedCount} item{maskedCount === 1 ? '' : 's'} masked
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleTogglePicker}
              className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] border transition-colors ${
                pickerActive
                  ? 'bg-purple-600/30 border-purple-500 text-purple-200'
                  : 'bg-white/5 border-white/10 hover:bg-white/10 text-gray-300'
              }`}
            >
              <EyeOff className="w-3 h-3" />
              {pickerActive ? 'Click page to blur · Esc' : 'Pick areas to blur'}
            </button>
            <button
              type="button"
              onClick={handleClearPicks}
              title="Clear manually picked areas"
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] border bg-white/5 border-white/10 hover:bg-white/10 text-gray-300"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          </div>
        </div>
        <p className="text-[10px] leading-relaxed text-gray-500">
          Only credentials, {prefs.enabled ? 'the enabled categories' : 'chosen categories'} and areas you pick are masked.
          Turning this off or stopping the recording restores the page instantly.
        </p>
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between text-[10px] text-gray-500 px-1">
        <span>Hardware 60fps • Zero Server Cost</span>
        <button
          onClick={handleOpenStudio}
          className="text-purple-400 hover:text-purple-300 underline underline-offset-2"
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
