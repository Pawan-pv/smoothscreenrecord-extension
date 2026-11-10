# SmoothStudio Autonomous QA & Test Architecture Walkthrough

## 1. Executive Summary

As an Autonomous QA Engineer, the complete source code in `/src`, compilation pipeline into `/dist`, and test configurations in `/tests` were audited, unified, and verified.

The extension now features a **Two-Tier Testing Architecture**:
1. **Tier 1 (Fast TDD Inner Loop)**: Sub-100ms headless unit tests running via `vitest` with `happy-dom` and a custom stateful Chrome API mock harness (`tests/mocks/chrome-mock.ts`).
2. **Tier 2 (E2E Integration & Audit Loop)**: Full browser execution running directly via standard `npx playwright test`, driving Chromium with the unpacked Manifest V3 extension loaded (`--load-extension=dist`), verifying service workers, content script DOM tracking, privacy redaction, canvas rendering, and procedural audio with zero console errors.

---

## 2. Source Code & Compilation Architecture (`/src` -> `/dist`)

### Source Map (`/src`)
- **`src/background/service-worker.ts`**: Manifest V3 background service worker handling session state persistence (`chrome.storage.session`), tab telemetry coordination, keepalive heartbeat loops, and dev-mode hot-reload WebSocket client.
- **`src/content/dom-tracker.ts`**: 120Hz high-frequency mouse sampling, cursor styling, keystroke HUD capture, and smart DOM bounding box calculation.
- **`src/content/privacy-redactor.ts`**: Real-time DOM inspection and sanitization engine masking PII (emails, financial figures, API keys) via TreeWalker node replacement.
- **`src/editor/`**: React 19 Linear-style Editor Studio (`EditorStudio.tsx`), Canvas 2.5D/3D viewport (`CanvasPreview.tsx`), Magnetic Pill Timeline (`TimelinePillTrack.tsx`), and the in-app Flight Doctor modal (`DiagnosticsDoctor.tsx`).
- **`src/engine/`**: Procedural Web Audio API sound synthesizer (`sfx-synthesizer.ts`), Catmull-Rom spline smoother (`cursor-spline.ts`), spring physics solver (`spring-physics.ts`), and hardware WebCodecs MP4 exporter (`mp4-exporter.ts`).
- **`src/popup/`**: Chrome action popup UI (`popup.tsx`) with instant studio launcher and live privacy toggles.

### Compilation Pipeline (`bun run build`)
- Transpiles TypeScript via `tsc` and bundles React components with Vite 8.
- Custom Rollup plugin (`bundleContentScriptsPlugin`) invokes Bun to package `dom-tracker.ts` and `privacy-redactor.ts` as standalone zero-dependency IIFEs into `dist/content/` (guaranteeing zero illegal ES `import`/`export` keywords in browser content scripts).

---

## 3. Issues Diagnosed & Patches Applied

### Issue 1: Test Runner Collision (`Vitest` vs `Playwright Test`)
- **Symptom**: Executing `npx playwright test` triggered 10 fatal `TypeError: Cannot read properties of undefined (reading 'config')` errors across all files in `tests/unit/*.test.ts`.
- **Root Cause**: Playwright's test collector by default scans all directories matching `.*(test|spec)\.(js|ts|mjs)`. When it encountered Vitest's unit test files importing `describe`, `it`, `expect` from `vitest`, Vitest threw because its internal runner context was absent.
- **Fix**:
  1. Created `playwright.config.ts` explicitly scoping Playwright Test to `testDir: './tests/e2e'` and `testMatch: /.*\.spec\.ts/`.
  2. Isolated Vitest unit tests to `tests/unit/` run via `bun run test` / `vitest run`.

### Issue 2: Chromium Executable Discovery in Headless Extension Mode
- **Symptom**: `browserType.launchPersistentContext` failed with `Executable doesn't exist at chromium_headless_shell-1155`.
- **Root Cause**: Playwright's local cache on the Windows host contained `chromium-1254`, whereas Playwright Test defaulted to requesting `headless_shell-1155`.
- **Fix**: Configured `tests/e2e/extension-audit.spec.ts` with dynamic fallback to the installed `chromium-1254/chrome-win64/chrome.exe` using `--headless=new` and flags for WebCodecs and media streams.

### Issue 3: Unchecked Asynchronous Runtime Errors (`chrome.runtime.lastError`)
- **Symptom**: Chrome logged `Unchecked runtime.lastError: Could not establish connection. Receiving end does not exist.` in context `editor.html?record=true&sourceTab=...`.
- **Root Cause**: Messages dispatched via `chrome.tabs.sendMessage` to tabs without an active content script or tabs that navigated away did not drain `chrome.runtime.lastError` in their response callbacks.
- **Fix**:
  1. Updated `src/background/service-worker.ts` to validate that target tabs use `http://` or `https://` before sending telemetry commands.
  2. Wrapped response callbacks in `service-worker.ts`, `EditorStudio.tsx`, and `dom-tracker.ts` to safely consume `void chrome.runtime?.lastError`.

### Issue 4: Playwright ESM Type Import Resolution
- **Symptom**: `SyntaxError: The requested module '@playwright/test' does not provide an export named 'BrowserContext'`.
- **Root Cause**: In ESM mode (`"type": "module"`), TypeScript type-only exports cannot be imported as values from CJS/ESM hybrid packages.
- **Fix**: Separated type imports in `tests/e2e/extension-audit.spec.ts`:
  ```ts
  import { test, expect, chromium } from '@playwright/test';
  import type { BrowserContext, Page } from '@playwright/test';
  ```

---

## 4. Test Suite Execution & Verification

### A. End-to-End Suite (`npx playwright test`)
Run Command: `npx playwright test`
- **Runner**: Playwright Test 1.50.0
- **Browser**: Chromium 1254 (Headless New with Unpacked MV3 Extension)
- **Results**: **9 / 9 passed (23.6s)**

| Stage | Test Name | Result | Duration | Notes |
|---|---|---|---|---|
| Stage 1 | Production Build & Package Integrity | PASS | 72ms | Verified manifest, service worker, and pure IIFE content scripts |
| Stage 2 | Manifest V3 Service Worker & Heartbeat PING | PASS | 1.0s | Active background worker responded with `{ pong: true }` |
| Stage 3 | Content Script Ingestion & Privacy Redaction | PASS | 2.2s | Simulated typing, deployment click; confirmed email/revenue/API key redaction |
| Stage 4 | Extension Popup UI Controls | PASS | 900ms | Verified popup action buttons and launch controls |
| Stage 5 | Editor Studio Canvas & Spring Camera Viewport | PASS | 1.4s | 1920x1080 canvas mounted with non-blank pixel buffer `[26,29,39,255]` |
| Stage 6 | In-App Flight Doctor Diagnostic Probes | PASS | 3.6s | 5/5 probes passed (WebCodecs, Web Audio, OPFS, Worker, Canvas) |
| Stage 7 | Playback Loop & Multi-Format Exporters | PASS | 4.4s | Playhead advanced; Markdown SOP and Interactive HTML downloads verified |
| Stage 8 | Live Screen Recording-to-Editor Pipeline | PASS | 4.4s | Live screen stream captured, finalized, and bound into editor |
| Stage 9 | Verify Zero Runtime Console Errors | PASS | 8ms | **0 console errors or exceptions** across all pages and workers |

### B. Fast TDD Unit Suite (`bun run test`)
Run Command: `bun run test`
- **Runner**: Vitest 5.1.0 + HappyDOM + Stateful Chrome API Mock
- **Results**: **10 / 10 test files passed, 67 / 67 tests passed (11.3s)**
  - `tests/unit/auto-zoom.test.ts` (10 tests)
  - `tests/unit/cursor-smoother.test.ts` (7 tests)
  - `tests/unit/cursor-spline.test.ts` (5 tests)
  - `tests/unit/diagnostic-channel.test.ts` (4 tests)
  - `tests/unit/frame-composer.test.ts` (10 tests)
  - `tests/unit/privacy-redactor.test.ts` (7 tests)
  - `tests/unit/recorder-orchestrator.test.ts` (6 tests)
  - `tests/unit/service-worker.test.ts` (7 tests)
  - `tests/unit/sfx-synthesizer.test.ts` (4 tests)
  - `tests/unit/spring-physics.test.ts` (7 tests)

---

## 5. Artifacts Generated
During the autonomous audit run, the following verification snapshots were saved to `tests/artifacts/`:
- `01-target-page-redacted.png`: Live DOM inspection showing redacted sensitive elements.
- `02-popup-studio.png`: Rendered extension popup interface.
- `03-flight-doctor-modal.png`: 5-subsystem live diagnostic health check.
- `04-editor-studio-live.png`: 1920x1080 3D canvas viewport and magnetic timeline.
- `05-live-recorded-editor.png`: Finalized recorded session loaded in Editor Studio.

---

## 6. How to Run

To build the extension:
```bash
bun run build
```

To run the Playwright end-to-end suite:
```bash
npx playwright test
```

To run the fast TDD unit test suite:
```bash
bun run test
```
