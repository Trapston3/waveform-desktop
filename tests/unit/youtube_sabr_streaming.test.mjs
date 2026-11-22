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
  resolveRemoteAudioProxyRequest,
  parseFirstWebmClusterTimecodeMs,
  findWebmClusterSeekSlice,
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

// ---------------------------------------------------------------------------
// 5. Open-ended Range (bytes=0-) never reports truncated chunk as total EOF
// ---------------------------------------------------------------------------

test('resolveYoutubeStreamProtocolRequest serves open-ended Range: bytes=0- with non-truncated total size and clean signal abort', async () => {
  const abortCtrl = new AbortController();
  const openReq = new Request('waveform-stream://yt?v=BjC0KUxiMhc', {
    headers: { Range: 'bytes=0-' },
    signal: abortCtrl.signal,
  });
  const openRes = await resolveYoutubeStreamProtocolRequest(openReq, tmpCacheDir);
  assert.equal(openRes.status, 206);
  const contentRange = openRes.headers.get('content-range') || '';
  const match = contentRange.match(/^bytes 0-(\d+)\/(\d+)$/);
  assert.ok(match, `Expected valid Content-Range header, got "${contentRange}"`);
  const reportedTotal = Number(match[2]);
  assert.ok(
    reportedTotal > 1_000_000,
    `Expected reportedTotal > 1 MB (never a ~128 KB chunk cutoff), got ${reportedTotal}`
  );

  const reader = openRes.body.getReader();
  const firstChunk = await reader.read();
  assert.equal(firstChunk.done, false);
  assert.ok(firstChunk.value.byteLength > 0);
  abortCtrl.abort();
  await reader.cancel().catch(() => {});
});

// ---------------------------------------------------------------------------
// 6. resolveRemoteAudioProxyRequest Range pass-through & CORS headers
// ---------------------------------------------------------------------------

test('resolveRemoteAudioProxyRequest handles OPTIONS, validates target URL, and passes through Range + 206 headers', async () => {
  const optRes = await resolveRemoteAudioProxyRequest(
    new Request('waveform-stream://proxy?url=https%3A%2F%2Fexample.com%2Fa.flac', {
      method: 'OPTIONS',
    })
  );
  assert.equal(optRes.status, 204);
  assert.equal(optRes.headers.get('access-control-allow-origin'), '*');

  const badRes = await resolveRemoteAudioProxyRequest(
    new Request('waveform-stream://proxy?url=ftp%3A%2F%2Fbad.example.com')
  );
  assert.equal(badRes.status, 400);

  const origFetch = globalThis.fetch;
  let capturedHeaders = null;
  globalThis.fetch = async (url, init) => {
    capturedHeaders = init?.headers || {};
    return new Response(new Uint8Array([0x66, 0x4c, 0x61, 0x43, 1, 2, 3, 4]), {
      status: 206,
      headers: {
        'Content-Type': 'audio/flac',
        'Content-Length': '8',
        'Content-Range': 'bytes 0-7/24500000',
        'Accept-Ranges': 'bytes',
      },
    });
  };

  try {
    const proxyReq = new Request(
      'waveform-stream://proxy?url=' + encodeURIComponent('https://cdn.dzr.example.com/track.flac'),
      { headers: { Range: 'bytes=0-7' } }
    );
    const proxyRes = await resolveRemoteAudioProxyRequest(proxyReq);
    assert.equal(proxyRes.status, 206);
    assert.equal(capturedHeaders['Range'], 'bytes=0-7');
    assert.equal(proxyRes.headers.get('content-type'), 'audio/flac');
    assert.equal(proxyRes.headers.get('content-range'), 'bytes 0-7/24500000');
    assert.equal(proxyRes.headers.get('accept-ranges'), 'bytes');
    assert.equal(proxyRes.headers.get('access-control-allow-origin'), '*');
    const body = new Uint8Array(await proxyRes.arrayBuffer());
    assert.equal(body.byteLength, 8);
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ---------------------------------------------------------------------------
// 7. StreamResolver.resolveLosslessStream with TrackMatcher <=5s validation & Electron proxy wrapping
// ---------------------------------------------------------------------------

test('StreamResolver.resolveLosslessStream validates duration <=5s, skips blocked Monochrome hosts, and wraps FLAC URL in Electron', async () => {
  const origFetch = globalThis.fetch;
  const origWindow = globalThis.window;
  const requestedUrls = [];

  globalThis.window = {
    electronAPI: { platform: 'win32' },
  };

  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    requestedUrls.push(urlStr);
    if (urlStr.includes('/search?q=')) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: '991',
              title: 'Midnight City',
              artist: { name: 'M83' },
              duration: 265, // 22s off from 243s -> must be rejected by <=5s guard
              flacUrl: 'https://cdn.dzr.example.com/wrong_duration.flac',
            },
            {
              id: '992',
              title: 'Midnight City',
              artist: { name: 'M83' },
              duration: 244, // 1s off from 243s -> must be accepted
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (urlStr.includes('/track/992')) {
      return new Response(
        JSON.stringify({
          id: '992',
          bitDepth: 24,
          sampleRate: 96000,
          flacUrl: 'https://cdn.dzr.example.com/m83_midnight_city_24_96.flac',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('Not Found', { status: 404 });
  };

  try {
    const resolver = new StreamResolver();
    const lossless = await resolver.resolveLosslessStream({
      videoId: 'dX3k_QDnzHE',
      title: 'Midnight City',
      artist: 'M83',
      durationSec: 243,
    });

    assert.ok(lossless, 'Expected lossless stream to resolve');
    assert.equal(lossless.isLossless, true);
    assert.equal(lossless.isDolbyAtmos, false);
    assert.equal(lossless.format, 'audio/flac');
    assert.equal(lossless.quality, '24-bit / 96kHz FLAC');
    assert.equal(
      lossless.url,
      'waveform-stream://proxy?url=' +
        encodeURIComponent('https://cdn.dzr.example.com/m83_midnight_city_24_96.flac')
    );
    assert.equal(
      requestedUrls.some((u) => u.includes('monochrome.tf') || u.includes('qqdl.site')),
      false,
      'Must never call blocked official Monochrome instances'
    );
  } finally {
    globalThis.fetch = origFetch;
    if (origWindow === undefined) delete globalThis.window;
    else globalThis.window = origWindow;
  }
});

// ---------------------------------------------------------------------------
// 8. WebM Cluster Slicing (?startMs=) & Proxy 200-to-206 Conversion Regressions
// ---------------------------------------------------------------------------

function makeSyntheticWebmCluster(timecodeMs, payloadLen = 32) {
  const tcBytes = [];
  let v = timecodeMs;
  if (v === 0) {
    tcBytes.push(0);
  } else {
    while (v > 0) {
      tcBytes.unshift(v & 0xff);
      v = Math.floor(v / 256);
    }
  }
  const tcElem = Buffer.from([0xe7, 0x80 | tcBytes.length, ...tcBytes]);
  const blockPayload = Buffer.alloc(payloadLen, (timecodeMs & 0xff) || 0x5a);
  const blockElem = Buffer.concat([Buffer.from([0xa3, 0x80 | blockPayload.length]), blockPayload]);
  const body = Buffer.concat([tcElem, blockElem]);
  const sizeHi = 0x40 | ((body.length >> 8) & 0x3f);
  const sizeLo = body.length & 0xff;
  return Buffer.concat([Buffer.from([0x1f, 0x43, 0xb6, 0x75, sizeHi, sizeLo]), body]);
}

test('findWebmClusterSeekSlice and resolveYoutubeStreamProtocolRequest serve exact ?startMs= 206 virtual slices + X-Waveform-Start-Ms', async () => {
  const videoId = 'TestWebmSk1'; // 11 chars
  const initBytes = Buffer.from([
    0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01,
    0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d,
  ]);
  const cluster0 = makeSyntheticWebmCluster(0, 40);
  const cluster10s = makeSyntheticWebmCluster(10000, 48);
  const cluster25s = makeSyntheticWebmCluster(25000, 44);
  const fullWebm = Buffer.concat([initBytes, cluster0, cluster10s, cluster25s]);

  const webmPath = path.join(tmpCacheDir, `${videoId}.webm`);
  const metaPath = path.join(tmpCacheDir, `${videoId}.json`);
  await fs.writeFile(webmPath, fullWebm);
  await fs.writeFile(
    metaPath,
    JSON.stringify({
      videoId,
      mimeType: 'audio/webm',
      contentLength: fullWebm.byteLength,
      durationSec: 40,
      itag: 251,
      ext: 'webm',
      sourceClient: 'TEST',
    })
  );

  assert.equal(parseFirstWebmClusterTimecodeMs(fullWebm), 0);

  const slice = await findWebmClusterSeekSlice(webmPath, 18000);
  assert.ok(slice, 'Expected valid seek slice');
  assert.equal(slice.actualStartMs, 10000, 'Must pick last Cluster with timecodeMs <= 18000');
  assert.deepEqual(Buffer.from(slice.initBytes), initBytes);
  assert.equal(slice.clusterOffset, initBytes.byteLength + cluster0.byteLength);
  const expectedVirtual = Buffer.concat([initBytes, cluster10s, cluster25s]);
  assert.equal(slice.totalLength, expectedVirtual.byteLength);
  assert.equal(parseFirstWebmClusterTimecodeMs(expectedVirtual), 10000);

  // Request across initBytes + cluster10s boundary
  const req = new Request(`waveform-stream://yt?v=${videoId}&startMs=18000`, {
    headers: { Range: `bytes=10-${expectedVirtual.byteLength - 1}` },
  });
  const res = await resolveYoutubeStreamProtocolRequest(req, tmpCacheDir);
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('x-waveform-start-ms'), '10000');
  assert.ok(
    (res.headers.get('access-control-expose-headers') || '').includes('X-Waveform-Start-Ms'),
    'Access-Control-Expose-Headers must expose X-Waveform-Start-Ms'
  );
  assert.equal(
    res.headers.get('content-range'),
    `bytes 10-${expectedVirtual.byteLength - 1}/${expectedVirtual.byteLength}`
  );
  assert.equal(res.headers.get('content-length'), String(expectedVirtual.byteLength - 10));
  const body = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(body, expectedVirtual.subarray(10));
});

test('resolveRemoteAudioProxyRequest converts upstream 200 OK to strict HTTP 206 Partial Content via disk cache', async () => {
  const origFetch = globalThis.fetch;
  const payload = new Uint8Array(4096);
  for (let i = 0; i < payload.byteLength; i++) {
    payload[i] = (i * 17 + 3) & 0xff;
  }

  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    // Upstream ignores Range header and returns full 200 OK
    return new Response(payload, {
      status: 200,
      headers: {
        'Content-Type': 'audio/flac',
        'Content-Length': String(payload.byteLength),
      },
    });
  };

  const targetUrl = 'https://cdn.example.com/no-range-support.flac';
  try {
    const req1 = new Request(
      'waveform-stream://proxy?url=' + encodeURIComponent(targetUrl),
      { headers: { Range: 'bytes=128-383' } }
    );
    const res1 = await resolveRemoteAudioProxyRequest(req1, tmpCacheDir);
    assert.equal(res1.status, 206, 'Client Range request must receive 206 even when upstream replies 200 OK');
    assert.equal(res1.headers.get('accept-ranges'), 'bytes');
    assert.equal(res1.headers.get('content-range'), 'bytes 128-383/4096');
    assert.equal(res1.headers.get('content-length'), '256');
    const buf1 = new Uint8Array(await res1.arrayBuffer());
    assert.deepEqual(buf1, payload.subarray(128, 384));

    // Subsequent Range request should hit cached proxy file cleanly without re-fetching upstream
    const req2 = new Request(
      'waveform-stream://proxy?url=' + encodeURIComponent(targetUrl),
      { headers: { Range: 'bytes=1024-' } }
    );
    const res2 = await resolveRemoteAudioProxyRequest(req2, tmpCacheDir);
    assert.equal(res2.status, 206);
    assert.equal(res2.headers.get('content-range'), 'bytes 1024-4095/4096');
    assert.equal(res2.headers.get('content-length'), '3072');
    const buf2 = new Uint8Array(await res2.arrayBuffer());
    assert.deepEqual(buf2, payload.subarray(1024));
    assert.equal(fetchCount, 1, 'Proxy cache must deduplicate subsequent range requests');
  } finally {
    globalThis.fetch = origFetch;
  }
});
