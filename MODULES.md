# MODULES.md — SmoothStudio, one feature module at a time

Rules: `AGENTS.md`. Journeys: `TEST_PLAN.md`. Bugs: `BUGS.md`. Log: `PROGRESS.md`.

A module is **DONE** only when all of its checks pass in **2 consecutive full-suite runs**,
it has **0 open CRITICAL/HIGH bugs**, and a **fresh verifier subagent** has confirmed that
the new tests fail on the pre-module commit, pass now, and that nothing was weakened,
faked or mocked in e2e. Then: commit `Mx done`, update this file and `PROGRESS.md`.

| Module | Status | Pre-module commit | Done commit |
|--------|--------|-------------------|-------------|
| M1 Recording core | IN PROGRESS | `e289055` | — |
| M2 Telemetry | TODO | | |
| M3 Privacy shield | TODO | | |
| M4 Editor | TODO | | |
| M5 Auto-zoom + cursor | TODO | | |
| M6 Audio | TODO | | |
| M7 Captions + intro/outro | TODO | | |
| M8 MP4 export | TODO | | |
| M9 GIF export | TODO | | |
| M10 SOP + HTML widget | TODO | | |
| M11 Low-spec performance | TODO | | |
| M12 Cleanup | TODO | | |

---

## M1 — Recording core

Scope: tab/window/screen capture, mic, OPFS storage, crash recovery, every stop path, session IDs.
Spec: AGENTS.md §2 item 1 (capture & telemetry: real `getDisplayMedia`, up to 60 fps, raw
recording in OPFS with an IndexedDB/memory fallback, nothing faked) and item 3 (real mic).

Environment fact (QA-005, not re-litigated): Chrome for Testing ignores the capture
auto-select flags, so automated runs always capture the **screen** (`displaySurface:"monitor"`)
with the fixture in a raised full-size window. Tab and window surfaces, and Chrome's own
"Stop sharing" bar, are human checks (HC-004, HC-008).

Tests: `tests/e2e/m1-recording-core.spec.ts` (real browser, real capture, editor tab in the
background) and `tests/unit/recording-storage.test.ts` (storage/session logic).

| ID | Check | Proof | Test |
|----|-------|-------|------|
| M1-01 | A screen recording is a real file in OPFS: exactly one VP8/VP9 video stream, even width/height equal to the capture track, a frame from the middle shows the fixture page | ffprobe of the OPFS file; a frame decoded to the fixture's epoch band | m1 `timing` |
| M1-02 | The recording covers the whole live interval: frame 0 is a real captured picture (not a uniform invented frame), the first PAGE frame's clock ≤ the instant the HUD appeared + 0.1 s, the last page frame's clock within 0.3 s of the stop click | epoch band of every decoded frame (only values inside the test's own time window count) vs the click times | m1 `timing` |
| M1-03 | Frame rate with the editor tab in the background, animating page: (a) no hole > 500 ms between recorded page frames, (b) the file keeps ≥ 95 % of the frames the pump read from the capture track, (c) ≥ 90 % of the fps a PLAIN `MediaRecorder` gets on the raw capture track of the same machine (independent baseline, same browser). "≥ 24 fps" is a human check on normal hardware (HC-006): this i3 + iGPU delivers 8–22 fps of a 60 fps page whatever the recorder does (probe-pump.mjs: the raw track alone reads 3–13 fps) | ffprobe frame timestamps + epoch band, recorder's frame-count log line, a plain-recorder file measured by ffprobe | m1 `timing` |
| M1-04 | Mic ON: the raw file has one Opus stream from the real microphone; the audio and video tracks end within 0.15 s of each other | ffprobe stream end times | m1 `mic` |
| M1-05 | Storage is durable while recording: encoded data reaches OPFS in committed pieces during the recording (not only at stop) | OPFS listing + sizes read from the editor while recording | m1 `crash` + unit |
| M1-06 | Crash recovery: if the editor renderer crashes mid-recording, opening the editor again recovers the recording: it plays, its video length ≥ (time recorded before the crash − 1 s), the SW is no longer "recording" and the HUD is gone from the target page | CDP `Page.crash` on the editor; ffprobe of the recovered file; SW storage; target DOM | m1 `crash` |
| M1-07 | Stop paths: the on-page HUD *Stop & Edit*, the editor's *Stop* button and the popup's *Stop Recording* each produce exactly ONE new recording in the editor, remove the HUD from the target page, and reset the SW state to not-recording | editor DOM, target DOM, SW `chrome.storage.session` | m1 `stop paths` |
| M1-08 | Session IDs: every recording gets a new unique session ID; the editor's loaded recording, the persisted telemetry and the SW share it; a recording never shows another recording's telemetry (each recording's telemetry contains the click made during it and not the click of the previous one) | `data-session-id` on the source video, persisted telemetry, click targets | m1 `stop paths` + unit |
| M1-09 | Reloading the editor after a recording shows the same recording with the same session ID | editor reload | m1 `stop paths` |
| M1-10 | Fallbacks: when OPFS is unavailable the recording is kept in IndexedDB, and in memory as a last resort; the editor still loads it | unit (storage backends) + m1 `idb fallback` (OPFS made unavailable for the editor page only) | unit + m1 |
| M1-11 | No regressions: build clean, `tsc --noEmit` clean, 0 test hooks in `dist/`, unit suite and the earlier journeys green | full suite | all |

Human checks for M1: HC-004 (Chrome's "Stop sharing" bar), HC-008 (tab and window surfaces
chosen in the share picker).

### M1 state (2026-11-11, end of session 2) — NOT DONE

- [x] acceptance checks written (this table)
- [x] tests written and shown failing on `e289055` (tests `68c8d50`)
- [x] implementation `39f7756`, zero-copy pump + snapshot limit `93ece99`; capture marker (AGENTS.md 3.8) `1635815`
- [x] used like a real user (desktop free): every M1 check PASSED one at a time — timing `28.7 fps vs 31.2 plain, worst hole 99 ms, first page frame −96 ms, last −77 ms`, mic, stop paths, crash, idb; a guarded mid-frame was looked at (real clock fixture + marker + HUD)
- [ ] full suite run 1 — **FAILED** (HEAD `93ece99`, 27 passed / 11 failed, 14.0 min). See BUGS.md QA-029..QA-034
- [ ] full suite run 2 — not started
- [ ] verifier — aborted before any test run (suite red). Its static review (Q3): **no weakening, faking or mocking found**; notes: (1) M1-03 check (b) `pts.length >= 0.95*read` is inflated by repeated hold frames → count only real frames; (2) the unit tests fail on `e289055` mostly with "not a function", only M1-05 #1 on behaviour; (3) the marker overlay is visible to every journey's pixel/DOM checks

**Where exactly I stopped (resume here):**
1. `tests/e2e/out/MARKER_ABORT.json` is still present ON PURPOSE (QA-031: the popup-stop recording had 34/127 frames without the marker; not viewed). Explain it WITHOUT viewing frames (is the marker on `popup.html`? what is on top after the popup closes?), fix, and only then delete the file.
2. QA-029 (blocks M1, regression: J1 failed `20.737 s vs 20.142 s`): forward frames only from HUD-live to the stop REQUEST instant.
3. QA-030 (blocks M1): reduce the frame-diff detector cost (≈20 % of the editor main thread); fix M1-03 (b) per the verifier.
4. Check whether the marker overlay causes J3's third blob (`moving-window diff {"changed":1751,"blobs":3}`).
5. Triage (not M1-owned, but must not be M1 regressions): QA-032 C1 silent mic track?, QA-033 J11 frozen export clock, QA-034 C2 3 silences.
6. Then full suite ×2 with the desktop free, the verifier, `M1 done`.

Open M1 follow-ups found on the way (not blocking M1):
- M2: `START_TELEMETRY` is still sent to every active http tab, not only the recorded one.
- M10: transition snapshots for the SOP/widget are now limited to one per 700 ms (they cost
  39 % of the editor's main thread on an animating page); M10 must check that every step still
  gets the right screenshot (ideally snapshots taken AT the click).
- M11: the frame-diff detector still keeps the editor ~20 % busy (2234 ms of 10761 ms) on an
  animating page; VP8 1080p is software-encoded here (H.264 HW encoder starts in 0.48 s).
