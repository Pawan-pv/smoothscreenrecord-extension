# SmoothStudio Roadmap

## Phase 1: Extension Architecture, Capture Pipeline & DOM Telemetry
- [x] Task 1.1: Project scaffolding (Vite, TypeScript, React 19, Tailwind CSS, extension configuration, build script).
- [x] Task 1.2: DOM Tracker content script (120Hz mouse sampling, cursor styles, smart bounding box climbing, typing tracker, keystroke HUD capture).
- [x] Task 1.3: Pre-recording privacy redactor (automated regex redacting for emails/financials/tokens + interactive click-to-blur picker).
- [x] Task 1.4: Screen capture worker & OPFS streaming engine (`getDisplayMedia` with `cursor: "never"`, chunk streamer, telemetry storage, fallback handling).
- [x] Task 1.5: Extension Popup UI (recording controls, screen selector, privacy presets, direct editor launch).

## Phase 2: Spring-Physics Camera & 2.5D/3D Rendering Engine
- [x] Task 2.1: Spring physics solver (critically damped second-order dynamics for position, scale, and isometric rotation).
- [x] Task 2.2: Vector cursor engine & Catmull-Rom spline smoother with velocity-based motion trail & ripple clicks.
- [x] Task 2.3: 2.5D/3D Canvas Rendering Engine (isometric tilt transform, drop shadow, rounded window framing, dynamic spotlight feathered mask).
- [x] Task 2.4: Animated background mesh gradient shaders & preset vibe themes.
- [x] Task 2.5: Glassmorphic 3D keystroke HUD renderer.

## Phase 3: Web Audio Silence Trimmer, Procedural SFX & WebCodecs Hardware MP4 Exporter
- [x] Task 3.1: Web Audio API RMS silence detector & automatic silence stripping calculator.
- [x] Task 3.2: Procedural sound synthesis engine (mouse click pop, keyboard thock, zoom whoosh).
- [x] Task 3.3: Hardware WebCodecs `VideoEncoder` + `mp4-muxer` offline export pipeline with audio track mixing.

## Phase 4: Linear-Style Editor Studio & Multi-Asset SOP Exporter
- [x] Task 4.1: Linear-style studio UI (dark theme `#0B0C10`, canvas viewport with aspect ratio controls: 16:9, 9:16, 1:1, 4:3).
- [x] Task 4.2: Magnetic Pill Timeline (interactive scrub head, audio waveform with silence segments, zoom pills with drag handles and inspector controls).
- [x] Task 4.3: Vibe Presets panel & Website Brand Palette extractor.
- [x] Task 4.4: Step-by-Step Markdown/Notion SOP Guide generator.
- [x] Task 4.5: Standalone Interactive HTML Click-Through Widget exporter.
- [x] Task 4.6: End-to-end integration, browser testing, production build verification, and user distribution package.
