# WaveForm Test Infrastructure Specification (TEST_INFRA)

## 1. Test Philosophy & Architecture

WaveForm Windows Desktop Client employs an **opaque-box, requirement-driven, 4-tier testing methodology**. This architecture verifies the application strictly against documented interface contracts, reverse-engineered mathematical DSP models, data schemas, and user workflows—independent of transient implementation details.

### Core Principles
1. **Opaque-Box Verification**: Tests validate observable public contracts, state transitions, audio DSP mathematics, and protocol boundaries without coupling to internal private methods.
2. **Determinism & Zero-Flakiness**: Tests are isolated, side-effect free, and deterministic. Audio simulations use synthetic PCM buffers and algorithmic formulas (constant-power trigonometric crossfades, SVF trapezoidal integration, Lookahead limiting).
3. **Progressive Testability**: Each milestone and feature can be tested in isolation, while higher tiers validate pairwise interactions and end-to-end user workflows.
4. **Standard Execution & Zero Friction**: Powered natively by Node.js 25 test runner (`node:test`, `node:assert/strict`) with ES module support, executing cross-platform without external package manager dependencies or native compilation overhead.

---

## 2. 4-Tier Test Methodology

| Tier | Name | Target Coverage | Scope & Verification Objectives |
|---|---|---|---|
| **Tier 1** | **Feature Coverage** | $\ge 5$ tests $\times$ 27 features ($\ge 135$ tests) | Isolated happy-path verification of each feature in `PROJECT.md` (data contracts, state transitions, DSP math, UI models). |
| **Tier 2** | **Boundary & Corner Cases** | $\ge 5$ tests $\times$ 27 features ($\ge 135$ tests) | Adversarial boundaries, null/undefined inputs, empty queues, volume clipping ($>1.0, <0.0$), corrupted audio headers, zero-length playlists, rapid seeking. |
| **Tier 3** | **Cross-Feature Combinations** | $\ge 27$ pairwise tests | State sharing and control-flow coupling (e.g., dual-deck crossfade during 10-band EQ glide; AutoEQ reload during spatial audio widening; search filter changes during offline playback). |
| **Tier 4** | **Real-World Application Scenarios** | $\ge 14$ end-to-end workflows | Multi-step user workflows (e.g., Cold start $\rightarrow$ Browse home shelves $\rightarrow$ Play track $\rightarrow$ 68-bar seek $\rightarrow$ Synced lyrics $\rightarrow$ Save to playlist $\rightarrow$ Verify listening history). |
| **Total** | **Combined Test Suite** | **$\ge 311$ Executable Tests** | **100% Feature, Boundary, Interaction & Workflow Coverage** |

---

## 3. Feature Inventory & Mapping (All 27 Features)

| Feature # | Feature Name | Tier 1 Tests | Tier 2 Tests | Tier 3 Pairwise Combinations | Tier 4 User Scenarios |
|---|---|---|---|---|---|
| 1 | Asset Extraction & Organization | 5 | 5 | Paired with F3, F7 | Scenario 1, Scenario 14 |
| 2 | Desktop Scaffolding & Window Chrome | 5 | 5 | Paired with F4, F24 | Scenario 1, Scenario 13 |
| 3 | Visual Design Tokens & Typography | 5 | 5 | Paired with F1, F21 | Scenario 1, Scenario 10 |
| 4 | Responsive 3-Column Desktop Shell | 5 | 5 | Paired with F2, F24 | Scenario 2, Scenario 12 |
| 5 | Dual-Deck Audio Engine | 5 | 5 | Paired with F6, F9, F11 | Scenario 2, Scenario 3, Scenario 6 |
| 6 | 10-Band Parametric/Graphic Equalizer | 5 | 5 | Paired with F5, F7, F8 | Scenario 4, Scenario 5 |
| 7 | AutoEQ Headphone Calibration | 5 | 5 | Paired with F6, F13 | Scenario 4, Scenario 14 |
| 8 | Spatial Audio & Stereo Width | 5 | 5 | Paired with F6, F11 | Scenario 5, Scenario 6 |
| 9 | Automix & Transition Effects | 5 | 5 | Paired with F5, F10 | Scenario 6, Scenario 8 |
| 10 | Waveform Amplitude & Live Visualizer | 5 | 5 | Paired with F5, F21 | Scenario 2, Scenario 7 |
| 11 | Lookahead Peak Limiter & Normalization | 5 | 5 | Paired with F5, F8 | Scenario 3, Scenario 5 |
| 12 | Domain Data Models & Entities | 5 | 5 | Paired with F13, F14 | Scenario 2, Scenario 8 |
| 13 | Local Persistence & State Storage | 5 | 5 | Paired with F7, F12, F18 | Scenario 9, Scenario 11 |
| 14 | InnerTube Music Service & Search | 5 | 5 | Paired with F12, F19 | Scenario 2, Scenario 8 |
| 15 | Local Audio File & Offline Playback | 5 | 5 | Paired with F5, F18 | Scenario 10, Scenario 12 |
| 16 | External Services & Fallback Mocking | 5 | 5 | Paired with F14, F22 | Scenario 7, Scenario 14 |
| 17 | Home & Explore Navigation Views | 5 | 5 | Paired with F14, F18 | Scenario 1, Scenario 2 |
| 18 | Library & Playlist Management | 5 | 5 | Paired with F13, F15 | Scenario 8, Scenario 9 |
| 19 | Search Screen & Filter Chips | 5 | 5 | Paired with F14, F17 | Scenario 8, Scenario 10 |
| 20 | Release & Artist Detail Pages | 5 | 5 | Paired with F14, F18 | Scenario 2, Scenario 8 |
| 21 | Now Playing Screen & 68-Bar Waveform | 5 | 5 | Paired with F10, F22 | Scenario 2, Scenario 7 |
| 22 | Syllable-Synced Lyrics Engine | 5 | 5 | Paired with F16, F21 | Scenario 7, Scenario 14 |
| 23 | 3D Album Cover Flow & Visualizers | 5 | 5 | Paired with F18, F20 | Scenario 11, Scenario 12 |
| 24 | Desktop Interaction & Shortcuts Matrix | 5 | 5 | Paired with F2, F4, F5 | Scenario 3, Scenario 13 |
| 25 | E2E Test Suite Pass (Tiers 1-4) | 5 | 5 | Self-validating Harness | Scenario 14 |
| 26 | Adversarial Coverage Hardening | 5 | 5 | Robustness & Fuzzing | Scenario 14 |
| 27 | Production Windows Packaging | 5 | 5 | Package & Launch | Scenario 13, Scenario 14 |

---

## 4. Directory Structure & Layout

```
waveform-desktop/
├── TEST_INFRA.md                  # Test architecture, feature mapping & commands
├── TEST_READY.md                  # Test delivery summary, coverage matrix & verification results
└── tests/
    ├── fixtures/                  # Reusable mock datasets & synthetic audio generators
    │   ├── mockAudio.mjs          # Synthetic Float32 PCM tones, impulse, sine wave sweeps
    │   ├── mockAutoEq.mjs         # Headphone models, biquad filter coeffs, AutoEQ profiles
    │   ├── mockInnerTube.mjs      # Home feed, search results, artist & album browse items
    │   ├── mockLyrics.mjs         # TTML word-synced & LRC line-synced lyrics payloads
    │   ├── mockPlaylists.mjs      # Playlist models, queue tiers, and browse categories
    │   ├── mockSettings.mjs       # Comprehensive >70 desktop preferences schema
    │   └── mockSongs.mjs          # Standard, local, high-res, explicit, and edge-case Song entities
    ├── helpers/
    │   └── testEngine.mjs         # DSP simulator, AudioEngine, StorageService, MusicService mocks
    ├── tier1_features/            # Tier 1: 27 feature test suites (>=135 tests)
    │   ├── feature01_assets.test.mjs
    │   ├── feature02_scaffolding.test.mjs
    │   ├── feature03_design_tokens.test.mjs
    │   ├── feature04_layout_shell.test.mjs
    │   ├── feature05_dual_deck.test.mjs
    │   ├── feature06_equalizer.test.mjs
    │   ├── feature07_autoeq.test.mjs
    │   ├── feature08_spatial_audio.test.mjs
    │   ├── feature09_automix.test.mjs
    │   ├── feature10_waveform_visualizer.test.mjs
    │   ├── feature11_peak_limiter.test.mjs
    │   ├── feature12_domain_models.test.mjs
    │   ├── feature13_local_persistence.test.mjs
    │   ├── feature14_innertube_service.test.mjs
    │   ├── feature15_local_media.test.mjs
    │   ├── feature16_external_services.test.mjs
    │   ├── feature17_home_explore.test.mjs
    │   ├── feature18_library_playlists.test.mjs
    │   ├── feature19_search_filters.test.mjs
    │   ├── feature20_release_artist_detail.test.mjs
    │   ├── feature21_now_playing_waveform.test.mjs
    │   ├── feature22_synced_lyrics.test.mjs
    │   ├── feature23_cover_flow.test.mjs
    │   ├── feature24_desktop_shortcuts.test.mjs
    │   ├── feature25_e2e_pass.test.mjs
    │   ├── feature26_adversarial_hardening.test.mjs
    │   └── feature27_production_packaging.test.mjs
    ├── tier2_boundaries/          # Tier 2: Boundary & Corner Cases (>=135 tests)
    │   ├── boundary_01_to_05.test.mjs
    │   ├── boundary_06_to_10.test.mjs
    │   ├── boundary_11_to_15.test.mjs
    │   ├── boundary_16_to_20.test.mjs
    │   └── boundary_21_to_27.test.mjs
    ├── tier3_combinations/        # Tier 3: Pairwise Interactions (>=27 tests)
    │   └── pairwise_interactions.test.mjs
    ├── tier4_scenarios/           # Tier 4: Real-World Workflows (>=14 tests)
    │   └── realworld_workflows.test.mjs
    └── runner.mjs                 # Unified test harness & test reporter
```

---

## 5. Execution Commands & Conventions

### Running the Entire Test Suite
To execute all 4 tiers with the test runner and formatted results summary:
```bash
node tests/runner.mjs
```

### Running with Native Node Test Runner
To execute directly via Node's native test engine:
```bash
node --test tests/**/*.test.mjs
```

### Running Specific Tiers
- **Tier 1 (Feature Coverage)**:
  ```bash
  node tests/runner.mjs --tier=1
  ```
- **Tier 2 (Boundary & Corner Cases)**:
  ```bash
  node tests/runner.mjs --tier=2
  ```
- **Tier 3 (Cross-Feature Combinations)**:
  ```bash
  node tests/runner.mjs --tier=3
  ```
- **Tier 4 (Real-World Application Scenarios)**:
  ```bash
  node tests/runner.mjs --tier=4
  ```

### Exit Code Conventions
- **Code 0**: All tests passed successfully with 100% pass rate.
- **Code 1**: One or more assertions failed or syntax error detected.
