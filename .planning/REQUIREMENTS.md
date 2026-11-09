# Requirements Specification

## 1. Core Features (v1 - Must Have)

### 1.1 Capture & Telemetry
- [x] Manifest V3 extension configuration with required permissions: `tabCapture`, `offscreen`, `storage`, `scripting`, `activeTab`.
- [x] High-frequency mouse tracking (up to 120Hz) capturing coordinates, computed CSS cursor style (`default`, `pointer`, `text`, `grab`).
- [x] Smart DOM bounding-box detection: on click, capture target element and climb DOM tree for parent container (`dialog`, `form`, `.card`, `section`).
- [x] Typing tracker: detect input/textarea interactions and focus zones for auto-framing text entry.
- [x] Keystroke HUD recorder: detect hotkeys and keyboard shortcuts (`Cmd/Ctrl+K`, `Enter`, modifiers) with timestamps.
- [x] Pre-recording privacy redactor: selective element click-to-blur and regex patterns for emails, revenue/currency, and API keys (`filter: blur(8px)`).
- [x] Video capture via `getDisplayMedia` with `cursor: "never"` and 60fps frame rate setting, saving chunks to OPFS (with fallback to IndexedDB/memory blob).

### 1.2 Spring Physics Camera & Rendering Engine
- [x] Critically damped spring simulation for camera transitions: smooth `x`, `y`, `scale` (1.0x to 2.8x), and 2.5D/3D perspective tilt (`rotateX`, `rotateY`).
- [x] Smart click clustering: groups multiple clicks in proximity to avoid erratic back-and-forth camera motions.
- [x] Catmull-Rom spline cursor interpolator with velocity-based motion trail and customizable animated click ripple rings.
- [x] Vector SVG cursor morphing between Pointer, Hand, and Text I-Beam based on telemetry.
- [x] Dynamic Spotlight Dimming mode: smooth 45% darkening of unselected areas with a soft feathered mask around the active focal container/cursor.
- [x] Animated background canvas: dynamic mesh gradients, dark mode studio presets, rounded corners with diffused drop-shadow.
- [x] 3D Glassmorphic Keystroke HUD badge rendering on canvas.

### 1.3 Audio Processing & Procedural Sound Design
- [x] Audio analysis via Web Audio API (`OfflineAudioContext` / `AudioContext`): RMS decibel level computation.
- [x] Awkward silence detection: identify pauses > 1.2s where no user interaction occurred.
- [x] 1-Click "Remove Silences" timeline auto-tightener.
- [x] Procedural Web Audio SFX generator: synthesizes realistic mechanical keyboard clicks/thocks, soft mouse click pops, and cinematic zoom whooshes ($0 external file dependencies).

### 1.4 WebCodecs Fast Hardware Exporter
- [x] Offline export loop using `VideoEncoder` + `mp4-muxer` to export high-speed MP4s directly on the user's GPU.
- [x] Video & audio multiplexing (mic audio + procedural sound effects).
- [x] Multi-format aspect ratio selection: 16:9 (YouTube/X), 9:16 (Shorts/TikTok), 1:1 (LinkedIn), 4:3 (Classic).

### 1.5 Linear-Style Dark Workspace & Multi-Format Outputs
- [x] Dark-theme editor UI (`#0B0C10`, `#14161D` cards, crisp 1px borders, Linear aesthetic).
- [x] Interactive Magnetic Pill Timeline: Video/Audio waveform track with red silence markers and purple zoom pills (draggable timing, customizable zoom factor, tilt, spotlight).
- [x] Vibe Presets Sidebar: Linear Dark, Apple Keynote, Stripe Mesh, Indie Pop, Minimal Clean + Auto-Brand color extractor.
- [x] Multi-Asset Outputs:
  - Hardware MP4 video download.
  - Step-by-step Markdown/Notion SOP guide with timestamped event summaries and screenshot previews.
  - Interactive HTML Click-Through Widget: single-file bundle with interactive pulsing hotspots.

## 2. Non-Functional Requirements
- **Performance**: 60fps real-time preview, hardware-accelerated WebCodecs export.
- **Cost**: $0 server cost, $0 API cost, completely local.
- **Privacy**: No telemetry, audio, or video leaves the user's browser.
- **Portability**: Chrome, Edge, Brave, and Chromium-based browsers.
