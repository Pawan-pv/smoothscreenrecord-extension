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
| M1-02 | The recording covers the whole live interval and nothing much beyond it: the first frame's page clock ≤ the instant the HUD appeared + 0.1 s, and the last frame's page clock within 0.3 s of the stop click | epoch band of the first and last decoded frames vs the click times | m1 `timing` |
| M1-03 | Frame rate with the editor tab in the BACKGROUND, on a continuously animating page: ≥ 24 distinct fps (spec: up to 60 fps) | ffprobe frame timestamps + distinct epoch values per second | m1 `timing` |
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

### M1 state

- [ ] acceptance checks written (this table)
- [ ] tests written and shown failing
- [ ] implementation
- [ ] used like a real user, outputs inspected
- [ ] full suite run 1 / run 2
- [ ] verifier
