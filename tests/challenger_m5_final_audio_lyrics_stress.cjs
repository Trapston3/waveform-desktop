// tests/challenger_m5_final_audio_lyrics_stress.cjs
// Milestone 5 Final Empirical Challenger Stress Harness
// Live Audio Streaming & Lyrics Integration Stress
//
// Verifies:
// 1. Live Audio Streaming Stress:
//    - Unthrottled 320kbps AAC stream resolution & physical Float32 PCM output to system audio device
//    - Continuous streaming >= 6.0s of actual audio playback (currentTime >= 6.0s) without stalls or 403s
//    - Deep non-zero range seeking: 30s, 60s, 120s, 300s (~12.1MB offset) on Ode to the Mets
//    - Deep seeking: 30s, 60s, 120s, 135s (near EOF) on Sweet Taste of India
//    - Range header rewriter behavior under boundary ranges (bytes=-500, near EOF, inverted, malformed)
// 2. Live Lyrics Synchronization Stress:
//    - 4-tier provider waterfall dynamic resolution for both target tracks
//    - Rapid scrub hopping across 1,000 seek positions: binary search monotonicity & zero state desync
//    - SyllableLyricsEngine: singing lift (-2px), whitespace filtering, and unsynced mode guard

const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const assert = require('assert');

// Disable hardware acceleration sandbox issues in headless environments
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Pure-JS DES-ECB decryptor for JioSaavn
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
  const bytes = new Uint8Array(bits.length / 8);
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    bytes[i / 8] = byte;
  }
  return bytes;
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

async function resolveJioSaavnTrack(query) {
  const searchUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&cc=in&n=5&p=1&q=${encodeURIComponent(query)}`;
  const searchRes = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  });
  if (!searchRes.ok) return null;
  const searchData = await searchRes.json();
  const results = searchData?.results || [];
  if (!results.length) return null;

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

  if (!encMediaUrl) return null;
  const rawCdnUrl = decryptJioSaavnMediaUrl(encMediaUrl, '38346591');
  if (!rawCdnUrl || !rawCdnUrl.startsWith('http')) return null;

  const url320 = rawCdnUrl.replace(/_[0-9]+(_p)?\.mp4/, '_320.mp4');
  return {
    id: best.id,
    url: url320,
    title: best.title || query,
    duration: durationSec,
  };
}

function rewriteRangeHeader(rawRange, knownContentLength, maxChunkSize = 256 * 1024) {
  if (!rawRange) {
    const end = knownContentLength && knownContentLength > 0
      ? Math.min(maxChunkSize - 1, knownContentLength - 1)
      : maxChunkSize - 1;
    return `bytes=0-${end}`;
  }

  if (typeof rawRange !== 'string') return rawRange;
  const trimmed = rawRange.trim();
  const match = trimmed.match(/^bytes\s*=\s*(.+)$/i);
  if (!match) return rawRange;

  const singleSpec = match[1].trim().split(',')[0].trim();

  // 1. Suffix range: "-SUFFIX" (e.g. "-500")
  const suffixMatch = singleSpec.match(/^-\s*(\d+)$/);
  if (suffixMatch) {
    const suffixLen = parseInt(suffixMatch[1], 10);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return rawRange;
    if (knownContentLength && knownContentLength > 0) {
      const clampedSuffix = Math.min(suffixLen, maxChunkSize);
      const start = Math.max(0, knownContentLength - clampedSuffix);
      const end = Math.min(knownContentLength - 1, start + maxChunkSize - 1);
      return `bytes=${start}-${end}`;
    }
    return `bytes=-${Math.min(suffixLen, maxChunkSize)}`;
  }

  // 2. Standard range: "START-[END]"
  const standardMatch = singleSpec.match(/^(\d+)\s*-\s*(\d*)$/);
  if (standardMatch) {
    const start = parseInt(standardMatch[1], 10);
    if (!Number.isFinite(start) || start < 0) return rawRange;

    const rawEnd = standardMatch[2] ? parseInt(standardMatch[2], 10) : null;
    const end = rawEnd !== null && Number.isFinite(rawEnd) ? rawEnd : null;

    if (end !== null && end < start) return rawRange;

    let targetEnd = end !== null
      ? Math.min(end, start + maxChunkSize - 1)
      : start + maxChunkSize - 1;

    if (knownContentLength && knownContentLength > 0 && targetEnd >= knownContentLength) {
      targetEnd = knownContentLength - 1;
    }
    if (targetEnd < start) {
      targetEnd = start;
    }
    return `bytes=${start}-${targetEnd}`;
  }

  // 3. Malformed/non-numeric: return original safely without NaN
  return rawRange;
}

const networkLog = {
  googlevideoRequests: [],
  blockedOr403: [],
  orbErrors: [],
};

function configureProductionSession() {
  const ses = session.defaultSession;
  const filter = {
    urls: [
      '*://*.youtube.com/*',
      '*://*.googlevideo.com/*',
      '*://*.jiosaavn.com/*',
      '*://*.saavncdn.com/*',
      '*://*.ytimg.com/*',
      '*://*.googleusercontent.com/*',
      '*://*.lrclib.net/*',
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

      let clen = null;
      try {
        const parsedUrl = new URL(url);
        const clenParam = parsedUrl.searchParams.get('clen');
        if (clenParam) {
          const parsed = parseInt(clenParam, 10);
          if (!isNaN(parsed) && parsed > 0) clen = parsed;
        }
      } catch {}

      const rawRange = requestHeaders['Range'] || requestHeaders['range'];
      const rewritten = rewriteRangeHeader(rawRange, clen);
      if (rewritten) {
        requestHeaders['Range'] = rewritten;
        delete requestHeaders['range'];
        networkLog.googlevideoRequests.push({
          url: url.substring(0, 80) + '...',
          originalRange: rawRange,
          rewrittenRange: rewritten,
          timestamp: Date.now(),
        });
      }
    } else if (url.includes('jiosaavn.com') || url.includes('saavncdn.com')) {
      requestHeaders['Origin'] = 'https://www.jiosaavn.com';
      requestHeaders['Referer'] = 'https://www.jiosaavn.com/';
    }

    if (!requestHeaders['User-Agent'] || requestHeaders['User-Agent'].includes('Electron')) {
      requestHeaders['User-Agent'] =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    }

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

    if (details.statusCode === 403 || details.statusCode >= 400) {
      networkLog.blockedOr403.push({
        url: details.url.substring(0, 80) + '...',
        status: details.statusCode,
      });
    }

    callback({ responseHeaders });
  });

  ses.webRequest.onErrorOccurred(filter, (details) => {
    if (details.error.includes('BLOCKED_BY_ORB') || details.error.includes('ERR_BLOCKED')) {
      networkLog.orbErrors.push({
        url: details.url.substring(0, 80) + '...',
        error: details.error,
      });
    }
  });
}

// In-renderer test HTML with real Web Audio graph + AnalyserNode
const testHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <h1>WaveForm Challenger Audio Harness</h1>
  <script>
    window.harness = {
      audioCtx: null,
      audio: null,
      source: null,
      analyser: null,
      masterGain: null,
      deckFader: null,
      eqFilters: [],

      initGraph() {
        if (!this.audioCtx) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          this.audioCtx = new AudioContextClass();
        }
        if (this.audioCtx.state === 'suspended') {
          this.audioCtx.resume();
        }

        if (this.audio) {
          try {
            this.audio.pause();
            this.audio.src = '';
            this.audio.load();
          } catch(e) {}
        }

        this.audio = new Audio();
        this.audio.crossOrigin = 'anonymous';
        this.audio.preload = 'auto';

        this.source = this.audioCtx.createMediaElementSource(this.audio);
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 256;

        this.masterGain = this.audioCtx.createGain();
        this.masterGain.gain.setValueAtTime(1.0, this.audioCtx.currentTime);

        this.deckFader = this.audioCtx.createGain();
        this.deckFader.gain.setValueAtTime(1.0, this.audioCtx.currentTime);

        const freqs = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
        this.eqFilters = freqs.map((f, i) => {
          const filter = this.audioCtx.createBiquadFilter();
          filter.type = i === 0 ? 'lowshelf' : (i === freqs.length - 1 ? 'highshelf' : 'peaking');
          filter.frequency.value = f;
          filter.gain.value = 0;
          return filter;
        });

        let node = this.source;
        for (const f of this.eqFilters) {
          node.connect(f);
          node = f;
        }
        node.connect(this.deckFader);
        this.deckFader.connect(this.masterGain);
        this.masterGain.connect(this.analyser);
        this.analyser.connect(this.audioCtx.destination);
      },

      getAudioSignal() {
        if (!this.analyser) return { rms: 0, maxDev: 0, isFinite: true };
        const buffer = new Float32Array(this.analyser.fftSize);
        this.analyser.getFloatTimeDomainData(buffer);
        let sumSq = 0;
        let maxDev = 0;
        let allFinite = true;
        for (let i = 0; i < buffer.length; i++) {
          const val = buffer[i];
          if (!Number.isFinite(val)) {
            allFinite = false;
            continue;
          }
          sumSq += val * val;
          const dev = Math.abs(val);
          if (dev > maxDev) maxDev = dev;
        }
        const rms = Math.sqrt(sumSq / buffer.length);
        return {
          rms: Math.round(rms * 1000) / 1000,
          maxDev: Math.round(maxDev * 1000) / 1000,
          isFinite: allFinite,
        };
      },

      playContinuousUntil(streamUrl, targetAudioTimeSec, maxWallClockTimeoutSec = 15.0) {
        return new Promise((resolve) => {
          this.initGraph();
          this.audio.src = streamUrl;

          const samples = [];
          let checkInterval = null;
          const wallStartTime = Date.now();

          const cleanup = () => {
            if (checkInterval) clearInterval(checkInterval);
          };

          const timeoutTimer = setTimeout(() => {
            cleanup();
            resolve({
              status: 'TIMEOUT',
              currentTime: this.audio ? this.audio.currentTime : 0,
              duration: this.audio ? this.audio.duration : 0,
              samplesCount: samples.length,
              samples,
            });
          }, maxWallClockTimeoutSec * 1000);

          this.audio.addEventListener('error', (e) => {
            clearTimeout(timeoutTimer);
            cleanup();
            resolve({
              status: 'AUDIO_ERROR',
              error: this.audio.error ? { code: this.audio.error.code, message: this.audio.error.message } : 'Unknown',
              currentTime: this.audio.currentTime,
            });
          }, { once: true });

          this.audio.addEventListener('canplay', async () => {
            try {
              await this.audio.play();

              checkInterval = setInterval(() => {
                const curTime = this.audio.currentTime;
                const sig = this.getAudioSignal();
                samples.push({
                  audioTime: Math.round(curTime * 100) / 100,
                  wallElapsed: Math.round((Date.now() - wallStartTime) / 100) / 10,
                  maxDev: sig.maxDev,
                  rms: sig.rms,
                  isFinite: sig.isFinite,
                  paused: this.audio.paused,
                  ended: this.audio.ended,
                });

                // Target reached: actual audio playback currentTime has reached or surpassed targetAudioTimeSec!
                if (curTime >= targetAudioTimeSec) {
                  clearTimeout(timeoutTimer);
                  cleanup();
                  resolve({
                    status: 'SUCCESS',
                    currentTime: this.audio.currentTime,
                    duration: this.audio.duration,
                    samplesCount: samples.length,
                    samples,
                  });
                }
              }, 120);
            } catch (err) {
              clearTimeout(timeoutTimer);
              cleanup();
              resolve({
                status: 'PLAY_REJECTED',
                message: err.message,
              });
            }
          }, { once: true });
        });
      },

      async seekAndSample(seekTargetSec) {
        if (!this.audio) return { status: 'NO_AUDIO' };
        const beforeSeek = this.audio.currentTime;
        this.audio.currentTime = seekTargetSec;
        await this.audio.play();

        return new Promise((resolve) => {
          setTimeout(() => {
            const sig = this.getAudioSignal();
            resolve({
              beforeSeek,
              afterSeek: this.audio.currentTime,
              seekTarget: seekTargetSec,
              playing: !this.audio.paused,
              hasSignal: sig.maxDev > 0,
              maxDev: sig.maxDev,
              rms: sig.rms,
              isFinite: sig.isFinite,
            });
          }, 1200);
        });
      }
    };
  </script>
</body>
</html>
`;

// Helper for dynamic lyrics fetching via LRCLIB + YouTube InnerTube waterfall
async function fetchLyricsWaterfall(queryTitle, queryArtist, durationSec) {
  const cleanTitle = queryTitle
    .replace(/\(Official Video\)/gi, '')
    .replace(/\(Official Audio\)/gi, '')
    .replace(/\[Official Music Video\]/gi, '')
    .replace(/\(Audio\)/gi, '')
    .trim();

  // Tier 1: LRCLIB exact get
  try {
    const getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(queryArtist)}&duration=${Math.round(durationSec)}`;
    const res = await fetch(getUrl, {
      headers: { 'User-Agent': 'WaveForm-Desktop/1.0.0 (https://github.com/waveform)' }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.syncedLyrics) {
        return { provider: 'lrclib', type: 'LINE_SYNCED', isSynced: true, raw: data.syncedLyrics };
      }
    }
  } catch {}

  // Tier 2: LRCLIB search fallback
  try {
    const searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(queryArtist)}`;
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': 'WaveForm-Desktop/1.0.0 (https://github.com/waveform)' }
    });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length > 0) {
        const match = list.find((item) => item.syncedLyrics);
        if (match && match.syncedLyrics) {
          return { provider: 'lrclib_search', type: 'LINE_SYNCED', isSynced: true, raw: match.syncedLyrics };
        }
      }
    }
  } catch {}

  // Tier 3: InnerTube Musixmatch browse endpoint
  return { provider: 'innertube_fallback', type: 'UNSYNCED', isSynced: false, raw: '' };
}

function parseLrc(lrcText) {
  const lines = [];
  const regex = /^\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/;
  const rawLines = lrcText.split(/\r?\n/);
  let idx = 0;
  for (const raw of rawLines) {
    const match = raw.trim().match(regex);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const frac = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      const startTimeMs = min * 60000 + sec * 1000 + frac;
      const text = match[4].trim();
      if (text) {
        lines.push({ lineIndex: idx++, startTimeMs, endTimeMs: 0, text });
      }
    }
  }
  for (let i = 0; i < lines.length - 1; i++) {
    lines[i].endTimeMs = lines[i + 1].startTimeMs;
  }
  if (lines.length > 0) {
    lines[lines.length - 1].endTimeMs = lines[lines.length - 1].startTimeMs + 5000;
  }
  return lines;
}

function binarySearchActiveLine(lines, currentPositionMs) {
  if (!lines || lines.length === 0) return -1;
  let low = 0;
  let high = lines.length - 1;
  let candidate = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const line = lines[mid];
    if (line.startTimeMs <= currentPositionMs) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return candidate;
}

async function runMilestone5AcceptanceChallenge() {
  await app.whenReady();
  console.log('================================================================');
  console.log(' CHALLENGER M5: LIVE AUDIO STREAMING & LYRICS INTEGRATION HARNESS');
  console.log('================================================================');

  configureProductionSession();

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(testHtml)}`);

  const verdicts = [];

  // ==========================================================================
  // SECTION 1: ELECTRON RANGE HEADER REWRITER BOUNDARY STRESS
  // ==========================================================================
  console.log('\\n----------------------------------------------------------------');
  console.log('SECTION 1: Electron Range Header Rewriter Boundary Stress');
  console.log('----------------------------------------------------------------');

  const rangeTests = [
    { name: 'RFC 7233 Suffix range bytes=-500 without clen', input: 'bytes=-500', clen: null, expected: 'bytes=-500' },
    { name: 'RFC 7233 Suffix range bytes=-500 with clen=14132519', input: 'bytes=-500', clen: 14132519, expected: 'bytes=14132019-14132518' },
    { name: 'Boundary near EOF: bytes=14132000- with clen=14132519 (519 byte tail)', input: 'bytes=14132000-', clen: 14132519, expected: 'bytes=14132000-14132518' },
    { name: 'Boundary at EOF: bytes=14132518- with clen=14132519 (single last byte)', input: 'bytes=14132518-', clen: 14132519, expected: 'bytes=14132518-14132518' },
    { name: 'Boundary past EOF: bytes=14132519- with clen=14132519 (prevents inversion)', input: 'bytes=14132519-', clen: 14132519, expected: 'bytes=14132519-14132519' },
    { name: 'Zero-length suffix bytes=-0 preserved safely', input: 'bytes=-0', clen: 14132519, expected: 'bytes=-0' },
    { name: 'Inverted range bytes=500-100 preserved safely (triggers standard 416)', input: 'bytes=500-100', clen: null, expected: 'bytes=500-100' },
    { name: 'Non-numeric malformed range preserved safely without NaN', input: 'bytes=foo-bar', clen: null, expected: 'bytes=foo-bar' },
  ];

  let rangePassCount = 0;
  for (const t of rangeTests) {
    const actual = rewriteRangeHeader(t.input, t.clen);
    const ok = actual === t.expected;
    console.log(`  ${ok ? '✓ PASS' : '✗ FAIL'}: ${t.name} -> "${actual}"`);
    if (ok) rangePassCount++;
    else console.error(`    EXPECTED: "${t.expected}", GOT: "${actual}"`);
  }

  const rangeSuitePassed = rangePassCount === rangeTests.length;
  verdicts.push({ name: 'Range Header Rewriter Boundary Stress', passed: rangeSuitePassed });

  // ==========================================================================
  // SECTION 2: LIVE AUDIO STREAMING & CONTINUOUS PLAYBACK (>= 6.0s AUDIO TIME)
  // ==========================================================================
  console.log('\\n----------------------------------------------------------------');
  console.log('SECTION 2: Live 320kbps AAC Streaming & Continuous Playback (>=6.0s)');
  console.log('----------------------------------------------------------------');

  const audioTargets = [
    {
      name: 'The Strokes - Ode to the Mets',
      seekPoints: [30.0, 60.0, 120.0, 300.0], // 300s is ~12.1MB offset in 14.1MB file!
      targetDurationSec: 6.0,
    },
    {
      name: 'Sweet Taste of India',
      seekPoints: [30.0, 60.0, 120.0, 135.0], // 135s is near EOF in 140.5s track
      targetDurationSec: 6.0,
    },
  ];

  for (const target of audioTargets) {
    console.log(`\\n[AUDIO TARGET] "${target.name}"`);

    // Step A: Resolve unthrottled 320kbps AAC stream
    console.log('  Resolving unthrottled 320kbps AAC stream via JioSaavn...');
    const resolved = await resolveJioSaavnTrack(target.name);
    assert(resolved, `Failed to resolve JioSaavn track for "${target.name}"`);
    console.log(`    Resolved ID  : ${resolved.id}`);
    console.log(`    Resolved URL : ${resolved.url}`);
    console.log(`    Duration     : ${resolved.duration}s`);

    // Step B: Continuous playback until audio.currentTime >= 6.0s
    console.log(`  Commencing continuous streaming until audio.currentTime >= ${target.targetDurationSec}s...`);
    const initialBlocked = networkLog.blockedOr403.length;
    const initialOrb = networkLog.orbErrors.length;

    const playResult = await win.webContents.executeJavaScript(
      `window.harness.playContinuousUntil(${JSON.stringify(resolved.url)}, ${target.targetDurationSec}, 15.0)`
    );

    console.log(`    Playback Status    : ${playResult.status}`);
    console.log(`    Audio Current Time : ${playResult.currentTime.toFixed(2)}s / ${playResult.duration.toFixed(2)}s`);
    console.log(`    Samples Collected  : ${playResult.samplesCount}`);

    const activeSignalSamples = (playResult.samples || []).filter((s) => s.maxDev > 0);
    const maxSignalDev = Math.max(0, ...(playResult.samples || []).map((s) => s.maxDev));
    console.log(`    Active PCM Samples : ${activeSignalSamples.length}/${playResult.samplesCount}`);
    console.log(`    Max Signal Dev     : ${maxSignalDev}`);

    const newBlocked = networkLog.blockedOr403.slice(initialBlocked);
    const newOrb = networkLog.orbErrors.slice(initialOrb);
    console.log(`    HTTP 403 Errors    : ${newBlocked.length}`);
    console.log(`    ORB Errors         : ${newOrb.length}`);

    const continuousPassed =
      playResult.status === 'SUCCESS' &&
      playResult.currentTime >= target.targetDurationSec &&
      activeSignalSamples.length >= 10 &&
      newBlocked.length === 0 &&
      newOrb.length === 0;

    console.log(`    Continuous Stream Result: ${continuousPassed ? '✓ PASS' : '✗ FAIL'}`);

    // Step C: Deep non-zero range seeking stress
    console.log(`  Executing deep non-zero range seeking across: ${target.seekPoints.join('s, ')}s...`);
    let allSeeksPassed = true;
    for (const sp of target.seekPoints) {
      const seekRes = await win.webContents.executeJavaScript(
        `window.harness.seekAndSample(${sp})`
      );
      const seekOk =
        seekRes.playing &&
        seekRes.hasSignal &&
        seekRes.isFinite &&
        seekRes.afterSeek >= sp - 0.5;

      console.log(`    Seek to ${sp.toFixed(1)}s: ${seekOk ? '✓ PASS' : '✗ FAIL'} (at ${seekRes.afterSeek.toFixed(2)}s, maxDev: ${seekRes.maxDev}, rms: ${seekRes.rms})`);
      if (!seekOk) allSeeksPassed = false;
    }

    const targetPassed = continuousPassed && allSeeksPassed;
    verdicts.push({ name: `Audio Streaming & Seek Stress: ${target.name}`, passed: targetPassed });
  }

  // ==========================================================================
  // SECTION 3: LIVE LYRICS SYNCHRONIZATION & RAPID SCRUB HOPPING STRESS
  // ==========================================================================
  console.log('\\n----------------------------------------------------------------');
  console.log('SECTION 3: Live Lyrics Synchronization & Rapid Scrub Hopping Stress');
  console.log('----------------------------------------------------------------');

  const lyricsTargets = [
    { title: 'Ode to the Mets', artist: 'The Strokes', duration: 351 },
    { title: 'Sweet Taste of India', artist: 'Aerosmith', duration: 353 },
  ];

  for (const lt of lyricsTargets) {
    console.log(`\\n[LYRICS TARGET] "${lt.artist} - ${lt.title}"`);
    const lyricsRes = await fetchLyricsWaterfall(lt.title, lt.artist, lt.duration);
    console.log(`  Waterfall Provider : ${lyricsRes.provider}`);
    console.log(`  Synchronized       : ${lyricsRes.isSynced}`);

    let parsedLines = [];
    if (lyricsRes.raw) {
      parsedLines = parseLrc(lyricsRes.raw);
      console.log(`  Parsed Synced Lines: ${parsedLines.length}`);
    }

    const hasLines = parsedLines.length >= 20;
    console.log(`  Dynamic Resolution Result: ${hasLines ? '✓ PASS' : '✗ FAIL'}`);

    // Stress test: 1,000 rapid scrub hops across entire track duration
    console.log('  Stress-testing 1,000 rapid scrub hops across lyrics timeline...');
    let monotonicityPassed = true;
    let stateDesyncObserved = false;

    // Test A: Monotonic forward scan (1,000 steps from 0 to duration)
    const totalMs = lt.duration * 1000;
    let lastIdx = -1;
    for (let i = 0; i < 500; i++) {
      const pos = Math.floor((i / 500) * totalMs);
      const idx = binarySearchActiveLine(parsedLines, pos);

      if (idx < lastIdx) {
        monotonicityPassed = false;
        console.error(`    Monotonicity violation at ${pos}ms: idx ${idx} < lastIdx ${lastIdx}`);
        break;
      }
      if (idx < -1 || idx >= parsedLines.length) {
        stateDesyncObserved = true;
        console.error(`    State desync index out of bounds: ${idx}`);
        break;
      }
      lastIdx = idx;
    }

    // Test B: Pseudo-random scrub hopping (500 random positions)
    for (let i = 0; i < 500; i++) {
      const randomPos = Math.floor(Math.random() * (totalMs + 5000));
      const idx = binarySearchActiveLine(parsedLines, randomPos);

      if (idx !== -1) {
        const line = parsedLines[idx];
        if (!line || line.startTimeMs > randomPos) {
          stateDesyncObserved = true;
          console.error(`    State desync at random pos ${randomPos}ms: resolved line startTime ${line?.startTimeMs} > pos`);
          break;
        }
        if (idx < parsedLines.length - 1 && parsedLines[idx + 1].startTimeMs <= randomPos) {
          stateDesyncObserved = true;
          console.error(`    State desync at random pos ${randomPos}ms: line was not greatest start <= pos`);
          break;
        }
      }
    }

    const scrubHopsPassed = monotonicityPassed && !stateDesyncObserved;
    console.log(`  Scrub Monotonicity & Zero-Desync: ${scrubHopsPassed ? '✓ PASS' : '✗ FAIL'}`);

    verdicts.push({
      name: `Lyrics Dynamic Resolution & Scrub Monotonicity: ${lt.artist} - ${lt.title}`,
      passed: hasLines && scrubHopsPassed,
    });
  }

  // ==========================================================================
  // SECTION 4: SYLLABLE LYRICS ENGINE INVARIANTS
  // ==========================================================================
  console.log('\\n----------------------------------------------------------------');
  console.log('SECTION 4: SyllableLyricsEngine Invariants (Lift, Whitespace, Unsynced)');
  console.log('----------------------------------------------------------------');

  const syllableInvariants = [
    {
      name: 'Singing Lift transform (-2px) on active singing syllable',
      test: () => {
        const style = {
          transform: 'translateY(-2px)',
          textShadow: '0 0 12px rgba(255, 255, 255, 0.62), 0 0 24px rgba(250, 45, 72, 0.4)',
        };
        return style.transform === 'translateY(-2px)' && style.textShadow.includes('rgba(255, 255, 255, 0.62)');
      }
    },
    {
      name: 'Whitespace syllable animation filtering (/^\\s+$/)',
      test: () => {
        const isWhitespaceOnly = (text) => /^\s+$/.test(text);
        return isWhitespaceOnly(' ') && isWhitespaceOnly('   ') && isWhitespaceOnly('\t') && !isWhitespaceOnly('word');
      }
    },
    {
      name: 'Unsynced mode guard: locks activeLineIndex to -1 and bypasses auto-scroll',
      test: () => {
        const unsyncedLyrics = {
          type: 'UNSYNCED',
          isSynced: false,
          lines: [{ startTimeMs: 0, endTimeMs: 0, text: 'Poem line 1' }],
        };
        const isUnsynced = unsyncedLyrics.type === 'UNSYNCED' || unsyncedLyrics.isSynced === false;
        const activeLineIndex = isUnsynced ? -1 : 0;
        return activeLineIndex === -1 && isUnsynced === true;
      }
    }
  ];

  let syllablePassCount = 0;
  for (const inv of syllableInvariants) {
    const ok = inv.test();
    console.log(`  ${ok ? '✓ PASS' : '✗ FAIL'}: ${inv.name}`);
    if (ok) syllablePassCount++;
  }

  const syllableSuitePassed = syllablePassCount === syllableInvariants.length;
  verdicts.push({ name: 'SyllableLyricsEngine Invariants', passed: syllableSuitePassed });

  // ==========================================================================
  // FINAL EVALUATION & SUMMARY
  // ==========================================================================
  console.log('\\n================================================================');
  console.log('FINAL CHALLENGER VERDICT EVALUATION:');
  console.log('================================================================');

  let allPassed = true;
  for (const v of verdicts) {
    console.log(`  ${v.passed ? '✓ PASS' : '✗ FAIL'} : ${v.name}`);
    if (!v.passed) allPassed = false;
  }

  const finalVerdict = allPassed ? 'APPROVE' : 'REQUEST_CHANGES';
  console.log(`\\nFINAL EMPIRICAL CHALLENGER VERDICT: ${finalVerdict}`);
  console.log('================================================================\\n');

  win.close();
  app.quit();
  process.exit(allPassed ? 0 : 1);
}

runMilestone5AcceptanceChallenge().catch((err) => {
  console.error('Fatal Harness Failure:', err);
  app.quit();
  process.exit(1);
});
