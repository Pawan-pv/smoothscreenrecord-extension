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

### M1 state (2026-11-11, end of session 1)

- [x] acceptance checks written (this table)
- [x] tests written and shown failing on `e289055`: unit 11/11 failed (`bytes committed to disk before stop: expected 0 to be >= 12`, stale telemetry handed to another session); m1 journey 5/5 failed (2.4 fps with a 2.5 s hole, audio 0.495 s past the video, no session ids, `OPFS while recording: … 0 bytes`, no IndexedDB)
- [x] implementation: `39f7756` (tests `68c8d50`)
- [~] used like a real user: unit 88/88; m1 `mic`, `stop paths`, `crash`, `idb fallback` PASS on the real build; `timing` not yet valid — see below
- [ ] full suite run 1 / run 2
- [ ] verifier

**Where exactly I stopped:** the m1 `timing` run was invalidated by the desktop: another
application window came on top of the test browser half-way through the recording (frames 63..119
show that window, not the fixture), although the harness sets the browser TOPMOST. Every
screen-capture journey needs the desktop to itself while it runs (HC-009). Last valid numbers
before that: 119/121 pump frames kept, worst hole 215 ms, last page frame −217 ms from the stop
click, first page frame −692 ms before the HUD. Next steps, in order:
1. With the desktop free: `node node_modules/playwright/cli.js test tests/e2e/m1-recording-core.spec.ts --reporter=list --workers=1`
2. Full suite run 1 and 2 (`--workers=1`), regressions fixed first.
3. Fresh verifier subagent: tests fail on `e289055`, pass on HEAD, nothing weakened/mocked.
4. Commit `M1 done`.

Open M1 follow-ups found on the way (not blocking M1): VP8 at 1080p still costs this i3 enough
CPU that the capture source slows while recording (11 fps vs 22 fps idle) → M11 quality profiles;
`START_TELEMETRY` is still sent to every active http tab, not only the recorded one → M2.
