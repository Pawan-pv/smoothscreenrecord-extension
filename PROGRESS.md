# PROGRESS.md — SmoothStudio QA loop

One entry per iteration. Newest first.

## M1 Recording core — session 2 (2026-11-11) — NOT DONE, stopped

User decisions: J12 timeout edit reverted (420 s kept; GIF slowness logged as QA-028 for M9);
M1-03 relative-fps redesign accepted (HC-006 by the user); new AGENTS.md §3.8 capture-marker rule.

**Capture marker (`1635815`)**: random-colour edge strips + token on every test-browser page;
every recording decoded in memory and checked before it may be viewed or saved. Negative check:
the same recording against the 3 other palette colours → `178/178` frames rejected.

**M1-03 fix (`93ece99`)**, measured with the desktop free:
```
canvas pump:            15.9 fps vs 29.0 plain MediaRecorder (pump read 175)
zero-copy generator:    20.6 fps vs 28.2   detector busy 4164 ms / 10761 ms, 69 snapshots
+ snapshots >= 700 ms:  28.7 fps vs 31.2   worst hole 99 ms, read 308 / file 309   -> PASS
```

**Full suite run 1 (HEAD `93ece99`): 27 passed, 11 failed (14.0 min).**
| Test | Result | Raw evidence |
|---|---|---|
| m1 stop paths | FAIL (marker) | `[marker] m1-stop/recording-popup.webm: 127 frames decoded, 34 without the marker` → dropped unviewed, run aborted (QA-031) |
| m1 crash, m1 idb | not run | `Run aborted: an earlier journey captured content without the test marker` |
| J1 | FAIL (regression) | `video track length 20.737s vs wall clock 20.142s` (QA-029) |
| J10 | FAIL | `raw length 11.855s vs wall clock 11.269s` (QA-015/QA-029) |
| J2 | FAIL | `frames without a readable epoch band: [0]` — frame 0 shows the editor (QA-016/QA-029) |
| m1 timing | FAIL | `27.7 fps (plain recorder 34.6 fps)` 80 % < 90 % (QA-030) |
| J3 | FAIL | `moving-window diff {"changed":1751,"blobs":3}` (QA-017; marker overlay to be ruled out) |
| C1 | FAIL | `acoustic onset … 21.1445s`, known pauses `maxDb null` (QA-032) |
| C2 | FAIL | `[data-silence-id]` count `Received: 3` (QA-034) |
| J11 | FAIL | every checked export frame `video clock 2358742351888` (QA-033) |
| J9, J12, m1 mic, audit, human-sim, popup-interactive | PASS | |

Verifier: aborted before running anything (suite red); static review found no weakening/faking/mocking.
Lock released, verifier worktree removed. No `M1 done` commit.

## M1 Recording core — session 1 (2026-11-11) — IN PROGRESS

Module plan and acceptance checks: `MODULES.md` (M1-01..M1-11). Pre-module commit `e289055`.

**Failing first** (`68c8d50` tests run on the `e289055` build):
```
unit tests/unit/recording-storage.test.ts   Tests 11 failed (11)
  bytes committed to disk before stop: expected 0 to be greater than or equal to 12
  telemetry of "first" must not be handed to "second": expected { …(5) } to be null
m1 timing   27 frames in ~11 s (2.4 fps), pts hole 4.225 -> 6.692 s, last frame 1281 ms before the stop
m1 mic      video ends 9.764 s, audio ends 10.259 s  (0.495 > 0.15)
m1 stop     no session id on the loaded recording (timeout)
m1 crash    OPFS while recording: [smoothstudio_recording.webm.crswap 0, smoothstudio_recording.webm 0] (0 bytes)
m1 idb      no recording after reload without OPFS
```

**Root causes found (with probes):**
- QA-024 (CRITICAL): one open `FileSystemWritableFileStream` for the whole recording only commits on `close()` → a crash lost everything.
- QA-023 (HIGH): `probe-recorder-start.mjs` — first encoded chunk: `vp9 4519 ms`, `vp8 259 ms`, `h264 475 ms` → recordings < 4.5 s had **no video** (`0 encoded frames in 3890ms`).
- QA-008 (HIGH): the pump was driven by `requestVideoFrameCallback`, which does not fire while the editor is not rendered. `probe-pump.mjs`: the fixture renders at 58–60 fps but the capture SOURCE of this machine only delivers 3–22 fps (raw track, no product code) — the ≥ 24 fps goal moved to HC-006.
- QA-025 / QA-026: no session ids (stale telemetry), no IndexedDB fallback.

**Fix `39f7756`.** After (real build, real capture, editor in the background):
```
unit 88 passed (88), tsc clean, build 0, 0 test hooks in dist/
m1 mic          PASS  video ends 8.884 s, audio ends 8.999 s
m1 stop paths   PASS  hud -> ["Alpha Action"], editor -> ["Beta Action"], popup -> ["Open Modal","Close"], 3 session ids, reload keeps the last
m1 crash        PASS  OPFS while recording: 9 committed parts, 583791 bytes; recovered after a CDP Page.crash at 7.36 s
m1 idb fallback PASS
m1 timing       last valid run: pump read 121 / sent 121, file 119 frames, worst hole 215 ms, last page frame -217 ms
                next run INVALID: an IDE window covered the test browser (frames 63..119) -> HC-009
```
Not yet done: valid `timing` run, full suite ×2, verifier, `M1 done` commit.

## Iteration 4 — privacy made blur-only (QA-013, QA-018), real telemetry check (QA-019)

**Environment notes (raw):**
- `npx playwright test` resolves a second Playwright copy → `Error: Playwright Test did not expect test() to be called here.` for every file. The suite must be run as `node node_modules/playwright/cli.js test` (= `npm run test:e2e`).
- An uncommitted, pre-existing edit of `tests/e2e/j2-tab-content.spec.ts` did not parse (`Identifier 'unreadable' has already been declared. (142:12)`) and relaxed J2 (excluded frames whose clock was off by ≥1 s). Per AGENTS.md §3.4 it was **not** adopted: saved as `uncommitted-j2-weakening.patch` in the session scratchpad, file restored to `75de4bc`.
- After the first verifier's worktree cleanup, `node_modules/.bin/tsc*` and `vite.bunx` were gone (`npm run build` → `error: could not find bin metadata file`). Restored with `bun install --frozen-lockfile` (`Checked 181 installs across 223 packages (no changes)`); verifiers now install their own deps instead of junctioning `node_modules`.

**Baseline full suite (run 1, product at `75de4bc`, 16.2 min): `5 failed, 28 passed`.**

| Journey | Result | Raw evidence |
|---|---|---|
| C2 | FAIL | `A/V skew -0.01699999999999946s exceeds one frame` (skews `[-0.0077,-0.0083,-0.017,-0.0136]`) → QA-011 |
| J10 | FAIL | `raw length 11.711s vs wall clock 11.286s` (0.425 > 0.3) → QA-015 |
| J11 | FAIL | `Timeout 240000ms exceeded while waiting for event "download"`, `seeking=0 seeked=0` → QA-001 |
| J2 | FAIL | `4.21 fps over 88 frames`; `worst clock/frame offset 1357209686422ms at frame 0` → QA-008 / QA-016 |
| J3 | FAIL | `moving-window diff … {"changed":29,"blobs":1}` (> 50 required) → QA-017 |

**QA-013 (CRITICAL) — the shield rewrote the page text.**
Failing first (`d9ec47d`, tests that encoded the `•` violation rewritten to spec item 5):
```
× blurs the offending elements with filter: blur(8px) and never rewrites the page text (spec item 5)
-             Account Owner: executive.director@fintech-global.com
+             Account Owner: ••••••@••••.com
Tests  5 failed | 6 passed (11)
```
Fix `514dcfa`. After:
```
J9 email text after redaction: "dana.reeves@example-corp.com"
J9 email region sharpness (luma stddev) before=72.3 after=12.8
J9 filters after the toggles are off: ["none", … ×11]
  ✓  J9 … (23.0s)          25 passed (1.1m)   unit: 71 passed (71)
```
`tests/e2e/out/j9/recorded_frame.png` inspected: iframe email/amount, rows, re-rendered node, form email/amount unreadable; "Robin Vale", headings, buttons readable.
Verifier: **APPROVED** (parent J9 failed with `Received "••••••@••••.com"`; fix passed). It found QA-018 and QA-019.

**QA-018 (HIGH) — body-level text was never blurred.** Failing test (`25e4323`): `QA-018: covers sensitive text written directly into <body>… ×` (holder was `<body>`). Fix `f67add7`: unit `72 passed (72)`; J9 + audit + human-sim + popup: `25 passed`. Verifier: pending.

**QA-019 (HIGH, test defect) — J9's telemetry check read an attribute nothing sets.** Now reads the persisted telemetry: `J9 telemetry: opfs=0 bytes, storage=3888 bytes`, clicks `[["span","[hidden input]",…],["span","[hidden input]",…],["td","[hidden input]",…],["button","Load more rows",…],["button","Submit to /echo",…]]`.

## Iteration 3 — second product bug found and fixed (QA-010), full-suite run

**Full suite (33 tests, 22.3 min):** `6 failed, 27 passed`.

| Journey | Result | Raw evidence |
|---------|--------|--------------|
| J1 | PASS | 20.4 s recording, Opus + VP9, waveform from the real audio |
| J2 | FAIL (harness) | the clock decoder produced false positives on two frames — fixed by a median-offset reference |
| J3 | FAIL (harness) | the comparison windows overlapped the mouse movement — fixed |
| J9 | PASS | redaction masks, `/echo` receives the original values, the SOP and the widget contain 0 sensitive values |
| J10 | FAIL | the MP4 export is 0.186 s longer than the recording (QA-009) |
| J11 | FAIL | the MP4 export hung for 420 s with **no seek event at all** (QA-001) |
| J12 | FAIL | the exported GIF had **one** frame for a 10 s clip (QA-010) |
| c2 (pre-existing) | FAIL | the MP4 export **completed** (`Encoded frame 1200/1217 (99%)`, `Muxed 948 AAC chunks`) but the A/V skew is 51-86 ms (QA-011) |

**Reproduced (failing test, before the fix) — QA-010:**

```
J12 GIF preset compact: 26848 bytes, 10.08s
ffprobe: stream|codec_name=gif|width=640|height=360|duration=10.080000|nb_frames=1
  ✘  19 tests\e2e\j12-gif-export.spec.ts:20:3 › J12 GIF export › J12: the exported GIF animates with increasing clock values …
```

**Root cause:** `src/engine/gif-exporter.ts:327-338` assigned `videoSource.currentTime = target` **before** attaching the `seeked` listener, and then compared `videoSource.currentTime` with the target to decide whether the frame was already there. Reading `currentTime` right after assigning it returns the **new** target, so that check was always true and the wait resolved before the decoder had produced a frame. Every exported frame was therefore the same picture, and the frame de-duplication collapsed the whole clip into a single frame.

**Fix:** the listener is attached before the assignment, the "already at this position" case is checked before it, and a 2 s timeout keeps a stalled seek from hanging the export.

**After the fix:**

```
J12 GIF preset compact: 516525 bytes, 11.12s
```

## Iteration 2 — first product bug found and fixed (QA-007)

**Reproduced (failing test, before the fix):**

```
[2026-11-11T…] J9 email text after redaction: "••••••@••••.com"
[2026-11-11T…] J9 /echo payloads: ["name=Robin Vale&email=robin.vale@fieldwork.dev&amount=₹1,25,000"]
  ✘  2 tests\e2e\j9-privacy.spec.ts:34:3 › J9 privacy › J9: sensitive values are unreadable in the recording and the export, …
    Error: turning the toggles off must restore the original value
```

**Root cause:** `applyAutoRedaction()` (`src/content/privacy-redactor.ts:352`) only ever *masked*. Switching a privacy category OFF broadcasted `APPLY_PRIVACY_OPTIONS` with that option `false`, but the content script re-scanned with the new options and never restored the text it had masked before, so the page kept showing `••••••@••••.com` forever.

**Fix:** `applyAutoRedaction()` now restores the previous state first (`resetRedactions({ keepPicker: true })`) and re-applies with the current options, in the same task, so no unredacted frame is ever painted. `resetRedactions()` also clears the `__smoothstudio_observed` marker now, so the mutation observers are re-armed with the *current* options (otherwise dynamic content would keep being redacted with the old ones).

**After the fix (same test):**

```
[2026-11-11T…] J9 email text after redaction: "••••••@••••.com"
[2026-11-11T…] J9 /echo payloads: ["name=Robin Vale&email=robin.vale@fieldwork.dev&amount=₹1,25,000"]
[2026-11-11T…] J9 email text after turning the toggles off: "dana.reeves@example-corp.com"
[2026-11-11T…] J9 sop: 118942 bytes, 0 sensitive values
[2026-11-11T…] J9 widget: 196282 bytes, 0 sensitive values
  ✓  1 tests\e2e\j9-privacy.spec.ts:34:3 › J9 privacy › J9: sensitive values are unreadable in the recording and the export, the page still works, and no asset leaks them (32.9s)
```

Unit tests after the fix: `Test Files 10 passed (10)`, `Tests 67 passed (67)`. `tsc --noEmit` clean. `npm run build` exit 0.

## Iteration 1 — environment reality check + first journeys

**Findings**

- **QA-004 (MEDIUM, product):** the manifest declares the `tabCapture` permission (`manifest.json:12`) but the product never uses it — the only capture call is `navigator.mediaDevices.getDisplayMedia()` (`src/engine/screen-recorder.ts:100`). In an automated session the WHOLE SCREEN is recorded (every other application and anything sensitive on it).
- **QA-005 (environment, not a bug):** Chrome for Testing 157 **and** Playwright Chromium 1254 ignore `--auto-select-tab-capture-source-by-title` and `--auto-select-desktop-capture-source=<window title>`; the probe (`tests/e2e/helpers/probe-capture-surface.mjs`) reports `displaySurface:"monitor"`, `deviceId:"screen:0:0"` for every variant. The capture surface is therefore the screen, and the harness raises the browser window into the top of the z-order (`tests/e2e/helpers/raise-window.ps1`) so the recorded surface really is the page under test. The first J2 run recorded the user's IDE (VS Code) instead of the fixture — the frames in `tests/e2e/out/j2/frame_05s.png` showed that, and the raise helper fixed it.
- **Fixture defect (test asset, not the product):** `clock.html` and `avsync.html` encode the wall-clock epoch with `epochMs >>> n`, but JavaScript bitwise operators truncate to 32 bits, so a 41-bit epoch could never be encoded and the band was unreadable. Both fixtures now use plain arithmetic. Nothing else decoded the band, so no existing test was affected.
- **Harness defect:** `ffmpeg -ss T -i file` (input seeking) lands on the nearest keyframe, which was up to 350 ms away from the requested time; the harness now uses output seeking (`-i file -ss T`).
- **QA-001 (HIGH, product) — first root-cause data:** the exporter's seek loop was reproduced in a clean room (`tests/e2e/helpers/probe-seek.mjs`): 1247 seeks over a real recorded WebM, **0 failures**. So the exporter's seek *pattern* is sound and the timeout must come from the editor's own context (the video element the preview is also driving), not from the WebM.

**Journeys written:** J1 (mic), J2 (real content + clock-vs-video timing), J3 (screen capture + cursor count), J9 (privacy), J10 (static page), J11 (MP4 export + A/V sync), J12 (GIF export).

## Iteration 0 — setup

**Read:** `CODE_REVIEW.md` was not in the repo; the user approved `.planning/REVIEW.md` as its source, so it was copied to `CODE_REVIEW.md` (13 leads: CR-01, WR-01..07, IN-01..05).

**Built:**
- `tests/fixtures/audio/generate-test-wav.mjs` → `tests/fixtures/audio/test.wav`: 20.000 s, 48 kHz mono, speech-like noise, two 2.00 s digital silences, three 4.5 kHz beeps at 2.0/8.0/18.0 s. Measured: silences at 4.015–6.021 s and 14.021–16.026 s (`silencedetect -42dB`), beeps ≈ −12.9 dB in the 4–5 kHz band vs −31.2 dB for a quiet window.
- `tests/e2e/helpers/harness.ts`: real Chrome for Testing launch (headed, 1920×1080, real `dist/`), capture-source selection (tab / screen / window), fixture server with a `POST /echo` endpoint that records payloads, user-level `recordPage()` (editor in the background, HUD button stops), ffprobe/ffmpeg analysis, epoch-bit decoding of the clock/avsync fixtures.
- `tests/e2e/j1-tab-mic.spec.ts`, `tests/e2e/j2-tab-content.spec.ts`.
- `BUGS.md`, `PROGRESS.md`, `HUMAN_CHECKS.md`.

**Verified as already done (no change needed):** setup item D — every `window.__*` test hook in `src/editor/EditorStudio.tsx:145-160` is inside `if (import.meta.env.DEV)`; `grep dist/ → 0 hits` for `__captureEngine`, `__setSilences`, `__startLiveRecording`, `__lastLoadedTelemetry`, `__smoothstudio_pills`, `__HardwareMp4Exporter`.

**Findings so far:**
- J1 first run failed the ±0.3 s duration check (raw 20.969 s vs measured 20.402 s). Packet analysis of the raw file: the **video** track ends at 20.560 s, the **Opus** track at 20.975 s. The extra 0.4 s is the audio encoder's tail, and my wall clock started ~0.16 s late (after the recorder was already live). Harness measurement point corrected; the product was not touched. Logged as QA-002 (audio tail, still open) and QA-003 (harness, not a bug).
- QA-001 (carried over from the previous verification session): the MP4 export aborts with `Seek timeout: ... not presented within 2000ms` and wedges the browser — reproduced with auto-cut OFF, so unrelated to silence skipping.
