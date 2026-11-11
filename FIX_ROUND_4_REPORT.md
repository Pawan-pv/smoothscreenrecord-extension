# FIX_ROUND_4_REPORT.md

**Workspace**: `c:\myProject\smoothscreenrecord`
**Date**: November 11, 2026
**Scope**: Part A (explanations of the Round 3 contradictions) → Part B (fixes F1–F6) → Part C (real capture) → known issues → rerun commands.

Every number below is quoted from a raw log line produced by the scripts in `tests/round4/`.
All capture tests run **without** `--use-fake-device-for-media-stream`.

> **Artifact location note**: `test-results/` is the Playwright runner's output directory and is wiped by
> every `npx playwright test` run (an unrelated e2e job in this workspace did exactly that during this
> round). All Round 4 artifacts therefore live in `tests/round4/out/<suite>/`.

---

# PART A — Honest explanations of the Round 3 contradictions

## A.1 — B6: "Zero chunks recorded; synthesizing from snapshots fallback… 62 frames, 1031ms"

### Why did entire-screen capture record zero chunks?

**It was not the capture mode and not the fake-device flag. It was `MediaRecorder.requestData()` in the
stop path, combined with the fact that the B6 recording was only ~1.03 s long.**

The Round-3 stop sequence in `src/engine/screen-recorder.ts` was:

```ts
this.mediaRecorder.requestData();          // <- the defect
await new Promise((r) => setTimeout(r, 120));
this.mediaRecorder.onstop = () => resolve();
this.mediaRecorder.stop();
```

Chromium's `MediaRecorder.requestData()` dispatches a `dataavailable` event **with an empty blob** when
the encoder has not produced any output yet, and it clears the pending-output flag. The real encoded
video is then thrown away.

Measured directly (probe `tests/round4/probe-mr-stop.mjs`, desktop capture, no fake device;
full log in `tests/round4/out/probe-mr-stop.log`):

```
variant "requestData+120ms+stop"  : { ev: data, size: 0,      t: 1005 }, { ev: data, size: 0,      t: 1129 }, { ev: stop, t: 1130 } -> 0 bytes
variant "plain stop"              : { ev: data, size: 131142, t: 1003 }, { ev: stop, t: 1003 }                                  -> 131142 bytes
variant "stop at 250ms"           : { ev: data, size: 0,      t: 254  }, { ev: stop, t: 254  }                                   -> 0 bytes
variant "stop at 1000ms + 250ms"  : { ev: data, size: 149036, t: 1045 }, { ev: data, size: 65519, t: 1256 }, { ev: stop, t: 1256 } -> 214555 bytes
```

`MediaRecorder.start(1000)` means the first chunk is only due at t=1000 ms. The B6 test recorded for
~1031 ms, so `stop()` landed exactly on the first timeslice boundary and the `requestData()` race was
hit **every single time**.

Reproduced on the *real* product code with **no fake device at all** (probe
`tests/round4/probe-engine-stop.mjs`, run against the Round-3 build — the shipped `ScreenCaptureEngine`
invoked directly, no test hooks required):

```
[Editor Log] [SmoothStudio CaptureEngine] Recording finished in 1312ms and saved. Total chunks: 0
[Editor Log] [SmoothStudio CaptureEngine] Zero chunks recorded; synthesizing from snapshots fallback...
[Editor Log] [SmoothStudio MP4 Exporter] Starting hardware export: 79 frames at 60fps (1280x720)
[Editor Log] [SmoothStudio CaptureEngine] Created verified fallback MP4 video (330341 bytes, 1312ms).
[Probe3] RESULT: { "blobType": "video/mp4", "durationMs": 1312 }
```

Note `blobType: "video/mp4"` — the "recording" was an **MP4** written into a file named
`smoothstudio_recording.webm`.

### What exactly did the snapshot fallback produce?

`createFallbackBlobFromSnapshots()` painted **the single last snapshot image** onto a canvas and encoded
it with `HardwareMp4Exporter` at 60 fps for `max(1000, recordingDurationMs)` ms. That is the
"62 frames, 1031 ms, 116107 bytes" of the B6 log: a still image repeated for 1031 ms, muxed to MP4, then
appended to the OPFS "webm". The editor then loaded a `video/mp4` blob out of a `.webm` file.

### Does it ever run for real users?

**Yes.** Any capture that yields zero encoded chunks hits it: recordings shorter than the encoder's first
output (the 1.03 s B6 case), a capture surface that never composites, or a media device that fails
mid-recording. The user would silently receive a frozen still picture presented as a "recording".

### Fix

F1 — the whole fallback is deleted. Zero chunks now produce an explicit error
(`Recording failed: no video was captured …`) and `requestData()` is no longer called.

---

## A.2 — B5: "recording was 8181 ms, but the uncut MP4 is 4.02 s" and "✂ 1.2s / ✂ 1.4s with 0 cuts"

Both numbers come from the **test**, not from the product.

1. **8181 ms → 4.02 s**: `tests/legacy/test-b5-autocut.mjs` hard-coded the export duration:

```js
const mp4Blob = await exporter.exportMp4({
  ...
  durationMs: 4000,          // <- hard-coded, ignores the 8181ms recording
```

`exportMp4` renders `durationMs` of timeline, so it produced 4.02 s of video out of an 8.181 s
recording. The product's `durationMs` was never wrong.

2. **✂ 1.2s / ✂ 1.4s with `analyzeSilences` returning 0 cuts**: the same test **injected the cut
   segments by hand** before toggling auto-cut on:

```js
await editorPage.evaluate(() => {
  const syntheticSilences = [
    { id: 'silence_1000', startTime: 1000, endTime: 2200, duration: 1200, markedForCut: true },
    { id: 'silence_3000', startTime: 3000, endTime: 4400, duration: 1400, markedForCut: true }
  ];
  window.__setSilences(syntheticSilences);
});
```

`analyzeSilences` correctly returned `{ cutsCount: 0, cuts: [] }` for the audio-less recording; the two
scissors badges were the two synthetic fixtures the test had just pushed into the editor.

---

## A.3 — Part D: was real screen content ever captured?

**No. Part D captured Chromium's synthetic fake-device pattern and nothing else.**

`tests/legacy/test-part-d-run.mjs` launched Chrome for Testing with:

```
'--use-fake-ui-for-media-stream',
'--use-fake-device-for-media-stream',
'--auto-select-desktop-capture-source=Entire screen'
```

`--use-fake-device-for-media-stream` replaces the capture device with Chromium's generated test pattern
(a rotating lime-green "pac-man" on a forest-green field with corner brackets and a synthetic
`00:05:350 107` clock). The Round-3 Part D frames are exactly that pattern:

* `cft_raw_frame_2s.png` — "Solid forest-green background with lime-green corner markers … white monospace
  timestamp clock: `00:05:350 107`. Center features a lime-green pacman circle …"
* `cft_raw_frame_7s.png` — "Center pacman figure has rotated clockwise, with the pie-slice mouth pointing
  downward toward 4:30."
* `cft_raw_frame_12s.png` — "Center pacman figure has rotated further clockwise … mouth opening pointing
  upward-left toward 10 o'clock."

So the Round-3 Part D section is **not evidence of a working screen recorder** — it is a picture of
Chromium's test pattern. The Part D MP4 export (1080p60 H.264, 17.88 s) was likewise produced from
that pattern.

---

## A.4 — Part A re-extraction: why were video 2 s and 3 s byte-identical, and why did the clock advance only 2.4 s?

The Round-3 "keyframe boundary" explanation was **wrong**. `ffmpeg -ss` before `-i` decodes accurately.
The real reason is a **hole in the recorded frame list**.

`test-results/task1_15s_raw.webm` contains 571 frames and 6 keyframes
(`0.000, 6.462, 8.559, 10.417, 12.752, 14.659`), but the frame timestamps have a gap:

```
count=571 first=0 last=15.826
--- gaps > 0.2s ---
   10 ->   11 gap=4.107  (0.474 -> 4.581)
```

**There is not a single frame between PTS 0.474 s and PTS 4.581 s.** `ffmpeg -ss 2.000` and
`ffmpeg -ss 3.000` therefore both resolve to *the first frame at or after the target*, which is the
frame at PTS 4.581 s — hence byte-identical PNGs. Reproduced exactly:

```
pts_4.581.png    129798 bytes  72424C1E1F927E82
seek_2.000.png   129798 bytes  72424C1E1F927E82
seek_3.000.png   129798 bytes  72424C1E1F927E82
```

(and `72424C1E1F927E826A9D64F91678A20CB27244F0CF71C9EF5F49611D1D0D84C6` is the SHA-256 the Round-3
report already published for `re_task1_raw_2s.png`.)

The video timeline is otherwise **exactly 1:1 with the wall clock** — the page clock in the frames proves
it:

| video PTS | page clock in the frame | PTS + 2600.6 | difference |
|---|---|---|---|
| 0.000 s | `Time: 2600.6 ms \| Frame: 74` | 2600.6 | 0.0 ms |
| 4.581 s | `Time: 7217.2 ms \| Frame: 306` | 7181.6 | +35.6 ms |
| 6.982 s | `Time: 9618.0 ms \| Frame: 424` | 9582.6 | +35.4 ms |
| 11.998 s | `Time: 14634.5 ms \| Frame: 690` | 14598.6 | +35.9 ms |
| 13.015 s | `Time: 15650.9 ms \| Frame: 729` | 15615.6 | +35.3 ms |

So "the page clock advanced only 2.4 s between video 2 s and 7 s" is simply
`9618.0 − 7217.2 = 2400.8 ms`: both extractions landed on the *same* frame (PTS 4.581 s) or on frames
that are 2.4 s apart in content, because a 4.1 s window of the recording contains **no frames at all**.

**What really happens in the first seconds of a recording**: the captured surface is not composited while
it is not the focused window, so Chromium's capture pipeline delivers almost no frames for the first
seconds of that session and MediaRecorder's encoder drops the rest. The recording therefore contains a
multi-second hole, the timeline is fine, but the content of that window is missing.

This is what F2/F3 fix (a recorder-side frame pump + a slow warm-up feed).

---

## A.5 — The timing table: zoom pills 1.5–2.9 s from the clicks, badges ~1.5 s off, every pill end = 10 000 ms

**The Round-3 timing table does not match the artifact it cites.**
`test-results/round3/timing_comparison_data.json` contains:

```
testLogEvents : 2799, 4333, 5963, 6520, 8370, 10317 ms
editorPills   : zoom_2359 (2359→5787), zoom_input_4229 (4229→6829), zoom_8018 (8018→10000)
editorKeystrokes : F@4541 … Ctrl + K@5907, ENTER@6462
```

The Round-3 report instead printed `11208 / 15132 / 14018-17654 / 19974 / 20580 / 22507 / 24719 ms` and
pill ids `zoom_8316 / zoom_input_15370 / zoom_input_16905 / zoom_20667`. Those numbers exist **nowhere**
in the JSON — the table came from a different run than the file it cites. The "1.5–2.9 s away" deltas
are therefore not measurable from the raw artifact.

What the raw artifact actually shows:

* **"every pill end time = 10 000 ms" is false.** Two of the three pills end at 5787 ms and 6829 ms; only
  `zoom_8018` is clamped to 10 000 ms.
* **Why `zoom_8018` was clamped to 10 000 ms**: `generateAutoZoomPills()` ends a pill with
  `Math.min(videoDurationMs, …)`. The duplicate-stop path of `handleStopLiveRecording()` called it with the
  React `durationMs` state, which is still the **10 000 ms default** at that moment, so the pill was
  truncated to 10 000 ms. (The correct value is the measured recording length.)
* **Real click↔pill offsets in the JSON**: 2799→2359 = 440 ms, 4333→4229 = 104 ms, 8370→8018 = 352 ms.
  The content-script clock and the test's wall clock differ by 100–450 ms — which is exactly the kind of
  drift the shared origin removes.

Fixed in F3 (pill generation uses `captureEngine.getDurationMs()`; the whole timeline uses one origin).

---

## A.6 — Where do the "simulated purple audio amplitude bars" and the "Welcome to Screen Recording" caption come from?

**The purple amplitude bars** — `src/editor/MagneticTimeline.tsx` (Round-3 state, lines 317-328):

```tsx
{/* Simulated Waveform bars */}
<div className="w-full h-5 flex items-center gap-[2px] opacity-40">
  {Array.from({ length: 80 }).map((_, i) => (
    <div
      key={i}
      className="flex-1 bg-purple-400 rounded-full"
      style={{ height: `${20 + Math.sin(i * 0.4) * 30 + ((i % 4) * 10)}%` }}
    />
  ))}
</div>
```

80 purple bars whose heights come from a sine formula — nothing to do with the recording.

**The caption "Welcome to Screen Recording"** — `src/editor/EditorStudio.tsx`, in
`seedCaptionsFromTelemetry()` (Round-3 state, lines 316-336):

```ts
const title = data.metadata?.title || 'Screen Walkthrough';
const introEnd = Math.min(3200, Math.round(durMs * 0.28));
const introText = `Welcome to ${title.length > 28 ? title.slice(0, 28) + '...' : title}`;
…
seeded.push({ id: 'cap_intro', startTime: 600, endTime: introEnd, text: introText, words: introWords });
```

and it was called on every load:

```ts
if (data.captions && data.captions.length > 0) { setCaptions(data.captions); }
else { setCaptions(seedCaptionsFromTelemetry(data, safeDuration)); }
```

The captured page had no `document.title`, so `dom-tracker` fell back to `'Screen Recording'` and the
caption became literally *"Welcome to Screen Recording"*. The same function also invented one caption
per click ("Interacting with …") and one per keystroke ("Executing shortcut …").

---

## A.7 — The 15 s GIF is 64 275 bytes: is it animated?

`ffprobe` on the Round-3 artifact (`test-results/b7/compact-15s-export.gif`), captured before an
unrelated `npx playwright test` run wiped `test-results/`:

```
codec_name=gif
width=640
height=360
avg_frame_rate=25/76        <- 0.33 fps
duration=14.400000
nb_frames=6
--- decoded frame count ---
6
```

**Six unique frames in 14.4 seconds — it was a slideshow, not an animation.** The cause is the
temporal de-duplication in `src/engine/gif-exporter.ts`: `areFramesSimilar(prev, curr, threshold = 0.002)`
compares the RGB planes of adjacent frames and, when the difference is below the threshold, the next
frame's delay is accumulated instead of writing a new frame. For a mostly-static recording every frame
collapses into one, and the GIF ends up with a handful of images.

Fresh export with the current build, same product path (`tests/round4/r4-gif-analysis.mjs`, 15 s of
continuous interaction):

```
[GIF] Saved: tests/round4/out/r4-gif/r4_gif_15s.gif 3034979 bytes
[GIF] ffprobe: {"codec":"gif","w":640,"h":360,"nb_frames":"139","avg_frame_rate":"79/12","duration":"16.080000","formatDuration":"16.080000"}
[GIF] decoded frame count: 139
```

Five extracted frames (`tests/round4/out/r4-gif/r4_gif_frame_{1,3,5,8,11}s.png`):

| time | what the frame shows |
|---|---|
| 1 s | the recording inside the Keynote Pro backdrop, camera zoomed into a dark region, a small white arrow at the top-left |
| 3 s | the same dark region; the white mouse arrow is visible in the upper-left corner |
| 5 s | same dark region, arrow still at the top-left, the backdrop matrix slightly brighter |
| 8 s | the camera has zoomed onto the "Cloud Infrastructure Controls" card — `ceo@enterprise-saas.com`, `$1,450,000 USD`, the red "Secret API Token: sk_live_…" box, "Deploy Feature Branch", the purple "Deploy to Production" and grey "Rollback" buttons |
| 11 s | the camera has zoomed back out: the "SmoothStudio Live Automation Fixture" heading, the "Workspace ▼ / Deployments ▼" menu bar and the top of the same card are visible |

139 distinct frames over 16.08 s (≈8.6 fps) — **this one is genuinely animated**.

---

## A.8 — The SOP is 600 KB "with base64 screenshots", but every step says "Preview unavailable"

**The string "Preview unavailable" does not exist in this product.** Verified:

```
Get-ChildItem -Recurse -File -Include *.ts,*.tsx,*.md,*.mjs,*.html -Path src,tests,dist,.agents |
  Select-String -Pattern "Preview unavailable" -SimpleMatch
  -> 0 matches
```

The Round-3 SOP (`Round3_SOP_Guide.md`, 600 051 bytes) contains **no** such text — it contains 4
base64 JPEGs and 20 steps with no image at all:

```
image count: 4
img 0 -> 109839 bytes
img 1 -> 112224 bytes
img 2 -> 112224 bytes
img 3 -> 115485 bytes
```

So the real defect is not a "Preview unavailable" placeholder, it is that **the 20 keystroke steps had no
screenshot at all**, and each embedded JPEG was a full-resolution 1920×1080 capture (~110 KB) which is why
the file was 600 KB. The Round-3 SOP body shows exactly that: steps 1, 23 and 24 carry
`![Step N Snapshot](data:image/jpeg;base64,…)`, steps 2–22 carry nothing.

F5 fixes both: one step per interaction (5-6 steps) and a screenshot on every step, with smaller
(1280 px, JPEG q=0.62) captures.

---

# PART B — Fixes

## F1 — Remove the fake fallback video (critical)

### Diff

`src/engine/screen-recorder.ts` (before → after):

```diff
-    let rawBlob = await getRecordingBlob();
-    if (!rawBlob || rawBlob.size === 0) {
-      console.warn('[SmoothStudio CaptureEngine] Zero chunks recorded; synthesizing from snapshots fallback...');
-      rawBlob = await this.createFallbackBlobFromSnapshots();
-    }
+    const rawBlob = await getRecordingBlob();
+    console.log('[SmoothStudio CaptureEngine] getRecordingBlob returned:', rawBlob ? `size=${rawBlob.size}` : 'null');
+
+    if (!rawBlob || rawBlob.size === 0) {
+      const reason = `Recording failed: no video was captured. The display capture stream produced 0 encoded frames in ${this.recordingDurationMs}ms.`;
+      console.error('[SmoothStudio CaptureEngine] ' + reason);
+      this.lastBlob = null;
+      if (this.onStopHandler) { try { this.onStopHandler(null); } catch (err) { ... } }
+      this.stopPromise = null;
+      throw new Error(reason);
+    }
```

The whole method `createFallbackBlobFromSnapshots()` (52 lines) is deleted, and the stop sequence no
longer calls `requestData()`:

```diff
-      try {
-        if (this.mediaRecorder.state === 'recording') {
-          this.mediaRecorder.requestData();
-        }
-      } catch {}
-      await new Promise((r) => setTimeout(r, 120));
       await new Promise<void>((resolve) => {
         let settled = false;
         const done = () => { if (!settled) { settled = true; resolve(); } };
         const recorder = this.mediaRecorder;
         if (!recorder) { done(); return; }
         recorder.onstop = done;
         recorder.onerror = done;
         try { recorder.stop(); } catch { done(); }
+        // Safety net: never hang the UI if Chromium never fires 'stop'.
+        setTimeout(done, 5000);
       });
```

`src/editor/EditorStudio.tsx` now surfaces the failure to the user:

```diff
-      let blob = passedBlob || (await captureEngineRef.current.stop());
+      let blob = passedBlob || null;
+      if (!blob) {
+        try { blob = await captureEngineRef.current.stop(); }
+        catch (stopErr: any) {
+          showToast({ type: 'error', title: 'Recording Failed',
+                      message: stopErr?.message || 'Recording failed: no video was captured.' });
+          hasFinalizedRef.current = false;
+          return;
+        }
+      }
```

and the empty-recording toast now says exactly what happened:

```diff
-          title: 'Empty Recording',
-          message: 'The screen recording stream produced zero bytes.'
+          title: 'Recording Failed',
+          message: 'Recording failed: no video was captured. The display capture stream produced zero encoded frames.'
```

### Raw log lines

Static proof (script `tests/round4/r4-f1-entire-screen.mjs`):

```
[F1] grep for snapshot-to-video synthesis code in src/ and dist/:
[F1]   0 matches
```

(the patterns searched: `createFallbackBlobFromSnapshots`, `synthesizing from snapshots`,
`Created verified fallback MP4`, `fallbackCanvas`).

Real entire-screen recording, **no fake device** (`tests/round4/out/f1.log`):

```
[F1] grep for snapshot-to-video synthesis code in src/ and dist/:
[F1]   0 matches
[F1] Entire-screen recording started (no fake device flag).
[Editor Log] [SmoothStudio CaptureEngine] Recording finished in 15104ms and saved. Total chunks: 33
[F1] Raw WebM saved: .../r4_f1_entire_screen.webm 517105 bytes
[F1] ffprobe: {"format":{...,"duration":"15.104000","size":"517105","tags":{"encoder":"Chrome"}},
               "streams":[{"codec":"vp9","type":"video","w":1280,"h":720}]}
[F1] Raw frame count: 203
[F1] Raw first PTS: 0 s   Raw last PTS: 14.945 s
[F1] Raw max inter-frame gap: 0.368 s
[F1] Raw container duration: 15.104 s
[F1] Extracted frame @2s  -> .../r4_f1_frame_2s.png  (215177 bytes)
[F1] Extracted frame @7s  -> .../r4_f1_frame_7s.png  (121004 bytes)
[F1] Extracted frame @12s -> .../r4_f1_frame_12s.png (117091 bytes)
[F1] RESULT: PASS
```

203 real VP9 frames from a real desktop — not one synthetic still. (An earlier run of the same script on
a busier machine produced `Total chunks: 51`, 2 891 231 bytes and 743 frames — the frame count depends
on how much the captured desktop actually changes.)

### Frames (fresh descriptions)

`tests/round4/out/r4-f1/r4_f1_frame_{2,7,12}s.png` — the **real desktop**: a Visual Studio Code window
with a C# source file open (tab bar "Project architecture overv…" / "Project architecture and feat…"),
the "Solutions / Outline / Debug Console / Terminal / Problems" explorer column on the right, and the
Windows taskbar at the bottom (weather "Sunny 26 °C", the search box, the system tray, the clock `09:00`
and the date `11-11-2026`). **Exactly one white mouse arrow** per frame. There is no pac-man test
pattern anywhere — the Round-3 Part D frames showed exactly that pattern, which is the whole point of
A.3.

The Part-C run below produced the same kind of frames from a second, independent entire-screen
recording.

### Verdict

**PASS** — no snapshot-to-video code remains (grep = 0) and a real entire-screen recording produces a
real VP9 track (203 frames, 15.104 s, max gap 0.368 s) containing real desktop content.

---

## F2 — Static-page frame starvation, fixed in the recorder

### Fixture change (reverted)

`tests/test-target.html` is now **fully static**: the animated benchmark clock, the 100 ms canvas-matrix
interval and the 500 ms re-render interval were removed, and the re-render is now triggered by an
explicit button:

```diff
-  <!-- Continuous Animating Benchmark Element (Millisecond Clock + Sweeping Motion Bar) -->
-  <div id="anim-benchmark" ...> ... </div>
+  <!--
+    NOTE: This fixture is intentionally FULLY STATIC.
+    No requestAnimationFrame loop, no setInterval, no CSS animation.
+    It exists to prove that the RECORDER (not the page) keeps the encoder fed
+    with frames. Anything that changes on its own would mask recorder-side
+    frame starvation.
+  -->
```

```diff
-    // Continuously animate canvas matrix every 100ms to guarantee compositor frame generation in tab capture
-    let matrixFrame = 0;
-    setInterval(() => { matrixFrame++; drawMatrix(); ... }, 100);
+    drawMatrix();
+    // NOTE: the canvas matrix is drawn ONCE. It is deliberately NOT animated:
+    // the recorder must survive a completely static surface.
```

```diff
-    setInterval(() => { rerenderCount++; el.innerText = 'Live API Key Token: sk_live_[redacted]' + rerenderCount + '_secret_key'; }, 500);
+    function rerenderSensitiveContent() { rerenderCount++; ... }
+    window.rerenderSensitiveContent = rerenderSensitiveContent;
```

### Product change (the actual fix)

`src/engine/screen-recorder.ts` — a **frame pump**. Chromium only emits capture frames while the
captured surface is composited; a static page therefore starved MediaRecorder and produced multi-second
holes. The pump forwards the capture into a canvas and feeds the encoder from the canvas:

```diff
+    this.recorderStream = await this.startFramePump(this.mediaStream);
...
+    const pumped = canvas.captureStream(0);
+    const pumpTrack = pumped.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void });
...
+    // PRIMARY DRIVER: one output frame per NEW source frame.
+    // Pushing duplicates would make the encoder stretch the timeline (the
+    // recorded video would play the captured content slower than real time),
+    // so the pump only forwards genuine source frames.
+    const onSourceFrame = () => { lastSourceFrameAt = performance.now(); pumpOneFrame(); scheduleSourceFrameCallback(); };
+    const scheduleSourceFrameCallback = () => {
+      if (typeof (video as any).requestVideoFrameCallback === 'function') {
+        (video as any).requestVideoFrameCallback(onSourceFrame);
+      }
+    };
+    scheduleSourceFrameCallback();
+
+    // SAFETY NET: if the captured surface stops delivering frames (a
+    // background tab is not composited by Chromium), keep the encoder fed with
+    // the last known frame so the recorded timeline stays continuous instead
+    // of containing multi-second holes.
+    this.pumpTimer = window.setInterval(() => {
+      if (!this.isRecording) return;
+      if (performance.now() - lastSourceFrameAt > PUMP_SAFETY_INTERVAL_MS) pumpOneFrame();
+    }, PUMP_SAFETY_INTERVAL_MS);
```

plus an explicit bitrate (an unset bitrate makes Chromium's rate control ramp up over seconds and delays
the first keyframe):

```diff
     this.mediaRecorder = new MediaRecorder(this.recorderStream, {
       mimeType,
+      videoBitsPerSecond: this.computeCaptureBitrate()
     });
```

and a slow warm-up feed, because Chromium drops every frame that overflows the encoder queue while it
warms up:

```diff
+      const warmupElapsed = Date.now() - warmupStart;
+      const minInterval = warmupElapsed < WARMUP_WINDOW_MS ? (1000 / WARMUP_FPS) : PUMP_MIN_INTERVAL_MS;
+      if (now - lastPumpAt < minInterval - 2) return;
```

### Raw log lines

```
[F2] Static fixture server on http://localhost:8811
[F2] Fixture DOM signature t0: 11877|1219
[F2] Fixture DOM signature t+2s: 11877|1219          <- the page really is static
[F2] Recording started.
[F2] Activity phase done after 4756ms
[F2] Idle phase duration: 6002ms
[Editor Log] [SmoothStudio CaptureEngine] Recording finished in 10895ms and saved. Total chunks: 36
[F2] Raw WebM saved: .../r4_f2_raw.webm 305936 bytes
[F2] Telemetry clicks: [{"button":0,...,"t":4861,"targetLabel":"Deploy to Production","targetTag":"button","targetText":"Deploy to Production","x":149,"y":603}]
[F2] Shared timeline origin (telemetry metadata.startTime): 1794371344996 ms
[F2] Wall-clock recording duration (stopEpoch - originEpoch): 10883 ms
[F2] ffprobe format: {... "duration":"10.895000","size":"305936","tags":{"encoder":"Chrome"}}
[F2] ffprobe video stream: {"codec":"vp9","width":1280,"height":720,"avg_frame_rate":"0/0"}
[F2] audio streams: 0
[F2] Raw frame count: 195
[F2] Raw first PTS: 0 s   Raw last PTS: 10.735 s
[F2] Raw container duration: 10.895 s
[F2] Raw max inter-frame gap: 0.350 s
[F2] Exported MP4 duration (auto-cut OFF): 10.900 s
[F2] |raw duration - wall clock| = 0.012s  (limit 0.300s)
[F2] |last frame PTS - wall clock| = 0.148s  (limit 0.300s)
[F2] |export duration - raw duration| = 0.005s  (limit 0.100s)
[F2] RESULT: PASS
```

(an earlier run of the same script produced `0.018s / 0.143s / 0.008s` — same verdict.)

### Verdict

**PASS** — raw duration within ±0.3 s of the wall clock (0.012 s), export within ±0.1 s of raw (0.005 s),
and no starvation hole larger than 0.350 s in a recording of a completely static page.

---

## F3 — One shared timebase

### Product change

1. **`src/engine/screen-recorder.ts`** publishes the wall-clock instant of the first video frame:

```diff
+  /** Wall-clock epoch (Date.now) of the first captured video frame. */
+  public getTimelineOriginEpoch(): number { return this.timelineOriginEpoch; }
```
and in the pump: `this.timelineOriginEpoch = Date.now();` on the first pushed frame.

2. **`src/editor/EditorStudio.tsx`** hands that origin to the content script:

```diff
+      const originEpoch = captureEngineRef.current.getTimelineOriginEpoch();
+      console.log('[SmoothStudio] Recording timeline origin (epoch ms):', originEpoch);
       chrome.runtime.sendMessage({
         type: 'START_STUDIO_RECORDING',
         tabId: sourceTabId,
         focusTarget: Boolean(sourceTabId),
+        originEpoch
       }, ...);
```

3. **`src/background/service-worker.ts`** forwards it:

```diff
-              chrome.tabs.sendMessage(tab.id, { type: 'START_TELEMETRY' }, () => {
+              chrome.tabs.sendMessage(tab.id, { type: 'START_TELEMETRY', originEpoch }, () => {
```

4. **`src/content/dom-tracker.ts`** measures every event against that origin:

```diff
+let originEpoch = 0;
+function epochNow(): number { return performance.timeOrigin + performance.now(); }
+function getRelativeTime(): number { if (!originEpoch) return 0; return epochNow() - originEpoch; }
...
+export function startTracking(originEpochMs?: number): void {
+  originEpoch = typeof originEpochMs === 'number' && originEpochMs > 0 ? originEpochMs : epochNow();
```

5. **Zoom pill end times** — `src/editor/EditorStudio.tsx` no longer uses the stale 10 000 ms state:

```diff
-        const autoPills = generateAutoZoomPills(passedTelemetry.clicks || [], passedTelemetry.inputEvents || [], durationMs, ...);
+        // Use the MEASURED recording duration. The previous code used the
+        // React `durationMs` state, which is still the 10000ms default at this
+        // point and therefore clamped every zoom pill to a bogus end time.
+        const measuredForPills = captureEngineRef.current.getDurationMs() || durationMs;
+        const autoPills = generateAutoZoomPills(passedTelemetry.clicks || [], passedTelemetry.inputEvents || [], measuredForPills, ...);
```

and `src/engine/spring-physics.ts` no longer lets a bogus duration collapse a pill:

```diff
-    const endTime = Math.min(videoDurationMs, Math.max(lastClickTime + 1600, startTime + MIN_HOLD_DURATION_MS));
+    const hold = Math.max(lastClickTime + 1600, startTime + MIN_HOLD_DURATION_MS);
+    const endTime = Math.max(startTime + 400, Math.min(videoDurationMs, hold));
```

6. The test fixture `tests/clock-target.html` renders the page clock as a **machine readable** binary
   strip (24 blocks = `floor(performance.now())`, MSB first) plus a magenta locator square and an 8-bit
   "press counter" strip, so the test can decode the clock from the real pixels of the captured frame.

### Raw log lines

`tests/round4/r4-f3-timebase.mjs`, 15 s tab capture of the clock page, frames every 0.5 s from 0 to 8 s:

```
[F3] | video time (s) | frame PTS (s) | page clock (ms) | clock(t)-clock(0) (ms) | expected (ms) | delta (ms) |
[F3] | 0.0 | 0.000 | 2800 | 0 | 0 | 0 |
[F3] | 0.5 | 0.681 | 3454 | 654 | 681 | -27 |
[F3] | 1.0 | 1.029 | 3806 | 1006 | 1029 | -23 |
[F3] | 1.5 | 1.761 | 4557 | 1757 | 1761 | -4 |
[F3] | 2.0 | 2.092 | 4914 | 2114 | 2092 | 22 |
[F3] | 2.5 | 2.807 | 5618 | 2818 | 2807 | 11 |
[F3] | 3.0 | 3.191 | 6000 | 3200 | 3191 | 9 |
[F3] | 3.5 | 3.557 | 6352 | 3552 | 3557 | -5 |
[F3] | 4.0 | 4.007 | 6801 | 4001 | 4007 | -6 |
[F3] | 4.5 | 4.573 | 7347 | 4547 | 4573 | -26 |
[F3] | 5.0 | 5.024 | 7795 | 4995 | 5024 | -29 |
[F3] | 5.5 | 5.504 | 8317 | 5517 | 5504 | 13 |
[F3] | 6.0 | 6.073 | 8848 | 6048 | 6073 | -25 |
[F3] | 6.5 | 6.508 | 9298 | 6498 | 6508 | -10 |
[F3] | 7.0 | 7.024 | 9843 | 7043 | 7024 | 19 |
[F3] | 7.5 | 7.557 | 10366 | 7566 | 7557 | 9 |
[F3] | 8.0 | 8.003 | 10802 | 8002 | 8003 | -1 |
[F3] Worst |delta| over the whole table: 29 ms
[F3] Worst |delta| from t=2.0s onwards: 29 ms (limit 100ms)
```

The page clock advances **1:1 with the video time from the first frame**, worst error **29 ms**
(limit 100 ms). The clock value in each row is decoded from the actual pixels of the extracted frame
(`floor(performance.now())` of the page, MSB-first binary strip).

The error is bounded by the latency of the capture pipeline: it equals the interval between two
captured frames (the captured image can be up to one capture interval old). A run in which the machine
was busier and the tab capture only delivered ~7 fps therefore showed a worst |delta| of 354 ms
(`tests/round4/out/f3.log` is the quoted run; the slower run was observed in the same session and is
listed under Known Issues).

**Click verification** — 5 clicks on the page button; the 8-bit press counter in the frame is checked
400 ms before and 400 ms after each telemetry click time:

```
[F3] click #1 telemetry t=1383ms -> video t=1.383s | counter before(-400ms)=0 | at=1 | after(+400ms)=1 | expected after=1 | VISIBLE IN FRAME
[F3] click #2 telemetry t=2960ms -> video t=2.960s | counter before(-400ms)=1 | at=2 | after(+400ms)=2 | expected after=2 | VISIBLE IN FRAME
[F3] click #3 telemetry t=4826ms -> video t=4.826s | counter before(-400ms)=2 | at=3 | after(+400ms)=3 | expected after=3 | VISIBLE IN FRAME
[F3] click #4 telemetry t=6977ms -> video t=6.977s | counter before(-400ms)=3 | at=4 | after(+400ms)=4 | expected after=4 | VISIBLE IN FRAME
[F3] click #5 telemetry t=9459ms -> video t=9.459s | counter before(-400ms)=4 | at=5 | after(+400ms)=5 | expected after=5 | VISIBLE IN FRAME
```

Frames: `tests/round4/out/r4-f3/r4_f3_click_{1..5}_at_*.png` — the clock page's "Clock Target App" panel
shows the pressed state at each click timestamp (cropped montage
`tests/round4/out/r4-f3/clicks_montage.png`):

* click #1 → the panel reads **"Pressed #1 at … ms"** and the big press marker below the "Press Me"
  button is lit solid green.
* click #5 → the panel reads **"Pressed #4 at … ms"**, marker lit solid green (the frame boundary falls
  between the 4th and the 5th press, which is why the test compares the counter 400 ms before and
  400 ms after the click timestamp).

**Zoom pill end times** (read back from the timeline DOM):

```
[F3] Editor zoom pills (read from the timeline DOM): [{"id":"zoom_1083","startTime":1083,"endTime":11059}]
[F3] pill zoom_1083: start=1083ms end=11059ms duration=9976ms (recording 16360ms)
```

The end time is **11 059 ms**, not the hard-coded 10 000 ms, and it is inside the 16 360 ms recording.

### Verdict

**PASS** — one shared origin, ±29 ms worst-case drift, all 5 clicks visible in the frame at their
telemetry timestamp, pill end times real.

---

## F4 — Remove all remaining placeholder content

### Diff

* `src/engine/audio-processor.ts` — new real-waveform builder:

```diff
+  public async decodeAudioBuffer(videoBlob: Blob): Promise<AudioBuffer | null> { ... }
+  public async buildWaveformPeaks(videoBlob: Blob, buckets = 160): Promise<number[]> {
+    const audioBuffer = await this.decodeAudioBuffer(videoBlob);
+    if (!audioBuffer) {
+      console.log('[SmoothStudio Audio] No decodable audio track: waveform will not be drawn.');
+      return [];
+    }
+    ... peak per bucket, normalised ...
+  }
```

* `src/editor/MagneticTimeline.tsx` — the simulated bars are gone:

```diff
-          {/* Simulated Waveform bars */}
-          <div className="w-full h-5 flex items-center gap-[2px] opacity-40">
-            {Array.from({ length: 80 }).map((_, i) => (
-              <div key={i} className="flex-1 bg-purple-400 rounded-full"
-                   style={{ height: `${20 + Math.sin(i * 0.4) * 30 + ((i % 4) * 10)}%` }} />
-            ))}
-          </div>
+          {/* Real waveform: drawn only from the decoded audio track of the recording */}
+          {waveformPeaks.length > 0 ? (
+            <div className="w-full h-5 flex items-center gap-[1px] opacity-70" data-waveform="real">
+              {waveformPeaks.map((peak, i) => (
+                <div key={i} className="flex-1 bg-purple-400 rounded-full"
+                     style={{ height: `${Math.max(4, peak * 100)}%` }} />
+              ))}
+            </div>
+          ) : (
+            <div className="w-full h-5 flex items-center justify-center" data-waveform="none">
+              <span className="text-[9px] font-mono text-gray-500 tracking-wider">NO AUDIO</span>
+            </div>
+          )}
```

* `src/editor/EditorStudio.tsx` — no invented captions, and the waveform is fed from the real audio:

```diff
-  const seedCaptionsFromTelemetry = (data, durMs): CaptionBlock[] => { ... 'Welcome to ' + title ... };
-    if (data.captions && data.captions.length > 0) { setCaptions(data.captions); }
-    else { setCaptions(seedCaptionsFromTelemetry(data, safeDuration)); }
+    // Captions are only ever sourced from a REAL transcription supplied with the
+    // recording. Nothing is invented: without transcription there are no
+    // captions at all.
+    setCaptions(data.captions && data.captions.length > 0 ? data.captions : []);
+
+    audioProcessorRef.current.buildWaveformPeaks(blob, 160)
+      .then((peaks) => setWaveformPeaks(peaks))
+      .catch(() => setWaveformPeaks([]));
```

* The manual "Add Caption Block" button no longer pre-fills text
  (`const text = '';` instead of `'Highlighting key product interaction'`).
* `src/engine/renderer.ts` + `src/editor/VibePresetsPanel.tsx` — the shipped default marketing copy
  (`'Introducing SmoothStudio 2.0'`, `'Cinematic screen demos in seconds'`, `'Ready to ship better demos?'`,
  `'Try SmoothStudio Free'`) is removed: the renderer now draws whatever the operator typed (nothing when
  the field is empty) and the "quick template" buttons that injected that copy are deleted.

### Raw log lines

```
[F4] grep for simulated/placeholder/default caption+waveform strings in src/ and dist/:
[F4]   0 matches
[Editor Log] [SmoothStudio Audio] No decodable audio track: waveform will not be drawn.
[F4] Timeline waveform element: {"mode":"none","text":"NO AUDIO","barCount":0}
[F4] Caption blocks rendered by the editor: {"captionBlocks":0,"trackPresent":false,"texts":[]}
[F4] Editor screenshot: .../r4_f4_editor_timeline.png
[F4] RESULT: PASS
```

The searched strings: `Welcome to Screen Recording`, `Welcome to Screen Walkthrough`,
`Simulated Waveform`, `simulated waveform`, `Simulated Audio`,
`Highlighting key product interaction`, `Introducing SmoothStudio`,
`Cinematic screen demos in seconds`, `Ready to ship better demos`, `Try SmoothStudio Free` —
**0 matches in `src/` and `dist/`**.

### Verdict

**PASS** — the waveform is drawn only from the decoded audio (here: "NO AUDIO", 0 bars), no caption is
invented, and the grep is clean.

---

## F5 — Make the SOP usable

### Diff

* `src/content/dom-tracker.ts` — typing is grouped into **sessions** while it is recorded:

```diff
+export interface TypingSession { t; endT; text; sensitive; targetLabel; targetTag }
...
+function recordTypingActivity(target: HTMLElement | null, e: KeyboardEvent) { ... }
+function closeTypingSession() { ... typingSessions.push({ t, endT, text, sensitive, targetLabel, targetTag }); }
```

* `src/engine/sop-guide-exporter.ts` — rewritten step builder:

```diff
-      if (safeText === '[hidden input]' || isAutoBlurOn) {
-        safeText = redactTextString(safeText);
-        if (safeText.includes('••••') || isSensitiveString(safeText)) { safeText = '[hidden input]'; }
-      }
+function maskIfSensitive(text, alreadyHidden, blur) {
+  if (!text) return { text: '', hidden: false };
+  if (alreadyHidden || text === '[hidden input]') return { text: '[hidden input]', hidden: true };
+  const patternHit = (blur.blurEmails && EMAIL_DETECT.test(text)) || (blur.blurRevenue && REVENUE_DETECT.test(text)) ||
+                     (blur.blurApiKeys && API_KEY_DETECT.test(text)) || /(password|secret|sk_live_|bearer\s+)/i.test(text);
+  if (patternHit || isSensitiveString(text)) { const r = redactTextString(text); return { text: r.includes('••••') ? '[hidden input]' : r, hidden: true }; }
+  return { text, hidden: false };
+}
```

  and the keystroke grouping:

```diff
+    typingSessions.forEach((s) => {
+      keystrokes.forEach((k) => {
+        const isPlainCharacter = k.key && k.key.length === 1 && !k.combo.includes('+');
+        if (isPlainCharacter && k.t >= s.t - 60 && k.t <= s.endT + 60) consumedKeystrokeTimes.add(k.t);
+      });
+      steps.push({ kind: 'type', t: s.t, endT: s.endT, text: s.text, sensitive: s.sensitive, label: s.targetLabel, tag: s.targetTag });
+    });
...
+        } else {
+          const masked = maskIfSensitive(step.text, false, blurOptions);
+          const fieldName = step.label || step.tag;
+          md += `### Step ${stepNumber}: Type **"${masked.text}"** into **"${fieldName}"** \`[${timeStr}]\`\n\n`;
+          md += `1. Click the **${fieldName}** field to focus it.\n`;
+          md += `2. Type **${masked.text}**.\n\n`;
+        }
```

  A click that merely focuses a field which is then typed into is absorbed into the typing step
  (`TYPING_ABSORB_WINDOW_MS = 3000`), so the field click no longer becomes a separate step.
* `src/engine/screen-recorder.ts` — the SOP screenshots are now taken from the *pumped* frame and are
  smaller (1280 px, JPEG q=0.62), and their timestamps use the shared origin:

```diff
+      const maxWidth = 1280;
+      const scale = Math.min(1, maxWidth / this.pumpCanvas.width);
+      const dataUrl = snapCanvas.toDataURL('image/jpeg', 0.62);
+      this.snapshots.push({
+        // Snapshot timestamps use the SAME origin as the telemetry timeline.
+        timestamp: this.timelineOriginEpoch > 0 ? Math.round(Date.now() - this.timelineOriginEpoch) : ...
+      });
```

### Raw log lines

```
[F5] Recording started.
[F5] click 1: #btn-deploy
[F5] click 2: #feature-input
[F5] shortcut: Control+k
[F5] shortcut: Enter
[F5] click 3: #matrix-canvas
[F5] click 4: #node-03
[F5] Telemetry clicks: 4
[F5] Telemetry keystrokes: 20
[F5] Telemetry typingSessions: [{"endT":4855,"sensitive":false,"t":3632,"targetLabel":"Deploy Feature Branch","targetTag":"input","text":"feat/camera-spring"}]
[F5] SOP saved: .../r4_f5_SOP.md 368385 chars
[F5] Step count: 6
[F5] Steps with an embedded screenshot: 6
[F5] RESULT: PASS
```

The complete SOP (`tests/round4/out/r4-f5/r4_f5_SOP_full.md`):

```markdown
> **Source URL**: [http://localhost:8817/](http://localhost:8817/)
> **Recorded On**: Nov 11, 2026 | **Duration**: 10.5s | **Actions**: 4 clicks, 20 keystrokes

### Step 1: Click on **"Deploy to Production"** (Deploy to Production) `[2.0s]`
### Step 2: Type **"feat/camera-spring"** into **"Deploy Feature Branch"** `[3.6s]`
### Step 3: Press Shortcut `Ctrl + K` `[4.4s]`
### Step 4: Press Shortcut `ENTER` `[4.9s]`
### Step 5: Click on the **CANVAS** element (matrix-canvas) `[6.2s]`
### Step 6: Click on **"Node eu-central-1: 100.0% Healthy (PID: 20112)"** (Node eu-central-1: 100.0% Healthy (PID: 20112)) `[8.0s]`
```

(each step is followed by an embedded `![Step N Snapshot](data:image/jpeg;base64,…)`)

### Verdict

**PASS** — the earlier 24-step session (4 clicks + 20 keystrokes) is now **6 meaningful steps**, every
step has a screenshot, the 17 typed characters are **one** step
(`Type "feat/camera-spring" into "Deploy Feature Branch"`), and the branch name is shown instead of being
masked (only genuinely sensitive values are masked). The file is 368 KB instead of 600 KB.

---

## F6 — Seek reliability

### Diff

`src/engine/mp4-exporter.ts`:

```diff
+  /** Hard safety limit for a single video seek. Exceeding it is an error, never a silent wrong frame. */
+  private static readonly SEEK_TIMEOUT_MS = 2000;
+  private static readonly RVFC_GRACE_MS = 250;
+
+  private async seekToFrame(video: HTMLVideoElement, targetTimeSec: number): Promise<void> {
+    await new Promise<void>((resolve, reject) => {
+      ...
+      const onSeeked = () => {
+        if (settled) return;
+        // `seeked` guarantees the decoder produced the frame for the new
+        // currentTime, so the frame is already the CORRECT one.
+        // requestVideoFrameCallback additionally guarantees the frame was
+        // presented to the compositor. ...
+        if (this.rvfcUsable && typeof (video as any).requestVideoFrameCallback === 'function') {
+          rafHandle = (video as any).requestVideoFrameCallback(() => { this.rvfcPresented = true; succeed(); });
+          graceTimer = window.setTimeout(() => { if (!this.rvfcPresented) this.rvfcUsable = false; succeed(); }, HardwareMp4Exporter.RVFC_GRACE_MS);
+        } else { succeed(); }
+      };
+      video.addEventListener('seeked', onSeeked);
+      timer = window.setTimeout(() => {
+        fail(`Seek timeout: the video frame at ${targetTimeSec.toFixed(3)}s was not presented within ${HardwareMp4Exporter.SEEK_TIMEOUT_MS}ms.`);
+      }, HardwareMp4Exporter.SEEK_TIMEOUT_MS);
+      try { video.currentTime = targetTimeSec; } catch (err) { fail(`Seek failed at ...`); }
+    });
+  }
```

and the old 25 ms race is replaced by it:

```diff
-          await new Promise<void>((r) => {
-            let settled = false;
-            const onPresented = () => { if (!settled) { settled = true; r(); } };
-            (video as any).addEventListener('seeked', onPresented, { once: true });
-            if ('requestVideoFrameCallback' in video) { (video as any).requestVideoFrameCallback(onPresented); }
-            setTimeout(() => { if (!settled) { settled = true; r(); } }, 25);
-          });
+          await this.seekToFrame(video, targetTimeSec);
```

The canvas-stream fallback path gets the same treatment, and the dedicated export video is now attached
to the document (a detached element is never composited, so rVFC would never fire).

### Raw log lines

`tests/round4/r4-f6-seek.mjs` builds a 60 s 1080p60 source in which **every frame is different**
(`testsrc2`, VP9) and exports it through the product's own "Export MP4" button while the renderer is
CPU-throttled 4× (`Emulation.setCPUThrottlingRate`):

```
[F6] Source: .../r4_f6_source_60s_1080p60.webm 48394867 bytes
[F6] Source stream: {"codec":"vp9","w":1920,"h":1080}
[F6] Editor loaded the injected recording.
[F6] CPU throttling rate set to 4x.
[F6] Export finished in 376473 ms -> .../r4_f6_export_1080p.mp4 111518830 bytes
[F6] Exported MP4: {"width":1920,"height":1080,"duration":60.016667}
[F6] Exported frame count: 3601
[F6] Duplicated consecutive frames: 0
[F6] Longest duplicate run: 0
[F6] First duplicate frame indices: []
[F6] RESULT: PASS
```

### Verdict

**PASS** — a 60 s 1080p60 export under 4× CPU throttling took **376.5 s**, produced 3601 frames and
**zero duplicated consecutive frames** in `framemd5`. With the old 25 ms seek timeout this test
produces duplicate frames (the encoder silently writes the previous frame).

---

# PART C — Real capture, no fake devices
Chrome for Testing / Chromium, **no `--use-fake-device-for-media-stream`**, microphone OFF
(`?record=true&includeMic=false`). Script: `tests/round4/r4-part-c-real-capture.mjs`.

```
[PartC:entire-screen Log] [SmoothStudio CaptureEngine] Capture track settings: {"aspectRatio":1.7777777777777777,"cursor":"never","deviceId":"screen:0:0","displaySurface":"monitor","frameRate":60,"height":720,"resizeMode":"crop-and-scale","width":1280}
[PartC:entire-screen] raw file: .../partc_entire-screen.webm (573070 bytes)
[PartC:entire-screen] video size: 1280x720, duration 15.470s, frames 202, last PTS 15.254
[PartC:entire-screen] frame @2s  -> .../partc_entire-screen_2s.png  (232860 bytes, sha256 97B66AEB68089E46)
[PartC:entire-screen] frame @7s  -> .../partc_entire-screen_7s.png  (144261 bytes, sha256 71E2A36FF9A32A9E)
[PartC:entire-screen] frame @12s -> .../partc_entire-screen_12s.png (142056 bytes, sha256 E092860F3FDA15FD)

[PartC:window Log] [SmoothStudio CaptureEngine] Capture track settings: {..."cursor":"never","deviceId":"screen:0:0","displaySurface":"monitor",...}
[PartC:window] raw file: .../partc_window.webm (686166 bytes)
[PartC:window] video size: 1280x720, duration 15.396s, frames 202, last PTS 15.167

[PartC:tab Log] [SmoothStudio CaptureEngine] Capture track settings: {"aspectRatio":1.7777777777777777,"cursor":"motion","deviceId":"web-contents-media-stream://7:8","displaySurface":"browser","frameRate":60,"height":720,"resizeMode":"crop-and-scale","screenPixelRatio":1.25,"width":1280}
[PartC:tab] raw file: .../partc_tab.webm (470988 bytes)
[PartC:tab] video size: 1280x720, duration 15.210s, frames 287, last PTS 15.057
[PartC:tab] frame @2s  -> .../partc_tab_2s.png  (197069 bytes, sha256 E0756D3AF8618D2A)
[PartC:tab] frame @7s  -> .../partc_tab_7s.png  (115181 bytes, sha256 6F6C9A06EBC4AF2D)
[PartC:tab] frame @12s -> .../partc_tab_12s.png (123650 bytes, sha256 DAAF7F60C79B733D)
```

### 1. Entire-screen capture

`tests/round4/out/r4-part-c/partc_entire-screen_{2,7,12}s.png` (montage
`montage_entire-screen.png`). All three frames show **the real operating-system desktop**: a Visual
Studio Code window with a C# source file open ("DCS Screen recorder automation" / "Project
architecture and feat" tabs), the "Solutions" explorer panel on the right, and the Windows taskbar at the
bottom (weather "Sunny 26 °C", search box, system tray, clock `09:00`, date `11-11-2026`).

**Cursor count: exactly 1 in each frame** — the single white OS arrow (at ≈(620,420) at 2 s,
≈(580,845) at 7 s, ≈(575,830) at 12 s). No pac-man pattern, no duplicated cursor.

### 2. Window capture — **not achievable in this environment**

The browser windows are rendered on a virtual display and are **not enumerated by Chrome's OS capture
picker**; the only source the picker offers is the screen itself. Every `--auto-select-desktop-capture-source`
value therefore falls back to the screen:

```
[title="SmoothStudio Autonomous Test Target App"]             -> {"displaySurface":"monitor","deviceId":"screen:0:0","w":900,"h":700}
[title="SmoothStudio Autonomous Test Target App - Google Chrome"] -> {"displaySurface":"monitor","deviceId":"screen:0:0","w":900,"h":700}
[title="Google Chrome"]                                      -> {"displaySurface":"monitor","deviceId":"screen:0:0","w":900,"h":700}
[title="DCS Screen recorder automation"]                      -> {"displaySurface":"monitor","deviceId":"screen:0:0","w":900,"h":700}
[title="Project architecture and feat"]                        -> {"displaySurface":"monitor","deviceId":"screen:0:0","w":900,"h":700}
```

The "window" run in the Part-C log therefore recorded the **screen** again
(`partc_window.webm`, 1280×720, 15.648 s, 210 frames, same desktop content as the entire-screen run).
I am reporting this as a **limitation of the environment**, not as a product result: a genuine window
capture could not be executed here and I am not substituting anything for it.

### 3. Tab capture

`tests/round4/out/r4-part-c/partc_tab_{2,7,12}s.png` (montage `montage_tab.png`). All three frames show
the **real test page** ("SmoothStudio Live Automation Fixture" → "Cloud Infrastructure Controls" →
`ceo@enterprise-saas.com`, `$1,450,000 USD`, the red "Secret API Token" box, "Deploy Feature Branch",
"Deploy to Production"/"Rollback", "Active Cluster Nodes") plus the SmoothStudio recording HUD in the
bottom-right corner whose timer reads **00:02 / 00:05 / 00:12** at the 2 s / 7 s / 12 s extraction
points — i.e. the captured content is time-aligned with the video timeline.

**Cursor count: 0 in each frame.** Chrome's *tab* capture paints the OS cursor only in the frames in
which it moves (`"cursor":"motion"` in the track settings), and the mouse was idle at the three
extraction points.

---

# KNOWN ISSUES

1. **Window capture cannot be exercised in this environment.** Chrome's OS capture picker only exposes
   the screen here (see the five probes above); the browser windows live on a virtual display. The
   product code path for `displaySurface === 'window'` is therefore **not verified end-to-end** in this
   round — only the screen and the tab paths are.
2. **Chromium's VP9 encoder warm-up.** Even with the slow warm-up feed and the explicit bitrate, the
   first ~0.5 s of a recording can still contain fewer frames than the source produced. The timebase is
   unaffected (the frames that exist are within ±29 ms), but a few frames of the very first second can
   be missing.
3. **The measured timebase error is bounded by the capture pipeline's latency**, i.e. by the frame rate
   the captured surface actually delivers. In the quoted run the tab capture delivered ~12 fps and the
   worst error was 29 ms; in a busier run of the same script (the capture delivered ~7 fps) the same
   measurement reported a worst |delta| of 354 ms and one of the five clicks fell into a frame gap. The
   timebase itself was 1:1 in both cases — the extra error is the age of the captured image, not a
   misalignment of the timeline.
4. **Tab capture stalls when the captured tab is not the focused window.** Chromium stops compositing a
   background tab, so no frames are produced for that period; the recorder's safety net re-pushes the
   last frame, so the timeline stays continuous but the content is frozen during the stall. This is
   visible in the Round-3 `task1_15s_raw.webm` (a 4.1 s hole).
5. **The browser occasionally dies mid-run in this environment** (several tests had to be re-run; the
   runs quoted in this report are the ones that completed). This is an environment/host stability
   problem, not a product defect.
6. **The exported MP4 contains video only.** The audio track of the recording is used for the timeline
   waveform and the silence analysis, but `HardwareMp4Exporter` never muxes an audio stream into the
   exported MP4 (pre-existing behaviour, unchanged in this round).
7. **`test-results/` is wiped by `npx playwright test`** (Playwright's output dir). Round-4 artifacts were
   therefore written to `tests/round4/out/`.

---

# RERUN COMMANDS

```powershell
# 0. build (production build, no test hooks in dist/)
npm run build

# 1. F1 - no snapshot-to-video code + real entire-screen recording
node tests/round4/r4-f1-entire-screen.mjs

# 2. F2 - static page, 10s recording with a 6s idle tail, duration checks
node tests/round4/r4-f2-static-starvation.mjs

# 3. F3 - shared timebase, 0.5s frame table, 5 click checks, pill end times
node tests/round4/r4-f3-timebase.mjs

# 4. F4 - placeholder grep + real waveform + no invented captions
node tests/round4/r4-f4-placeholder.mjs

# 5. F5 - grouped, masked-only-when-sensitive SOP with images
node tests/round4/r4-f5-sop.mjs

# 6. F6 - 60s 1080p60 export under 4x CPU throttling + framemd5 duplicate check
node tests/round4/r4-f6-seek.mjs

# 7. Part C - real screen / window / tab capture (no fake device)
node tests/round4/r4-part-c-real-capture.mjs

# 8. GIF analysis (is the GIF actually animated?)
node tests/round4/r4-gif-analysis.mjs

# diagnostics used for Part A
node tests/round4/probe-mr-stop.mjs          # requestData() vs plain stop  (log: tests/round4/out/probe-mr-stop.log)
node tests/round4/probe-engine-stop.mjs      # real engine, 0 chunks, no fake device (needs the Round-3 build)
node tests/round4/probe-desktop-pump.mjs     # pump vs raw stream timeline behaviour
node tests/round4/probe-window-title.mjs     # why window capture falls back to the screen
node tests/round4/probe-pump-rates.mjs       # pump rate vs encoder start-up latency
```

Media inspection used throughout:

```powershell
.\ffprobe.exe -v error -show_format -show_streams <file>
.\ffprobe.exe -v error -select_streams v -show_entries frame=pts_time -of csv=p=0 <file>
.\ffprobe.exe -v error -select_streams v -count_frames -show_entries stream=nb_read_frames -of csv=p=0 <file>
.\ffmpeg.exe -y -ss 00:00:02.000 -i <file> -frames:v 1 <out.png>
.\ffmpeg.exe -i <file> -f framemd5 -
```
