---
phase: smoothscreenrecord
reviewed: 2026-11-09
depth: deep
files_reviewed: 24
files_reviewed_list:
  - src/background/service-worker.ts
  - src/content/dom-tracker.ts
  - src/content/privacy-redactor.ts
  - src/editor/CanvasPreview.tsx
  - src/editor/EditorStudio.tsx
  - src/editor/MagneticTimeline.tsx
  - src/editor/VibePresetsPanel.tsx
  - src/engine/audio-processor.ts
  - src/engine/cursor-spline.ts
  - src/engine/gif-exporter.ts
  - src/engine/html-widget-exporter.ts
  - src/engine/mp4-exporter.ts
  - src/engine/opfs-storage.ts
  - src/engine/renderer.ts
  - src/engine/screen-recorder.ts
  - src/engine/sop-guide-exporter.ts
  - src/engine/spring-physics.ts
  - src/main.tsx
  - src/offscreen/recorder-worker.ts
  - src/popup/popup.tsx
  - src/types/telemetry.ts
findings:
  critical: 1
  warning: 7
  info: 5
  total: 13
status: issues_found
---

# SmoothStudio Code Review Report

## Summary

Deep review of the TypeScript/React source in `src/`. Build (`tsc` + `vite build`) passes, but several runtime/logic defects exist across recording, preview, exports, UI, and extension loading. Most severe is a privacy-redaction bug that can leave PII unredacted due to stateful global regexes. Recording stop flow has reentrancy/double-processing that can cause duplicate setups and flaky telemetry. Other issues include stale React closures, overly restrictive display capture constraints, and mismatched snapshot timestamps.

## Critical Issues

### CR-01: Stateful global regexes cause privacy redaction to skip subsequent text nodes

**File:** `src/content/privacy-redactor.ts:28-38`
**Issue:** `EMAIL_REGEX`, `REVENUE_REGEX`, and `API_KEY_REGEX` are declared with the `g` flag and reused across `applyAutoRedaction` calls via `.test(content)`. `.test()` advances `lastIndex` on the shared regex object; on the next text node the search starts mid-string (or at the end), so emails/revenue/API keys in later nodes are frequently not detected and not redacted. This can leak PII in recordings.
**Fix:**
```ts
// Reset lastIndex before testing, or use a non-global regex for detection
EMAIL_REGEX.lastIndex = 0;
if (options.blurEmails && EMAIL_REGEX.test(content)) { ... }
```
Better: create local non-global regexes for `.test()` or use `String.prototype.match` with a fresh regex.

## Warnings

### WR-01: `handleStopLiveRecording` reentrancy and duplicate processing

**File:** `src/editor/EditorStudio.tsx:526-566` (and `src/engine/screen-recorder.ts:95-100`, `195-201`)
**Issue:** `handleStopLiveRecording` calls `captureEngine.stop()`, whose `onStop` handler is set to `() => handleStopLiveRecording()`. This re-invokes the whole stop flow inside `stop()`, then the outer call continues, producing duplicate `STOP_STUDIO_RECORDING` messages, duplicate `getRecordingBlob`/telemetry loads, and multiple `setupLoadedRecording` calls. Telemetry may be missing on the first pass, yielding flaky fallback recordings.
**Fix:** Do not route `captureEngine.stop()`'s `onStop` back into the full handler. Set `onStop` to a lightweight notifier (e.g. `() => setIsRecordingLive(false)`) or `null`, and let the UI/service-worker drive `handleStopLiveRecording`.

### WR-02: Stale closure in keyboard shortcut effect (`Z` adds pill at stale playhead)

**File:** `src/editor/EditorStudio.tsx:463-484`
**Issue:** The keydown effect depends only on `[durationMs]`, but `handleAddPillAtPlayhead` closes over `currentTimeMs` from the render when the effect was created. Pressing `Z` later adds the zoom pill at an outdated time.
**Fix:** Add `currentTimeMs` (and `handleAddPillAtPlayhead`) to the dependency array, or read the latest playhead via a ref.

### WR-03: Stale closure in editor tab message listener

**File:** `src/editor/EditorStudio.tsx:87-102`
**Issue:** The `STUDIO_STOP_CAPTURE` listener is registered once with the first render's `handleStopLiveRecording`. Later renders' updated handler (with current state/refs) is never used.
**Fix:** Re-register when `handleStopLiveRecording` changes, or store the latest handler in a ref and invoke `handlerRef.current`.

### WR-04: `displaySurface: 'browser'` restricts capture to browser tabs

**File:** `src/engine/screen-recorder.ts:38-47`
**Issue:** The display-media constraints force `displaySurface: 'browser'`, preventing users from selecting an entire screen or application window, despite the documented fullscreen/window fallback path.
**Fix:** Remove the `displaySurface` constraint (or make it optional) so the native picker offers screen/window/tab choices.

### WR-05: Snapshot timestamps are absolute but compared to relative telemetry times

**File:** `src/engine/screen-recorder.ts:157-159`; `src/engine/sop-guide-exporter.ts:60`; `src/engine/html-widget-exporter.ts:11`
**Issue:** Snapshots store `timestamp: performance.now()` (absolute, ~epoch ms), while click/keystroke `t` values are relative to recording start. `Math.abs(s.timestamp - ev.t)` never matches, so SOP/HTML exports never attach screenshots.
**Fix:** Store `timestamp: performance.now() - recordingStart` (or pass a base), or convert click times to absolute before matching. Align both sides.

### WR-06: `applyAutoRedaction` crashes when invoked before `document.body` exists

**File:** `src/content/privacy-redactor.ts:18`
**Issue:** Content scripts run at `document_start`. If privacy options are applied before `<body>` is parsed, `document.createTreeWalker(document.body, ...)` throws because `document.body` is null.
**Fix:** Guard with `if (!document.body) return;` or defer until `DOMContentLoaded`.

### WR-07: Playback SFX triggered inside `setCurrentTimeMs` state updater

**File:** `src/editor/EditorStudio.tsx:413-451`
**Issue:** Audio SFX calls and `setIsPlaying(false)` are invoked inside the state updater passed to `setCurrentTimeMs`. React may invoke updaters twice (StrictMode) and updaters should be pure, leading to duplicate sounds and timing glitches.
**Fix:** Compute `next` time outside the updater, perform side effects in the rAF loop body, then call `setCurrentTimeMs(next)`.

## Info

### IN-01: Broad API-key regex redacts ordinary long tokens

**File:** `src/content/privacy-redactor.ts:15`
**Issue:** `API_KEY_REGEX` matches any 32+ character alphanumeric string, which can over-redact UUIDs/hashes.
**Fix:** Tighten to known key prefixes or require entropy/length heuristics.

### IN-02: Object URL for recorded video is never revoked

**File:** `src/editor/EditorStudio.tsx` (`setupLoadedRecording`)
**Issue:** `URL.createObjectURL(blob)` is assigned to `video.src` but never revoked, leaking memory across recordings.
**Fix:** Revoke the previous object URL when replacing `videoElement` or on unmount.

### IN-03: Offscreen worker is effectively unused

**File:** `src/offscreen/recorder-worker.ts`
**Issue:** Only handles a `PING` message; recording capture runs in the editor tab. Dead/placeholder code.
**Fix:** Remove or implement actual offscreen capture usage.

### IN-04: `videoTrack.onended` calls async `stop()` without handling rejection

**File:** `src/engine/screen-recorder.ts:95-99`
**Issue:** `this.stop()` is fire-and-forget; failures are swallowed.
**Fix:** `this.stop().catch((e) => console.error(...))`.

### IN-05: Unhandled `video.play()` promise in frame-diff detector

**File:** `src/engine/screen-recorder.ts:119`
**Issue:** `video.play()` returns a promise that may reject under autoplay policy; unhandled rejection possible.
**Fix:** `video.play().catch(() => {})`.
---

_Reviewed: 2026-11-09_
_Reviewer: gsd-code-reviewer_
_Depth: deep_
