# TEST_PLAN.md — SmoothStudio QA plan

The product contract lives in `AGENTS.md` (§2 PRODUCT SPEC). This file says **what is
tested, how, and what counts as proof**.

---

## 1. Setup (done once, verified in Wave 0)

| Step | What | Where | Done when |
|------|------|-------|-----------|
| S1 | Binaries and generated output are never committed | `.gitignore` | `ffmpeg.exe`, `ffprobe.exe`, `dist/`, `test-results/`, `coverage/`, `*.mp4/webm/gif`, `tests/e2e/out/` are all ignored |
| S2 | The test fixtures exist | `tests/fixtures/` | `clock.html`, `avsync.html`, `privacy.html`, `static.html`, `sync-flash.html`, `nav-a/b/c.html`, `inject.html`, `privacy-frame.html`, `audio/test.wav` |
| S3 | The tests are consolidated | `tests/unit/`, `tests/e2e/` | unit tests in `tests/unit/*.test.ts` (vitest), journeys in `tests/e2e/*.spec.ts` (playwright); `tests/legacy`, `tests/round4`, `tests/verify` are historical scripts, not part of the suite |
| S4 | Test hooks are gated behind `import.meta.env.DEV` | `src/editor/EditorStudio.tsx` | `grep -r "__captureEngine\|__setSilences\|__startLiveRecording\|__lastLoadedTelemetry\|__smoothstudio_pills\|__HardwareMp4Exporter" dist/` → 0 hits |
| S5 | Cross-process locks exist | `.locks/` | `.locks/screen.lock` is the lock for `[SERIAL]` journeys |
| S6 | The product builds | `src/` | `npm run build` exits 0, `npx tsc --noEmit` is clean |

### The shared harness

`tests/e2e/helpers/harness.ts` (and the newer `extension.ts` / `session.ts`) launch **real
Chrome for Testing** with the **real built `dist/`** loaded as an unpacked extension, serve
the fixture pages from a local HTTP server on an ephemeral port, and give every run **its
own temporary Chrome profile**. The recorded media is then measured with the repo's own
`ffprobe.exe` / `ffmpeg.exe`.

Two facts about this machine are already proven and must not be re-litigated:

* **QA-005** — Chrome for Testing 157 *and* Playwright Chromium 1254 ignore
  `--auto-select-tab-capture-source-by-title` and `--auto-select-desktop-capture-source`.
  `displaySurface` is always `"monitor"`. Real page content is therefore recorded by
  putting the fixture in a full-screen app window and capturing the screen.
* The desktop has other windows in the z-order, so the harness raises the browser window
  to the top for the duration of a journey (`tests/e2e/helpers/raise-window.ps1`).

---

## 2. The journeys

`[SERIAL]` journeys take `.locks/screen.lock` for the whole run and never run next to
another browser test. Everything else may run two at a time, never more.

### Existing

| ID | File | What it proves |
|----|------|----------------|
| J1 | `tests/e2e/j1-tab-mic.spec.ts` | A recording made with the mic ON contains video + an Opus track of the real length, a real waveform, and the two known silences of the fixture WAV |
| J2 | `tests/e2e/j2-tab-content.spec.ts` | The recorded tab shows the *real* page and its epoch clock tracks the video timeline 1:1 |
| J3 | `tests/e2e/j3-screen-capture.spec.ts` | A screen recording shows the real page, tracks the wall clock, and contains exactly one cursor |
| J9 | `tests/e2e/j9-privacy.spec.ts` | Sensitive values are unreadable in the recording and the export, **the page still works and keeps its own text (spec item 5)**, the toggles restore it, and no asset leaks a sensitive value |
| J10 | `tests/e2e/j10-static-page.spec.ts` | A static page still records a continuous, correctly timed file and exports at the same length |
| J11 | `tests/e2e/j11-mp4-export.spec.ts` | The MP4 export contains h264+aac, the right number of frames and is in sync within one frame |
| J12 | `tests/e2e/j12-gif-export.spec.ts` | The exported GIF animates with increasing clock values and every preset reports its size |
| C1 | `tests/e2e/c1-mic-recording.spec.ts` | A recording with the mic ON has an Opus stream of the recording length |
| C2 | `tests/e2e/c2-mp4-audio.spec.ts` | The MP4 export contains AAC audio in sync with the video, and auto-cut removes the same span from audio **and** video |
| — | `tests/e2e/extension-audit.spec.ts` | Build integrity, service-worker lifecycle, content-script ingestion, popup controls, canvas/spring viewport, flight doctor, exporters, the recording→editor pipeline, zero console errors |
| — | `tests/e2e/human-simulation.spec.ts` | The popup flows a user actually performs, end to end, with zero console errors |
| — | `tests/e2e/popup-interactive.spec.ts` | Service-worker lifecycle/heartbeat/state machine, the popup controls, and real message passing to the content script |

### To be written (Wave 0, by `@qa-tester`)

| ID | What it must prove |
|----|--------------------|
| J20 | **Where captions come from.** The editor must never invent caption text: a caption added at the playhead starts empty, the operator types the real transcription, the exported MP4/GIF renders exactly the typed words, and **nothing** transcribes the audio automatically (spec items 1, 4). Proof: the caption list is empty after a recording with no transcription, the typed words appear in the export frames, and no caption text exists that the operator did not type |
| J21 | **SOP guide export.** The Markdown SOP guide is real: its step timestamps match the recorded clicks, its screenshots come from the recording, and it contains no sensitive value (spec item 4) |
| J22 | **HTML widget export.** The widget is a single self-contained file, its hotspots match the real recorded clicks, it opens and works offline, and it loads **no** external resource (spec items 4, 6) |
| J23 | **No network requests.** While recording and while exporting, the extension itself makes **zero** network requests: every request in the browser session belongs to the fixture server, and `src/` contains no `fetch`/`XHR`/`WebSocket`/`sendBeacon`/remote `<script>`/remote font (spec item 6) |

### Human-only

J4 (real OS cursor), J5 (Chrome's "Stop sharing" bar), J7 (multi-window), J19 (1707 px
window) cannot be automated here — they are written up in `HUMAN_CHECKS.md` with the exact
steps. They are **not** faked with a mock.

---

## 3. What counts as proof

* A journey passes only if the **real** artefact was measured: `ffprobe` on the exported
  file, extracted frames that were actually looked at, pixel statistics, file sizes,
  measured durations.
* "The button exists" is never a proof. "The exported MP4 has 1217 frames and the beep
  lands 51 ms before the flash" is.
* A failing journey must keep its raw output. The runner writes it to
  `tests/e2e/out/<journey>/` and the orchestrator pastes it into `BUGS.md` / `PROGRESS.md`.

---

## 4. How to run

```bash
npm run build                       # dist/ must be current
npx playwright test --reporter=list --workers=1          # the whole suite
npx playwright test tests/e2e/j9-privacy.spec.ts --reporter=list   # one journey
npm test                            # the unit tests
```

A journey that must not run next to another browser test:

```bash
# PowerShell
New-Item -ItemType Directory -Force .locks | Out-Null
# ... acquire .locks/screen.lock, run, release it
```

Artifacts land in `tests/e2e/out/<journey>/` (git-ignored). `test-results/` holds the
Playwright output.

---

## 5. The loop

1. `@qa-tester` runs the whole suite and logs every failure with its raw output.
2. The orchestrator picks the highest-severity bugs that touch **different** files and
   gives each one to a `@fixer` in its own worktree.
3. The fixer writes a **failing** regression test, fixes the root cause in `src/`, and
   commits `"<ID>: <what changed>"`.
4. `@verifier` re-runs the new test against the commit's **parent** (must fail) and against
   the commit (must pass), reads the whole diff, and approves or rejects.
5. Approved fixes are merged into `main` one at a time; after each merge the **whole
   suite** runs again. A regression reverts the merge and reopens the bug.
6. `PROGRESS.md` gets a wave summary after every wave.
