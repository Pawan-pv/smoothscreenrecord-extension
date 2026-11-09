# Project: SmoothStudio (ScreenSmooth Challenger)

## Overview
SmoothStudio is a high-performance, 100% client-side Chrome Extension that turns mundane screen captures into cinematic, Apple Keynote-style product demo videos and SOP guides with $0 server and API costs.

## Core Value Proposition
- **15x Faster Hardware Exports**: Uses the modern browser `WebCodecs` (`VideoEncoder`) and `mp4-muxer` instead of single-threaded, memory-leaking `FFmpeg.wasm`.
- **DOM-Aware Smart Camera**: Captures DOM bounding boxes (`getBoundingClientRect`), typing carets, and click clusters to frame elements smartly rather than dumb coordinate zooming.
- **Apple Keynote Aesthetics**: 3D isometric perspective tilts, dynamic spotlight dimming, vector cursor morphing (pointer, text, hand) with motion blur, and a 3D glassmorphic keystroke HUD.
- **Zero-Cost Audio Intelligence**: Web Audio API RMS dead-air detection to cut awkward silences with one click, plus built-in procedural sound effects (click pops, mechanical typing thocks, camera zoom whooshes).
- **OPFS High-Resolution Streaming**: Streams 60fps video directly to disk (Origin Private File System), allowing hour-long 4K captures without tab memory crashes.
- **Multi-Format 3-in-1 Exports**: High-speed MP4/GIF video, Step-by-Step Markdown/Notion SOP guide with captured snapshots, and interactive HTML click-through widgets.

## Target Audience
- Indie hackers, SaaS founders, product marketers, developer advocates, technical writers, customer success teams.
