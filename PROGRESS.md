# PROGRESS.md — SmoothStudio QA loop

One entry per iteration. Newest first.

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
