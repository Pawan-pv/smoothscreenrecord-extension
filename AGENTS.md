# AGENTS.md — SmoothStudio

Operating rules for every human and every agent working on this repository.

Testing is manual: the owner tests every change by hand in Chrome. There is no automated test suite.

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
`src/` is the product. There are no automated tests and no test hooks: do not add a test suite,
test files, mocks or `window.__*` hooks.

### 3.2 Manual testing by the owner
The owner verifies every change by hand with the built extension in real Chrome. After a change,
say exactly what to try (which page, which clicks, what should happen) so it can be checked by hand.

### 3.3 Smallest correct change
No unrelated refactors, no drive-by formatting, no dependency bumps in a bug fix.

### 3.4 Build must stay clean
`npm run build` (tsc + vite build) must exit 0 and `npx tsc --noEmit` must be clean.

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
plugins/                   Vite plugins (dev extension reloader)
public/                    icons and static files copied into dist/
```

---

## 5. Commands

```bash
npm install                 # or: bun install
npm run build               # tsc + vite build  -> dist/
npm run dev:extension       # rebuild on change and reload the extension
```

Load `dist/` with "Load unpacked" at `chrome://extensions`, then reload the extension and
refresh the page you record after every build.
