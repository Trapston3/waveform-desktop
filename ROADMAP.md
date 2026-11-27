# WaveForm Desktop Architecture & Release Roadmap

## v1.3.x — Completed Foundation & Pre-Rust Bridge
- **Dual-Deck Audio & Live DSP:** Sample-accurate gapless dual-deck engine, 10-band RBJ/SVF AutoEQ (17,703 profiles, 8,850 parametric), Mid/Side karaoke processor, Bar-snapped A–B looping, and ONNX beat/downbeat + vocal stem separation.
- **12 Hardware-Accelerated Lyric Visualizers:** Full-bleed WebGL2/Three.js + Canvas2D stages including `IosTextingMotion` (Messages, Liquid Glass, Group Chat, 2.5D CarPlay Maps) and `StarfieldShip3D` (`Vaporwave`, `Deep Space`, `Nebula Run`, `Retro Wireframe`).
- **Pre-Rust Bridge (`v1.3.5`):**
  - Typed `PlatformBridge` boundary (`src/platform/`) isolating all renderer IPC from Electron internals.
  - Pure-Rust `waveform-core` crate (`rlib`, zero N-API dependencies) separated from thin `waveform-napi` bindings inside `native/` Cargo workspace.
  - Lossless `.woff2` font compression for `SF Pro Display` (`~5.5 MB` patch reduction) and repeatable baseline telemetry (`docs/PERF_BASELINE.md`).

## v1.4.0 — Pure-Rust Audio Pipeline & Native SABR Transport
- Move YouTube SABR stream resolution, HTTP `206` range buffering, and Gapless Audio Decode/Resample directly into `waveform-core` (`rodio`/`symphonia` or WASAPI shared/exclusive output).
- Expose typed async command/telemetry channels over `PlatformBridge` while preserving Web Audio fallback for browser/test environments.

## v1.4.5 — Backend Parity, Lyrics Alignment & Cache Engine
- Consolidate SQLite library indexing, offline LRU cache eviction, Last.fm/ListenBrainz scrobbling queue, and forced-alignment lyric timing inside pure-Rust core services.
- Expand automated frame-pacing and memory-footprint regression gates against `docs/PERF_BASELINE.md`.

## v1.5.0 — Tauri 2 Native Shell
- Implement a Tauri 2 `PlatformBridge` backend binding directly to `waveform-core` without Electron/Chromium process overhead.
- Cut cold-boot latency, idle RAM footprint, and delta installer sizes by replacing Electron IPC/N-API glue with direct native commands.
