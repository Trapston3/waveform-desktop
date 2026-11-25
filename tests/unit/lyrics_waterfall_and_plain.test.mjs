// tests/unit/lyrics_waterfall_and_plain.test.mjs
// Unit tests for strict synced-first multi-provider lyrics waterfall, plain lyrics fallback, and zero fake timestamps.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const resolverHook = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.tsx') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
      for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        try {
          return await nextResolve(specifier + suffix, context);
        } catch {}
      }
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`, import.meta.url);

const { LyricsService, detectSyncType, scoreLrclibCandidate } = await import(
  pathToFileURL(path.join(rootDir, 'src/services/LyricsService.ts')).href
);
const { parseLrc } = await import(
  pathToFileURL(path.join(rootDir, 'src/lyricVisualizer/core/lrcParser.ts')).href
);

describe('Synced-First Multi-Provider Lyrics Waterfall & Plain Fallback', () => {
  beforeEach(() => {
    LyricsService.clearCache();
  });

  test('detectSyncType & scoreLrclibCandidate rank synced + duration-matched candidates cleanly', () => {
    const lineSynced = LyricsService.parseLrc('[00:05.00] First line\n[00:10.00] Second line', 'LrcLib');
    assert.equal(detectSyncType(lineSynced), 'line');
    assert.equal(lineSynced.syncType, 'line');

    const plain = LyricsService.parsePlainText('Line one\nLine two', 'LrcLib');
    assert.equal(detectSyncType(plain), 'plain');
    assert.equal(plain.syncType, 'plain');
    assert.equal(plain.isSynced, false);
    assert.equal(plain.lines[0].startTimeMs, 0);
    assert.equal(plain.lines[1].endTimeMs, 0);

    const badMatch = scoreLrclibCandidate(
      { trackName: 'Unrelated Song', artistName: 'Nobody', syncedLyrics: '[00:01.00] hi', duration: 200 },
      'Midnight City',
      'M83',
      243
    );
    assert.equal(badMatch, -1);

    const exactDurSynced = scoreLrclibCandidate(
      { trackName: 'Midnight City', artistName: 'M83', syncedLyrics: '[00:01.00] Waiting', duration: 243 },
      'Midnight City',
      'M83',
      243
    );
    const plainOnly = scoreLrclibCandidate(
      { trackName: 'Midnight City', artistName: 'M83', plainLyrics: 'Waiting in a car', duration: 243 },
      'Midnight City',
      'M83',
      243
    );
    assert.ok(exactDurSynced > plainOnly, 'Synced candidate must outrank plain-only candidate');
  });

  test('LyricsService skips plain LRCLIB responses and keeps querying until NetEase/Kugou returns synced LRC', async () => {
    const prevFetch = globalThis.fetch;
    const prevWindow = globalThis.window;

    try {
      globalThis.fetch = async (url) => {
        const u = String(url);
        if (u.includes('lrclib.net/api/get')) {
          return new Response(JSON.stringify({ plainLyrics: 'Plain LRCLIB verse 1\nPlain LRCLIB verse 2' }), { status: 200 });
        }
        if (u.includes('lrclib.net/api/search')) {
          return new Response(
            JSON.stringify([{ trackName: 'Starlight', artistName: 'Muse', plainLyrics: 'Plain search verse' }]),
            { status: 200 }
          );
        }
        return new Response('', { status: 404 });
      };

      let neteaseCalled = 0;
      globalThis.window = {
        electronAPI: {
          searchNetEaseLyrics: async () => {
            neteaseCalled++;
            return {
              syncedLyrics: '[00:02.00] Far away\n[00:05.50] This ship has taken me far away',
              plainLyrics: null,
            };
          },
        },
      };

      const res = await LyricsService.fetchLyrics('vid-sl-1', 'Starlight', 'Muse', 'Black Holes', 240);
      assert.equal(neteaseCalled, 1);
      assert.ok(res);
      assert.equal(res.provider, 'NetEase');
      assert.equal(res.isSynced, true);
      assert.ok(res.syncType === 'line' || res.syncType === 'word');
      assert.equal(res.lines[0].startTimeMs, 2000);
    } finally {
      globalThis.fetch = prevFetch;
      globalThis.window = prevWindow;
    }
  });

  test('Plain fallback returns syncType plain without fabricating timestamps, and parseLrc preserves 0s for plain text', async () => {
    const prevFetch = globalThis.fetch;
    const prevWindow = globalThis.window;
    try {
      globalThis.fetch = async (url) => {
        if (String(url).includes('lrclib.net/api/get')) {
          return new Response(JSON.stringify({ plainLyrics: 'Line alpha\nLine beta' }), { status: 200 });
        }
        return new Response('[]', { status: 200 });
      };
      globalThis.window = {};

      const res = await LyricsService.fetchLyrics('', 'Unique Plain Track 99123', 'Unknown Indie Band', '', 210);
      assert.ok(res);
      assert.equal(res.type, 'UNSYNCED');
      assert.equal(res.syncType, 'plain');
      assert.equal(res.isSynced, false);
      assert.equal(res.lines[0].startTimeMs, 0);
      assert.equal(res.lines[1].startTimeMs, 0);

      const coreParsed = parseLrc('Line alpha\nLine beta', { trackDurationSeconds: 210 });
      assert.ok(coreParsed);
      assert.equal(coreParsed.sourceKind, 'Unsynced');
      assert.equal(coreParsed.lines[0].startSeconds, 0);
      assert.equal(coreParsed.lines[1].endSeconds, 0);
    } finally {
      globalThis.fetch = prevFetch;
      globalThis.window = prevWindow;
    }
  });
});
