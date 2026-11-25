// tests/unit/replay_persistence.test.mjs
// Unit tests for 2026 Replay accurate time accumulation, atomic disk persistence, and legacy migration.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
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

const {
  writeReplayHistoryAtomicSync,
  readReplayHistorySync,
  mergeReplayEntries,
} = await import(pathToFileURL(path.join(rootDir, 'electron/replayStore.ts')).href);

const { ListeningSessionTracker, computeYearlyReplayStats } = await import(
  pathToFileURL(path.join(rootDir, 'src/services/StorageService.ts')).href
);

describe('2026 Replay Permanent Disk Persistence & True Listening Duration', () => {
  test('writeReplayHistoryAtomicSync writes primary + .bak and recovers automatically from corrupt primary', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-replay-test-'));
    try {
      const filePath = path.join(tmpDir, 'replay-history.json');
      const sample = [
        {
          sessionId: 'sess_1',
          videoId: 'v1',
          title: 'Track One',
          artist: 'Artist Alpha',
          playedAt: 1767225600000,
          listenedSeconds: 240,
          countedPlay: true,
        },
      ];
      writeReplayHistoryAtomicSync(filePath, sample);
      assert.equal(fs.existsSync(filePath), true);
      assert.equal(readReplayHistorySync(filePath).length, 1);

      // Update file -> .bak now holds valid JSON; corrupt primary and verify .bak recovery
      writeReplayHistoryAtomicSync(filePath, [
        ...sample,
        {
          sessionId: 'sess_2',
          videoId: 'v2',
          title: 'Track Two',
          artist: 'Artist Beta',
          playedAt: 1767225900000,
          listenedSeconds: 195,
          countedPlay: true,
        },
      ]);
      fs.writeFileSync(filePath, '{corrupted_json', 'utf8');
      const recovered = readReplayHistorySync(filePath);
      assert.equal(recovered.length, 1);
      assert.equal(recovered[0].videoId, 'v1');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('mergeReplayEntries deduplicates across disk & legacy localStorage while keeping longest duration', () => {
    const disk = [
      { videoId: 'v1', title: 'Song', artist: 'Art', playedAt: 100000, listenedSeconds: 30, countedPlay: true },
    ];
    const legacy = [
      { videoId: 'v1', title: 'Song', artist: 'Art', playedAt: 102000, listenedSeconds: 245, countedPlay: true },
      { videoId: 'v2', title: 'Song 2', artist: 'Art B', playedAt: 200000, listenedSeconds: 180, countedPlay: true },
    ];
    const merged = mergeReplayEntries(disk, legacy);
    assert.equal(merged.length, 2);
    const v1 = merged.find((e) => e.videoId === 'v1');
    assert.equal(v1?.listenedSeconds, 245);
  });

  test('ListeningSessionTracker accumulates full real listening seconds (240s, not flat 30s) and computes accurate minutes', () => {
    const tracker = new ListeningSessionTracker();
    const song = {
      videoId: 'song_240',
      id: 'song_240',
      title: 'Long Anthem',
      artist: 'Coldplay',
      album: 'Viva La Vida',
      durationSec: 240,
      thumbnail: '',
    };

    let t = Date.UTC(2026, 5, 15, 12, 0, 0);
    const flushes = [];
    for (let sec = 0; sec < 240; sec++) {
      const res = tracker.onTick({
        song,
        isPlaying: true,
        isSeeking: false,
        engineTimeSec: sec,
        durationSec: 240,
        nowMs: t,
      });
      flushes.push(...res);
      t += 1000;
    }
    const finalEntry = tracker.flush(t);
    if (finalEntry) flushes.push(finalEntry);
    const latest = flushes[flushes.length - 1];
    assert.ok(latest, 'Expected flushed Replay session');
    assert.equal(latest.countedPlay, true);
    assert.ok(
      latest.listenedSeconds >= 235,
      `Expected ~240s listened, got ${latest.listenedSeconds}`
    );

    const stats = computeYearlyReplayStats([latest], 2026, []);
    assert.equal(stats.totalListeningTimeSec, latest.listenedSeconds);
    assert.ok(Math.round(stats.totalListeningTimeSec / 60) >= 4);
  });
});
