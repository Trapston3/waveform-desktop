// tests/unit/ml_karaoke_and_autosync.test.mjs
// Unit tests for neural Karaoke DSP blending, Auto-Lyric cross-correlation sync,
// neural downbeat transition windowing, and Rust/TS SyncEngine vocal-silence gaps.

import { describe, test } from 'node:test';
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

const { blendVocalStem, KaraokeProcessor } = await import(
  pathToFileURL(path.join(rootDir, 'src/audio/DspChain.ts')).href
);
const { TransitionProcessor } = await import(
  pathToFileURL(path.join(rootDir, 'src/audio/TransitionProcessor.ts')).href
);
const { estimateLyricOffsetMsFallback } = await import(
  pathToFileURL(path.join(rootDir, 'src/services/MlAudioService.ts')).href
);
const { SyncEngine, clampAutoSyncOffsetMs } = await import(
  pathToFileURL(path.join(rootDir, 'src/lyricVisualizer/core/syncEngine.ts')).href
);

describe('ONNX ML Audio Features: Karaoke DSP, Auto-Lyric Sync & Downbeat Auto-Mix', () => {
  test('blendVocalStem cancels vocals at 0% gain, preserves instruments, and isolates vocals when requested', () => {
    const mixL = new Float32Array([0.8, 0.5, -0.4]);
    const mixR = new Float32Array([0.2, 0.5, -0.4]);
    const voxL = new Float32Array([0.5, 0.3, -0.4]);
    const voxR = new Float32Array([0.5, 0.3, -0.4]);

    // 0% vocal level -> instrumental = mix - vocal
    const inst = blendVocalStem(mixL, mixR, voxL, voxR, 0.0, false);
    assert.ok(Math.abs(inst.leftOut[0] - 0.3) < 1e-5);
    assert.ok(Math.abs(inst.rightOut[0] - -0.3) < 1e-5);
    assert.ok(Math.abs(inst.leftOut[2]) < 1e-5);

    // Isolate vocals at 80%
    const acapella = blendVocalStem(mixL, mixR, voxL, voxR, 0.8, true);
    assert.ok(Math.abs(acapella.leftOut[0] - 0.4) < 1e-5);
    assert.ok(Math.abs(acapella.rightOut[1] - 0.24) < 1e-5);

    // KaraokeProcessor attenuates center vocal tone even in instant Mid/Side DSP mode
    const proc = new KaraokeProcessor(44100);
    proc.enabled = true;
    proc.vocalLevel = 0;
    const len = 4096;
    const sineL = new Float32Array(len);
    const sineR = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const vocal = Math.sin((2 * Math.PI * 1000 * i) / 44100) * 0.6;
      const sideInst = Math.sin((2 * Math.PI * 300 * i) / 44100) * 0.2;
      sineL[i] = vocal + sideInst;
      sineR[i] = vocal - sideInst;
    }
    const { leftOut } = proc.process(sineL, sineR);
    let inE = 0;
    let outE = 0;
    for (let i = 1024; i < len; i++) {
      inE += sineL[i] * sineL[i];
      outE += leftOut[i] * leftOut[i];
    }
    assert.ok(outE < inE * 0.35, `Expected center vocal energy attenuated cleanly (${outE} vs ${inE})`);
  });

  test('estimateLyricOffsetMsFallback recovers planted timing shift between vocal envelope and lyrics', () => {
    const fps = 10;
    const env = new Float32Array(120); // 12 seconds
    // Vocal bursts at [2.5s..4.5s] and [6.5s..8.5s]
    for (let i = 25; i < 45; i++) env[i] = 0.9;
    for (let i = 65; i < 85; i++) env[i] = 0.9;

    // Lyrics planted 1.5s too early -> optimal offset is ~ +1500ms
    const res = estimateLyricOffsetMsFallback(env, fps, [1.0, 5.0]);
    assert.ok(Math.abs(res.offsetMs - 1500) <= 300, `Expected ~+1500ms, got ${res.offsetMs}`);
    assert.ok(res.confidence > 0.2);
  });

  test('SyncEngine applies wide autoSyncOffsetMs + neural vocalSilenceRanges without breaking manual +/-2000ms clamp', () => {
    const engine = new SyncEngine();
    assert.equal(clampAutoSyncOffsetMs(25000), 15000);
    engine.setOffsetMs(500);
    engine.setAutoSyncOffsetMs(4500);
    assert.equal(engine.getEffectiveOffsetMs(), 5000);

    engine.setVocalSilenceRanges([{ startSec: 10.0, endSec: 16.0 }]);
    const lyrics = {
      lines: [
        { startSeconds: 1, endSeconds: 5, text: 'Verse', words: [] },
        { startSeconds: 20, endSeconds: 24, text: 'Chorus', words: [] },
      ],
    };
    const frame = engine.update(
      {
        track: { id: 't1', title: 'T', artist: 'A', durationSeconds: 30 },
        positionSeconds: 12.0,
        isPlaying: true,
        playbackRate: 1,
        timestampMs: 1000,
      },
      lyrics,
      1000
    );
    assert.equal(frame.isInstrumentalGap, true);
  });

  test('TransitionProcessor.findBestDownbeatTransitionWindow picks downbeat aligning with vocal silence', () => {
    const outDownbeats = [148, 152, 156, 160, 164, 168];
    const inDownbeats = [2.0, 4.0, 6.0];
    const vocalSilences = [{ startSec: 159.5, endSec: 172.0 }];
    const win = TransitionProcessor.findBestDownbeatTransitionWindow(
      outDownbeats,
      176,
      inDownbeats,
      4,
      vocalSilences,
      120
    );
    assert.equal(win.alignedToDownbeat, true);
    assert.equal(win.incomingStartSec, 2.0);
    assert.ok(win.outgoingStartSec >= 160, `Expected downbeat in quiet outro (>=160s), got ${win.outgoingStartSec}`);
    assert.ok(win.vocalOverlapSec < 1.5);
  });
});
