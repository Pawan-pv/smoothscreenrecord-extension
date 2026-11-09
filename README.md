# 🎬 SmoothStudio

> **The Category-Defining, 100% Client-Side Screen Recorder & SOP Studio ($0 Server & AI Cost)**
> Built to beat ScreenSmooth by replacing slow single-threaded `FFmpeg.wasm` with native **WebCodecs hardware GPU encoding**, adding **DOM-aware smart framing**, **Apple Keynote 3D isometric perspective tilts**, and **one-click multi-format outputs**.

---

## ⚡ Why SmoothStudio Beats ScreenSmooth

| Feature | ScreenSmooth | SmoothStudio |
| :--- | :--- | :--- |
| **MP4 Export Engine** | Single-threaded `FFmpeg.wasm` (hangs, leaks RAM) | **Native WebCodecs (`VideoEncoder`) + `mp4-muxer`** (15x faster hardware GPU encoding) |
| **Camera Zooming** | Dumb (X, Y) coordinate zooms | **DOM-Aware Bounding Box Locking** (`element.closest(...)`) to frame whole modals and cards |
| **Cursor Recording** | Baked-in OS cursor | **Vector 4K Cursor in Post** with Catmull-Rom spline smoothing & directional motion blur |
| **Perspective & Camera** | Flat 2D zoom only | **Apple Keynote 3D Isometric Perspective Matrix** (`rotateY`/`rotateX`) |
| **Focal Highlighting** | None | **Dynamic Spotlight Dimming** (45% feathered radial mask around active focal zone) |
| **Audio Intelligence** | Raw mic audio with silences | **Web Audio API RMS Silence Detector** (1-click remove dead air > 1.2s) |
| **Sound Design** | None | **Procedural Web Audio SFX**: Mechanical keyboard thocks, click pops, zoom whooshes |
| **Output Formats** | MP4 only | **3-in-1**: Hardware 60fps MP4, Markdown SOP Guide, and Interactive HTML Walkthrough Widget |
| **Hosting & API Cost** | Subscription / Server cost | **$0.00 Forever**: Runs 100% client-side in the user's browser |

---

## 🚀 Quick Start (Powered by Bun)

This project is configured with **Bun** for ultra-fast installs and compilation.

### Prerequisites
- [Bun](https://bun.sh/) (v1.1+ recommended)

### 1. Install Dependencies
```bash
bun install
```

### 2. Start Studio Workspace (Dev Mode)
```bash
bun run dev
```
Open [http://localhost:5173/](http://localhost:5173/) to explore the Studio Editor with interactive demo telemetry, 3D tilts, spotlight dimming, and export features.

### 3. Build Extension for Chrome
```bash
bun run build
```
The compiled, production-ready extension is emitted to the [`dist/`](dist/) folder in ~2 seconds.

---

## 🧩 Loading into Chrome, Brave, or Edge

1. Open your browser and navigate to `chrome://extensions/`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked** (top-left).
4. Select the [`dist`](dist/) folder in this repository.
5. The **SmoothStudio** extension icon will now appear in your browser toolbar!

---

## 🛠️ Architecture & Pillars

- **Pillar 1: DOM-Aware "Smart Camera" Engine** ([`src/content/dom-tracker.ts`](src/content/dom-tracker.ts))
  - Samples mouse at 120Hz, tracks cursor styles (`pointer`, `text`, `grab`), and climbs DOM trees on clicks to capture element bounding rectangles.
  - Automatic typing tracker that focuses on `<input>` and `<textarea>` elements with automatic zoom recovery.
  - Injects a floating in-page recording HUD (`🔴 Rec 00:05 | Stop & Edit`).

- **Pillar 2: Apple Keynote 3D Visuals & Shaders** ([`src/engine/renderer.ts`](src/engine/renderer.ts), [`src/engine/spring-physics.ts`](src/engine/spring-physics.ts))
  - Critically damped spring simulation for position, scale, and isometric rotation.
  - Procedural animated mesh gradient backgrounds + 5 curated Vibe Presets (*Linear Dark*, *Apple Keynote*, *Stripe Mesh*, *Indie Pop*, *Minimal Clean*).
  - 1-click **"Match Website Brand Colors"** extracting dominant CSS colors.

- **Pillar 3: Zero-Cost Audio & Privacy Superpowers** ([`src/engine/audio-processor.ts`](src/engine/audio-processor.ts), [`src/content/privacy-redactor.ts`](src/content/privacy-redactor.ts))
  - Pre-recording automated regex blurring for emails, revenue/currency, and API tokens.
  - Interactive click-to-blur picker.
  - Procedural Web Audio sound effects synthesizer.

- **Pillar 4: Linear-Style Magnetic Studio** ([`src/editor/EditorStudio.tsx`](src/editor/EditorStudio.tsx), [`src/editor/MagneticTimeline.tsx`](src/editor/MagneticTimeline.tsx))
  - Dual-track magnetic timeline with waveform, silence markers, and draggable zoom pills.
  - Drag pill edges directly on the timeline to customize zoom duration.
  - Full keyboard shortcuts (`Space` to play/pause, `←`/`→` to jump 1s, `Z` to add zoom pill).

- **Pillar 5: Multi-Format Asset Exports**
  - **Hardware 60fps MP4**: Hardware GPU encoded with `VideoEncoder` + `mp4-muxer`.
  - **SOP Guide**: Comprehensive Markdown/Notion formatted guide with timestamps and snapshots.
  - **Interactive HTML Widget**: Single-file bundle with pulsing clickable hotspots for product demos.

---

## 📄 License
MIT — Built with ⚡ Bun, Vite, React 19, TypeScript, Tailwind CSS, and WebCodecs.
