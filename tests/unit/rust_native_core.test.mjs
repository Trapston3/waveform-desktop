import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';

// Register ESM resolution hook so relative .ts imports without extensions (like DspChain -> AutoEqLoader) resolve cleanly
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

const {
  getNativeCore,
  isNativeCoreLoaded,
  getNativeCoreInfo,
  resetNativeCoreForTests,
} = await import('../../electron/nativeCore.ts');

const {
  prewarmAutoEqDb,
  getAutoEqStatus,
  searchAutoEqDb,
  getAutoEqProfile,
} = await import('../../electron/autoEqDb.ts');

const {
  scanAudioFolderWithMetadata,
  incrementalScanLocalFolders,
  writeMetadataDiskCache,
} = await import('../../electron/localMetadata.ts');

const {
  computeBiquadMagnitudeDb,
  computeSvfEqMagnitudeDb,
  registerNativeDspAccelerator,
} = await import('../../src/audio/DspChain.ts');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'waveform-rust-core-test-'));

after(() => {
  registerNativeDspAccelerator(null);
  delete process.env.WAVEFORM_NATIVE_CORE_PATH;
  resetNativeCoreForTests();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function encodeSyncsafeInt(value) {
  return Buffer.from([
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f,
  ]);
}

function makeId3v23Frame(id, payload) {
  const header = Buffer.alloc(10);
  header.write(id, 0, 4, 'ascii');
  header.writeUInt32BE(payload.length, 4);
  header.writeUInt16BE(0, 8);
  return Buffer.concat([header, payload]);
}

function makeTextFrame(id, text) {
  return makeId3v23Frame(id, Buffer.concat([Buffer.from([0x00]), Buffer.from(text, 'latin1')]));
}

function makeUsltFrame(lyrics) {
  const payload = Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from('eng', 'ascii'),
    Buffer.from([0x00]),
    Buffer.from(lyrics, 'latin1'),
  ]);
  return makeId3v23Frame('USLT', payload);
}

function makeApicFrame(pngBytes) {
  const payload = Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from('image/png\0', 'ascii'),
    Buffer.from([0x03]),
    Buffer.from([0x00]),
    pngBytes,
  ]);
  return makeId3v23Frame('APIC', payload);
}

const MINIMAL_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex'
);

function buildTestMp3({ title, artist, album, trackNumber = 1, year = '2024', lyrics, pngBytes, frameCount = 40 }) {
  const frames = [];
  if (title) frames.push(makeTextFrame('TIT2', title));
  if (artist) {
    frames.push(makeTextFrame('TPE1', artist));
    frames.push(makeTextFrame('TPE2', artist));
  }
  if (album) frames.push(makeTextFrame('TALB', album));
  if (trackNumber) frames.push(makeTextFrame('TRCK', String(trackNumber)));
  if (year) frames.push(makeTextFrame('TYER', String(year)));
  if (lyrics) frames.push(makeUsltFrame(lyrics));
  if (pngBytes) frames.push(makeApicFrame(pngBytes));

  const tagBody = Buffer.concat(frames);
  const id3Header = Buffer.concat([
    Buffer.from('ID3', 'ascii'),
    Buffer.from([0x03, 0x00, 0x00]),
    encodeSyncsafeInt(tagBody.length),
  ]);

  const mpegFrame = Buffer.alloc(417, 0);
  mpegFrame[0] = 0xff;
  mpegFrame[1] = 0xfb;
  mpegFrame[2] = 0x90;
  mpegFrame[3] = 0x00;

  return Buffer.concat([id3Header, tagBody, ...Array.from({ length: frameCount }, () => mpegFrame)]);
}

test('nativeCore loads live waveform-core.node and supports WAVEFORM_NATIVE_CORE_PATH=disabled toggle', () => {
  delete process.env.WAVEFORM_NATIVE_CORE_PATH;
  resetNativeCoreForTests();

  const core = getNativeCore();
  assert.ok(core, 'Expected live waveform-core.win32-x64-msvc.node to load');
  assert.equal(isNativeCoreLoaded(), true);

  const info = getNativeCoreInfo();
  assert.equal(info.loaded, true);
  assert.equal(info.version, '0.1.0');
  assert.ok(info.path && info.path.endsWith('waveform-core.win32-x64-msvc.node'));

  process.env.WAVEFORM_NATIVE_CORE_PATH = 'disabled';
  resetNativeCoreForTests();
  assert.equal(getNativeCore(), null);
  assert.equal(isNativeCoreLoaded(), false);

  delete process.env.WAVEFORM_NATIVE_CORE_PATH;
  resetNativeCoreForTests();
  assert.ok(getNativeCore());
});

test('AutoEQ native core + TS bridge + JS fallback match contracts across 17,703 rows', async () => {
  delete process.env.WAVEFORM_NATIVE_CORE_PATH;
  resetNativeCoreForTests();

  const status = await prewarmAutoEqDb();
  assert.equal(status.ready, true);
  assert.equal(status.totalRows, 17703);
  assert.equal(status.parametricRows, 8850);
  assert.equal(status.totalCount, 17703);
  assert.equal(status.parametricCount, 8850);

  const syncStatus = getAutoEqStatus();
  assert.equal(syncStatus.totalCount, 17703);
  assert.equal(syncStatus.parametricCount, 8850);

  const t0 = performance.now();
  const hits = searchAutoEqDb('sony whch-720n', 10);
  const searchMs = performance.now() - t0;
  assert.ok(hits.length > 0);
  assert.equal(hits[0].name, 'Sony WH-CH720N');
  assert.equal(hits[0].parametric, true);
  assert.ok(searchMs < 15, `Native search took ${searchMs.toFixed(2)}ms`);

  const salnotes = getAutoEqProfile('7Hz Salnotes Zero');
  assert.ok(salnotes);
  assert.equal(salnotes.parametric, true);
  assert.equal(salnotes.filters.length, 10);
  assert.ok(salnotes.preampGainDb <= 0);

  // Security sanitization checks
  assert.equal(getAutoEqProfile("' OR '1'='1"), null);
  assert.equal(searchAutoEqDb("'; DROP TABLE eq_presets; --").length, 0);
  assert.equal(getAutoEqProfile('Audeze\0LCD-X'), null);
  const rtl = getAutoEqProfile('\u202ESONY\u202C');
  assert.ok(rtl && rtl.name.toLowerCase().includes('sony'));

  // Verify JS fallback when WAVEFORM_NATIVE_CORE_PATH=disabled
  process.env.WAVEFORM_NATIVE_CORE_PATH = 'disabled';
  resetNativeCoreForTests();
  const fbStatus = getAutoEqStatus();
  assert.equal(fbStatus.ready, true);
  assert.equal(fbStatus.totalCount, 17703);
  assert.equal(fbStatus.parametricCount, 8850);
  const fbHits = searchAutoEqDb('sony whch-720n', 5);
  assert.equal(fbHits[0].name, 'Sony WH-CH720N');
  const fbProfile = getAutoEqProfile('7Hz Salnotes Zero');
  assert.ok(fbProfile && fbProfile.filters.length === 10);

  delete process.env.WAVEFORM_NATIVE_CORE_PATH;
  resetNativeCoreForTests();
});

test('Scanner native core + TS bridge + JS fallback extract tags, SHA-256 art, disk enrichment, and incremental diffs', async () => {
  const musicDir = path.join(tmpRoot, 'music');
  const albumDir = path.join(musicDir, 'CoverSub');
  const userDataNative = path.join(tmpRoot, 'userdata-native');
  const userDataFallback = path.join(tmpRoot, 'userdata-fallback');
  fs.mkdirSync(albumDir, { recursive: true });

  const mp3A = path.join(musicDir, '01 - Track A.mp3');
  const mp3B = path.join(musicDir, '02 - Track B.mp3');
  const mp3C = path.join(albumDir, '03 - Track C.mp3');

  fs.writeFileSync(
    mp3A,
    buildTestMp3({
      title: 'Rust Signal',
      artist: 'Core Band',
      album: 'Native LP',
      trackNumber: 1,
      lyrics: 'Line A\nLine B',
      pngBytes: MINIMAL_PNG,
    })
  );
  fs.writeFileSync(
    mp3B,
    buildTestMp3({
      title: 'Artless Echo',
      artist: 'Ghost Artist',
      album: 'Orbit',
      trackNumber: 2,
    })
  );
  fs.writeFileSync(path.join(albumDir, 'cover.png'), MINIMAL_PNG);
  fs.writeFileSync(
    mp3C,
    buildTestMp3({
      title: 'Folder Cover Track',
      artist: 'Cover Artist',
      album: 'Cover Sub',
      trackNumber: 3,
    })
  );

  // 1. Live native scan
  delete process.env.WAVEFORM_NATIVE_CORE_PATH;
  resetNativeCoreForTests();
  const tracks = await scanAudioFolderWithMetadata(musicDir, userDataNative);
  assert.equal(tracks.length, 3);

  const trackA = tracks.find((t) => t.title === 'Rust Signal');
  assert.ok(trackA);
  assert.match(trackA.videoId, /^local_[0-9a-f]{20}$/);
  assert.match(trackA.artistId, /^local_art_[0-9a-f]{14}$/);
  assert.match(trackA.albumId, /^local_alb_[0-9a-f]{14}$/);
  assert.match(trackA.artworkHash, /^[0-9a-f]{40}$/);
  assert.equal(trackA.lyrics, 'Line A\nLine B');
  assert.ok(fs.existsSync(path.join(userDataNative, 'artwork-cache', `${trackA.artworkHash}.png`)));

  const trackC = tracks.find((t) => t.title === 'Folder Cover Track');
  assert.equal(trackC.artworkHash, trackA.artworkHash);

  const trackB = tracks.find((t) => t.title === 'Artless Echo');
  assert.equal(trackB.thumbnailUrl, null);

  // Disk metadata cache enrichment for artless track
  await writeMetadataDiskCache(userDataNative, trackB.metadataCacheKey, {
    artworkUrl: 'https://example.com/enriched.jpg',
  });
  const rescanned = await scanAudioFolderWithMetadata(musicDir, userDataNative);
  assert.equal(
    rescanned.find((t) => t.title === 'Artless Echo').thumbnailUrl,
    'https://example.com/enriched.jpg'
  );

  // Incremental scan (add -> unchanged -> update + delete)
  const inc1 = await incrementalScanLocalFolders(userDataNative, [musicDir]);
  assert.equal(inc1.added, 3);
  assert.equal(inc1.updated, 0);
  assert.equal(inc1.removed, 0);

  const inc2 = await incrementalScanLocalFolders(userDataNative);
  assert.equal(inc2.added, 0);
  assert.equal(inc2.updated, 0);
  assert.equal(inc2.removed, 0);

  fs.writeFileSync(
    mp3A,
    buildTestMp3({
      title: 'Rust Signal Remastered',
      artist: 'Core Band',
      album: 'Native LP',
      trackNumber: 1,
      frameCount: 60,
    })
  );
  fs.unlinkSync(mp3B);

  const inc3 = await incrementalScanLocalFolders(userDataNative);
  assert.equal(inc3.added, 0);
  assert.equal(inc3.updated, 1);
  assert.equal(inc3.removed, 1);
  assert.equal(inc3.tracks.length, 2);
  assert.ok(inc3.tracks.some((t) => t.title === 'Rust Signal Remastered'));

  // 2. Fallback scan with WAVEFORM_NATIVE_CORE_PATH=disabled
  process.env.WAVEFORM_NATIVE_CORE_PATH = 'disabled';
  resetNativeCoreForTests();
  const fbTracks = await scanAudioFolderWithMetadata(musicDir, userDataFallback);
  assert.equal(fbTracks.length, 2);
  assert.ok(fbTracks.some((t) => t.title === 'Rust Signal Remastered'));

  delete process.env.WAVEFORM_NATIVE_CORE_PATH;
  resetNativeCoreForTests();
});

test('DSP native core matches JS computeBiquadMagnitudeDb & computeSvfEqMagnitudeDb within 1e-6 dB and analyzes audio frames', () => {
  delete process.env.WAVEFORM_NATIVE_CORE_PATH;
  resetNativeCoreForTests();
  const core = getNativeCore();
  assert.ok(core);

  const filters = [
    { type: 'LOW_SHELF', freq: 105, q: 0.71, gainDb: -4.5 },
    { type: 'PEAKING', freq: 1000, q: 2.0, gainDb: 6.0 },
    { type: 'HIGH_SHELF', freq: 10000, q: 0.707, gainDb: 4.0 },
    { type: 'LOW_PASS', freq: 16000, q: 0.707, gainDb: 0.0 },
    { type: 'HIGH_PASS', freq: 30, q: 0.707, gainDb: 0.0 },
    { type: 'BAND_PASS', freq: 2500, q: 1.5, gainDb: 0.0 },
  ];
  const freqs = [20, 60, 105, 500, 1000, 3200, 10000, 18000];

  const jsBiquad = computeBiquadMagnitudeDb(filters, -3.5, freqs, 48000);
  const rustBiquad = core.computeBiquadMagnitudeDb(filters, freqs, 48000, -3.5);
  assert.equal(rustBiquad.length, freqs.length);
  for (let i = 0; i < freqs.length; i++) {
    assert.ok(
      Math.abs(jsBiquad[i] - rustBiquad[i]) < 1e-6,
      `Biquad mismatch at ${freqs[i]}Hz: JS=${jsBiquad[i]} Rust=${rustBiquad[i]}`
    );
  }

  const bands10 = [5.0, 3.0, 1.0, 0.0, -2.0, 1.5, 3.0, 4.0, 2.0, -1.5];
  const jsSvf = computeSvfEqMagnitudeDb(bands10, freqs, 44100, 2.0, -1.0);
  const rustSvf = core.computeSvfEqMagnitudeDb(bands10, freqs, 44100, 2.0, -1.0);
  assert.equal(rustSvf.length, freqs.length);
  for (let i = 0; i < freqs.length; i++) {
    assert.ok(
      Math.abs(jsSvf[i] - rustSvf[i]) < 1e-6,
      `SVF mismatch at ${freqs[i]}Hz: JS=${jsSvf[i]} Rust=${rustSvf[i]}`
    );
  }

  // Test registerNativeDspAccelerator hook in DspChain.ts
  registerNativeDspAccelerator({
    computeBiquadMagnitudeDb: (f, fr, sr, p) => core.computeBiquadMagnitudeDb(f, fr, sr, p),
    computeSvfEqMagnitudeDb: (b, fr, sr, tb, tt) =>
      core.computeSvfEqMagnitudeDb(b, fr, sr, tb, tt),
  });
  const hookedBiquad = computeBiquadMagnitudeDb(filters, -3.5, freqs, 48000);
  const hookedSvf = computeSvfEqMagnitudeDb(bands10, freqs, 44100, 2.0, -1.0);
  assert.deepEqual(hookedBiquad, rustBiquad);
  assert.deepEqual(hookedSvf, rustSvf);
  registerNativeDspAccelerator(null);

  // Test analyzeAudioFrame
  const sr = 44100;
  const pcm = new Float32Array(1024);
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = 0.75 * Math.sin((2 * Math.PI * 90 * i) / sr);
  }
  const frame1 = core.analyzeAudioFrame(pcm, sr);
  assert.equal(frame1.spectrum32.length, 32);
  assert.ok(frame1.rms > 0.4);
  assert.ok(frame1.bass > frame1.treble);
  assert.ok(frame1.estimatedBpm >= 65 && frame1.estimatedBpm <= 185);
});

test('ONNX engine validates model protobufs and runs graceful spectral-flux beat fallback without onnxruntime.dll', async () => {
  delete process.env.WAVEFORM_NATIVE_CORE_PATH;
  resetNativeCoreForTests();
  const core = getNativeCore();
  assert.ok(core);

  const status = await core.onnxInitModels(path.resolve('src/assets/data'));
  assert.equal(status.beatModelValid, true);
  assert.ok(status.beatModelBytes > 20_000_000);
  assert.equal(status.vocalsModelValid, true);
  assert.ok(status.vocalsModelBytes > 8_000_000);

  const st2 = core.onnxStatus();
  assert.equal(st2.beatModelValid, true);
  assert.equal(st2.vocalsModelValid, true);

  const frames = 100;
  const spec = new Float32Array(frames * 128).fill(0.05);
  for (let t = 5; t < frames; t += 25) {
    for (let b = 0; b < 32; b++) {
      spec[t * 128 + b] = 2.5;
    }
  }
  const beatRes = core.onnxInferBeats(spec, frames, 22050);
  assert.equal(beatRes.beatProbabilities.length, frames);
  assert.ok(beatRes.beatTimesSec.length > 0);
  assert.ok(beatRes.estimatedBpm >= 65 && beatRes.estimatedBpm <= 185);

  const tinyMix = new Float32Array(2 * 2049 * 4).fill(0.1);
  const vocalsRes = core.onnxInferVocalsMask(tinyMix, 4);
  assert.equal(vocalsRes.freqBins, 2049);
  assert.equal(vocalsRes.channels, 2);
});
