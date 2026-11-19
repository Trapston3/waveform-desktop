import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

import {
  computeMetadataCacheKey,
  readMetadataDiskCache,
  writeMetadataDiskCache,
  scanAudioFolderWithMetadata,
  resolveArtProtocolResponse,
} from '../../electron/localMetadata.ts';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'waveform-meta-test-'));

after(() => {
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
    Buffer.from([0x00]), // ISO-8859-1
    Buffer.from('eng', 'ascii'),
    Buffer.from([0x00]), // empty descriptor
    Buffer.from(lyrics, 'latin1'),
  ]);
  return makeId3v23Frame('USLT', payload);
}

function makeApicFrame(pngBytes) {
  const payload = Buffer.concat([
    Buffer.from([0x00]), // ISO-8859-1
    Buffer.from('image/png\0', 'ascii'),
    Buffer.from([0x03]), // Cover (front)
    Buffer.from([0x00]), // empty description
    pngBytes,
  ]);
  return makeId3v23Frame('APIC', payload);
}

// Minimal 1x1 transparent PNG
const MINIMAL_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex'
);

function buildTestMp3({ title, artist, album, lyrics, pngBytes, frameCount = 40 }) {
  const frames = [];
  if (title) frames.push(makeTextFrame('TIT2', title));
  if (artist) frames.push(makeTextFrame('TPE1', artist));
  if (album) frames.push(makeTextFrame('TALB', album));
  if (lyrics) frames.push(makeUsltFrame(lyrics));
  if (pngBytes) frames.push(makeApicFrame(pngBytes));

  const tagBody = Buffer.concat(frames);
  const id3Header = Buffer.concat([
    Buffer.from('ID3', 'ascii'),
    Buffer.from([0x03, 0x00, 0x00]),
    encodeSyncsafeInt(tagBody.length),
  ]);

  // MPEG1 Layer III, 128kbps, 44100Hz, stereo, no padding => 417 bytes per frame
  const mpegFrame = Buffer.alloc(417, 0);
  mpegFrame[0] = 0xff;
  mpegFrame[1] = 0xfb;
  mpegFrame[2] = 0x90;
  mpegFrame[3] = 0x00;

  const audioFrames = Buffer.concat(Array.from({ length: frameCount }, () => mpegFrame));
  return Buffer.concat([id3Header, tagBody, audioFrames]);
}

test('computeMetadataCacheKey normalizes artist, title, and durationSec', () => {
  const k1 = computeMetadataCacheKey('  Daft Punk ', 'One More Time', 320.4);
  const k2 = computeMetadataCacheKey('daft punk', 'one more time', 320);
  const k3 = computeMetadataCacheKey('daft punk', 'one more time', 321);
  assert.match(k1, /^[0-9a-f]{40}$/);
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);
});

test('readMetadataDiskCache and writeMetadataDiskCache handle miss, write, and merge', async () => {
  const userData = path.join(tmpRoot, 'userdata-cache-test');
  const key = computeMetadataCacheKey('Artist', 'Title', 120);

  const miss = await readMetadataDiskCache(userData, key);
  assert.equal(miss, null);

  await writeMetadataDiskCache(userData, key, { artworkUrl: 'https://example.com/art.jpg' });
  const merged = await writeMetadataDiskCache(userData, key, { lyrics: { lines: ['hello'] } });

  assert.equal(merged.artworkUrl, 'https://example.com/art.jpg');
  assert.deepEqual(merged.lyrics, { lines: ['hello'] });

  const readBack = await readMetadataDiskCache(userData, key);
  assert.deepEqual(readBack, merged);
});

test('scanAudioFolderWithMetadata extracts ID3 tags, art, USLT lyrics, duration, and cached web art', async () => {
  const musicDir = path.join(tmpRoot, 'music');
  const userData = path.join(tmpRoot, 'userdata-scan-test');
  fs.mkdirSync(musicDir, { recursive: true });

  const taggedMp3Path = path.join(musicDir, '01 - Ignored Filename.mp3');
  fs.writeFileSync(
    taggedMp3Path,
    buildTestMp3({
      title: 'Midnight Signal',
      artist: 'Neon Horizon',
      album: 'Night Drive',
      lyrics: 'First line of lyrics\nSecond line of lyrics',
      pngBytes: MINIMAL_PNG,
      frameCount: 40,
    })
  );

  const artlessMp3Path = path.join(musicDir, '02_Solaris - Echoes.mp3');
  fs.writeFileSync(
    artlessMp3Path,
    buildTestMp3({
      title: 'Echoes',
      artist: 'Solaris',
      album: 'Orbit',
      frameCount: 40,
    })
  );

  const firstScan = await scanAudioFolderWithMetadata(musicDir, userData);
  assert.equal(firstScan.length, 2);

  const taggedTrack = firstScan.find((s) => s.title === 'Midnight Signal');
  assert.ok(taggedTrack, 'taggedTrack should be found');
  assert.equal(taggedTrack.artist, 'Neon Horizon');
  assert.equal(taggedTrack.albumName, 'Night Drive');
  assert.ok(taggedTrack.durationSec >= 1, `expected durationSec >= 1, got ${taggedTrack.durationSec}`);
  assert.match(taggedTrack.durationText, /^\d+:\d{2}$/);
  assert.equal(taggedTrack.lyrics, 'First line of lyrics\nSecond line of lyrics');
  assert.equal(
    taggedTrack.thumbnailUrl,
    'waveform-local://art?key=' + encodeURIComponent(taggedTrack.metadataCacheKey)
  );

  const artFile = path.join(userData, 'metadata-cache', 'art', `${taggedTrack.metadataCacheKey}.png`);
  assert.ok(fs.existsSync(artFile), 'embedded PNG art should be written to metadata-cache/art/');

  const artRes = await resolveArtProtocolResponse(
    new URL(`waveform-local://art?key=${taggedTrack.metadataCacheKey}`),
    userData
  );
  assert.equal(artRes.status, 200);
  assert.equal(artRes.headers.get('Content-Type'), 'image/png');
  assert.equal(artRes.headers.get('Access-Control-Allow-Origin'), '*');

  const missRes = await resolveArtProtocolResponse(
    new URL('waveform-local://art?key=nonexistentkey'),
    userData
  );
  assert.equal(missRes.status, 404);
  assert.equal(missRes.headers.get('Access-Control-Allow-Origin'), '*');

  // Populate disk cache for the artless track and verify rescan picks it up
  const artlessTrack = firstScan.find((s) => s.title === 'Echoes');
  assert.ok(artlessTrack);
  assert.equal(artlessTrack.thumbnailUrl, null);

  await writeMetadataDiskCache(userData, artlessTrack.metadataCacheKey, {
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/test/600x600bb.jpg',
  });

  const secondScan = await scanAudioFolderWithMetadata(musicDir, userData);
  const rescannedArtless = secondScan.find((s) => s.title === 'Echoes');
  assert.equal(
    rescannedArtless.thumbnailUrl,
    'https://is1-ssl.mzstatic.com/image/thumb/test/600x600bb.jpg'
  );
});

test('lyricsStore.fetchLyricsForTrack parses embedded plain/LRC lyrics and checks disk cache before network', async () => {
  const bundlePath = path.join(tmpRoot, 'lyricsStore.bundle.mjs');
  await esbuild.build({
    entryPoints: ['src/state/lyricsStore.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundlePath,
  });
  const { useLyricsStore } = await import(pathToFileURL(bundlePath).href);

  const prevWindow = globalThis.window;
  try {
    useLyricsStore.getState().clearLyrics();

    // 1. Embedded plain (UNSYNCED) lyrics
    await useLyricsStore.getState().fetchLyricsForTrack({
      videoId: 'local_plain_1',
      title: 'Plain Track',
      artist: 'Artist A',
      artists: [{ id: null, name: 'Artist A' }],
      artistIds: [],
      totalPlayTimeMs: 0,
      playCount: 0,
      liked: false,
      isExplicit: false,
      lyrics: 'Line one\nLine two',
    });
    let state = useLyricsStore.getState();
    assert.equal(state.lyricsData?.type, 'UNSYNCED');
    assert.equal(state.lyricsData?.provider, 'Embedded');
    assert.equal(state.lyricsData?.isSynced, false);
    assert.equal(state.lyricsData?.lines.length, 2);
    assert.equal(state.lyricsData?.lines[0].text, 'Line one');

    // 2. Embedded LRC (LINE_SYNCED) lyrics
    await useLyricsStore.getState().fetchLyricsForTrack({
      videoId: 'local_lrc_1',
      title: 'Synced Track',
      artist: 'Artist B',
      artists: [{ id: null, name: 'Artist B' }],
      artistIds: [],
      totalPlayTimeMs: 0,
      playCount: 0,
      liked: false,
      isExplicit: false,
      lyrics: '[00:01.00] Hello world\n[00:03.50] Next line',
    });
    state = useLyricsStore.getState();
    assert.equal(state.lyricsData?.type, 'LINE_SYNCED');
    assert.equal(state.lyricsData?.provider, 'Embedded');
    assert.equal(state.lyricsData?.lines.length, 2);
    assert.equal(state.lyricsData?.lines[0].startTimeMs, 1000);

    // 3. Disk cache hit before network
    const cachedLyricsPayload = {
      type: 'LINE_SYNCED',
      provider: 'lrclib',
      lines: [{ lineIndex: 0, startTimeMs: 500, endTimeMs: 2500, text: 'Cached line' }],
    };
    let cacheRequestedWith = null;
    globalThis.window = {
      electronAPI: {
        getMetadataCache: async (arg) => {
          cacheRequestedWith = arg;
          return { lyrics: cachedLyricsPayload };
        },
      },
    };

    await useLyricsStore.getState().fetchLyricsForTrack({
      videoId: 'local_cached_1',
      title: 'Cached Song',
      artist: 'Cached Artist',
      durationSec: 185,
      artists: [{ id: null, name: 'Cached Artist' }],
      artistIds: [],
      totalPlayTimeMs: 185000,
      playCount: 0,
      liked: false,
      isExplicit: false,
      lyrics: null,
    });
    state = useLyricsStore.getState();
    assert.deepEqual(cacheRequestedWith, {
      artist: 'Cached Artist',
      title: 'Cached Song',
      durationSec: 185,
    });
    assert.deepEqual(state.lyricsData, cachedLyricsPayload);
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
    useLyricsStore.getState().clearLyrics();
  }
});
