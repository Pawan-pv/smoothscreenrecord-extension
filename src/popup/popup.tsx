import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { Video, Mic, EyeOff, Shield, Sparkles, Sliders, ExternalLink } from 'lucide-react';
import '../index.css';

export function PopupApp() {
  const [isRecording, setIsRecording] = useState(false);
  const [includeMic, setIncludeMic] = useState(true);
  const [blurEmails, setBlurEmails] = useState(true);
  const [blurRevenue, setBlurRevenue] = useState(true);
  const [blurApiKeys, setBlurApiKeys] = useState(true);
  const [pickerActive, setPickerActive] = useState(false);

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' }, (res) => {
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

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'APPLY_PRIVACY_OPTIONS',
            options: {
              blurEmails: key === 'emails' ? val : blurEmails,
              blurRevenue: key === 'revenue' ? val : blurRevenue,
              blurApiKeys: key === 'keys' ? val : blurApiKeys
            }
          }).catch(() => {});
        }
      });
    }
  };

  const handleTogglePicker = () => {
    const nextState = !pickerActive;
    setPickerActive(nextState);

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: nextState ? 'START_PICKER' : 'STOP_PICKER'
          }).catch(() => {});
        }
      });
    }
  };

  const handleStartRecording = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        // Apply privacy settings first
        if (activeTab?.id) {
          chrome.tabs.sendMessage(activeTab.id, {
            type: 'APPLY_PRIVACY_OPTIONS',
            options: { blurEmails, blurRevenue, blurApiKeys }
          }).catch(() => {});
        }

        // Open studio tab with live recording prompt
        chrome.tabs.create({ url: chrome.runtime.getURL('editor.html?record=true') });
        window.close();
      });
    } else {
      // In standalone browser mode, redirect to studio editor with recording prompt
      window.open('/editor.html?record=true', '_blank');
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
            onClick={() => {
              if (typeof chrome !== 'undefined' && chrome.runtime) {
                chrome.runtime.sendMessage({ type: 'STOP_STUDIO_RECORDING' });
                setIsRecording(false);
              }
            }}
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

      {/* Privacy Redaction Superpowers */}
      <div className="space-y-2 bg-[#14161D] p-3 rounded-xl border border-white/5 mb-4">
        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-200 mb-2">
          <Shield className="w-3.5 h-3.5 text-emerald-400" />
          Pre-Recording Privacy Shield ($0 Leak)
        </div>

        <div className="space-y-1.5 text-[11px]">
          <label className="flex items-center justify-between text-gray-300 hover:text-white cursor-pointer py-1">
            <span>Auto-Blur Emails</span>
            <input
              type="checkbox"
              checked={blurEmails}
              onChange={(e) => handleTogglePrivacy('emails', e.target.checked)}
              className="rounded bg-gray-800 border-gray-600 text-purple-600 focus:ring-0"
            />
          </label>

          <label className="flex items-center justify-between text-gray-300 hover:text-white cursor-pointer py-1">
            <span>Auto-Blur Revenue & Numbers</span>
            <input
              type="checkbox"
              checked={blurRevenue}
              onChange={(e) => handleTogglePrivacy('revenue', e.target.checked)}
              className="rounded bg-gray-800 border-gray-600 text-purple-600 focus:ring-0"
            />
          </label>

          <label className="flex items-center justify-between text-gray-300 hover:text-white cursor-pointer py-1">
            <span>Auto-Blur API Keys & Secrets</span>
            <input
              type="checkbox"
              checked={blurApiKeys}
              onChange={(e) => handleTogglePrivacy('keys', e.target.checked)}
              className="rounded bg-gray-800 border-gray-600 text-purple-600 focus:ring-0"
            />
          </label>
        </div>

        <button
          onClick={handleTogglePicker}
          className={`mt-2 w-full py-1.5 text-xs rounded-lg border flex items-center justify-center gap-1.5 transition-colors ${
            pickerActive
              ? 'bg-purple-600/30 border-purple-500 text-purple-200'
              : 'bg-white/5 border-white/10 hover:bg-white/10 text-gray-300'
          }`}
        >
          <EyeOff className="w-3 h-3" />
          {pickerActive ? 'Active: Click Elements on Page to Blur' : 'Interactive Click-to-Blur Picker'}
        </button>
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
