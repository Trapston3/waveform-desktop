<div align="center">
  <img src="src/assets/icons/Logo.png" alt="WaveForm Desktop Logo" width="96" height="96" />
  <h1>WaveForm Desktop</h1>
  <p><strong>Apple Music-inspired Liquid Glass desktop music player built with Electron, React 19, Web Audio DSP, local metadata extraction, and personalized streaming.</strong></p>

  <p>
    <img src="https://img.shields.io/badge/Electron-30.5.1-47848F?logo=electron&logoColor=white" alt="Electron" />
    <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19" />
    <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white" alt="Vite 6" />
    <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  </p>
</div>

---

## Screenshots

> Drop screenshots into `docs/screenshots/` using the filenames below to populate this showcase:

| Home & Personalized Picks | Now Playing & 60fps Lyrics |
| :---: | :---: |
| ![WaveForm Home View](docs/screenshots/home.png) | ![Now Playing & Smooth Synced Lyrics](docs/screenshots/now-playing-lyrics.png) |

| Library, 3D Cover Flow & Spotify Playlists | 10-Band Equalizer & AutoEQ |
| :---: | :---: |
| ![Library & 3D Album Cover Flow](docs/screenshots/library-coverflow.png) | ![Equalizer, AutoEQ & Spatial DSP](docs/screenshots/equalizer-dsp.png) |

| Local Media Library & Embedded Metadata |
| :---: |
| ![Local Media Scanner & Metadata](docs/screenshots/local-media.png) |

---

## Features

### Dual-Deck Audio Engine & DSP (`src/audio/`)
- **CORS-Resilient Dual-Deck Playback (`AudioEngine.ts`)**: Dual deck architecture (`deckA` / `deckB`) with constant-power crossfading, `waveform-local://` HTTP Range (`206 Partial Content`) local streaming, and automatic lazy unbound `<audio>` direct fallback if an external media CDN fails CORS or `MediaElementAudioSourceNode` routing—preventing silent playback across local and web transitions.
- **Real Media Clock Accuracy (`useAudioController.ts`)**: Synchronizes playback position and paused/stalled recovery directly from the active `<audio>` element without synthetic progress fabrication.
- **10-Band Equalizer & AutoEQ (`DspChain.ts`, `AutoEqLoader.ts`)**: Live Web Audio `BiquadFilterNode` chain paired with an embedded SQLite AutoEQ headphone database (`src/assets/data/auto_eq.db`), spatial stereo width processing, ReplayGain normalization, and a lookahead peak limiter.
- **68-Bar Waveform & Live PCM Visualizer (`WaveformExtractor.ts`, `LiveVisualizer.ts`, `WaveformCanvasSeekbar.tsx`)**: Hardware-accelerated High-DPI canvas seekbar with optimistic seek latching.

### Local Media, Embedded Tags & Disk Cache (`electron/localMetadata.ts`)
- **Deep Audio Tag Extraction (`music-metadata`)**: Recursively scans `.mp3`, `.flac`, `.wav`, `.m4a`, `.aac`, `.ogg`, `.opus`, `.mp4`, and `.webm` folders to extract title, artist, album, year, bitrate, quality badge, real `durationSec`, embedded cover art (`waveform-local://art?key=...`), and embedded synced/unsynced lyrics (`USLT`, `SYLT`, `©lyr`, `LYRICS`).
- **Non-Blocking Web Enrichment & Disk Cache (`LocalMetadataEnricher.ts`, `lyricsStore.ts`)**: Falls back to iTunes Search / YouTube Music for cover art and LRCLIB / Musixmatch / InnerTube for lyrics without blocking playback, caching results to disk in Electron `userData` by normalized `artist + title + duration`.

### Personalized Streaming & Account Connections (`electron/accountAuth.ts`)
- **Authenticated YouTube Music (`SAPISIDHASH`)**: Supports persistent sign-in via Electron session cookies, injecting `Cookie`, `Authorization: SAPISIDHASH`, `X-Origin`, and `X-Goog-AuthUser: 0` on InnerTube requests and automatically refreshing personalized Home recommendations on sign-in or sign-out.
- **Spotify Library Playlists Shelf (`SpotifyPlaylistService.ts`)**: Connecting Spotify reveals a dedicated **Spotify Playlists** shelf inside **Library → Playlists**, mapping tracks into WaveForm's stream resolver for seamless playback.
- **Accurate Track Matching & Artist Detail**: Match scoring (`TrackMatcher.ts`), clickable singer/producer credits (`ArtistCredits`), and iOS-inspired `ArtistDetailView` with stylized artist signatures (`AppleArtistArtService.ts`).

### Liquid Glass Desktop UX (`src/ui/`)
- **Unified Top-Left Search (`LeftSidebar.tsx`)**: Single search bar in the top-left sidebar with autocomplete suggestions, `Ctrl+K` quick focus, and filterable results (`All`, `Songs`, `Videos`, `Albums`, `Artists`, `Playlists`).
- **Collapsible Apple Music Sidebar**: Slim icon rail (`64px`) with hover-to-expand, collapsible **Library** and **Playlists** accordions, and automatic distraction-free rail cleanup when collapsed.
- **60fps Smooth Lyrics Engine (`SyllableLyricsEngine.tsx`)**: Driven by a `requestAnimationFrame` loop interpolating directly from the active audio element's `currentTime`, scrolled with a damped harmonic spring (`SpringScroller`) and GPU-composited `transform`/`opacity` row transitions.
- **Dynamic Album-Cover Accent Color, Now Playing Fullscreen & 2026 Replay**: Extracts vibrant cover art palettes for dynamic theming, retains window controls inside `NowPlayingScreen` alongside `Escape`-dismissible fullscreen mode, and tracks Replay stats (`ReplayStoriesModal.tsx`) with full reset support.
- **Custom Windows / Electron Branding (`electron/appIcon.ts`, `scripts/generate-icon.mjs`)**: Multi-resolution `build/icon.ico` (`16`–`256px`) and `build/icon.png` wired into `BrowserWindow`, Windows AppUserModelId, and the system tray.

---

## Project Architecture

```text
waveform-desktop/
├── build/                      # Generated app branding icons (icon.ico, icon.png)
├── electron/
│   ├── main.ts                 # Electron main process, protocol handlers, window & tray, IPC
│   ├── preload.cts             # Context-isolated electronAPI bridge
│   ├── localMetadata.ts        # music-metadata scanner, art/lyrics extraction & disk cache
│   ├── accountAuth.ts          # YouTube Music SAPISIDHASH & Spotify playlist API helpers
│   └── appIcon.ts              # Cross-platform BrowserWindow & tray icon resolution
├── scripts/
│   ├── dev.mjs                 # Vite + Electron development launcher
│   ├── start.mjs               # Production launcher
│   └── generate-icon.mjs       # Multi-resolution .ico & .png generator from Logo.png
├── src/
│   ├── audio/                  # Dual-deck AudioEngine, DSP chain, AutoEQ, visualizer
│   ├── models/                 # Normalized Song, Playlist, Navigation models
│   ├── services/               # InnerTube, StreamResolver, LyricsService, AccountAuth, Spotify
│   ├── state/                  # Zustand stores (player, queue, library, lyrics, nav, settings)
│   ├── ui/
│   │   ├── common/             # LiquidGlass, ContextMenu, ArtistCredits, Settings & modals
│   │   ├── components/         # DesktopTrackTable, RightSidecar/Inspector helpers
│   │   ├── hooks/              # useAudioController, useKeyboardShortcuts, useWindowDimensions
│   │   ├── layout/             # DesktopTitleBar, LeftSidebar, MainViewport, RightSidecar, BottomPlayerBar
│   │   ├── player/             # NowPlayingScreen, SyllableLyricsEngine, WaveformCanvasSeekbar, CoverFlow
│   │   └── views/              # Home, Explore, Search, Library, LocalMedia, Artist, Release, Equalizer
│   └── utils/                  # Session persistence & utilities
└── tests/                      # 4-tier E2E runner, acceptance suite & targeted unit tests
```

---

## Getting Started

### Prerequisites
- **Node.js 20+** (tested on Node v25.6.1 / Windows x64)
- **npm**

### Install & Run in Development

```bash
npm install
npm run dev
```

### Production Build & Launch

```bash
npm run build
npm start
```

### Regenerate Branding Icons (`build/icon.ico` & `build/icon.png`)

```bash
node scripts/generate-icon.mjs
```

### Verification & Tests

```bash
# TypeScript checks (renderer, Electron main, preload)
npm run typecheck

# 4-tier test suite (311 tests)
npm test

# Targeted unit tests (audio CORS/switching, local metadata/cache, auth/Spotify, UI/lyrics, icon)
node --test tests/unit/*.test.mjs

# 109-check E2E acceptance suite
node tests/verify_acceptance_criteria_e2e.mjs
```

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Space` | Play / Pause |
| `Ctrl+K` / `Ctrl+F` | Focus top-left search input (expands sidebar if collapsed) |
| `ArrowLeft` / `ArrowRight` | Seek `-5s` / `+5s` (`Shift` for `-15s` / `+15s`) |
| `J` | Seek `-5s` |
| `ArrowUp` / `ArrowDown` | Volume `+5%` / `-5%` |
| `M` | Toggle Mute |
| `L` | Toggle Lyrics Sidecar |
| `Q` | Toggle Up Next Queue Sidecar |
| `F` | Toggle Now Playing view |
| `Esc` | Exit fullscreen / close active overlay, modal, or sidecar |
