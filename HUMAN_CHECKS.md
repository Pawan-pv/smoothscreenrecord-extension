# HUMAN_CHECKS.md — things only a person can verify

Everything in this file could not be verified by the automated real-browser suite in this
environment, either because it needs a human gesture/decision, or because the environment
cannot provide it. Each entry says exactly what to do and what to look at.

---

## HC-001 — MP4 export in a real desktop session (QA-001)

**Why a human:** the automated runs wedge the browser process, so the *user-visible* result
(the toast, the downloaded file, whether Chrome stays alive) cannot be observed end-to-end
from the automation.

**Steps**
1. Build: `npm run build`, then load `dist/` as an unpacked extension in Chrome.
2. Open any page, press *Start Studio Recording* with the microphone ON, record ~20 s, stop.
3. In the editor press *Export 1080p/60fps MP4*.
4. Watch for the toast: does it say *MP4 Exported* or *MP4 Export Failed*?
5. If it fails, copy the exact text of the toast and the DevTools console error.

**What to report:** the toast text, the console error text, and whether Chrome stayed
responsive afterwards (can you still scroll the editor?).

---

## HC-002 — Audio tail of the raw recording (QA-002)

**Why a human:** the automated run measures the tail (Opus track ≈ 0.4 s longer than the
video track), but whether the *exported* file actually drifts at the end needs a human to
watch the exported MP4's last second against the last second of the raw recording.

**Steps**
1. Record ~20 s with the mic ON.
2. Export the MP4 (or GIF) and play the last 2 seconds of the export next to the last 2
   seconds of the raw recording.

**What to report:** whether the export's audio runs past the last video frame, and by how
much (frozen picture with sound?).

---

## HC-003 — Real OS cursor in screen/window capture (J3/J4)

**Why a human:** the automated cursor count works on a *static* fixture where the cursor is
the only moving thing. With a busy page the OS cursor is baked into the frame and an
automated blob count cannot separate it from other high-contrast shapes.

**Steps**
1. Record the screen (entire screen) for 10 s while moving the mouse over a text-heavy page.
2. Export to GIF/MP4, open the export, step through the frames.
3. Count the cursors visible in each frame.

**What to report:** how many cursors appear per frame, and whether the cursor is the
product's smooth vector cursor or the raw OS arrow.

---

## HC-004 — Chrome's "Stop sharing" bar (J5)

**Why a human:** Chrome's own "Stop sharing" bar is browser chrome; whether the extension
notices it depends on the real browser UI.

**Steps**
1. Start a recording, then press the browser's *Stop sharing* button (or the camera icon in
   the toolbar → *Stop sharing*).
2. Confirm the editor loads the NEW recording and that the HUD disappears from the page.

**What to report:** whether the recording ends, what the editor shows, and whether the HUD
is gone.

---

## HC-005 — Multi-window / multi-display (J7, J19)

**Why a human:** the automation runs one window on one display. Recording a 1707 px wide
window and verifying the HUD only appears in the recorded tab needs a second real window.

**Steps (J19)** Open a browser window exactly 1707 px wide, record it, export, and play the
export.
**Steps (J7)** Open two windows, record a tab in one of them, and check that the HUD,
tracker and blur appear only in the recorded tab and are gone after stopping.

**What to report:** the export resolution, whether the export plays, and where the HUD
appeared.

---

## HC-006 — Frame rate of a recording made the normal way (QA-008)

**Why a human:** the automated run measures ~7 fps for a 20 s recording made while the
editor tab stays in the background, but the cause (Chromium throttling frame presentation
in the hidden editor tab) and the effect on the exported video can only be judged by
watching the result.

**Steps**
1. Open a page that animates continuously (the clock fixture, or any video page).
2. Start the recording from the popup and let the editor tab sit in the background for
   20 s.
3. Export to MP4 or GIF and play the result at 1x.

**What to report:** whether the motion looks smooth or stuttery, and whether the exported
file's frame rate (ffprobe `nb_frames` / duration) matches what you see.

---

## HC-007 — Privacy shield when the recording is started from the editor (QA-006)

**Why a human:** the automated run proves that the page is NOT redacted when the recording
is started from the editor, but a human has to decide how the fix should behave when the
recording covers the whole screen instead of one tab (in-page redaction cannot protect a
screen capture of other applications).

**Steps**
1. Open a page with an e-mail address in it.
2. Open the extension from the toolbar icon and press *Open Studio* (NOT *Start Studio
   Recording*).
3. In the editor press *Record New Screen*, record the page for a few seconds, stop.
4. Play the recording.

**What to report:** whether the e-mail address is readable in the recording, and what the
extension should do when the user captures the whole screen while the privacy shield is
on.
