# SmoothStudio Architecture & Recording Flow Notes

## 1. Capture API
- **API Used**: `navigator.mediaDevices.getDisplayMedia` in `src/engine/screen-recorder.ts` (lines 46–65).
- **Options**:
  - `video: { frameRate: 60, cursor: 'never' }`
  - `audio: true` (system audio capture)
  - Optional `navigator.mediaDevices.getUserMedia({ audio: ... })` for microphone audio mixed into the media stream.
- **Offscreen Document / tabCapture**: While `tabCapture` and `offscreen` permissions exist in `manifest.json`, the active screen recording implementation is client-side in `ScreenCaptureEngine` via `navigator.mediaDevices.getDisplayMedia` and `MediaRecorder` (`video/webm; codecs=vp9,opus` or `vp8,opus`).

## 2. Popup to Service Worker Message & Target Tab Resolution
- **Popup action (`src/popup/popup.tsx`)**:
  - Clicking "Start Studio Recording" queries the active tab in the current window: `chrome.tabs.query({ active: true, currentWindow: true })`.
  - Dispatches `APPLY_PRIVACY_OPTIONS` to the active tab if it is an HTTP/HTTPS URL.
  - Opens `editor.html?record=true&sourceTab=${activeTabId}` in a new tab via `chrome.tabs.create`.
  - Closes the popup window (`window.close()`).
- **Editor startup (`src/editor/EditorStudio.tsx`)**:
  - On mount, if `record=true` is in the query parameters, it reads `sourceTab` and triggers `handleStartLiveRecording(sourceTabId)`.
  - Initiates display capture via `captureEngine.start(...)`.
  - Once capture starts, sends `{ type: 'START_STUDIO_RECORDING', tabId: sourceTabId, focusTarget: true }` to the service worker.
- **Service worker (`src/background/service-worker.ts`)**:
  - Listens for `START_STUDIO_RECORDING` (or `START_RECORDING`).
  - Persists session state (`isRecording: true`, `activeRecordingTabId`, `activeEditorTabId`).
  - Broadcasts `{ type: 'START_TELEMETRY' }` to the target tab (`recordingTabId`).
  - Focuses the target tab via `chrome.tabs.update(recordingTabId, { active: true })`.
- **Target page content script (`src/content/dom-tracker.ts`)**:
  - Receives `START_TELEMETRY`.
  - Injects `#smoothstudio-floating-hud` (🔴 timer + `Stop & Edit` button).
  - Starts 120Hz mouse sampling, click listening with container climbing (`findParentContainer`), keystroke tracking, and input focus tracking.

## 3. Storage & Editor Loading Flow
- **Storage (`src/engine/opfs-storage.ts`)**:
  - Chunks from `MediaRecorder.ondataavailable` (emitted every 1000ms) are streamed to OPFS as `smoothstudio_recording.webm` via `FileSystemWritableFileStream` and duplicated into an in-memory `memoryVideoChunks: Blob[]` array.
  - When stopped, `finalizeVideo()` closes the OPFS file handle stream.
  - `getRecordingBlob()` retrieves the `File` from OPFS root (`navigator.storage.getDirectory().getFileHandle('smoothstudio_recording.webm')`) or returns `new Blob(memoryVideoChunks, { type: 'video/webm' })`.
  - Telemetry is saved to OPFS (`smoothstudio_telemetry.json`) and synced to `chrome.storage.local`.
- **Editor loading (`src/editor/EditorStudio.tsx`)**:
  - Clicking "Stop & Edit" in the floating HUD sends `STOP_STUDIO_RECORDING` to the service worker.
  - Service worker requests `STOP_TELEMETRY` from the target page, which stops tracking, removes the HUD, and returns telemetry.
  - Service worker sends `STUDIO_STOP_CAPTURE` (with telemetry) to `editor.html` and brings `editor.html` to front.
  - `handleStopLiveRecording` stops `captureEngine`, obtains the WebM blob, creates an object URL (`URL.createObjectURL(blob)`), mounts it to an HTML5 `<video>` element, resolves duration, generates auto zoom pills, and starts the 60 FPS Canvas preview loop.

## 4. Zoom Pills Generation from Click Data
- **Engine (`src/engine/spring-physics.ts` -> `generateAutoZoomPills`)**:
  - Groups chronological clicks into clusters using a spatial radius of `320px` and temporal window of `3800ms`.
  - Uses DOM container bounds (modals, dialogs, cards, forms) captured during click events to calculate focal center `(targetX, targetY)` and adaptive scale:
    - Large container (>60% viewport): 1.35x zoom.
    - Small container (<20% viewport): 2.1x zoom.
    - Standard card/section: 1.7x zoom.
  - Holds zoom for at least 2400ms (`MIN_HOLD_DURATION_MS`) or 1600ms past the last click in cluster.
  - Generates zoom pills for input focus / text entry (`1.8x` zoom).
  - Computes 3D isometric camera tilts (`calculateIsometricTilt`: max ±8° tiltX, ±10° tiltY).
  - Returns sorted array of `ZoomPill` objects.
