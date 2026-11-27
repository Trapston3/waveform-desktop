# WaveForm Desktop v1.3.5 — Performance & Bundle Baseline

Generated: 2026-11-27T21:04:21.913Z (win32 x64, Node v25.6.1)

## 1. Bundle, Font & Release Artifact Sizes

| Artifact | Size | Notes |
| :--- | ---: | :--- |
| `src/assets/fonts/sf_pro_display_*.woff2` (5 weights) | 5.71 MB | Down from 10.95 MB OTF (**-5.24 MB / -47.8%**) |
| `src/assets/fonts/` (all bundled fonts) | 5.83 MB | Full Latin + accented + symbol glyph sets preserved |
| `dist/` | 46.76 MB | Vite production web bundle |
| `dist/assets/` | 46.76 MB | JS, CSS, and WOFF2/TTF font assets |
| `dist-electron/` | 0.44 MB | Compiled main & preload scripts |
| `native/waveform-core/waveform-core.win32-x64-msvc.node` | 4.95 MB | Built from `waveform-napi` cdylib wrapping pure `waveform-core` |
| `release/WaveForm-AppPatch-1.3.5.zip` | 26.95 MB | vs v1.3.4 (28.61 MB): **-1.66 MB (-5.8%)** |
| `release/WaveForm-Setup-1.3.5.exe` | 125.26 MB | NSIS differential installer |
| `release/WaveForm-Portable-1.3.5.exe` | 114.98 MB | Standalone portable x64 build |
| `release/win-unpacked/` | 372.65 MB | Unpacked desktop runtime footprint |

## 2. Electron Runtime Footprint (Isolated Cold Boot)

| Metric | Measured Value | Notes |
| :--- | ---: | :--- |
| Executable | `release/win-unpacked/WaveForm.exe` | Spawned with clean temporary `--user-data-dir` and terminated |
| Cold Boot Process Tree Init | 5768 ms | Time until multi-process tree active (8 processes) |
| Idle Working Set (RAM) | 633.27 MB | Summed across Electron process tree (664,035,328 bytes) |
| Idle Private Bytes | 418.26 MB | Summed commit charge across tree (438,579,200 bytes) |

## 3. Native Rust `waveform-core` Microbenchmarks (Release Build)

| Operation | Timing / Throughput | Details |
| :--- | ---: | :--- |
| `autoeqInit` | 130.73 ms | Cold SQLite load + trigram index (17,703 rows, 8,850 parametric) |
| `autoeqSearch("sony whch-720n")` | 5.399 ms | 100-iter avg (7 ranked matches) |
| `autoeqFindProfile("7Hz Salnotes Zero")` | 0.317 ms | 100-iter avg including `PaP\x01` decode |
| `computeBiquadMagnitudeDb` | 0.0503 ms | 1,000-iter avg (5 biquad bands x 128 log freqs) |
| `analyzeAudioFrame` | 0.5723 ms | 500-iter avg (2048-sample FFT @ 48 kHz + BPM tracker) |

