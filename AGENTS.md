# AGENTS.md — SmoothStudio

Operating rules for every human and every agent working on this repository.

`TEST_PLAN.md` describes the journeys, `BUGS.md` is the bug log, `PROGRESS.md` is the
running log of the QA loop, `HUMAN_CHECKS.md` lists everything a person must verify
by hand, and `CODE_REVIEW.md` holds the static-review leads.

---

## 1. The product

SmoothStudio is a Chrome extension (MV3) that records the screen, renders a cinematic
preview (spring camera, vector cursor, spotlight, keystroke HUD), analyses the audio,
and exports MP4 / GIF / a Notion SOP guide / an interactive HTML widget.

Everything runs **locally in the browser**. There is no server, no account, no API key,
no telemetry.

---

## 2. PRODUCT SPEC (binding)

This is the contract. A change that violates it is a regression, even if a test passes.
Numbered items are referenced by ID (e.g. "spec item 5").

### 1. Capture & telemetry
Capture the screen/tab at up to 60 fps with a real `getDisplayMedia` surface, track the
mouse (up to 120 Hz) with its computed CSS cursor, detect the clicked element and its
parent container, track typing in inputs, record keystroke hotkeys, and write the raw
recording to OPFS (with an IndexedDB/memory fallback). Nothing may be faked.

### 2. Camera & rendering
Critically damped spring camera (x, y, scale 1.0–2.8, 2.5D/3D tilt), click clustering,
Catmull-Rom cursor spline with a motion trail, SVG cursor morphing, spotlight dimming with
a feathered mask, an animated mesh-gradient background, and a 3D glassmorphic keystroke HUD.
All of it rendered on a canvas at 60 fps.

### 3. Audio
Real microphone capture, RMS analysis, silence detection (pauses > 1.2 s with no
interaction), a one-click "Remove Silences" auto-tightener that removes **the same spans
from audio and video**, and procedural Web Audio SFX (no external files).

### 4. Exports
MP4 (H.264 + AAC, WebCodecs + `mp4-muxer`), GIF (multiple presets), the Notion/Step-by-step
Markdown SOP guide, and the single-file interactive HTML widget. The exports must be real
files with real content: no placeholder video, no fake frames, no invented data.

### 5. Privacy shield — **non-destructive, blur-only**
The privacy shield redacts emails, revenue/currency figures and API keys, and offers an
interactive click-to-blur picker.

- Redaction is applied with **`filter: blur(8px)`** on the offending element.
- **The page's own text must never be rewritten.** The extension must not replace a
  value with `•` characters, must not truncate it, and must not otherwise alter the
  page's text content. `textContent` of the page stays exactly what the page put there.
- The page must keep working while the shield is on: forms must still post their original
  values, copy/paste must still yield the original text, and the app must not throw.
- Turning a category OFF must restore the original rendering immediately.
- Nothing the shield covers may reach the recording, the SOP guide, the HTML widget or the
  telemetry: no asset may contain a sensitive value.

Rationale: a user recording their own screen must get a usable recording of a usable page.
A shield that silently destroys the page's data is a bug, even if it hides the secret.

### 6. Local-only, no network
The extension must make **no network requests** of its own: no analytics, no API calls,
no remote assets, no fonts, no CDNs. `$0 server cost, $0 API cost`. Any `fetch`/`XHR`/
`WebSocket`/`sendBeacon`/`<script src=http…>` in `src/` is a spec violation.

---

## 3. Rules for everybody

### 3.1 The product code lives in `src/`
`src/` is the product. Tests live in `tests/`. A fix that only changes a test is not a fix.

### 3.2 Test hooks stay behind `import.meta.env.DEV`
Every `window.__*` hook in `src/` must be inside `if (import.meta.env.DEV)`.
After a build, `grep dist/ -r "__captureEngine\|__setSilences\|__startLiveRecording\|__lastLoadedTelemetry\|__smoothstudio_pills\|__HardwareMp4Exporter"` must return **0 hits**.

### 3.3 No mocks in e2e content journeys
The e2e journeys drive the **real** built extension (`dist/`) in **real** Chrome, with real
clicks, real typing and a real capture surface. `tests/mocks/chrome-mock.ts` and the
`--use-fake-device-for-media-stream` flag may only ever replace the **microphone**, never
the picture. No test may assert on a value the product invented.

### 3.4 Never weaken an existing test or fixture
If an existing test or fixture looks wrong, **stop and say so** — do not edit it. The
orchestrator decides. A test change needs its own commit and its own justification.

### 3.5 Evidence, not assertions
A bug report carries the raw output (test runner output, `ffprobe` output, file sizes,
pixel measurements). "It looked wrong" is not evidence.

### 3.6 Smallest correct change
No unrelated refactors, no drive-by formatting, no dependency bumps in a bug fix.

### 3.7 Build must stay clean
`npm run build` (tsc + vite build) must exit 0 and `npx tsc --noEmit` must be clean.

### 3.8 Screen-capture safety: the capture marker
Screen-capture journeys record the REAL screen, so they can capture whatever else is on the
desktop. Therefore:
- **Every page of the test browser shows a unique marker**: coloured strips along the left,
  right and bottom edges in a colour chosen at random per run, plus a random token in large
  text (`tests/e2e/helpers/marker.ts`, installed by `launchApp` / `launchExtension` on every
  page: fixtures, editor, popup).
- **After capture, the frames are checked for the marker BEFORE anything views or saves
  them.** The check decodes every frame in memory (ffmpeg via stdin, nothing written)
  — `guardRecording()`, called by `recordPage`, `recordSession`, `saveRawRecording`,
  `writeScratch` and the M1 journey's own save points.
- **If the marker is missing, the wrong content was captured**: the bytes are dropped
  without being viewed or written, `tests/e2e/out/MARKER_ABORT.json` (counts only, no frame
  data) aborts the run — every later journey refuses to launch — and it is reported.
  **Never view or save frames that do not contain the marker.** Delete the abort file only
  after the desktop is free again.
- **Before each screen test the test browser window is brought to the foreground and
  maximised** (`raise-window.ps1 -Mode top`, called at launch and again before each recording).

---

## 4. Layout

```
src/                       product code
  background/              MV3 service worker
  content/                 content scripts (dom-tracker, privacy-redactor)
  editor/                  editor UI (React)
  engine/                  recorder, renderer, exporters, audio
  popup/                   popup UI
  offscreen/               offscreen document worker
tests/
  unit/                    vitest unit tests
  e2e/                     Playwright real-browser journeys (tests/e2e/*.spec.ts)
  e2e/helpers/harness.ts   shared real-browser harness
  e2e/helpers/extension.ts shared harness (newer style)
  e2e/helpers/session.ts   shared harness (newer style)
  fixtures/                local fixture pages + the test WAV
  e2e/out/                 generated artifacts (git-ignored)
  legacy/ round4/ verify/ older scripts, not part of the suite
test-results/              Playwright output (git-ignored)
.locks/                    cross-process locks (screen.lock)
```

---

## 5. Commands

```bash
npm install                 # or: bun install
npm run build               # tsc + vite build  -> dist/
npm run build:test          # same but NODE_ENV=development
npm test                    # vitest run (tests/unit)
npm run test:e2e            # playwright (tests/e2e) - needs dist/ built
npx playwright test tests/e2e/j9-privacy.spec.ts     # one journey
npx playwright test --reporter=list --workers=1     # the whole suite
```

`ffmpeg.exe` / `ffprobe.exe` live in the repo root (git-ignored) and are used by the
harness to inspect the recorded media.

---

## 6. Concurrency

- At most **3** fixers at a time, at most **2** browser instances at a time.
- `[SERIAL]` journeys take `.locks/screen.lock` for the whole run and must never run
  next to another browser test.
- Every run uses its **own** temporary Chrome profile (the harness creates one) and its
  own port (the fixture server binds port 0 and reports the real port).
- Fixers work in their own git worktree (`../ss-wt-<ID>`, branch `fix/<ID>`); they never
  touch `main` and never push.
