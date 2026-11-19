// tests/adversarial_m3_challenger_song_matching_session.mjs
// ==============================================================================
// EMPIRICAL CHALLENGER ADVERSARIAL STRESS TEST SUITE
// Milestone M3: 0Hz Re-render Invariant, Song Matching Algorithm & Session Persistence
// ==============================================================================

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// Register tsxLoader for TS ESM imports
register('./helpers/tsxLoader.mjs', import.meta.url);

const { TrackMatcher } = await import('../src/services/TrackMatcher.ts');
const {
  loadSyncSession,
  saveSyncSession,
  clearSyncSession,
  persistSessionDebounced,
} = await import('../src/utils/sessionPersistence.ts');
const { usePlayerStore } = await import('../src/state/playerStore.ts');
const { normalizeSong } = await import('../src/models/Song.ts');

const sampleTrack1 = normalizeSong({
  videoId: 'ode-to-the-mets-001',
  title: 'Ode to the Mets',
  artist: 'The Strokes',
  durationSec: 351,
  totalPlayTimeMs: 351000,
  streamUrl: 'https://example.com/audio1.mp4',
});

const sampleTrack2 = normalizeSong({
  videoId: 'sweet-taste-india-002',
  title: 'Sweet Taste of India',
  artist: 'Sweet Taste of India',
  durationSec: 353,
  totalPlayTimeMs: 353000,
  streamUrl: 'https://example.com/audio2.mp4',
});

// Helper: build subscriber harness matching Zustand selector pattern
function createSelectorHarness(selectors, store = usePlayerStore) {
  let renderCount = 0;
  let lastValues = selectors.map((sel) => sel(store.getState()));

  const unsubscribe = store.subscribe((state) => {
    let shouldRender = false;
    for (let i = 0; i < selectors.length; i++) {
      const nextVal = selectors[i](state);
      if (!Object.is(lastValues[i], nextVal)) {
        lastValues[i] = nextVal;
        shouldRender = true;
      }
    }
    if (shouldRender) {
      renderCount++;
    }
  });

  return {
    getRenderCount: () => renderCount,
    resetCount: () => {
      renderCount = 0;
      lastValues = selectors.map((sel) => sel(store.getState()));
    },
    unsubscribe,
  };
}

// ==============================================================================
// SUITE 1: 0Hz PLAYBACK RE-RENDER ISOLATION IN DESKTOP TRACK TABLE
// ==============================================================================
describe('Suite 1: DesktopTrackTable 0Hz Playback Re-render Isolation', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      currentTrack: sampleTrack1,
      playbackState: 'PLAYING',
      positionMs: 0,
      durationMs: 351000,
      volume: 0.8,
      isMuted: false,
      isShuffle: false,
      repeatMode: 'off',
    });
  });

  test('CHALLENGE-01: 500 rapid position updates produce STRICTLY 0 re-renders in DesktopTrackTable', () => {
    // Selectors exactly extracted from DesktopTrackTable.tsx (lines 61-63)
    const trackTableSelectors = [
      (s) => s.currentTrack?.videoId,
      (s) => s.playbackState === 'PLAYING',
      (s) => s.togglePlay,
    ];

    const harness = createSelectorHarness(trackTableSelectors);

    // Simulate 500 rapid playback ticks (e.g., 50Hz playback for 10 seconds)
    for (let tick = 1; tick <= 500; tick++) {
      usePlayerStore.setState({ positionMs: tick * 100 });
    }

    assert.strictEqual(
      harness.getRenderCount(),
      0,
      'DesktopTrackTable must produce exactly 0 re-renders over 500 position updates'
    );
    harness.unsubscribe();
  });

  test('CHALLENGE-02: Rapid seeks, volume sweeps, buffer progress, shuffle, repeat produce STRICTLY 0 re-renders', () => {
    const trackTableSelectors = [
      (s) => s.currentTrack?.videoId,
      (s) => s.playbackState === 'PLAYING',
      (s) => s.togglePlay,
    ];

    const harness = createSelectorHarness(trackTableSelectors);

    // Large jumps / seeks
    usePlayerStore.setState({ positionMs: 50000 });
    usePlayerStore.setState({ positionMs: 120000 });
    usePlayerStore.setState({ positionMs: 300000 });

    // Volume sweeps
    for (let v = 0; v <= 10; v++) {
      usePlayerStore.setState({ volume: v / 10 });
    }

    // Transport flags
    usePlayerStore.setState({ isMuted: true });
    usePlayerStore.setState({ isMuted: false });
    usePlayerStore.setState({ isShuffle: true });
    usePlayerStore.setState({ repeatMode: 'all' });
    usePlayerStore.setState({ repeatMode: 'one' });
    usePlayerStore.setState({ repeatMode: 'off' });

    assert.strictEqual(
      harness.getRenderCount(),
      0,
      'DesktopTrackTable must be completely unaffected by seeks, volume, and transport flags'
    );
    harness.unsubscribe();
  });

  test('CHALLENGE-03: Surgical re-rendering: exactly 1 re-render on track change, exactly 1 on play/pause transition', () => {
    const trackTableSelectors = [
      (s) => s.currentTrack?.videoId,
      (s) => s.playbackState === 'PLAYING',
      (s) => s.togglePlay,
    ];

    const harness = createSelectorHarness(trackTableSelectors);

    // 1. Change track to sampleTrack2 -> exactly 1 re-render
    usePlayerStore.setState({ currentTrack: sampleTrack2 });
    assert.strictEqual(harness.getRenderCount(), 1, 'Track transition must cause exactly 1 re-render');

    // 2. Play 100 position ticks on the new track -> 0 additional re-renders
    for (let i = 1; i <= 100; i++) {
      usePlayerStore.setState({ positionMs: i * 50 });
    }
    assert.strictEqual(harness.getRenderCount(), 1, 'Ticks on new track must not re-render');

    // 3. Pause playback -> exactly 1 re-render (total: 2)
    usePlayerStore.setState({ playbackState: 'PAUSED' });
    assert.strictEqual(harness.getRenderCount(), 2, 'Pause transition must cause exactly 1 re-render');

    // 4. Resume playback -> exactly 1 re-render (total: 3)
    usePlayerStore.setState({ playbackState: 'PLAYING' });
    assert.strictEqual(harness.getRenderCount(), 3, 'Resume transition must cause exactly 1 re-render');

    harness.unsubscribe();
  });

  test('CHALLENGE-04: Static AST and source audit of DesktopTrackTable confirms zero positionMs references and React.memo wrapping', () => {
    const filePath = path.join(ROOT, 'src/ui/components/DesktopTrackTable.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    // Must not subscribe to positionMs
    assert.ok(!source.includes('s.positionMs'), 'DesktopTrackTable must not reference s.positionMs');
    assert.ok(!source.includes('s.currentTimeMs'), 'DesktopTrackTable must not reference s.currentTimeMs');

    // Must be memoized
    assert.ok(source.includes('React.memo(') || source.includes('memo('), 'DesktopTrackTable must be memoized');
  });
});

// ==============================================================================
// SUITE 2: TRACKMATCHER ALGORITHM ADVERSARIAL STRESS TESTING
// ==============================================================================
describe('Suite 2: TrackMatcher Version Rejection, Duration & Neutral Segments', () => {
  const cleanTarget = {
    title: 'Ode to the Mets',
    artist: 'The Strokes',
    durationSec: 351,
  };

  test('CHALLENGE-05: Strict version rejection for bracketed version variants against clean target', () => {
    const parenthesizedVariants = [
      { name: 'remix', title: 'Ode to the Mets (Official Remix)' },
      { name: 'rmx', title: 'Ode to the Mets (Club Rmx)' },
      { name: 'reverb', title: 'Ode to the Mets (Slowed and Reverb)' },
      { name: 'slowed', title: 'Ode to the Mets (Slowed Down Edit)' },
      { name: 'sped up', title: 'Ode to the Mets (Sped Up)' },
      { name: 'nightcore', title: 'Ode to the Mets [Nightcore Version]' },
      { name: 'live', title: 'Ode to the Mets (Live at Barclays Center)' },
      { name: 'concert', title: 'Ode to the Mets (Concert 2021)' },
      { name: 'cover', title: 'Ode to the Mets (Acoustic Cover)' },
      { name: 'karaoke', title: 'Ode to the Mets (Karaoke Version)' },
      { name: 'instrumental', title: 'Ode to the Mets [Instrumental]' },
      { name: '8d', title: 'Ode to the Mets (8D Audio Experience)' },
      { name: 'mashup', title: 'Ode to the Mets (Mashup)' },
      { name: 'tribute', title: 'Ode to the Mets (A Tribute to The Strokes)' },
      { name: 'acoustic', title: 'Ode to the Mets (Acoustic Session)' },
      { name: 'acapella', title: 'Ode to the Mets (Acapella Stems)' },
      { name: 'lofi', title: 'Ode to the Mets (Lofi Chill Beat)' },
    ];

    for (const v of parenthesizedVariants) {
      const candidate = {
        title: v.title,
        artist: 'The Strokes',
        channelTitle: 'Music Hub',
        durationSec: 351,
      };

      const score = TrackMatcher.score(candidate, cleanTarget);
      assert.strictEqual(
        score,
        null,
        `Bracketed version keyword "${v.name}" in title "${v.title}" must be strictly rejected (expected null, got ${score})`
      );
    }
  });

  test('BUG-01 (REMEDIATED): Multi-word version phrase "bass boosted" is strictly rejected in classify()', () => {
    // TrackMatcher.VERSION_WORDS contains 'bass boosted', 'bassboosted', 'boosted', 'bass'.
    // classify() checks VERSION_WORDS.has(merged) ('bassboosted') and individual words ('bass', 'boosted').
    // When (Bass Boosted) is encountered, version markers are added to versions,
    // ensuring strict rejection against a clean studio target.
    const candidate = {
      title: 'Ode to the Mets (Bass Boosted)',
      artist: 'The Strokes',
      channelTitle: 'BassMaster',
      durationSec: 351,
    };

    const score = TrackMatcher.score(candidate, cleanTarget);
    assert.strictEqual(
      score,
      null,
      'Remediated: (Bass Boosted) is strictly rejected (score === null)'
    );
  });

  test('BUG-02 (REMEDIATED): Unparenthesized trailing version tokens (Cover, Live, Mashup, Slowed, Reverb, etc.) are strictly rejected', () => {
    // In TrackMatcher.ts, TRAILING_TAKES includes all version words from VERSION_WORDS.
    // Unparenthesized trailing tokens are recognized, popped from words, and added to versions,
    // ensuring candidate is strictly rejected against a clean studio target.
    const unparenthesizedLeaks = [
      'Cover', 'Live', 'Mashup', 'Slowed', 'Reverb', 'Acoustic', 'Tribute', 'Lofi', 'Edit', 'Mix', 'Session'
    ];

    for (const w of unparenthesizedLeaks) {
      const candidate = {
        title: `Ode to the Mets ${w}`,
        artist: 'The Strokes',
        channelTitle: 'Fan Channel',
        durationSec: 351,
      };

      const score = TrackMatcher.score(candidate, cleanTarget);
      assert.strictEqual(
        score,
        null,
        `Remediated: unparenthesized "${w}" is strictly rejected (score === null)`
      );
    }
  });

  test('CHALLENGE-06: Strict version rejection across CJK non-Latin version markers', () => {
    const cjkVariants = [
      { lang: 'Japanese', marker: 'リミックス', title: 'Ode to the Mets (リミックス)' },
      { lang: 'Japanese', marker: 'カバー', title: 'Ode to the Mets (カバー)' },
      { lang: 'Japanese', marker: 'カラオケ', title: 'Ode to the Mets (カラオケ)' },
      { lang: 'Japanese', marker: 'ライブ', title: 'Ode to the Mets (ライブ)' },
      { lang: 'Japanese', marker: 'アコースティック', title: 'Ode to the Mets (アコースティック)' },
      { lang: 'Chinese', marker: '翻唱', title: 'Ode to the Mets (翻唱)' },
      { lang: 'Chinese', marker: '现场', title: 'Ode to the Mets (现场)' },
      { lang: 'Chinese', marker: '混音', title: 'Ode to the Mets (混音)' },
      { lang: 'Korean', marker: '커버', title: 'Ode to the Mets (커버)' },
      { lang: 'Korean', marker: '라이브', title: 'Ode to the Mets (라이브)' },
      { lang: 'Korean', marker: '리믹스', title: 'Ode to the Mets (리믹스)' },
    ];

    for (const cjk of cjkVariants) {
      const candidate = {
        title: cjk.title,
        artist: 'The Strokes',
        channelTitle: 'Asia Channel',
        durationSec: 351,
      };

      const score = TrackMatcher.score(candidate, cleanTarget);
      assert.strictEqual(
        score,
        null,
        `CJK marker "${cjk.marker}" (${cjk.lang}) in "${cjk.title}" must be rejected against clean target`
      );
    }
  });

  test('CHALLENGE-07: Version preservation: when user requests a specific version, clean candidates are rejected and matched candidates accepted', () => {
    const liveTarget = {
      title: 'Ode to the Mets (Live)',
      artist: 'The Strokes',
      durationSec: 360,
    };

    const cleanCandidate = {
      title: 'Ode to the Mets',
      artist: 'The Strokes',
      channelTitle: 'The Strokes - Topic',
      durationSec: 358,
    };

    const liveCandidate = {
      title: 'Ode to the Mets (Live)',
      artist: 'The Strokes',
      channelTitle: 'The Strokes - Topic',
      durationSec: 360,
    };

    // Clean candidate lacks the requested 'live' version -> must be rejected
    const cleanScore = TrackMatcher.score(cleanCandidate, liveTarget);
    assert.strictEqual(cleanScore, null, 'Clean candidate must be rejected when live version is explicitly requested');

    // Live candidate has matching 'live' version -> must be accepted with high score
    const liveScore = TrackMatcher.score(liveCandidate, liveTarget);
    assert.ok(liveScore !== null && liveScore >= 120, `Live candidate should score >= 120, got ${liveScore}`);
  });

  test('CHALLENGE-08: Neutral packaging segments do NOT trigger version mismatch', () => {
    const neutralTitles = [
      'Ode to the Mets (Album Version)',
      'Ode to the Mets (Original Version)',
      'Ode to the Mets (Original Mix)',
      'Ode to the Mets (Single Version)',
      'Ode to the Mets (Radio Edit)',
      'Ode to the Mets (Radio Version)',
      'Ode to the Mets (Stereo Version)',
      'Ode to the Mets (Mono Version)',
      'Ode to the Mets (Studio Version)',
      'Ode to the Mets (Full Version)',
      'Ode to the Mets (Standard Version)',
      'Ode to the Mets (Explicit Version)',
      'Ode to the Mets (Deluxe Version)',
      'Ode to the Mets (Original Track)',
    ];

    for (const title of neutralTitles) {
      const candidate = {
        title,
        artist: 'The Strokes',
        channelTitle: 'The Strokes - Topic',
        durationSec: 351,
      };

      const score = TrackMatcher.score(candidate, cleanTarget);
      assert.ok(
        score !== null && score >= 120,
        `Neutral segment in "${title}" must NOT be rejected (got score: ${score})`
      );
    }
  });

  test('CHALLENGE-09: Duration proximity thresholds: tight (<= 5s), medium (<= 15s), loose (<= 30s), rejected (> 30s)', () => {
    const baseCandidate = {
      title: 'Ode to the Mets',
      artist: 'The Strokes',
      channelTitle: 'Various Artists',
    };

    // Tight (delta = 0s) -> 40 points duration
    const score0 = TrackMatcher.score({ ...baseCandidate, durationSec: 351 }, cleanTarget);
    // Tight (delta = 5s) -> 40 points duration
    const score5 = TrackMatcher.score({ ...baseCandidate, durationSec: 356 }, cleanTarget);
    // Medium (delta = 10s) -> 20 points duration
    const score10 = TrackMatcher.score({ ...baseCandidate, durationSec: 361 }, cleanTarget);
    // Loose (delta = 25s) -> 5 points duration
    const score25 = TrackMatcher.score({ ...baseCandidate, durationSec: 376 }, cleanTarget);
    // Over threshold (delta = 31s) -> null (rejected)
    const score31 = TrackMatcher.score({ ...baseCandidate, durationSec: 382 }, cleanTarget);
    // Extreme mismatch (delta = 100s) -> null
    const score100 = TrackMatcher.score({ ...baseCandidate, durationSec: 451 }, cleanTarget);

    assert.ok(score0 !== null, 'score0 should be non-null');
    assert.ok(score5 !== null, 'score5 should be non-null');
    assert.strictEqual(score0, score5, 'Delta 0s and delta 5s should both receive full 40 points duration bonus');

    assert.ok(score10 !== null, 'score10 should be non-null');
    assert.strictEqual(score0 - score10, 20, 'Score with 10s drift should be exactly 20 points lower than tight match');

    assert.ok(score25 !== null, 'score25 should be non-null');
    assert.strictEqual(score0 - score25, 35, 'Score with 25s drift should be exactly 35 points lower than tight match');

    assert.strictEqual(score31, null, 'Candidate with drift > 30s must return null');
    assert.strictEqual(score100, null, 'Candidate with extreme drift must return null');
  });

  test('CHALLENGE-10: rankCandidates prioritizes official studio ATV ahead of fan uploads and handles ranking correctly', () => {
    const candidatePool = [
      { id: 'c1', title: 'Ode to the Mets (Slowed + Reverb)', artist: 'The Strokes', durationSec: 400, channelTitle: 'ChillZone' },
      { id: 'c2', title: 'Ode to the Mets (Official Remix)', artist: 'The Strokes', durationSec: 350, channelTitle: 'DJ Mixes' },
      { id: 'c3', title: 'Ode to the Mets (Live 2020)', artist: 'The Strokes', durationSec: 360, channelTitle: 'ConcertVids' },
      { id: 'c4', title: 'Ode to the Mets - Cover', artist: 'The Strokes', durationSec: 351, channelTitle: 'Indie Covers' },
      { id: 'c5', title: 'Ode to the Mets [Nightcore]', artist: 'The Strokes', durationSec: 280, channelTitle: 'Nightcore Anime' },
      { id: 'c6', title: 'Ode to the Mets', artist: 'The Strokes', durationSec: 351, channelTitle: 'The Strokes - Topic', musicVideoType: 'MUSIC_VIDEO_TYPE_ATV' },
      { id: 'c7', title: 'Ode to the Mets (Audio)', artist: 'The Strokes', durationSec: 351, channelTitle: 'Fan Reupload' },
      { id: 'c8', title: 'Ode to the Mets', artist: 'The Strokes', durationSec: 365, channelTitle: 'Indie Fan 14s drift' },
      { id: 'c9', title: 'Ode to the Mets (8D Audio)', artist: 'The Strokes', durationSec: 351, channelTitle: '8D Beats' },
      { id: 'c10', title: 'Ode to the Mets (Karaoke Version)', artist: 'The Strokes', durationSec: 351, channelTitle: 'KaraokeFun' },
    ];

    const ranked = TrackMatcher.rankCandidates(candidatePool, cleanTarget);

    // Only non-remix, non-cover, non-live candidates within <= 30s drift should survive (c6, c7, c8)
    assert.strictEqual(ranked.length, 3, 'Only 3 valid studio/clean candidates should survive filtering');

    // Rank 1 must be c6: Official Topic Channel + ATV bonus + exact duration match
    assert.strictEqual(ranked[0].id, 'c6', 'Top ranked track must be the official ATV Topic channel track');

    // Rank 2 should be c7: exact duration match, but no topic/ATV bonus
    assert.strictEqual(ranked[1].id, 'c7', 'Second ranked track should be exact duration fan upload');

    // Rank 3 should be c8: 14s drift
    assert.strictEqual(ranked[2].id, 'c8', 'Third ranked track should be 14s drift');
  });
});

// ==============================================================================
// SUITE 3: SESSION PERSISTENCE & PLAYERSTORE RAPID WRITES & REHYDRATION STRESS
// ==============================================================================
describe('Suite 3: sessionPersistence & playerStore Durability, Fuzz & Rehydration', () => {
  beforeEach(() => {
    clearSyncSession();
  });

  test('CHALLENGE-11: 500 rapid consecutive storage writes execute cleanly without throw or corruption', () => {
    for (let i = 1; i <= 500; i++) {
      const session = {
        version: 1,
        savedAt: Date.now(),
        player: {
          currentTrack: sampleTrack1,
          positionMs: i * 200,
          durationMs: 351000,
          volume: (i % 100) / 100,
          isMuted: i % 2 === 0,
          preMuteVolume: 0.8,
          isShuffle: i % 3 === 0,
          repeatMode: 'off',
          playbackState: 'PAUSED',
        },
        queue: {
          tiers: {
            USER_QUEUE: [sampleTrack2],
            CONTEXT: [sampleTrack1],
            AUTOPLAY: [],
          },
          currentSong: sampleTrack1,
          currentTier: 'CONTEXT',
          currentIndex: 0,
          history: [],
          context: null,
        },
      };

      saveSyncSession(session);
    }

    const loaded = loadSyncSession();
    assert.ok(loaded !== null, 'Session must load cleanly after 500 rapid writes');
    assert.strictEqual(loaded.version, 1);
    assert.strictEqual(loaded.player.positionMs, 500 * 200);
    assert.strictEqual(loaded.player.currentTrack?.videoId, sampleTrack1.videoId);
  });

  test('CHALLENGE-12: Corrupt, invalid and boundary storage payloads are safely rejected by loadSyncSession without crash', () => {
    const corruptPayloads = [
      '{ this is completely invalid JSON',
      'null',
      'undefined',
      '12345',
      '"just a string"',
      '[]',
      '[1, 2, 3]',
      '{"version": 2}', // Unsupported version
      '{"version": "1"}', // Version string instead of number
      '{"version": 1}', // Missing player object
      '{"version": 1, "player": null}', // Null player
      '{"version": 1, "player": "not an object"}',
      '', // Empty string
      '    ', // Whitespace
      '\x00\xFF\xFE\x00', // Binary garbage
    ];

    // Access storage directly to inject malformed payloads
    for (const corrupt of corruptPayloads) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('waveform_playback_session', corrupt);
        } else if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
          globalThis.localStorage.setItem('waveform_playback_session', corrupt);
        }
      } catch {}

      // loadSyncSession MUST not throw, and MUST return null
      let result;
      assert.doesNotThrow(() => {
        result = loadSyncSession();
      }, `loadSyncSession must not throw on payload: "${corrupt}"`);

      // If corrupt, result must be null
      assert.strictEqual(result, null, `Corrupt payload "${corrupt}" must return null`);
    }
  });

  test('CHALLENGE-13: Full reload cycle preserves exact track, position, volume, shuffle, repeat, and 3 queue tiers intact', () => {
    const testSession = {
      version: 1,
      savedAt: 1731770000000,
      player: {
        currentTrack: sampleTrack1,
        positionMs: 142500,
        durationMs: 351000,
        volume: 0.65,
        isMuted: false,
        preMuteVolume: 0.65,
        isShuffle: true,
        repeatMode: 'all',
        playbackState: 'PAUSED',
      },
      queue: {
        tiers: {
          USER_QUEUE: [sampleTrack2],
          CONTEXT: [sampleTrack1, sampleTrack2],
          AUTOPLAY: [sampleTrack1],
        },
        currentSong: sampleTrack1,
        currentTier: 'CONTEXT',
        currentIndex: 0,
        history: [],
        context: { id: 'album-123', type: 'album' },
      },
    };

    saveSyncSession(testSession);

    const rehydrated = loadSyncSession();
    assert.ok(rehydrated !== null, 'Rehydrated session must not be null');

    // 1. Current Track
    assert.strictEqual(rehydrated.player.currentTrack?.videoId, 'ode-to-the-mets-001');
    assert.strictEqual(rehydrated.player.currentTrack?.title, 'Ode to the Mets');
    assert.strictEqual(rehydrated.player.currentTrack?.artist, 'The Strokes');

    // 2. Playback State & Transport
    assert.strictEqual(rehydrated.player.positionMs, 142500);
    assert.strictEqual(rehydrated.player.durationMs, 351000);
    assert.strictEqual(rehydrated.player.volume, 0.65);
    assert.strictEqual(rehydrated.player.isShuffle, true);
    assert.strictEqual(rehydrated.player.repeatMode, 'all');
    assert.strictEqual(rehydrated.player.playbackState, 'PAUSED', 'Rehydrated state must always be PAUSED to respect browser autoplay policies');

    // 3. Queue Tiers
    assert.strictEqual(rehydrated.queue.tiers.USER_QUEUE.length, 1);
    assert.strictEqual(rehydrated.queue.tiers.USER_QUEUE[0].videoId, 'sweet-taste-india-002');
    assert.strictEqual(rehydrated.queue.tiers.CONTEXT.length, 2);
    assert.strictEqual(rehydrated.queue.tiers.AUTOPLAY.length, 1);
    assert.strictEqual(rehydrated.queue.currentTier, 'CONTEXT');
    assert.strictEqual(rehydrated.queue.currentIndex, 0);
  });

  test('CHALLENGE-14: Clear sync session wipes storage completely', () => {
    saveSyncSession({
      version: 1,
      savedAt: Date.now(),
      player: {
        currentTrack: sampleTrack1,
        positionMs: 5000,
        durationMs: 351000,
        volume: 0.8,
        isMuted: false,
        preMuteVolume: 0.8,
        isShuffle: false,
        repeatMode: 'off',
        playbackState: 'PAUSED',
      },
      queue: {
        tiers: { USER_QUEUE: [], CONTEXT: [], AUTOPLAY: [] },
        currentSong: sampleTrack1,
        currentTier: null,
        currentIndex: 0,
        history: [],
        context: null,
      },
    });

    assert.ok(loadSyncSession() !== null);
    clearSyncSession();
    assert.strictEqual(loadSyncSession(), null, 'clearSyncSession must result in null on subsequent load');
  });
});
