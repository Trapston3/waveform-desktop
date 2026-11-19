# Project: WaveForm Windows Desktop — 1:1 Apple Music Frontend & Live Lyrics Parity

## Architecture & Reverse-Engineered Design Vision

WaveForm Windows Desktop is an Electron + React 19 + TypeScript + Vite audio workstation engineered as a **1:1 visual and structural copy of the Windows Apple Music client** (`C:\Program Files\WindowsApps\AppleInc.AppleMusicWin_1.1792.39942.0_x64__nzyj5cx40ttqa`):

1. **Windows Apple Music Shell & Layout (WinUI 3 Parity)**:
   - **Header Bar (48px)**: Sticky header with window controls, back/forward navigation arrows, search capsule, and `backdrop-filter: blur(24px)`.
   - **Sidebar Navigation (260px)**: Authentic WinUI 3 acrylic pane (`rgba(24, 24, 27, 0.78)` + `blur(20px)` + 1px border-r `rgba(255,255,255,0.07)`):
     - *Apple Music / Discovery*: Home ("Listen Now"), New/Explore ("Browse"), Radio ("Listen Together").
     - *Library*: Recently Added, Artists, Albums, Songs, Local Media.
     - *Playlists*: User playlists with 22x22 artwork icons, hover circular play button, and `#FA2D48` crimson active pill.
   - **Bottom Player Bar (64px)**: Docked transport bar (`rgba(28, 28, 30, 0.88)` + `blur(30px)` + 1px border-t `rgba(255,255,255,0.08)`):
     - Left: 54x54 album artwork lockup, title ticker tape, subtitle (artist/album), explicit badge, favorite star.
     - Center: Shuffle, Previous, 32px Play/Pause circular pill, Next, Repeat; bottom seekbar with WaveForm's 68-bar waveform rail.
     - Right: Volume scrubber with mute toggle, AirPlay / DSP icon (launching 10-band SVF EQ & AutoEQ), Lyrics quote-bubble toggle, Playing Next queue toggle.
   - **Combined Sticky Offset**: 112px (48px top header + 64px bottom player).

2. **1:1 Lyrics & Now Playing Parity**:
   - **GPU Fluid Mesh Canvas (`AppleMusicFluidMeshCanvas`)**: WebGL 2 (with Canvas 2D fallback) implementing Direct3D `MeshVertexShader`/`MeshPixelShader` and Cirrus OkLab fluid shader with multi-frequency sinusoidal domain warping and screen-space Interleaved Gradient Noise dithering to eliminate 8-bit banding.
   - **Full-Screen Now Playing Layout (`NowPlayingScreen`)**:
     - Dual-layer directional scrim (vignette + horizontal contrast gradient).
     - Left: Large floating album artwork lockup with interactive 3D perspective tilt (`perspective: 1200px`) and dynamic specular sheen (`useTiltTransform.ts`).
     - Right: **Borderless floating Live Lyrics** directly over the ambient animated mesh (zero card box, zero borders).
   - **Live Lyrics Engine (`SyllableLyricsEngine`)**:
     - Graduated depth-of-field blur (`filter: blur(...)`: 0px active, 1.5px ±1, 3.5px ±2, 6.0px ±3+).
     - Apple Music 3-dot pulsating countdown beat dots (`• • •`) for instrumental breaks >4.0s (`InstrumentalDotsRow.tsx`).
     - Second-order harmonic oscillator spring ODE solver for auto-scrolling with tempo-adaptive stiffness and critical damping.
     - Automatic 3.5s manual scroll detention snap-back to active line.
     - Backing vocals / parenthetical text support.
   - **Sidecar Lyrics/Queue Drawer (`RightSidecar`)**: 360px drawer with spring transition, ambient artwork tinting, and depth-of-field blur parity.

3. **Restrained, Minimal Liquid Glass**:
   - Liquid Glass optics (`.liquid-glass-capsule` / `#liquid-glass-lens`) are strictly restricted ONLY to:
     1. The **Search Bar**,
     2. The **Bottom Player Widget**, and
     3. Select floating popovers/menus (`ContextMenu`, `EqualizerModal`).
   - Content surfaces (sidebar, main canvas, album/artist headers, cards, and track tables) strictly follow the authentic Apple Music app look-as-is (clean, unwarped acrylic/dark UI).

4. **100% Feature Parity**:
   - Real audible 320kbps MP4 AAC streaming on *The Strokes - Ode to the Mets* and *Sweet Taste of India*.
   - Live debounced search & autocomplete.
   - 68-bar waveform seekbar with 250ms optimistic scrub latch.
   - 10-band SVF Equalizer + 17,703 AutoEQ headphone profiles (`auto_eq.db` via Electron IPC) + Mid/Side Spatial Audio.
   - 3D Cover Flow, 2026 Replay Stories, Listen Together PartySync, Local Media scanner, and 3-tier queue (`USER_QUEUE -> CONTEXT -> AUTOPLAY`).
   - 60fps scrolling, 0Hz playback re-render isolation, 0 TypeScript errors, clean `npm run build` and `npm test` (311+ tests).

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Authentic Sidebar Acrylic | Replace `.liquid-glass-sidebar` with WinUI 3 acrylic (`rgba(24,24,27,0.78)` + blur 20px, 260px width) | M1 | REA / Parity |
| 2 | Library Sub-Tab Segmented Controls | Replace `.liquid-glass` on library tabs & filter inputs with clean segmented controls | M1 | Parity Survey |
| 3 | Minimal Liquid Glass Enforcement | Restrict Liquid Glass strictly to Search Bar, Bottom Player Widget, and floating popovers | M1 | User Directive R3 |
| 4 | Shell Layout Geometry Alignment | 48px header, 64px player bar, 112px combined offset, 44px DataGrid track rows, 54px artwork | M1 | REA Survey |
| 5 | GPU Fluid Mesh Canvas | WebGL 2 OkLab shader with domain warping & Interleaved Gradient Noise dithering | M2 | REA / OSS Survey |
| 6 | Borderless Floating Fullscreen Lyrics | Remove boxed `.liquid-glass` card container; float lyrics directly over fluid mesh | M2 | Lyrics / OSS Survey |
| 7 | Graduated Depth-of-Field Blur | `filter: blur(...)` 0px active, 1.5px ±1, 3.5px ±2, 6.0px ±3+ based on line distance | M2 | User Directive R2 |
| 8 | Pulsating Beat Countdown Dots | 3-dot pulsating countdown (`• • •`) for instrumental breaks >4.0s | M2 | REA / Lyrics Survey |
| 9 | 3D Interactive Artwork Tilt & Sheen | `perspective: 1200px` 3D card tilt and specular sheen on full-screen artwork lockup | M2 | Lyrics Survey |
| 10 | Harmonic Oscillator Spring Scrolling | Analytical second-order spring ODE solver with tempo-adaptive stiffness and damping | M2 | OSS Survey |
| 11 | 3.5s Detention Auto-Center Snap-back | Auto-scroll resumes and smoothly snaps back to active line after 3500ms inactivity | M2 | Lyrics / OSS Survey |
| 12 | Sidecar Lyrics Drawer Parity | 360px drawer with ambient artwork tint, graduated blur, and spring slide-out | M2 | Lyrics Survey |
| 13 | Apple Music Home & Explore Views | Editorial showcase shelves, 8px card radius, hover play buttons | M3 | REA Survey |
| 14 | Album & Playlist Detail Split Headers | Large square artwork on left, metadata + crimson Play/Shuffle on right | M3 | REA Survey |
| 15 | Universal 44px Tabular Song List | 44px DataGrid rows, 32px headers, explicit badge, favorite star (#FA2D48) | M3 | REA Survey |
| 16 | Real Audible 320kbps MP4 AAC Streaming | Saavn direct streams on *The Strokes - Ode to the Mets* and *Sweet Taste of India* | M3 | Parity Survey |
| 17 | 68-Bar Waveform Seekbar | Resampled 68 bars, 250ms optimistic latch, decoupled DOM time pill | M3 | Parity Survey |
| 18 | 10-Band SVF EQ & 17,703 AutoEQ Profiles | Web Audio SVF filters, Mid/Side Spatial Audio, `auto_eq.db` via Electron IPC | M3 | Parity Survey |
| 19 | 3D Cover Flow & Replay Stories | Interactive 3D cover flow view and 2026 vertical story presentation | M3 | Parity Survey |
| 20 | PartySync, Local Media & 3-Tier Queue | Listen Together client, local directory scanner, strict 3-tier queue | M3 | Parity Survey |
| 21 | 60fps Zero-Jank & 0Hz Playback Re-render | Virtualized rows, CSS containment, zero parent re-renders during audio playback | M3 | Parity Survey |
| 22 | Multi-Tier E2E Test Suite Pass | 311 / 311 tests pass with 100% pass rate across Tiers 1-4 | M4 | Test Infra |
| 23 | Adversarial Coverage Hardening | White-box stress tests on shader, spring physics, and contrast | M4 | Test Infra |
| 24 | Strictly Sequential Dual Verification Pass | Pass 1: Claude Sonnet 5.5 Low; Pass 2: 4 Hydrogen Medium (strictly sequential) | M4 | User Directive |
| 25 | Forensic Integrity Audit Gate | Forensic integrity auditor verification with clean report | M4 | Project Standard |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Shell Geometry, Acrylic Sidebar & Restrained Liquid Glass | Refactor LeftSidebar and LibraryScreen to authentic WinUI acrylic; enforce minimal Liquid Glass | none | DONE |
| M2 | 1:1 Live Lyrics Engine & Full-Screen Now Playing Parity | WebGL fluid mesh, borderless lyrics, graduated blur, beat dots, 3D tilt, spring ODE | M1 | IN_PROGRESS |
| M3 | Windows Content Views, Tracklist & 100% Feature Parity | 44px song table, split headers, 320kbps streaming, 68-bar seekbar, 10-band EQ, AutoEQ | M2 | PLANNED |
| M4 | 4-Tier E2E Pass, Sequential Verification & Forensic Gate | 311+ E2E tests, Sonnet 5.5 Low + 4 Hydrogen Medium sequential verification, CLEAN audit | M3 | PLANNED |

---

## Interface Contracts

### M1 ↔ M2: Shell Layout & Ambient Theme Contract
- LeftSidebar width: 260px (`w-[260px]`), Top Header height: 48px (`h-12`), Bottom Player height: 64px (`h-16`).
- CSS Tokens: `--am-acrylic-sidebar: rgba(24, 24, 27, 0.78)`, `--am-text-primary: #D8FFFFFF`, `--am-text-secondary: #83FFFFFF`, `--am-text-tertiary: #3FFFFFFF`, `--am-brand-pink: #FA2D48`.
- Liquid Glass restricted exclusively to `.liquid-glass-capsule` on Search Bar, Bottom Player Widget, and Context Menu / Equalizer dialog.
- Theme Store extracts 5 palette colors (`vibrant`, `edgeWash`, `ambientBackground`, `playerTint`, `accent`) consumed by WebGL fluid mesh and Sidecar drawer.

### M2 ↔ M3: Lyrics & Player Store Contract
- `AppleMusicFluidMeshCanvas`: Accepts `colors: string[]`, `isPlaying: boolean`, `speed: number`. Rendered in `NowPlayingScreen` and `RightSidecar`.
- `SyllableLyricsEngine`: Consumes `currentTrackId`, `currentTimeMs`, `syncedLyrics`. Emits `seekTo(ms)`.
- Full-screen Now Playing mode toggled via `usePlayerStore.getState().toggleFullscreen()`.

### M3 ↔ M4: Verification & Test Suite Contract
- `npm test` runs 311+ E2E tests across Tiers 1-4.
- `npm run typecheck` passes with code 0.
- `npm run build` compiles clean production bundle.

---

## Code Layout
- `src/ui/layout/`: Shell layout (`DesktopTitleBar.tsx`, `LeftSidebar.tsx`, `MainViewport.tsx`, `BottomPlayerBar.tsx`, `RightSidecar.tsx`).
- `src/ui/player/`: Player components (`NowPlayingScreen.tsx`, `AppleMusicFluidMeshCanvas.tsx`, `SyllableLyricsEngine.tsx`, `InstrumentalDotsRow.tsx`, `WaveformCanvasSeekbar.tsx`, `useTiltTransform.ts`, `EqualizerModal.tsx`).
- `src/ui/views/`: Content views (`HomeScreen.tsx`, `ExploreScreen.tsx`, `LibraryScreen.tsx`, `ReleaseDetailView.tsx`, `ArtistDetailView.tsx`, `SearchScreen.tsx`, `CoverFlowView.tsx`).
- `src/ui/components/`: Universal components (`DesktopTrackTable.tsx`, `ContextMenu.tsx`).
- `src/services/`: Services (`StreamResolver.ts`, `LyricsService.ts`, `MusicService.ts`, `PartySyncClient.ts`, `LocalMediaScanner.ts`).
- `tests/`: 4-Tier test suite (`runner.mjs`, `tier1_features/`, `tier2_boundaries/`, `tier3_combinations/`, `tier4_scenarios/`).
