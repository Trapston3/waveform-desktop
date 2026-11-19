// tests/unit/m3_song_matching_persistence.test.mjs
// Milestone M3 Dedicated Unit Test Suite:
// 1. Reverse-Engineered TrackMatcher Algorithm (Exact Official Studio Song Selection)
// 2. Playback Session State Persistence & Zero-Flicker Rehydration

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { register } from 'node:module';

// Register ESM resolution hook so Node can resolve relative .ts imports without extensions
const resolverHook = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
      try {
        return await nextResolve(specifier + '.ts', context);
      } catch {}
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

const { TrackMatcher } = await import('../../src/services/TrackMatcher.ts');
const { loadSyncSession, saveSyncSession, clearSyncSession } = await import('../../src/utils/sessionPersistence.ts');
const { AudioEngine } = await import('../../src/audio/AudioEngine.ts');

describe('Milestone M3: Exact Official Song Matching Algorithm (TrackMatcher)', () => {
  test('TM-01: parseTitle strips noise and extracts clean core', () => {
    const parts = TrackMatcher.parseTitle('Ode to the Mets (Official Audio)', 'The Strokes');
    assert.strictEqual(parts.core, 'odetothemets');
    assert.strictEqual(parts.versions.size, 0);
  });

  test('TM-02: Strict version rejection: candidate remix rejected for clean target', () => {
    const target = {
      title: 'Ode to the Mets',
      artist: 'The Strokes',
      durationSec: 341,
    };

    const remixCandidate = {
      id: 'remix_01',
      videoId: 'remix_01',
      title: 'Ode to the Mets (Slowed + Reverb Remix)',
      artist: 'The Strokes',
      channelTitle: 'Vibe Edits',
      durationSec: 405,
    };

    const score = TrackMatcher.score(remixCandidate, target);
    assert.strictEqual(score, null, 'Unrequested remix must be strictly rejected (score === null)');
  });

  test('TM-03: Strict version rejection: candidate cover/karaoke rejected for clean target', () => {
    const target = {
      title: 'Sweet Taste of India',
      artist: 'Sweet Taste of India',
      durationSec: 353,
    };

    const coverCandidate = {
      id: 'cover_01',
      videoId: 'cover_01',
      title: 'Sweet Taste of India (Cover Version)',
      artist: 'Sweet Taste of India',
      channelTitle: 'Cover Studio',
      durationSec: 353,
    };

    const score = TrackMatcher.score(coverCandidate, target);
    assert.strictEqual(score, null, 'Unrequested cover must be strictly rejected');
  });

  test('TM-04: Duration drift > 30s strictly rejected', () => {
    const target = {
      title: 'Overdrive',
      artist: 'Lazerhawk',
      durationSec: 260,
    };

    const longCandidate = {
      id: 'long_01',
      videoId: 'long_01',
      title: 'Overdrive',
      artist: 'Lazerhawk',
      channelTitle: 'Lazerhawk',
      durationSec: 330, // 70s drift
    };

    const score = TrackMatcher.score(longCandidate, target);
    assert.strictEqual(score, null, 'Candidate with drift > 30s must return null');
  });

  test('TM-05: Official Topic Channel and tight duration proximity award high scores', () => {
    const target = {
      title: 'Ode to the Mets',
      artist: 'The Strokes',
      durationSec: 341,
    };

    const officialTopic = {
      id: 'atv_01',
      videoId: '5dNP-a-XXx0',
      title: 'Ode to the Mets',
      artist: 'The Strokes',
      channelTitle: 'The Strokes - Topic',
      durationSec: 341,
      musicVideoType: 'MUSIC_VIDEO_TYPE_ATV',
    };

    const score = TrackMatcher.score(officialTopic, target);
    assert.ok(score !== null && score >= 190, `Official topic candidate must receive score >= 190 (got: ${score})`);
  });

  test('TM-06: rankCandidates picks official studio version ahead of remixes and fan edits', () => {
    const target = {
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      durationSec: 200,
    };

    const candidates = [
      {
        id: 'fan_01',
        title: 'Blinding Lights (8D Audio + Bass Boosted)',
        artist: 'The Weeknd',
        channelTitle: '8D Bass Central',
        durationSec: 200,
      },
      {
        id: 'live_01',
        title: 'Blinding Lights (Live at Super Bowl)',
        artist: 'The Weeknd',
        channelTitle: 'The Weeknd',
        durationSec: 245,
      },
      {
        id: 'official_atv',
        title: 'Blinding Lights',
        artist: 'The Weeknd',
        channelTitle: 'The Weeknd - Topic',
        durationSec: 200,
        musicVideoType: 'MUSIC_VIDEO_TYPE_ATV',
      },
      {
        id: 'cover_02',
        title: 'Blinding Lights (Acoustic Cover)',
        artist: 'Various Artists',
        channelTitle: 'Indie Covers',
        durationSec: 195,
      },
    ];

    const ranked = TrackMatcher.rankCandidates(candidates, target);
    assert.strictEqual(ranked.length, 1, 'Only the official studio version should qualify');
    assert.strictEqual(ranked[0].id, 'official_atv', 'Official ATV track must be ranked #1');
  });

  test('TM-07: Neutral packaging segments do not trigger version mismatch', () => {
    const target = {
      title: 'Midnight City',
      artist: 'M83',
      durationSec: 243,
    };

    const albumCandidate = {
      id: 'm83_01',
      title: 'Midnight City (Original Version)',
      artist: 'M83',
      channelTitle: 'M83 - Topic',
      durationSec: 243,
    };

    const score = TrackMatcher.score(albumCandidate, target);
    assert.ok(score !== null && score >= 160, 'Neutral packaging segment (Original Version) must be accepted');
  });

  test('TM-08: CJK character matching without whitespace splitting', () => {
    const target = {
      title: '夜に駆ける',
      artist: 'YOASOBI',
      durationSec: 261,
    };

    const officialCJK = {
      id: 'cjk_01',
      title: '夜に駆ける',
      artist: 'YOASOBI',
      channelTitle: 'Ayase / YOASOBI - Topic',
      durationSec: 261,
    };

    const score = TrackMatcher.score(officialCJK, target);
    assert.ok(score !== null && score >= 160, 'Exact CJK title must match');

    const coverCJK = {
      id: 'cjk_02',
      title: '夜に駆ける (歌ってみた)',
      artist: 'YOASOBI',
      channelTitle: 'Fan Channel',
      durationSec: 261,
    };

    const coverScore = TrackMatcher.score(coverCJK, target);
    assert.strictEqual(coverScore, null, 'CJK cover (歌ってみた) must be rejected');
  });

  test('TM-09: Multi-word (Bass Boosted) and unparenthesized trailing tokens are strictly rejected against clean target', () => {
    const target = {
      title: 'Ode to the Mets',
      artist: 'The Strokes',
      durationSec: 351,
    };

    // 1. Bracketed multi-word phrase "Bass Boosted"
    const bassBoostedCandidate = {
      id: 'bb_01',
      title: 'Ode to the Mets (Bass Boosted)',
      artist: 'The Strokes',
      channelTitle: 'BassMaster',
      durationSec: 351,
    };
    assert.strictEqual(
      TrackMatcher.score(bassBoostedCandidate, target),
      null,
      'Multi-word (Bass Boosted) candidate must be strictly rejected'
    );

    // 2. Unparenthesized trailing version tokens
    const unparenthesizedTakes = ['Cover', 'Live', 'Mashup', 'Slowed', 'Reverb', 'Acoustic'];
    for (const take of unparenthesizedTakes) {
      const takeCandidate = {
        id: `take_${take}`,
        title: `Ode to the Mets ${take}`,
        artist: 'The Strokes',
        channelTitle: 'Fan Channel',
        durationSec: 351,
      };
      assert.strictEqual(
        TrackMatcher.score(takeCandidate, target),
        null,
        `Unparenthesized trailing take "${take}" must be strictly rejected`
      );
    }
  });
});

describe('Milestone M3: Playback Session State Persistence', () => {
  test('PERSIST-01: Synchronous localStorage save and load round-trip', () => {
    clearSyncSession();

    const mockTrack = {
      videoId: '5dNP-a-XXx0',
      title: 'Overdrive',
      artist: 'Lazerhawk',
      liked: false,
      totalPlayTimeMs: 260000,
      durationSec: 260,
      playCount: 1,
      artistIds: [],
      artists: [],
      isExplicit: false,
    };

    const testSession = {
      version: 1,
      savedAt: Date.now(),
      player: {
        currentTrack: mockTrack,
        positionMs: 45000,
        durationMs: 260000,
        volume: 0.75,
        isMuted: false,
        preMuteVolume: 0.75,
        isShuffle: true,
        repeatMode: 'all',
        playbackState: 'PAUSED',
      },
      queue: {
        tiers: {
          USER_QUEUE: [mockTrack],
          CONTEXT: [mockTrack],
          AUTOPLAY: [],
        },
        currentSong: mockTrack,
        currentTier: 'CONTEXT',
        currentIndex: 0,
        history: [],
        context: null,
      },
    };

    saveSyncSession(testSession);
    const restored = loadSyncSession();
    assert.ok(restored !== null, 'Session must be restored from synchronous storage');
    assert.strictEqual(restored.player.currentTrack.videoId, '5dNP-a-XXx0');
    assert.strictEqual(restored.player.positionMs, 45000);
    assert.strictEqual(restored.player.volume, 0.75);
    assert.strictEqual(restored.player.isShuffle, true);
    assert.strictEqual(restored.queue.tiers.USER_QUEUE.length, 1);

    clearSyncSession();
  });

  test('PERSIST-02: AudioEngine prepareRestoredTrack positions track in PAUSED state', async () => {
    const engine = new AudioEngine();
    const mockTrack = {
      videoId: '5dNP-a-XXx0',
      title: 'Overdrive',
      artist: 'Lazerhawk',
      liked: false,
      totalPlayTimeMs: 260000,
      durationSec: 260,
      playCount: 1,
      artistIds: [],
      artists: [],
      isExplicit: false,
    };

    await engine.prepareRestoredTrack(mockTrack, 30000, 'active');
    const state = engine.getPlaybackState();

    assert.strictEqual(state.playbackState, 'PAUSED', 'Restored track must be in PAUSED state');
    assert.strictEqual(state.currentTrack?.videoId, '5dNP-a-XXx0');
    assert.strictEqual(state.positionMs, 30000, 'Track position must match saved position (30,000ms)');
  });
});
