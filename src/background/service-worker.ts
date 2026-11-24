// SmoothStudio Manifest V3 Service Worker with Persistent Session State & Keepalive

interface SessionState {
  activeRecordingTabId: number | null;
  activeEditorTabId: number | null;
  isRecording: boolean;
  quality?: string;
  /** Recording session id (M1-08): shared by the video, the telemetry and the editor. */
  activeSessionId?: string | null;
}

import { mergeTelemetrySegments, segmentKey, TelemetrySegment } from './telemetry-merge';
import { untrackablePage } from '../engine/restricted-pages';

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

/**
 * Bumped on every in-memory write. `loadSessionState()` reads asynchronously;
 * a start/stop that lands while that read is in flight leaves memory newer than
 * the snapshot it is about to apply, so the snapshot must be discarded.
 */
let stateRevision = 0;
/** True while a persist is still being written: memory is newer than storage. */
let pendingStateWrites = 0;

async function loadSessionState(): Promise<SessionState> {
  // A persisted write that has not landed yet would make this read apply an
  // OLD snapshot over the newer in-memory state.
  if (pendingStateWrites > 0) return state;
  const revisionAtStart = stateRevision;
  try {
    const data: Record<string, any> = await getStorageArea().get(['activeRecordingTabId', 'activeEditorTabId', 'isRecording', 'quality', 'activeSessionId']);
    if (revisionAtStart !== stateRevision) return state;
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
  stateRevision++;
  pendingStateWrites++;
  try {
    await getStorageArea().set(partial);
  } catch (err) {
    console.warn('[SmoothStudio SW] Failed to persist session state:', err);
  } finally {
    pendingStateWrites--;
  }
}

/**
 * Recording context that must outlive a page load of the recorded tab.
 * Kept in storage.session so it also survives the service worker idling:
 * - recordingOriginEpoch: the instant the video's first picture was shown. A
 *   page that loads mid-recording measures its timestamps against it.
 * - activePrivacyOptions: the shield categories the user turned on.
 * - segment index: the keys of the telemetry segments handed over by pages that
 *   have since been left (navigation / reload).
 */
const CTX_ORIGIN_KEY = 'recordingOriginEpoch';
const CTX_PRIVACY_KEY = 'activePrivacyOptions';
const SEGMENT_INDEX_KEY = 'smoothstudio_seg_index';

async function readRecordingContext(): Promise<{ originEpoch: number | null; privacyOptions: Record<string, boolean> | null }> {
  const data: Record<string, any> = await getStorageArea().get([CTX_ORIGIN_KEY, CTX_PRIVACY_KEY]).catch(() => ({}));
  return {
    originEpoch: typeof data[CTX_ORIGIN_KEY] === 'number' ? data[CTX_ORIGIN_KEY] : null,
    privacyOptions: data[CTX_PRIVACY_KEY] && typeof data[CTX_PRIVACY_KEY] === 'object' ? data[CTX_PRIVACY_KEY] : null
  };
}

// Segment writes are read-modify-write on the index: serialise them.
let segmentQueue: Promise<unknown> = Promise.resolve();
function queueSegmentOp<T>(op: () => Promise<T>): Promise<T> {
  const next = segmentQueue.then(op, op);
  segmentQueue = next.catch(() => undefined);
  return next;
}

function storeSegment(segment: TelemetrySegment): Promise<boolean> {
  return queueSegmentOp(async () => {
    try {
      const key = segmentKey(segment);
      const idx: Record<string, any> = await getStorageArea().get([SEGMENT_INDEX_KEY]);
      const keys: string[] = Array.isArray(idx[SEGMENT_INDEX_KEY]) ? idx[SEGMENT_INDEX_KEY] : [];
      if (!keys.includes(key)) keys.push(key);
      await getStorageArea().set({ [key]: segment, [SEGMENT_INDEX_KEY]: keys });
      return true;
    } catch (err) {
      console.warn('[SmoothStudio SW] Failed to store telemetry segment:', err);
      return false;
    }
  });
}

function readSegments(sessionId: string | null): Promise<TelemetrySegment[]> {
  return queueSegmentOp(async () => {
    const idx: Record<string, any> = await getStorageArea().get([SEGMENT_INDEX_KEY]).catch(() => ({}));
    const keys: string[] = Array.isArray(idx[SEGMENT_INDEX_KEY]) ? idx[SEGMENT_INDEX_KEY] : [];
    if (keys.length === 0) return [];
    const stored: Record<string, any> = await getStorageArea().get(keys).catch(() => ({}));
    return keys
      .map((k) => stored[k] as TelemetrySegment | undefined)
      .filter((seg): seg is TelemetrySegment => Boolean(seg) && (seg!.sessionId || null) === (sessionId || null));
  });
}

/** Removes the segments of one session, or every segment when no session is named. */
function clearSegments(sessionId?: string | null): Promise<void> {
  return queueSegmentOp(async () => {
    const idx: Record<string, any> = await getStorageArea().get([SEGMENT_INDEX_KEY]).catch(() => ({}));
    const keys: string[] = Array.isArray(idx[SEGMENT_INDEX_KEY]) ? idx[SEGMENT_INDEX_KEY] : [];
    const prefix = sessionId === undefined ? null : `smoothstudio_seg:${sessionId}:`;
    const doomed = prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
    const kept = keys.filter((k) => !doomed.includes(k));
    await getStorageArea().remove(doomed).catch(() => undefined);
    await getStorageArea().set({ [SEGMENT_INDEX_KEY]: kept }).catch(() => undefined);
  });
}

/**
 * Why an end request did or did not close a session.
 * - `ended`: this call transitioned the live session to stopped.
 * - `stale`: the caller named a session that is no longer the live one.
 * - `superseded`: the session ended, but a NEWER one started while its
 *   telemetry was being collected; the newer session's state is untouched.
 * - `not_recording`: there was nothing to end.
 */
type EndReason = 'ended' | 'stale' | 'superseded' | 'not_recording';

interface EndSessionResult {
  telemetry: any;
  sessionId: string | null;
  ended: boolean;
  reason: EndReason;
}

/**
 * Ends the recording session on the RECORDED tab: STOP_TELEMETRY removes the
 * HUD and returns the telemetry, which is tagged with the session id and
 * persisted. The SW state is reset. Every stop path goes through here, so the
 * telemetry of a session is collected exactly once and never mixed with
 * another session's.
 */
interface InFlightEnd {
  target: string | null;
  promise: Promise<EndSessionResult>;
}
let endInFlight: InFlightEnd | null = null;
async function endRecordingSession(expectedSessionId: string | null = null): Promise<EndSessionResult> {
  // Concurrent stops for the SAME session share one telemetry collection. A
  // stop for a DIFFERENT (newer) session waits for the in-flight one to
  // settle and then gets its own attempt: it must never be answered with the
  // old session's result and silently leave the new recording running.
  while (endInFlight) {
    const inflight = endInFlight;
    const result = await inflight.promise;
    if (expectedSessionId !== null && inflight.target === expectedSessionId) {
      return result;
    }
  }

  let promise: Promise<EndSessionResult> | null = null;
  promise = (async (): Promise<EndSessionResult> => {
    const curr = await loadSessionState();
    const sessionId = curr.activeSessionId || null;

    // A stop is only valid for the session that is live right now. Without
    // this check a late HUD/editor stop would kill the recording that
    // replaced its own.
    if (expectedSessionId && sessionId && expectedSessionId !== sessionId) {
      return { telemetry: null, sessionId, ended: false, reason: 'stale' };
    }

    if (!curr.isRecording) {
      // Already ended (another stop path got here first): hand out what was
      // stored for THIS session, if anything. A late retry of an old session's
      // stop must never hand the UI the telemetry of a different session.
      const stored = await chrome.storage.local.get(['smoothstudio_telemetry']).catch(() => ({} as any));
      const t = (stored as any)?.smoothstudio_telemetry || null;
      const lastId = (await getStorageArea().get(['lastSessionId']).catch(() => ({} as any)) as any)?.lastSessionId || null;
      const belongsToRequest =
        !expectedSessionId ||
        (t?.metadata?.sessionId === expectedSessionId && lastId === expectedSessionId);
      return {
        telemetry: t && lastId && t.metadata?.sessionId === lastId && belongsToRequest ? t : null,
        sessionId: lastId,
        ended: false,
        reason: 'not_recording'
      };
    }
    const tabId = curr.activeRecordingTabId;
    let telemetry: any = null;
    let finalResponse: any = null;
    if (tabId) {
      finalResponse = await new Promise<any>((resolve) => {
        let done = false;
        const finish = (v: any) => { if (!done) { done = true; resolve(v); } };
        try {
          chrome.tabs.sendMessage(tabId, { type: 'STOP_TELEMETRY', sessionId }, (response) => {
            void chrome.runtime?.lastError; // the tab may be gone
            finish(response || null);
          });
        } catch { finish(null); }
        setTimeout(() => finish(null), STOP_TELEMETRY_TIMEOUT_MS);
      });
      telemetry = finalResponse?.data || null;
    }
    // Pages the recorded tab went through (navigation / reload) handed their
    // telemetry over in segments: stitch them and the last page into one stream.
    const handedOver = await readSegments(sessionId);
    const unacked: TelemetrySegment[] = Array.isArray(finalResponse?.unacked) ? finalResponse.unacked : [];
    if (handedOver.length > 0 || unacked.length > 0) {
      const ctx = await readRecordingContext();
      const all = [...handedOver, ...unacked];
      const finalOrigin = typeof finalResponse?.originEpoch === 'number' ? finalResponse.originEpoch : null;
      const referenceOrigin = ctx.originEpoch
        ?? finalOrigin
        ?? [...all].sort((a, b) => a.originEpoch - b.originEpoch)[0].originEpoch;
      telemetry = mergeTelemetrySegments({
        sessionId,
        referenceOrigin,
        segments: all,
        final: { data: telemetry, originEpoch: finalOrigin }
      });
    }
    await clearSegments(sessionId);
    if (telemetry && telemetry.metadata) {
      telemetry.metadata.sessionId = sessionId || telemetry.metadata.sessionId;
      await chrome.storage.local.set({
        smoothstudio_telemetry: telemetry,
        'smoothstudio_telemetry.json': telemetry
      }).catch(() => undefined);
      console.log('[SmoothStudio SW] Telemetry persisted at epoch', Date.now());
    }

    // Compare-and-set: collecting the telemetry above yields to the event
    // loop, so a NEW recording can start in the meantime. Only reset the
    // state if the session that was live when we started is still the live
    // one; otherwise the start already owns the state.
    const latest = await loadSessionState();
    const stillTheSameSession = latest.isRecording
      && (latest.activeSessionId || null) === sessionId
      && latest.activeRecordingTabId === tabId;
    if (!stillTheSameSession) {
      return {
        telemetry: telemetry && telemetry.metadata ? telemetry : null,
        sessionId,
        ended: false,
        reason: 'superseded'
      };
    }

    // Mark the ended session BEFORE the state says "idle": a concurrent stop
    // that sees isRecording=false must be able to hand out this session's
    // telemetry (and never a different session's).
    await getStorageArea().set({ lastSessionId: sessionId }).catch(() => undefined);
    await persistSessionState({ isRecording: false, activeRecordingTabId: null, activeSessionId: null });
    return {
      telemetry: telemetry && telemetry.metadata ? telemetry : null,
      sessionId,
      ended: true,
      reason: 'ended'
    };
  })().finally(() => {
    // Clear the slot before any waiter resumes, so a stop for another session
    // can start its own attempt immediately.
    if (endInFlight && endInFlight.promise === promise) endInFlight = null;
  });
  endInFlight = { target: expectedSessionId, promise };
  return promise;
}

/**
 * Sends a message to the editor tab that owns the recorder. When the tab id is
 * not known (the editor registered late) the first editor tab is used, exactly
 * like the stop path's fallback.
 */
/**
 * Send a message to the editor tab with retry-and-ack. The SW can restart
 * mid-stop, so a single fire-and-forget sendMessage can be dropped. Retry up
 * to `retries` times; `onResult(true)` fires once the editor acknowledges,
 * `onResult(false)` when every attempt went unanswered.
 */
function sendEditorWithAck(
  tabId: number,
  payload: any,
  retries: number,
  onResult?: (acked: boolean) => void
): void {
  const attempt = (remaining: number) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      if (chrome.runtime?.lastError || !response) {
        if (remaining > 0) {
          setTimeout(() => attempt(remaining - 1), 100);
        } else {
          onResult?.(false);
        }
        return;
      }
      onResult?.(true);
    });
  };
  attempt(retries);
}

function notifyEditorCapture(tabId: number | null | undefined, payload: any): void {
  if (tabId) {
    sendEditorWithAck(tabId, payload, 3);
    return;
  }
  chrome.tabs.query({ url: chrome.runtime.getURL('editor.html*') }, (tabs) => {
    if (tabs.length > 0 && tabs[0].id) {
      persistSessionState({ activeEditorTabId: tabs[0].id }).catch(() => {});
      sendEditorWithAck(tabs[0].id, payload, 3);
    }
  });
}

type TabDispatchResult = {
  tabId: number;
  ok: boolean;
  reason?: string;
  response?: any;
};

/** A normal web page an extension may run on (the Chrome Web Store, for one, is https but off-limits). */
function isWebTab(tab: chrome.tabs.Tab): boolean {
  if (!tab.url) return true;
  return (tab.url.startsWith('http://') || tab.url.startsWith('https://')) && !untrackablePage(tab.url);
}

function isMissingReceiver(reason: string | undefined): boolean {
  return /receiving end does not exist|could not establish connection/i.test(reason || '');
}

function sendTabMessageWithAck(tabId: number, message: any): Promise<{ ok: boolean; response?: any; reason?: string }> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const error = chrome.runtime?.lastError;
        if (error) {
          resolve({ ok: false, reason: error.message });
          return;
        }
        if (response?.ok === true) {
          resolve({ ok: true, response });
          return;
        }
        resolve({ ok: false, response, reason: 'missing_ack' });
      });
    } catch (error) {
      resolve({ ok: false, reason: error instanceof Error ? error.message : String(error) });
    }
  });
}

async function dispatchToTab(tab: chrome.tabs.Tab, message: any): Promise<TabDispatchResult> {
  const tabId = tab.id;
  if (typeof tabId !== 'number') return { tabId: -1, ok: false, reason: 'missing_tab_id' };
  if (!isWebTab(tab)) return { tabId, ok: false, reason: 'restricted_page' };

  const first = await sendTabMessageWithAck(tabId, message);
  if (first.ok) return { tabId, ok: true, response: first.response };
  if (!isMissingReceiver(first.reason)) return { tabId, ok: false, reason: first.reason };

  try {
    // The shield must cover every frame (the manifest registers it with
    // all_frames), so a repaired tab gets it in cross-origin iframes too.
    // The tracker is top-frame only: its message listener is top-frame only
    // and sub-frames must never emit a second stream of mouse telemetry.
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content/privacy-redactor.js']
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/dom-tracker.js']
    });
  } catch (error) {
    return { tabId, ok: false, reason: 'injection_failed' };
  }

  const retry = await sendTabMessageWithAck(tabId, message);
  return retry.ok
    ? { tabId, ok: true, response: retry.response }
    : { tabId, ok: false, reason: retry.reason };
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

/**
 * The recorded tab finished loading a page (navigation or reload): the new page
 * has none of the old page's state, so it is re-armed here. It joins the
 * recording that is already running (same session, same origin) and gets the
 * privacy shield applied again, in every frame.
 */
async function rearmRecordedTab(tab: chrome.tabs.Tab): Promise<void> {
  const curr = await loadSessionState();
  if (!curr.isRecording || tab.id !== curr.activeRecordingTabId) return;
  const ctx = await readRecordingContext();
  if (ctx.privacyOptions) {
    const shield = await dispatchToTab(tab, { type: 'APPLY_PRIVACY_OPTIONS', options: ctx.privacyOptions });
    if (!shield.ok) console.warn('[SmoothStudio SW] Privacy shield not re-applied after navigation:', shield.reason);
  }
  let originEpoch = ctx.originEpoch;
  if (originEpoch === null) {
    const earlier = await readSegments(curr.activeSessionId || null);
    originEpoch = earlier.length ? Math.min(...earlier.map((seg) => seg.originEpoch)) : Date.now();
  }
  const res = await dispatchToTab(tab, {
    type: 'START_TELEMETRY',
    originEpoch,
    sessionId: curr.activeSessionId || null,
    resume: true
  });
  if (!res.ok) console.warn('[SmoothStudio SW] Telemetry not re-armed after navigation:', res.reason);
}

chrome.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  rearmRecordedTab({ ...tab, id: tab?.id ?? tabId }).catch(() => undefined);
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
      // A new recording starts with no telemetry from an earlier one and with
      // the provisional origin it was given (RECORDING_LIVE makes it exact).
      const provisionalOrigin = Number(message.originEpoch);
      // A session that is still live (its editor died, or its stop never
      // arrived) is ended first, on ITS tab: otherwise that tab keeps its HUD
      // and keeps tracking forever, because the new session's stop only
      // reaches the new recorded tab.
      const endPrevious = loadSessionState()
        .then((prev) => (prev.isRecording && (prev.activeSessionId || null) !== sessionId
          ? endRecordingSession(prev.activeSessionId || null).then(() => undefined)
          : undefined))
        .catch(() => undefined);
      const resetContext = endPrevious.then(() => clearSegments()).then(() => (
        Number.isFinite(provisionalOrigin) && provisionalOrigin > 0
          ? getStorageArea().set({ [CTX_ORIGIN_KEY]: provisionalOrigin })
          : getStorageArea().remove(CTX_ORIGIN_KEY)
      )).catch(() => undefined);
      resetContext.then(() => persistSessionState({
        isRecording: true,
        activeRecordingTabId: targetRecordingTabId,
        activeEditorTabId: editorTabId,
        quality,
        activeSessionId: sessionId
      })).then(() => {
        // START_TELEMETRY goes to the recorded tab only: the stop only ever
        // reaches that tab, so any other tab started here would keep its HUD
        // and keep tracking after the recording ended.
        // `originEpoch` is the wall-clock timestamp of the first captured video
        // frame: sharing it makes telemetry time and video time use ONE clock.
        const originEpoch = message.originEpoch;
        chrome.tabs.query({}, (tabs) => {
          const targets = tabs.filter((tab) => typeof tab.id === 'number' && tab.id === targetRecordingTabId);
          Promise.all(targets.map((tab) => dispatchToTab(tab, { type: 'START_TELEMETRY', originEpoch, sessionId })))
            .then((results) => {
              for (const result of results) {
                if (!result.ok) console.warn('[SmoothStudio SW] START_TELEMETRY failed for tab', result.tabId, result.reason);
              }
              sendResponse({ status: 'recording_started', activeRecordingTabId: targetRecordingTabId, quality, sessionId, telemetry: results });
            });
        });

        // Focus target tab if requested
        if (message.focusTarget && targetRecordingTabId) {
          chrome.tabs.update(targetRecordingTabId, { active: true }).catch(() => {});
        }

      });
    };

    if (recordingTabId) {
      dispatchStart(recordingTabId);
    } else {
      // No tab named: track a page clicks CAN be tracked on. The tab in front in the last
      // focused window first, then the active web tab of any window, then any web tab.
      // Never the editor, and never a page Chrome closes to extensions (Web Store, chrome://):
      // those would record no clicks at all.
      const trackable = (t: chrome.tabs.Tab) => typeof t.id === 'number' && t.id !== editorTabId && Boolean(t.url) && isWebTab(t);
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (focused) => {
        const inFront = (focused || []).find(trackable);
        if (inFront?.id) {
          dispatchStart(inFront.id);
          return;
        }
        chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }, (webTabs) => {
          const candidates = (webTabs || []).filter(trackable);
          const chosen = candidates.find((t) => t.active) || candidates[0];
          dispatchStart(chosen?.id ?? null);
        });
      });
    }
    return true;
  }

  // 3b. The recorder started its timeline (QA-037). The recorded surface is
  // really on screen at this instant, so it is the single origin shared by the
  // video, the audio and the telemetry of the recorded tab.
  if (message.type === 'RECORDING_LIVE') {
    const epoch = Math.round(Number(message.epoch));
    if (!Number.isFinite(epoch) || epoch <= 0) {
      sendResponse({ status: 'invalid_origin' });
      return true;
    }
    loadSessionState().then(async (curr) => {
      const tabId = curr.activeRecordingTabId;
      const sessionId = typeof message.sessionId === 'string' ? message.sessionId : curr.activeSessionId;
      // Pages the recorded tab loads from now on measure against this instant.
      await getStorageArea().set({ [CTX_ORIGIN_KEY]: epoch }).catch(() => undefined);
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { type: 'TIMELINE_ORIGIN', epoch, sessionId }, () => {
          void chrome.runtime?.lastError;
        });
      }
      console.log('[SmoothStudio SW] Recording live origin shared at epoch', epoch, 'with tab', tabId);
      sendResponse({ status: 'live_origin_shared', epoch });
    });
    return true;
  }

  // 4. Stop Studio Recording
  // Stop paths: the on-page HUD, the popup, and the editor itself (its Stop
  // button, Chrome's "Stop sharing" bar). The response carries the session's
  // telemetry once it has been collected.
  if (message.type === 'STOP_STUDIO_RECORDING') {
    const wanted: string | null = typeof message.sessionId === 'string' ? message.sessionId : null;
    console.log('[SmoothStudio SW] STOP requested at epoch', Date.now(), 'for session', wanted);
    loadSessionState().then(async (currState) => {
      const editorTabId = currState.activeEditorTabId;
      const fromEditor = Boolean(sender.tab?.id && editorTabId && sender.tab.id === editorTabId);

      // QA-029: the recorder lives in the editor, and the video must end at the
      // instant the user pressed stop. Collecting the telemetry (a round trip to
      // the recorded tab plus a storage write) took ~0.6 s on a 20 s session, so
      // the editor is told to stop NOW and the telemetry follows it: the editor
      // asks for the telemetry itself (its second STOP shares this in-flight
      // end), and the final notify below still delivers it with the session.
      const ownsLiveSession = currState.isRecording
        && (!wanted || !currState.activeSessionId || currState.activeSessionId === wanted);
      if (!fromEditor && ownsLiveSession) {
        notifyEditorCapture(editorTabId, { type: 'STUDIO_STOP_CAPTURE', sessionId: currState.activeSessionId });
        console.log('[SmoothStudio SW] Editor told to stop at epoch', Date.now());
      }

      const result = await endRecordingSession(wanted);

      if (!result.ended) {
        // Even when the SW didn't own this session's end (stale/superseded/
        // not_recording), the editor may still be recording and needs to know
        // to stop so the recording reaches it. Never forward a stop for a
        // session that is not the live one: it would kill a newer recording.
        const targetSessionId = currState.activeSessionId;
        const refersToLiveSession = !wanted || !targetSessionId || targetSessionId === wanted;
        if (editorTabId && !fromEditor && refersToLiveSession) {
          notifyEditorCapture(editorTabId, { type: 'STUDIO_STOP_CAPTURE', sessionId: targetSessionId });
          console.log('[SmoothStudio SW] Editor told to stop (non-ended session) at epoch', Date.now());
        }
        const status = result.reason === 'stale'
          ? 'stop_ignored'
          : result.reason === 'superseded'
            ? 'stop_superseded'
            : 'not_recording';
        sendResponse({ status, telemetry: result.telemetry, sessionId: result.sessionId });
        return;
      }

      const { telemetry, sessionId } = result;

      // The recorder lives in the editor: tell it to stop (unless it asked).
      // QA-029: the editor brings its own tab forward once the encoder has
      // stopped (screen-recorder.ts). Activating it here, at the stop request,
      // made Chromium composite the tab switch into the last frames. Only a
      // missing editor (sendMessage error) is activated as a fallback.
      const notify = (tabId: number) => {
        sendEditorWithAck(tabId, { type: 'STUDIO_STOP_CAPTURE', telemetry, sessionId }, 3, (acked) => {
          if (acked) return;
          // Fallback only: activate the editor tab so the user sees the stop
          // even if the SW is restarting and the message was never delivered.
          // Never do this on a delivered stop: activating the tab at stop time
          // made Chromium composite the tab switch into the last frames
          // (QA-029).
          chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
        });
      };
      if (!fromEditor) {
        if (editorTabId) {
          notify(editorTabId);
        } else {
          chrome.tabs.query({ url: chrome.runtime.getURL('editor.html*') }, (tabs) => {
            if (tabs.length > 0 && tabs[0].id) {
              persistSessionState({ activeEditorTabId: tabs[0].id }).catch(() => {});
              notify(tabs[0].id);
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
    const wanted: string | null = typeof message.sessionId === 'string' ? message.sessionId : null;
    loadSessionState().then(async (currState) => {
      if (currState.isRecording && (!wanted || !currState.activeSessionId || currState.activeSessionId === wanted)) {
        const res = await endRecordingSession(wanted);
        sendResponse({ status: res.ended ? 'session_recovered' : 'not_recording', ...res });
      } else {
        const res = await endRecordingSession(wanted); // not recording: returns what was stored
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

  // 5b. A page of the recorded tab hands over what it captured so far. The
  // page may be unloaded at any moment (navigation, reload): what has been
  // stored here survives it.
  if (message.type === 'TELEMETRY_SEGMENT') {
    const segment = message.segment as TelemetrySegment | undefined;
    loadSessionState().then(async (curr) => {
      const belongs = Boolean(segment) && curr.isRecording
        && typeof sender.tab?.id === 'number' && sender.tab.id === curr.activeRecordingTabId
        && (segment!.sessionId || null) === (curr.activeSessionId || null);
      if (!belongs) {
        sendResponse({ ok: false, reason: 'not_the_recorded_tab' });
        return;
      }
      sendResponse({ ok: await storeSegment(segment!) });
    });
    return true;
  }

  // 5c. A cross-origin iframe of the recorded tab: is the tab being recorded?
  if (message.type === 'FRAME_TRACKING_STATUS') {
    loadSessionState().then((curr) => {
      sendResponse({ recording: curr.isRecording && typeof sender.tab?.id === 'number' && sender.tab.id === curr.activeRecordingTabId });
    });
    return true;
  }

  // 5d. Pointer events of a cross-origin iframe (the top page cannot see them):
  // relayed to the top page of the same tab, which records them in its stream.
  if (message.type === 'FRAME_TELEMETRY') {
    const tabId = sender.tab?.id;
    loadSessionState().then((curr) => {
      if (!curr.isRecording || typeof tabId !== 'number' || tabId !== curr.activeRecordingTabId || !Array.isArray(message.events)) {
        sendResponse({ ok: false });
        return;
      }
      try {
        chrome.tabs.sendMessage(tabId, { type: 'FRAME_TELEMETRY', events: message.events }, { frameId: 0 }, () => {
          void chrome.runtime?.lastError;
          sendResponse({ ok: true });
        });
      } catch {
        sendResponse({ ok: false });
      }
    });
    return true;
  }

  // 6. Forward Privacy & Redaction Messages to Tabs
  if (['APPLY_PRIVACY_OPTIONS', 'START_PICKER', 'STOP_PICKER', 'RESET_PRIVACY'].includes(message.type)) {
    // Remember the shield configuration: a page the recorded tab navigates to
    // gets it applied again (the page's own state is gone with the old page).
    if (message.type === 'APPLY_PRIVACY_OPTIONS') {
      getStorageArea().set({ [CTX_PRIVACY_KEY]: message.options || {} }).catch(() => undefined);
    } else if (message.type === 'RESET_PRIVACY') {
      getStorageArea().remove(CTX_PRIVACY_KEY).catch(() => undefined);
    }
    // A message that names a tab (the popup's Start) only goes to that tab: it
    // must not inject the shield into every open page, and its result is the
    // answer to "did the shield reach the page I am about to record?".
    const onlyTabId = typeof message.tabId === 'number' ? message.tabId : null;
    chrome.tabs.query({}, (tabs) => {
      Promise.all(tabs
        .filter((tab) => typeof tab.id === 'number' && (onlyTabId === null || tab.id === onlyTabId))
        .map((tab) => dispatchToTab(tab, message)))
        .then((results) => sendResponse({ status: 'forwarded', results }));
    });
    return true;
  }

  return false;
});
