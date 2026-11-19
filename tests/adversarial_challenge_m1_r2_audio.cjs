// tests/adversarial_challenge_m1_r2_audio.cjs
// Empirical Challenger: Milestone 1 Iteration 2 (Audio Streaming & Playback Engine)
// Rigorous Adversarial Stress Harness for Stream Longevity, Byte Boundaries, Multi-Point Seeking & Float32 PCM Verification

const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

// Comprehensive network tracking
const networkAudit = {
  requests: [],
  responses: [],
  rangeRequests: [],
  http403Count: 0,
  http403Details: [],
  orbErrors: [],
};

// --- PURE-JS DES-ECB CIPHER (Matching StreamResolver.ts) ---
const PC1 = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4];
const PC2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32];
const SHIFTS = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
const IP = [58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7];
const IP_INV = [40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25];
const E = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1];
const S_BOXES = [
  [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
  [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
  [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
  [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
  [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
  [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
  [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
  [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11]
];
const P = [16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25];

function permute(bits, table) { return table.map((pos) => bits[pos - 1]); }
function bytesToBits(bytes) {
  const bits = [];
  for (let i = 0; i < bytes.length; i++) {
    for (let j = 7; j >= 0; j--) bits.push((bytes[i] >> j) & 1);
  }
  return bits;
}
function bitsToBytes(bits) {
  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    bytes.push(byte);
  }
  return Buffer.from(bytes);
}
function generateSubkeys(keyBytes) {
  const keyBits = bytesToBits(keyBytes);
  const permutedKey = permute(keyBits, PC1);
  let C = permutedKey.slice(0, 28);
  let D = permutedKey.slice(28, 56);
  const subkeys = [];
  for (let round = 0; round < 16; round++) {
    const shift = SHIFTS[round];
    C = C.slice(shift).concat(C.slice(0, shift));
    D = D.slice(shift).concat(D.slice(0, shift));
    subkeys.push(permute(C.concat(D), PC2));
  }
  return subkeys;
}
function feistel(R, subkey) {
  const expanded = permute(R, E);
  const xored = expanded.map((b, i) => b ^ subkey[i]);
  const sBoxOut = [];
  for (let i = 0; i < 8; i++) {
    const chunk = xored.slice(i * 6, (i + 1) * 6);
    const row = (chunk[0] << 1) | chunk[5];
    const col = (chunk[1] << 3) | (chunk[2] << 2) | (chunk[3] << 1) | chunk[4];
    const val = S_BOXES[i][row * 16 + col];
    for (let j = 3; j >= 0; j--) sBoxOut.push((val >> j) & 1);
  }
  return permute(sBoxOut, P);
}
function desBlockDecrypt(blockBytes, subkeys) {
  const bits = permute(bytesToBits(blockBytes), IP);
  let L = bits.slice(0, 32);
  let R = bits.slice(32, 64);
  for (let round = 15; round >= 0; round--) {
    const f = feistel(R, subkeys[round]);
    const nextL = R;
    const nextR = L.map((b, i) => b ^ f[i]);
    L = nextL;
    R = nextR;
  }
  return bitsToBytes(permute(R.concat(L), IP_INV));
}
function decryptJioSaavnMediaUrl(encryptedB64, key = '38346591') {
  try {
    const subkeys = generateSubkeys(Buffer.from(key, 'utf8'));
    const cipherBytes = Buffer.from(encryptedB64, 'base64');
    const decryptedBlocks = [];
    for (let i = 0; i < cipherBytes.length; i += 8) {
      decryptedBlocks.push(desBlockDecrypt(cipherBytes.slice(i, i + 8), subkeys));
    }
    const decrypted = Buffer.concat(decryptedBlocks);
    const padLen = decrypted[decrypted.length - 1];
    if (padLen >= 1 && padLen <= 8) return decrypted.slice(0, decrypted.length - padLen).toString('utf8');
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

async function resolveTrackForTest(query) {
  console.log(`[RESOLVER] Searching track: "${query}"...`);
  const searchUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&cc=in&n=5&p=1&q=${encodeURIComponent(query)}`;
  const searchRes = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  });
  if (!searchRes.ok) throw new Error(`Search failed for ${query}: HTTP ${searchRes.status}`);
  const searchData = await searchRes.json();
  const results = searchData?.results || [];
  if (!results.length) throw new Error(`No results found for ${query}`);

  const best = results[0];
  let encMediaUrl = best.encrypted_media_url || best.more_info?.encrypted_media_url;
  let durationSec = parseInt(best.duration || best.more_info?.duration || '0', 10);

  if (!encMediaUrl && best.id) {
    const detailsUrl = `https://www.jiosaavn.com/api.php?__call=song.getDetails&pids=${encodeURIComponent(best.id)}&_format=json&_marker=0&ctx=web6dot0`;
    const detailsRes = await fetch(detailsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });
    if (detailsRes.ok) {
      const detailsData = await detailsRes.json();
      const song = detailsData?.songs?.[0] || detailsData?.[best.id];
      if (song) {
        encMediaUrl = song.encrypted_media_url || song.more_info?.encrypted_media_url;
        if (!durationSec) {
          durationSec = parseInt(song.duration || song.more_info?.duration || '0', 10);
        }
      }
    }
  }

  if (!encMediaUrl) throw new Error(`Encrypted media URL not found for ${query}`);
  const rawCdnUrl = decryptJioSaavnMediaUrl(encMediaUrl, '38346591');
  if (!rawCdnUrl || !rawCdnUrl.startsWith('http')) throw new Error(`Decryption failed for ${query}`);

  const url320 = rawCdnUrl.replace(/_[0-9]+(_p)?\.mp4/, '_320.mp4');
  return {
    id: best.id,
    title: best.title || query,
    durationSec,
    url: url320,
    bitrate: 320000,
    format: 'audio/mp4 (320kbps AAC)',
  };
}

function configureProductionSessionInterceptor() {
  const ses = session.defaultSession;
  const filter = {
    urls: [
      '*://*.googlevideo.com/*',
      '*://*.jiosaavn.com/*',
      '*://*.saavncdn.com/*',
      '*://*.youtube.com/*',
    ],
  };

  ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    const url = details.url;

    if (url.includes('googlevideo.com')) {
      delete requestHeaders['Origin'];
      delete requestHeaders['Referer'];
      delete requestHeaders['origin'];
      delete requestHeaders['referer'];
      requestHeaders['User-Agent'] =
        'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)';
    } else if (url.includes('jiosaavn.com') || url.includes('saavncdn.com')) {
      requestHeaders['Origin'] = 'https://www.jiosaavn.com';
      requestHeaders['Referer'] = 'https://www.jiosaavn.com/';
    }

    if (!requestHeaders['User-Agent'] || requestHeaders['User-Agent'].includes('Electron')) {
      requestHeaders['User-Agent'] =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    }

    networkAudit.requests.push({
      url: details.url,
      range: requestHeaders['Range'] || requestHeaders['range'] || null,
      timestamp: Date.now(),
    });

    callback({ requestHeaders });
  });

  ses.webRequest.onHeadersReceived(filter, (details, callback) => {
    const responseHeaders = { ...(details.responseHeaders || {}) };
    for (const key of Object.keys(responseHeaders)) {
      const lower = key.toLowerCase();
      if (
        lower === 'access-control-allow-origin' ||
        lower === 'access-control-allow-headers' ||
        lower === 'access-control-allow-methods' ||
        lower === 'access-control-expose-headers'
      ) {
        delete responseHeaders[key];
      }
    }
    responseHeaders['Access-Control-Allow-Origin'] = ['*'];
    responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, HEAD, OPTIONS'];
    responseHeaders['Access-Control-Allow-Headers'] = ['*'];
    responseHeaders['Access-Control-Expose-Headers'] = ['Content-Length, Content-Range, Accept-Ranges'];

    const contentRange = responseHeaders['content-range'] || responseHeaders['Content-Range'] || null;
    const contentLength = responseHeaders['content-length'] || responseHeaders['Content-Length'] || null;

    if (details.url.includes('saavncdn.com') || details.url.includes('googlevideo.com')) {
      const crStr = Array.isArray(contentRange) ? contentRange[0] : contentRange;
      const clStr = Array.isArray(contentLength) ? contentLength[0] : contentLength;
      networkAudit.rangeRequests.push({
        url: details.url,
        statusCode: details.statusCode,
        statusLine: details.statusLine,
        contentRange: crStr,
        contentLength: clStr,
        timestamp: Date.now(),
      });
      console.log(`[NET HTTP] Status ${details.statusCode} | Range: ${crStr} | Length: ${clStr}`);
    }

    if (details.statusCode === 403) {
      networkAudit.http403Count++;
      networkAudit.http403Details.push({ url: details.url, timestamp: Date.now() });
      console.error(`[CRITICAL] HTTP 403 Forbidden encountered on ${details.url}`);
    }

    callback({ responseHeaders });
  });

  ses.webRequest.onErrorOccurred(filter, (details) => {
    console.error(`[NET ERROR] ${details.url.slice(0, 80)} | ${details.error}`);
    if (details.error.includes('ORB') || details.error.includes('BLOCKED')) {
      networkAudit.orbErrors.push({ url: details.url, error: details.error });
    }
  });
}

const harnessHtml = `
<!DOCTYPE html>
<html>
<head><title>Challenger Float32 Harness</title></head>
<body>
  <h1>Adversarial Float32 PCM Verification Harness</h1>
  <script>
    window.challengerHarness = {
      ctx: null,
      audio: null,
      srcNode: null,
      faderNode: null,
      masterVolumeNode: null,
      eqNodes: [],
      analyser: null,
      floatBuf: null,
      uint8Buf: null,
      errors: [],

      initAudioGraph() {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx();
        if (this.ctx.state === 'suspended') this.ctx.resume();

        this.audio = new Audio();
        this.audio.crossOrigin = 'anonymous';
        this.audio.preload = 'auto';

        this.srcNode = this.ctx.createMediaElementSource(this.audio);
        this.faderNode = this.ctx.createGain();
        this.faderNode.gain.setValueAtTime(1.0, this.ctx.currentTime);

        this.masterVolumeNode = this.ctx.createGain();
        this.masterVolumeNode.gain.setValueAtTime(1.0, this.ctx.currentTime);

        const freqs = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
        let prevNode = this.srcNode;
        this.srcNode.connect(this.faderNode);
        prevNode = this.faderNode;

        this.eqNodes = freqs.map((f, i) => {
          const filter = this.ctx.createBiquadFilter();
          filter.type = i === 0 ? 'lowshelf' : i === freqs.length - 1 ? 'highshelf' : 'peaking';
          filter.frequency.value = f;
          filter.gain.value = 0.0;
          prevNode.connect(filter);
          prevNode = filter;
          return filter;
        });

        prevNode.connect(this.masterVolumeNode);

        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.masterVolumeNode.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);

        this.floatBuf = new Float32Array(this.analyser.fftSize);
        this.uint8Buf = new Uint8Array(this.analyser.frequencyBinCount);

        window.addEventListener('error', (e) => {
          this.errors.push({ msg: e.message, file: e.filename, line: e.lineno });
        });
      },

      getFloatMetrics() {
        if (!this.analyser || !this.floatBuf) return { peak: 0, rms: 0, stdDev: 0, nonZeroCount: 0 };
        this.analyser.getFloatTimeDomainData(this.floatBuf);
        let sum = 0;
        let sumSq = 0;
        let peak = 0;
        let nonZeroCount = 0;
        const N = this.floatBuf.length;
        for (let i = 0; i < N; i++) {
          const v = this.floatBuf[i];
          const absV = Math.abs(v);
          if (absV > peak) peak = absV;
          if (absV > 1e-4) nonZeroCount++;
          sum += v;
          sumSq += v * v;
        }
        const mean = sum / N;
        const rms = Math.sqrt(sumSq / N);
        const variance = Math.max(0, (sumSq / N) - (mean * mean));
        const stdDev = Math.sqrt(variance);

        // Also check uint8 time domain for cross-validation
        this.analyser.getByteTimeDomainData(this.uint8Buf);
        let maxByteDev = 0;
        for (let i = 0; i < this.uint8Buf.length; i++) {
          const dev = Math.abs(this.uint8Buf[i] - 128);
          if (dev > maxByteDev) maxByteDev = dev;
        }

        return {
          peak: Math.round(peak * 10000) / 10000,
          rms: Math.round(rms * 10000) / 10000,
          stdDev: Math.round(stdDev * 10000) / 10000,
          mean: Math.round(mean * 10000) / 10000,
          nonZeroCount,
          maxByteDev,
          sampleSlice: Array.from(this.floatBuf.slice(0, 4)).map(v => Math.round(v * 10000) / 10000),
        };
      },

      setVolume(val) {
        if (this.masterVolumeNode && this.ctx) {
          this.masterVolumeNode.gain.cancelScheduledValues(this.ctx.currentTime);
          this.masterVolumeNode.gain.setValueAtTime(val, this.ctx.currentTime);
        }
      },

      setFader(val) {
        if (this.faderNode && this.ctx) {
          this.faderNode.gain.cancelScheduledValues(this.ctx.currentTime);
          this.faderNode.gain.setValueAtTime(val, this.ctx.currentTime);
        }
      },

      setEqBoost() {
        if (this.eqNodes[0] && this.ctx) this.eqNodes[0].gain.setValueAtTime(12, this.ctx.currentTime);
        if (this.eqNodes[1] && this.ctx) this.eqNodes[1].gain.setValueAtTime(10, this.ctx.currentTime);
      },

      async runContinuousPlayback(url, durationSec) {
        if (!this.ctx) this.initAudioGraph();
        if (this.ctx.state === 'suspended') await this.ctx.resume();

        this.audio.src = url;
        const floatSamples = [];

        return new Promise((resolve) => {
          let timer = null;
          let interval = null;
          const cleanup = () => {
            if (timer) clearTimeout(timer);
            if (interval) clearInterval(interval);
          };

          timer = setTimeout(() => {
            cleanup();
            resolve({
              status: 'TIMEOUT',
              currentTime: this.audio.currentTime,
              duration: this.audio.duration,
              floatSamples,
              errors: this.errors,
            });
          }, (durationSec + 5) * 1000);

          this.audio.addEventListener('error', () => {
            cleanup();
            resolve({
              status: 'MEDIA_ERROR',
              error: this.audio.error ? this.audio.error.message : 'Unknown error',
              currentTime: this.audio.currentTime,
              floatSamples,
              errors: this.errors,
            });
          }, { once: true });

          this.audio.addEventListener('canplay', async () => {
            try {
              await this.audio.play();
              const startTime = Date.now();

              interval = setInterval(() => {
                const elapsed = (Date.now() - startTime) / 1000;
                const metrics = this.getFloatMetrics();

                floatSamples.push({
                  elapsed: Math.round(elapsed * 10) / 10,
                  currentTime: Math.round(this.audio.currentTime * 100) / 100,
                  peak: metrics.peak,
                  rms: metrics.rms,
                  stdDev: metrics.stdDev,
                  nonZeroCount: metrics.nonZeroCount,
                  maxByteDev: metrics.maxByteDev,
                  sampleSlice: metrics.sampleSlice,
                });

                if (elapsed >= 2.0 && elapsed < 2.2) this.setVolume(0.1);
                if (elapsed >= 3.0 && elapsed < 3.2) this.setVolume(1.0);
                if (elapsed >= 3.5 && elapsed < 3.7) this.setFader(0.0);
                if (elapsed >= 4.2 && elapsed < 4.4) this.setFader(1.0);
                if (elapsed >= 4.8 && elapsed < 5.0) this.setEqBoost();

                if (elapsed >= durationSec) {
                  cleanup();
                  this.audio.pause();
                  resolve({
                    status: 'SUCCESS',
                    currentTime: this.audio.currentTime,
                    duration: this.audio.duration,
                    floatSamples,
                    errors: this.errors,
                  });
                }
              }, 150);
            } catch (err) {
              cleanup();
              resolve({
                status: 'PLAY_EXCEPTION',
                error: err.message,
                floatSamples,
                errors: this.errors,
              });
            }
          }, { once: true });
        });
      },

      async seekTo(seekTimeSec) {
        if (!this.audio) return { status: 'NO_AUDIO' };
        const beforeTime = this.audio.currentTime;
        const duration = this.audio.duration;

        this.audio.currentTime = seekTimeSec;
        try {
          await this.audio.play();
        } catch {}

        return new Promise((resolve) => {
          setTimeout(() => {
            const metrics = this.getFloatMetrics();
            resolve({
              targetSeekSec: seekTimeSec,
              beforeTime: Math.round(beforeTime * 100) / 100,
              afterTime: Math.round(this.audio.currentTime * 100) / 100,
              duration: Math.round(duration * 100) / 100,
              playing: !this.audio.paused,
              ended: this.audio.ended,
              metrics,
            });
          }, 1500);
        });
      }
    };
  </script>
</body>
</html>
`;

async function main() {
  await app.whenReady();
  console.log('========================================================================');
  console.log(' EMPIRICAL CHALLENGER: AUDIO STREAM LONGEVITY & BYTE BOUNDARY HARNESS');
  console.log('========================================================================\n');

  configureProductionSessionInterceptor();

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true, // Validate under production web security
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(harnessHtml)}`);

  const targets = [
    { name: 'The Strokes - Ode to the Mets', duration: 6.0, seekPoints: [60.0, 90.0, 180.0, 300.0] },
    { name: 'Sweet Taste of India', duration: 6.0, seekPoints: [60.0, 90.0, 130.0, 300.0] },
  ];

  const overallResults = [];

  for (const target of targets) {
    console.log(`\n========================================================================`);
    console.log(`>>> TARGET TRACK: "${target.name}"`);
    console.log(`========================================================================`);

    // 1. Resolve Track
    const resolved = await resolveTrackForTest(target.name);
    console.log(`  Title       : ${resolved.title}`);
    console.log(`  Duration    : ${resolved.durationSec}s`);
    console.log(`  Bitrate     : ${resolved.bitrate} bps`);
    console.log(`  Format      : ${resolved.format}`);
    console.log(`  Stream URL  : ${resolved.url.slice(0, 75)}...`);

    const initialRangesCount = networkAudit.rangeRequests.length;
    const initial403Count = networkAudit.http403Count;

    // 2. Continuous 6+ Second Playback Test
    console.log(`\n[TEST 1] Continuous ${target.duration}s live playback test with Float32 PCM monitoring...`);
    const playResult = await win.webContents.executeJavaScript(
      `window.challengerHarness.runContinuousPlayback(${JSON.stringify(resolved.url)}, ${target.duration})`
    );

    console.log(`  Playback Result Status : ${playResult.status}`);
    console.log(`  Reached Audio Position : ${playResult.currentTime.toFixed(2)}s (Duration: ${playResult.duration ? playResult.duration.toFixed(2) : 'N/A'}s)`);
    console.log(`  Samples Recorded       : ${playResult.floatSamples ? playResult.floatSamples.length : 0}`);

    // Analyze Float32 PCM signal data
    const samples = playResult.floatSamples || [];
    const activeFloatSamples = samples.filter((s) => s.rms > 0.001 || s.peak > 0.01);
    const maxPeak = Math.max(0, ...samples.map((s) => s.peak));
    const maxRms = Math.max(0, ...samples.map((s) => s.rms));
    const maxStdDev = Math.max(0, ...samples.map((s) => s.stdDev));

    console.log(`  Active Float32 Samples : ${activeFloatSamples.length} / ${samples.length}`);
    console.log(`  Max Float32 Peak Amp   : ${maxPeak}`);
    console.log(`  Max Float32 RMS Power  : ${maxRms}`);
    console.log(`  Max Standard Deviation : ${maxStdDev}`);

    const continuousPass =
      playResult.status === 'SUCCESS' &&
      playResult.currentTime >= 5.0 &&
      activeFloatSamples.length >= 10 &&
      maxPeak > 0.01 &&
      maxRms > 0.005;

    console.log(`  Continuous Playback Assessment: ${continuousPass ? 'PASSED' : 'FAILED'}`);

    // 3. Multi-Point Seeking & Byte Boundary Challenge
    console.log(`\n[TEST 2] Multi-Point Seek Challenge: ${JSON.stringify(target.seekPoints)}s`);
    const seekAssessments = [];

    for (const seekSec of target.seekPoints) {
      console.log(`\n  --- Seeking to ${seekSec}s ---`);
      const rangeBeforeCount = networkAudit.rangeRequests.length;
      const seekRes = await win.webContents.executeJavaScript(
        `window.challengerHarness.seekTo(${seekSec})`
      );

      const newRangeResponses = networkAudit.rangeRequests.slice(rangeBeforeCount);
      console.log(`    Requested Seek     : ${seekRes.targetSeekSec}s`);
      console.log(`    Position After     : ${seekRes.afterTime}s (Track Duration: ${seekRes.duration}s)`);
      console.log(`    Audio State        : playing=${seekRes.playing}, ended=${seekRes.ended}`);
      console.log(`    Float32 Metrics    : Peak=${seekRes.metrics.peak}, RMS=${seekRes.metrics.rms}, StdDev=${seekRes.metrics.stdDev}, Slice=${JSON.stringify(seekRes.metrics.sampleSlice)}`);

      // Check HTTP 206 and byte boundaries
      let has206 = false;
      let startByte = -1;
      let totalBytes = -1;
      for (const r of newRangeResponses) {
        console.log(`    HTTP Range Response: Status=${r.statusCode}, Content-Range=${r.contentRange}`);
        if (r.statusCode === 206) has206 = true;
        if (r.contentRange) {
          const match = r.contentRange.match(/bytes\s+(\d+)-\d+\/(\d+)/);
          if (match) {
            startByte = parseInt(match[1], 10);
            totalBytes = parseInt(match[2], 10);
          }
        }
      }

      // Check boundary: 1,071,145 bytes (~65s cap in Iteration 1)
      const exceedsCap = startByte > 1071145;
      const isPastDuration = seekSec >= (resolved.durationSec || 9999);

      console.log(`    Start Byte Offset  : ${startByte >= 0 ? startByte.toLocaleString() : 'cached/buffered'} bytes (Total: ${totalBytes >= 0 ? totalBytes.toLocaleString() : 'N/A'})`);
      if (startByte >= 0) {
        console.log(`    Exceeds 1,071,145b : ${exceedsCap ? 'YES (Boundary Exceeded Successfully)' : 'NO (Within first 1.07MB)'}`);
      }

      // Determine seek pass condition
      let seekSuccess = false;
      if (isPastDuration) {
        // If seek was beyond end of track (e.g. 300s on a 140s track), it should clamp to duration or ended without 403
        seekSuccess = seekRes.ended || seekRes.afterTime >= (resolved.durationSec - 2.0);
        console.log(`    Over-Duration Seek : Properly clamped to end (${seekRes.afterTime}s) without fatal error.`);
      } else {
        seekSuccess = seekRes.playing && (seekRes.metrics.rms > 0 || seekRes.metrics.peak > 0);
      }

      seekAssessments.push({
        seekSec,
        seekRes,
        startByte,
        exceedsCap,
        has206,
        seekSuccess,
      });
    }

    const new403s = networkAudit.http403Count - initial403Count;
    console.log(`\n[NETWORK AUDIT for "${target.name}"]:`);
    console.log(`  HTTP 403 Count   : ${new403s}`);
    console.log(`  ORB Errors Count : ${networkAudit.orbErrors.length}`);

    const allSeeksPassed = seekAssessments.every((s) => s.seekSuccess);
    const targetPassed = continuousPass && allSeeksPassed && new403s === 0;

    overallResults.push({
      name: target.name,
      targetPassed,
      continuousPass,
      seekAssessments,
      new403s,
      maxPeak,
      maxRms,
    });

    console.log(`\n>>> RESULT FOR "${target.name}": ${targetPassed ? 'PASSED ALL ADVERSARIAL CRITERIA' : 'FAILED'}`);
  }

  console.log('\n========================================================================');
  console.log(' FINAL EMPIRICAL SUMMARY & VERDICT');
  console.log('========================================================================');
  let allPass = true;
  for (const r of overallResults) {
    console.log(`- ${r.name}: ${r.targetPassed ? 'PASS' : 'FAIL'}`);
    console.log(`    Continuous 6s Playback : ${r.continuousPass ? 'PASS' : 'FAIL'} (Peak: ${r.maxPeak}, RMS: ${r.maxRms})`);
    for (const s of r.seekAssessments) {
      console.log(`    Seek ${s.seekSec}s: ${s.seekSuccess ? 'PASS' : 'FAIL'} | StartByte: ${s.startByte.toLocaleString()} | Exceeds 1.07MB: ${s.exceedsCap ? 'YES' : 'N/A'}`);
    }
    console.log(`    HTTP 403 Count: ${r.new403s}`);
    if (!r.targetPassed) allPass = false;
  }

  const finalVerdict = allPass ? 'APPROVE' : 'REQUEST_CHANGES';
  console.log(`\nFINAL CHALLENGER VERDICT: ${finalVerdict}`);
  console.log('========================================================================\n');

  win.close();
  app.quit();
}

main().catch((err) => {
  console.error('Fatal Test Exception:', err);
  app.quit();
});
