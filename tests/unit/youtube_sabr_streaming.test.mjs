// tests/unit/youtube_sabr_streaming.test.mjs
// Unit & live integration tests for YouTube SABR streaming, header scoping, and Range protocol handler

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';

// Register ESM resolution hook so Node can resolve extensionless relative .ts imports
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

const { applyYouTubeAuthHeaders } = await import('../../electron/accountAuth.ts');
const {
  resolveYoutubeStreamForIpc,
  resolveYoutubeStreamProtocolRequest,
  destroyAllSabrStreams,
} = await import('../../electron/youtubeSabrStream.ts');
const { StreamResolver } = await import('../../src/services/StreamResolver.ts');

const tmpCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waveform-sabr-test-'));

after(async () => {
  await destroyAllSabrStreams();
  await fs.rm(tmpCacheDir, { recursive: true, force: true }).catch(() => {});
});

// ---------------------------------------------------------------------------
// 1. Header Scoping: music.youtube.com ONLY (skip www.youtube.com)
// ---------------------------------------------------------------------------

test('applyYouTubeAuthHeaders injects auth on music.youtube.com and skips www.youtube.com/youtubei/v1/player', () => {
  const ytCookie = 'VISITOR_INFO1_LIVE=xyz; SAPISID=sabr_test_sapisid; HSID=999';

  const musicHeaders = applyYouTubeAuthHeaders(
    'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false',
    { 'Content-Type': 'application/json' },
    ytCookie
  );
  assert.equal(musicHeaders['Cookie'], ytCookie);
  assert.equal(musicHeaders['Origin'], 'https://music.youtube.com');
  assert.equal(musicHeaders['Referer'], 'https://music.youtube.com/');
  assert.match(musicHeaders['Authorization'], /^SAPISIDHASH \d+_[a-f0-9]{40}$/);

  const wwwPlayerHeaders = applyYouTubeAuthHeaders(
    'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
    { 'Content-Type': 'application/json', Origin: 'https://www.youtube.com' },
    ytCookie
  );
  assert.equal(wwwPlayerHeaders['Cookie'], undefined);
  assert.equal(wwwPlayerHeaders['Authorization'], undefined);
  assert.equal(wwwPlayerHeaders['X-Origin'], undefined);
  assert.equal(wwwPlayerHeaders['X-Goog-AuthUser'], undefined);
  assert.equal(wwwPlayerHeaders['Origin'], 'https://www.youtube.com');
  assert.equal(wwwPlayerHeaders['Content-Type'], 'application/json');
});

// ---------------------------------------------------------------------------
// 2. Protocol handler rejects invalid video IDs with 400
// ---------------------------------------------------------------------------

test('resolveYoutubeStreamProtocolRequest returns HTTP 400 for invalid video IDs', async () => {
  const req = new Request('http://waveform-stream.local/yt?v=bad_id');
  const res = await resolveYoutubeStreamProtocolRequest(req, tmpCacheDir);
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

// ---------------------------------------------------------------------------
// 3. StreamResolver uses Electron IPC resolveYoutubeStream when available
// ---------------------------------------------------------------------------

test('StreamResolver routes direct videoId through window.electronAPI.resolveYoutubeStream in Electron', async () => {
  const prevWindow = globalThis.window;
  let calledWith = null;
  globalThis.window = {
    electronAPI: {
      resolveYoutubeStream: async (videoId) => {
        calledWith = videoId;
        return {
          streamUrl: `waveform-stream://yt?v=${encodeURIComponent(videoId)}`,
          mimeType: 'audio/webm',
          durationSec: 185,
          sourceClient: 'ANDROID_VR',
          cached: false,
        };
      },
    },
  };

  try {
    const resolver = new StreamResolver();
    const resolved = await resolver.resolve('BjC0KUxiMhc', 'Subways of Your Mind', 'FEX');
    assert.equal(calledWith, 'BjC0KUxiMhc');
    assert.equal(resolved.url, 'waveform-stream://yt?v=BjC0KUxiMhc');
    assert.equal(resolved.format, 'audio/webm');
    assert.equal(resolved.durationMs, 185000);
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  }
});

// ---------------------------------------------------------------------------
// 4. Live SABR Streaming Tests: BjC0KUxiMhc (Lostwave) & 2UF4DOVqDHI
// ---------------------------------------------------------------------------

for (const { videoId, label } of [
  { videoId: 'BjC0KUxiMhc', label: 'Subways of Your Mind (Lostwave)' },
  { videoId: '2UF4DOVqDHI', label: '2UF4DOVqDHI' },
]) {
  test(`Live SABR stream for ${videoId} (${label}) exceeds 1.5 MB and serves HTTP 206 start & mid-track ranges`, async () => {
    const ipcResult = await resolveYoutubeStreamForIpc(videoId, tmpCacheDir);
    assert.equal(ipcResult.streamUrl, `waveform-stream://yt?v=${encodeURIComponent(videoId)}`);
    assert.match(ipcResult.mimeType, /^audio\//);

    // 1. Initial range: bytes=0-65535
    const startReq = new Request(`waveform-stream://yt?v=${videoId}`, {
      headers: { Range: 'bytes=0-65535' },
    });
    const startRes = await resolveYoutubeStreamProtocolRequest(startReq, tmpCacheDir);
    assert.equal(startRes.status, 206, `Expected 206 for start range of ${videoId}`);
    assert.equal(startRes.headers.get('accept-ranges'), 'bytes');
    assert.equal(startRes.headers.get('access-control-allow-origin'), '*');
    assert.match(startRes.headers.get('content-range') || '', /^bytes 0-65535\/\d+$/);
    const startBuf = new Uint8Array(await startRes.arrayBuffer());
    assert.equal(startBuf.byteLength, 65536);

    // 2. Mid-track seek past the 1 MB cutoff: bytes=1200000-1265535
    const midReq = new Request(`waveform-stream://yt?v=${videoId}`, {
      headers: { Range: 'bytes=1200000-1265535' },
    });
    const midRes = await resolveYoutubeStreamProtocolRequest(midReq, tmpCacheDir);
    if (midRes.status !== 206) {
      const errBody = await midRes.text().catch(() => '');
      assert.fail(`Expected 206 for mid-track range of ${videoId}, got ${midRes.status}: ${errBody}`);
    }
    assert.match(midRes.headers.get('content-range') || '', /^bytes 1200000-1265535\/\d+$/);
    const midBuf = new Uint8Array(await midRes.arrayBuffer());
    assert.equal(midBuf.byteLength, 65536);

    // 3. Prove > 1.5 MB is fetched via SABR (defeating the 1 MB 403 cutoff)
    const past15MbReq = new Request(`waveform-stream://yt?v=${videoId}`, {
      headers: { Range: 'bytes=1572864-1605631' }, // 1.5 MB + 32 KB
    });
    const past15MbRes = await resolveYoutubeStreamProtocolRequest(past15MbReq, tmpCacheDir);
    if (past15MbRes.status !== 206) {
      const errBody = await past15MbRes.text().catch(() => '');
      assert.fail(`Expected 206 past 1.5 MB for ${videoId}, got ${past15MbRes.status}: ${errBody}`);
    }
    const past15MbBuf = new Uint8Array(await past15MbRes.arrayBuffer());
    assert.equal(past15MbBuf.byteLength, 32768);
  });
}
