# BUGS.md — SmoothStudio QA bug log

Severity: **CRITICAL** = core loop broken, data loss, privacy leak or security issue · **HIGH** = wrong output or a broken feature · **MEDIUM** = performance or UX problem · **LOW** = cosmetic

Status: `OPEN` · `FIXED <commit>` · `BLOCKED <reason>` · `NOT A BUG <evidence>`

Leads from `CODE_REVIEW.md` (copied from `.planning/REVIEW.md`, 2026-11-09) are listed as **leads, not facts** — each one still has to be reproduced with a real browser run before it counts.

| ID | Severity | Title | Repro steps | Evidence | Status |
|----|----------|-------|--------------|----------|--------|
| QA-001 | HIGH | MP4 export aborts with a 2 s seek timeout and leaves the browser unresponsive | Record any page with the mic ON, press *Export MP4* | `Seek timeout: the video frame at 7.533s was not presented within 2000ms` (`src/engine/mp4-exporter.ts:87-153`); reproduced with auto-cut **OFF** as well → not caused by silence skipping. Browser stopped answering; the download never arrived | OPEN (pre-existing, also breaks `tests/e2e/c2-mp4-audio.spec.ts`) |
| QA-002 | MEDIUM | The Opus track of the raw recording outlives the video track by ~0.4 s | Record 20 s with the mic ON | Raw file: video packets end at 20.560 s, audio packets end at 20.975 s, file duration 20.969 s, wall clock 20.402 s | OPEN (impact on export A/V still to be measured in J11) |
| QA-003 | — | Wall-clock reference point of the e2e harness was taken after the capture had already started | — | Harness fix: the clock now starts when the on-page HUD appears (recorder live). **Product was not changed** | NOT A BUG (harness measurement error, `tests/e2e/helpers/harness.ts`) |
| QA-004 | MEDIUM | The declared `tabCapture` permission is never used - the product can only capture through the getDisplayMedia picker | Press *Start Studio Recording* and look at Chrome's share sheet; then check the source | `manifest.json:12` declares `"tabCapture"`, but the only capture call in the product is `navigator.mediaDevices.getDisplayMedia()` (`src/engine/screen-recorder.ts:100`). Probe (`tests/e2e/helpers/probe-capture-surface.mjs`) reports `displaySurface:"monitor"` for every capture request. Consequence in an automated session: the WHOLE SCREEN is recorded, including every other application and anything sensitive on it | OPEN |
| QA-005 | — | Chrome for Testing 157 ignores the capture auto-select flags | Launch with `--auto-select-tab-capture-source-by-title=<title>` or `--auto-select-desktop-capture-source=<window title>` and read the track settings | Probe output: `displaySurface:"monitor"`, `deviceId:"screen:0:0"` for a tab title, a window title and a single-word title, in both Chrome for Testing 157 and Playwright Chromium 1254 | NOT A BUG (environment limitation of this Chrome build; recorded in HUMAN_CHECKS.md) |
| QA-006 | HIGH | The privacy shield is only armed when the recording is started from the popup | Open the editor directly (toolbar icon → *Open Studio*, or `editor.html?record=true`) and record a page that contains an email | `src/popup/popup.tsx:103-109` broadcasts `APPLY_PRIVACY_OPTIONS` to the target tab; the editor's start path (`src/editor/EditorStudio.tsx:756-769`) only sends `START_STUDIO_RECORDING`, and the service worker (`src/background/service-worker.ts:109-132`) only dispatches `START_TELEMETRY`. Observed in J9: with all three toggles ON in the popup, the page kept the readable `dana.reeves@example-corp.com` until the popup's *Start Studio Recording* was used | OPEN |
| QA-007 | HIGH | Turning a privacy toggle OFF leaves the page masked | Enable the privacy shield, then switch *Auto-Blur Emails* off in the popup | `applyAutoRedaction()` (`src/content/privacy-redactor.ts:352-360`) only masks; it never restored what it had masked, so the page kept showing `••••••@••••.com`. Reproduced by J9 before the fix | FIXED (restore-then-reapply in `applyAutoRedaction`, observers re-armed with the current options) |

## Leads from CODE_REVIEW.md (not yet reproduced)

| Lead | Severity | Title | File | Status |
|------|----------|-------|------|--------|
| CR-01 | CRITICAL | Stateful global regexes cause privacy redaction to skip subsequent text nodes | `src/content/privacy-redactor.ts:28-38` | OPEN — the current source already declares *non-global* detection patterns (`privacy-redactor.ts:18`), so the lead may be stale; must be confirmed with a recorded frame (J9) |
| WR-01 | MEDIUM | `handleStopLiveRecording` reentrancy and duplicate processing | `src/editor/EditorStudio.tsx:526-566`, `src/engine/screen-recorder.ts:95-100,195-201` | OPEN (lead) |
| WR-02 | MEDIUM | Stale closure in keyboard shortcut effect (`Z` adds pill at stale playhead) | `src/editor/EditorStudio.tsx:463-484` | OPEN (lead) |
| WR-03 | MEDIUM | Stale closure in editor tab message listener | `src/editor/EditorStudio.tsx:87-102` | OPEN (lead) |
| WR-04 | MEDIUM | `displaySurface: 'browser'` restricts capture to browser tabs | `src/engine/screen-recorder.ts:38-47` | OPEN (lead) |
| WR-05 | MEDIUM | Snapshot timestamps are absolute but compared to relative telemetry times | `src/engine/screen-recorder.ts:157-159`, `src/engine/sop-guide-exporter.ts:60`, `src/engine/html-widget-exporter.ts:11` | OPEN (lead) |
| WR-06 | MEDIUM | `applyAutoRedaction` crashes when invoked before `document.body` exists | `src/content/privacy-redactor.ts:18` | OPEN (lead) |
| WR-07 | MEDIUM | Playback SFX triggered inside `setCurrentTimeMs` state updater | `src/editor/EditorStudio.tsx:413-451` | OPEN (lead) |
| IN-01 | LOW | Broad API-key regex redacts ordinary long tokens | `src/content/privacy-redactor.ts:15` | OPEN (lead) |
| IN-02 | LOW | Object URL for recorded video is never revoked | `src/editor/EditorStudio.tsx` (`setupLoadedRecording`) | OPEN (lead) |
| IN-03 | LOW | Offscreen worker is effectively unused | `src/offscreen/recorder-worker.ts` | OPEN (lead) |
| IN-04 | LOW | `videoTrack.onended` calls async `stop()` without handling rejection | `src/engine/screen-recorder.ts:95-99` | OPEN (lead) |
| IN-05 | LOW | Unhandled `video.play()` promise in frame-diff detector | `src/engine/screen-recorder.ts:119` | OPEN (lead) |
