# WaveForm Desktop — Architectural Decisions (`DECISIONS.md`)

## 1. LyricVisualizer Rendering Stack: Electron-Native Canvas2D + WebGL2 + Multi-Window `BrowserWindow`s vs. .NET 10 / WinUI 3
- **Decision**: Build the LyricVisualizer engine in TypeScript using **HTML5 Canvas2D + WebGL2** inside Electron's Chromium renderer, with dedicated transparent/frameless (`#/overlay`) and fullscreen (`#/ambient`) `BrowserWindow` viewports rather than a separate .NET 10 / WinUI 3 native host.
- **Rationale**:
  - WaveForm Desktop is already an Electron + React + Vite + Zustand application; keeping the visualizer in the same renderer runtime allows direct zero-serialization access to `AudioEngine`'s Web Audio `AnalyserNode` (via `sampleAudioMetrics`), Zustand stores, and React UI controls.
  - WebGL2 + Canvas2D provides hardware-accelerated 60fps rendering for all 13 visual styles (`AppleMusicFlow` through `StarfieldShip3D`) with automatic Canvas2D fallback when WebGL2 is unavailable (e.g., headless tests or constrained GPUs).
  - Transparent click-through desktop overlays (`setIgnoreMouseEvents(true, { forward: true })`) and multi-monitor fullscreen ambient windows are natively supported by Electron's `BrowserWindow` APIs without inter-process COM/NamedPipe marshaling.

## 2. Typography & Iconography: Bundled OFL Fonts (`@fontsource/*`) + `lucide-react`, Zero Apple Assets
- **Decision**: Bundle 7 SIL Open Font License (OFL-1.1) font families locally via `@fontsource/*` (`Inter`, `Plus Jakarta Sans`, `Instrument Serif`, `Fraunces`, `Space Grotesk`, `JetBrains Mono`, `Outfit`) and use `lucide-react` / Segoe UI icons exclusively.
- **Rationale**:
  - Guarantees identical offline typography on Windows without requiring system font installs or external CDN fetches.
  - Strictly avoids Apple SF Symbols, `-apple-system`, `SF Pro`, or any proprietary Apple font/icon assets.

## 3. Crash-Safe Persistence: Atomic JSON Cache Store vs. Native SQLite Bindings
- **Decision**: Persist lyrics cache and per-song timing offsets (`-2000..+2000 ms`) using an **atomic write-temp-and-rename JSON store** in Electron's `userData` directory rather than native SQLite (`better-sqlite3` / `sqlite3`) bindings.
- **Rationale**:
  - Native Node addons (`better-sqlite3`) introduce Electron ABI rebuild friction across Windows x64/arm64 targets and Electron version upgrades.
  - Writing to a `.tmp` file and atomically renaming (`fs.rename`) prevents cache corruption on sudden power loss or process termination, while keeping zero native build dependencies.

## 4. Windows Fullscreen Game Guard: `SHQueryUserNotificationState`
- **Decision**: Guard idle-triggered Ambient Mode and intrusive overlay activations on Windows using Win32 `SHQueryUserNotificationState` (via native/PowerShell or Electron display/notification state checks) when `gameGuardEnabled` is true.
- **Rationale**:
  - Prevents WaveForm's fullscreen Ambient Mode from stealing focus or interrupting exclusive fullscreen games (`QUNS_BUSY`, `QUNS_RUNNING_D3D_FULL_SCREEN`, `QUNS_PRESENTATION_MODE`).

## 5. Lock-Screen Power & GPU Discipline: 0% GPU Suspend
- **Decision**: Subscribe to Electron `powerMonitor` `lock-screen` / `unlock-screen` events and immediately halt `requestAnimationFrame` + skip WebGL2/Canvas2D draw calls (`setLocked(true)`) while the Windows session is locked.
- **Rationale**:
  - Eliminates wasted GPU/CPU cycles and battery drain when the user's screen is locked, resuming seamlessly on `unlock-screen`.

## 6. YouTube SABR Streaming Integration (`googlevideo`)
- **Decision**: Integrate `googlevideo` SABR streaming with `electron/main.ts` session header/CORS normalization (stripping conflicting `Access-Control-Allow-Credentials` when `Access-Control-Allow-Origin: *` is applied) and `AudioEngine`'s direct-element fallback when CORS prevents Web Audio `MediaElementAudioSourceNode` routing.
- **Rationale**:
  - Ensures reliable playback across YouTube Music / SABR streams without silent audio failures, while `sampleAudioMetrics` gracefully returns zeroed metrics if the direct fallback element is active.
