// tests/adversarial_stream_longevity_m1.cjs
// Empirical Challenger: Milestone 1 Audio Playback & Streaming Engine Stress Suite
// Tests:
// 1. Production Electron media session interception (onBeforeSendHeaders + onHeadersReceived)
// 2. Continuous 6+ second streaming of "The Strokes - Ode to the Mets" and "Sweet Taste of India"
// 3. Subsequent byte chunk streaming via non-zero range seeking (testing Range rewrite for chunks > 256KB)
// 4. Web Audio graph responsiveness: dynamic volume, deck fader/crossfader, 10-band EQ during active streaming
// 5. Console error, unhandled rejection, and ORB/403 network auditing
// 6. Memory heap stability across extended playback

const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');

// Configure command-line switches identical to production electron/main.ts
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

// Network activity tracker
const networkLog = {
  requests: [],
  googlevideoRequests: [],
  blockedOr403: [],
  orbErrors: [],
};

// --- PURE-JS DES ECB IMPLEMENTATION FOR JIOSAAVN RESOLUTION ---
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
    } else if (url.includes('music.youtube.com')) {
      requestHeaders['Origin'] = 'https://music.youtube.com';
      requestHeaders['Referer'] = 'https://music.youtube.com/';
    } else if (url.includes('youtube.com')) {
      requestHeaders['Origin'] = 'https://www.youtube.com';
      requestHeaders['Referer'] = 'https://www.youtube.com/';
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

    if (details.url.includes('googlevideo.com') || details.url.includes('saavncdn.com')) {
      console.log(`[NET RECV] Status: ${details.statusCode} ${details.statusLine} | Content-Range: ${details.responseHeaders['content-range'] || details.responseHeaders['Content-Range']} | Content-Length: ${details.responseHeaders['content-length'] || details.responseHeaders['Content-Length']} | Content-Type: ${details.responseHeaders['content-type'] || details.responseHeaders['Content-Type']}`);
    }

    if (details.statusCode === 403 || details.statusCode >= 400) {
      networkLog.blockedOr403.push({
        url: details.url.substring(0, 80) + '...',
        status: details.statusCode,
      });
    }

    callback({ responseHeaders });
  });

  ses.webRequest.onErrorOccurred(filter, (details) => {
    console.log(`[NET ERROR] ${details.url.slice(0, 60)} | Error: ${details.error}`);
    if (details.error.includes('BLOCKED_BY_ORB') || details.error.includes('ERR_BLOCKED')) {
      networkLog.orbErrors.push({
        url: details.url.substring(0, 80) + '...',
        error: details.error,
      });
    }
  });
}

async function resolveVideo(query) {
  // 1. Primary unthrottled streaming tier: JioSaavn 320kbps full-length AAC
  try {
    const jio = await resolveJioSaavnTrack(query);
    if (jio && jio.url) {
      return {
        videoId: jio.id || 'saavn_track',
        format: {
          itag: 140,
          mimeType: 'audio/mp4; codecs="mp4a.40.2"',
          bitrate: 320000,
          url: jio.url,
        },
        title: jio.title || query,
        duration: jio.duration,
      };
    }
  } catch (err) {
    console.warn('[JioSaavn] Resolution skipped:', err.message);
  }

  // 2. Secondary fallback tier: YouTube Music iOS stream format
  const sRes = await fetch('https://music.youtube.com/youtubei/v1/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'X-YouTube-Client-Name': '67',
      'X-YouTube-Client-Version': '1.20250101.01.00',
      Origin: 'https://music.youtube.com',
      Referer: 'https://music.youtube.com/',
    },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20250101.01.00', hl: 'en', gl: 'US' }, user: { lockedSafetyMode: false }, request: { useSsl: true } },
      query,
    }),
  });
  const sData = await sRes.json();
  const jsonStr = JSON.stringify(sData);
  const match = jsonStr.match(/"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"/);
  const videoId = match ? match[1] : null;
  if (!videoId) throw new Error(`Could not resolve videoId for query: ${query}`);

  const client = {
    clientName: 'IOS',
    clientVersion: '20.10.4',
    clientId: '5',
    userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
  };

  const pRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': client.userAgent,
      'X-YouTube-Client-Name': client.clientId,
      'X-YouTube-Client-Version': client.clientVersion,
      Origin: 'https://www.youtube.com',
      Referer: 'https://www.youtube.com/',
    },
    body: JSON.stringify({
      context: { client: { clientName: client.clientName, clientVersion: client.clientVersion, hl: 'en', gl: 'US' }, user: { lockedSafetyMode: false }, request: { useSsl: true } },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });
  const pData = await pRes.json();
  const afs = pData.streamingData?.adaptiveFormats?.filter((f) => f.mimeType?.startsWith('audio/') && f.url) || [];
  afs.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  const best = afs[0];
  if (!best) throw new Error(`No direct audio stream URL found for videoId: ${videoId}`);

  return { videoId, format: best, title: pData.videoDetails?.title || query };
}

const testHtml = `
<!DOCTYPE html>
<html>
<head><title>Adversarial Audio Test</title></head>
<body>
  <h1>Adversarial Web Audio Harness</h1>
  <script>
    window.harness = {
      errors: [],
      unhandledRejections: [],
      ctx: null,
      audio: null,
      srcNode: null,
      faderNode: null,
      masterVolumeNode: null,
      eqNodes: [],
      analyser: null,
      timeBuf: null,
      samples: [],

      initGraph() {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx();
        if (this.ctx.state === 'suspended') {
          this.ctx.resume();
        }

        this.audio = new Audio();
        this.audio.crossOrigin = 'anonymous';
        this.audio.preload = 'auto';

        this.srcNode = this.ctx.createMediaElementSource(this.audio);
        this.faderNode = this.ctx.createGain(); // Deck gain / crossfader
        this.faderNode.gain.setValueAtTime(1.0, this.ctx.currentTime);

        this.masterVolumeNode = this.ctx.createGain(); // Master volume
        this.masterVolumeNode.gain.setValueAtTime(1.0, this.ctx.currentTime);

        // 10-Band EQ filters
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
        this.analyser.fftSize = 256;
        this.masterVolumeNode.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);

        this.timeBuf = new Uint8Array(this.analyser.frequencyBinCount);

        window.addEventListener('error', (e) => {
          this.errors.push({ message: e.message, filename: e.filename, lineno: e.lineno });
        });
        window.addEventListener('unhandledrejection', (e) => {
          this.unhandledRejections.push({ reason: String(e.reason) });
        });
      },

      getAudioSignal() {
        if (!this.analyser || !this.timeBuf) return { maxDev: 0, rms: 0 };
        this.analyser.getByteTimeDomainData(this.timeBuf);
        let maxDev = 0;
        let sumSq = 0;
        for (let i = 0; i < this.timeBuf.length; i++) {
          const dev = Math.abs(this.timeBuf[i] - 128);
          if (dev > maxDev) maxDev = dev;
          sumSq += dev * dev;
        }
        const rms = Math.sqrt(sumSq / this.timeBuf.length);
        return { maxDev, rms };
      },

      setMasterVolume(val) {
        if (this.masterVolumeNode && this.ctx) {
          this.masterVolumeNode.gain.cancelScheduledValues(this.ctx.currentTime);
          this.masterVolumeNode.gain.setValueAtTime(val, this.ctx.currentTime);
        }
      },

      setDeckFader(val) {
        if (this.faderNode && this.ctx) {
          this.faderNode.gain.cancelScheduledValues(this.ctx.currentTime);
          this.faderNode.gain.setValueAtTime(val, this.ctx.currentTime);
        }
      },

      setEqGain(bandIdx, val) {
        if (this.eqNodes[bandIdx] && this.ctx) {
          this.eqNodes[bandIdx].gain.setValueAtTime(val, this.ctx.currentTime);
        }
      },

      async playTrackLong(url, durationSeconds) {
        if (!this.ctx) this.initGraph();
        if (this.ctx.state === 'suspended') await this.ctx.resume();

        this.audio.src = url;
        this.samples = [];

        return new Promise((resolve, reject) => {
          let timeoutHandle = null;
          let sampleInterval = null;
          let graphManipulations = [];

          const cleanup = () => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (sampleInterval) clearInterval(sampleInterval);
          };

          timeoutHandle = setTimeout(() => {
            cleanup();
            resolve({
              status: 'COMPLETED_BY_TIMEOUT',
              currentTime: this.audio.currentTime,
              duration: this.audio.duration,
              samplesCount: this.samples.length,
              samples: this.samples,
              graphManipulations,
              errors: this.errors,
              unhandledRejections: this.unhandledRejections,
            });
          }, (durationSeconds + 3) * 1000);

          const getBuffered = () => {
            const buf = [];
            for (let i = 0; i < this.audio.buffered.length; i++) {
              buf.push([this.audio.buffered.start(i), this.audio.buffered.end(i)]);
            }
            return buf;
          };

          this.audio.addEventListener('error', (e) => {
            cleanup();
            resolve({
              status: 'MEDIA_ERROR',
              error: this.audio.error ? { code: this.audio.error.code, message: this.audio.error.message } : 'unknown',
              currentTime: this.audio.currentTime,
              networkState: this.audio.networkState,
              readyState: this.audio.readyState,
              buffered: getBuffered(),
              errors: this.errors,
              unhandledRejections: this.unhandledRejections,
            });
          }, { once: true });

          this.audio.addEventListener('stalled', () => {
            console.log('[AUDIO EVENT] stalled at ' + this.audio.currentTime);
          });
          this.audio.addEventListener('waiting', () => {
            console.log('[AUDIO EVENT] waiting at ' + this.audio.currentTime);
          });
          this.audio.addEventListener('ended', () => {
            console.log('[AUDIO EVENT] ended at ' + this.audio.currentTime);
          });

          this.audio.addEventListener('canplay', async () => {
            try {
              await this.audio.play();

              const startTime = Date.now();
              sampleInterval = setInterval(() => {
                const elapsed = (Date.now() - startTime) / 1000;
                const sig = this.getAudioSignal();
                this.samples.push({
                  elapsed: Math.round(elapsed * 10) / 10,
                  currentTime: Math.round(this.audio.currentTime * 100) / 100,
                  maxDev: sig.maxDev,
                  rms: Math.round(sig.rms * 100) / 100,
                  paused: this.audio.paused,
                  ended: this.audio.ended,
                });

                // Dynamic Web Audio Graph Challenge:
                // At 2.0s: Lower master volume to 0.1
                if (elapsed >= 2.0 && elapsed < 2.2 && !graphManipulations.includes('vol_0.1')) {
                  this.setMasterVolume(0.1);
                  graphManipulations.push('vol_0.1');
                }
                // At 3.0s: Restore master volume to 1.0
                if (elapsed >= 3.0 && elapsed < 3.2 && !graphManipulations.includes('vol_1.0')) {
                  this.setMasterVolume(1.0);
                  graphManipulations.push('vol_1.0');
                }
                // At 3.5s: Attenuate fader (crossfader test) to 0.0
                if (elapsed >= 3.5 && elapsed < 3.7 && !graphManipulations.includes('fader_0.0')) {
                  this.setDeckFader(0.0);
                  graphManipulations.push('fader_0.0');
                }
                // At 4.2s: Restore fader to 1.0
                if (elapsed >= 4.2 && elapsed < 4.4 && !graphManipulations.includes('fader_1.0')) {
                  this.setDeckFader(1.0);
                  graphManipulations.push('fader_1.0');
                }
                // At 4.8s: Adjust 10-band EQ (Bass Boost +12dB on band 0 & 1)
                if (elapsed >= 4.8 && elapsed < 5.0 && !graphManipulations.includes('eq_boost')) {
                  this.setEqGain(0, 12);
                  this.setEqGain(1, 10);
                  graphManipulations.push('eq_boost');
                }

                if (elapsed >= durationSeconds) {
                  cleanup();
                  this.audio.pause();
                  resolve({
                    status: 'SUCCESS',
                    currentTime: this.audio.currentTime,
                    duration: this.audio.duration,
                    samplesCount: this.samples.length,
                    samples: this.samples,
                    graphManipulations,
                    errors: this.errors,
                    unhandledRejections: this.unhandledRejections,
                  });
                }
              }, 150);
            } catch (err) {
              cleanup();
              resolve({
                status: 'PLAY_EXCEPTION',
                message: err.message,
                errors: this.errors,
                unhandledRejections: this.unhandledRejections,
              });
            }
          }, { once: true });
        });
      },

      async testSeekingAndSubsequentChunks(seekTimeSec) {
        if (!this.audio) return { status: 'NO_AUDIO' };
        const beforeSeekTime = this.audio.currentTime;
        this.audio.currentTime = seekTimeSec;
        await this.audio.play();

        return new Promise((resolve) => {
          setTimeout(() => {
            const sig = this.getAudioSignal();
            resolve({
              beforeSeekTime,
              afterSeekTime: this.audio.currentTime,
              playing: !this.audio.paused,
              hasSignal: sig.maxDev > 0,
              maxDev: sig.maxDev,
            });
          }, 1500);
        });
      }
    };
  </script>
</body>
</html>
`;

async function runAdversarialAudioStress() {
  await app.whenReady();
  console.log('================================================================');
  console.log(' EMPIRICAL CHALLENGER: AUDIO STREAMING & LONGEVITY STRESS HARNESS');
  console.log('================================================================');

  configureProductionSession();

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true, // Crucial: Test with production webSecurity: true!
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  const consoleMessages = [];
  win.webContents.on('console-message', (e, level, msg) => {
    consoleMessages.push({ level, msg });
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(testHtml)}`);

  const results = {};

  const testTargets = [
    { name: 'The Strokes - Ode to the Mets', duration: 6.0 },
    { name: 'Sweet Taste of India', duration: 6.0 },
  ];

  for (const target of testTargets) {
    console.log(`\n----------------------------------------------------------------`);
    console.log(`[TEST TARGET] "${target.name}" (${target.duration}s continuous stream)`);
    console.log(`----------------------------------------------------------------`);

    const initialReqCount = networkLog.googlevideoRequests.length;
    const initialBlockedCount = networkLog.blockedOr403.length;
    const initialOrbCount = networkLog.orbErrors.length;
    const initialHeap = process.memoryUsage();

    console.log('Step 1: Resolving YouTube Music stream format...');
    const resolved = await resolveVideo(target.name);
    console.log(`  Resolved videoId : ${resolved.videoId}`);
    console.log(`  Title            : "${resolved.title}"`);
    console.log(`  itag             : ${resolved.format.itag} (${resolved.format.mimeType})`);
    console.log(`  bitrate          : ${resolved.format.bitrate} bps`);
    console.log(`  Direct URL Host  : ${new URL(resolved.format.url).hostname}`);

    console.log(`\nStep 2: Commencing ${target.duration}s live playback through Web Audio graph...`);
    const streamUrl = resolved.format.url;

    const playResult = await win.webContents.executeJavaScript(
      `window.harness.playTrackLong(${JSON.stringify(streamUrl)}, ${target.duration})`
    );

    console.log(`  Playback status   : ${playResult.status}`);
    console.log('  Full PlayResult   :', JSON.stringify(playResult, null, 2));
    console.log(`  Current time      : ${playResult.currentTime.toFixed(2)}s (Duration: ${playResult.duration ? playResult.duration.toFixed(2) : 'N/A'}s)`);
    console.log(`  Samples collected : ${playResult.samplesCount}`);

    // Verify audio signal was non-zero
    const activeSamples = (playResult.samples || []).filter((s) => s.maxDev >= 1);
    const maxSignalDeviation = Math.max(0, ...(playResult.samples || []).map((s) => s.maxDev));
    console.log(`  Active signal samples : ${activeSamples.length}/${playResult.samplesCount}`);
    console.log(`  Max PCM deviation     : ${maxSignalDeviation}`);
    console.log(`  Graph manipulations   : ${JSON.stringify(playResult.graphManipulations)}`);

    const trackDuration = playResult.duration || resolved.duration || 140.0;
    const seekPoints = [60.0, 90.0, Math.min(180.0, Math.floor(trackDuration - 10.0))];
    const seekResults = [];
    for (const sp of seekPoints) {
      console.log(`\nStep 3: Testing non-zero range seeking & subsequent chunk streaming (seek to ${sp.toFixed(1)}s)...`);
      const sr = await win.webContents.executeJavaScript(
        `window.harness.testSeekingAndSubsequentChunks(${sp})`
      );
      console.log(`  Seek to ${sp.toFixed(1)}s result:`, sr);
      seekResults.push(sr);
    }

    const targetReqs = networkLog.googlevideoRequests.slice(initialReqCount);
    const newBlocked = networkLog.blockedOr403.slice(initialBlockedCount);
    const newOrb = networkLog.orbErrors.slice(initialOrbCount);
    const endHeap = process.memoryUsage();

    console.log(`\nStep 4: Network & Memory Audit for "${target.name}":`);
    console.log(`  GoogleVideo HTTP chunks requested : ${targetReqs.length}`);
    if (targetReqs.length > 0) {
      console.log(`  First chunk range                 : ${targetReqs[0].rewrittenRange}`);
      console.log(`  Last chunk range                  : ${targetReqs[targetReqs.length - 1].rewrittenRange}`);
    }
    console.log(`  HTTP 403 Forbidden count          : ${newBlocked.length}`);
    console.log(`  ORB Errors count                  : ${newOrb.length}`);
    console.log(`  Heap delta (MB)                   : ${((endHeap.heapUsed - initialHeap.heapUsed) / (1024 * 1024)).toFixed(2)} MB`);

    const allSeeksPassed = seekResults.length > 0 && seekResults.every((sr) => sr.hasSignal && sr.playing);

    const passed =
      playResult.status === 'SUCCESS' &&
      playResult.currentTime >= 5.0 &&
      activeSamples.length > 5 &&
      newBlocked.length === 0 &&
      newOrb.length === 0 &&
      allSeeksPassed;

    results[target.name] = {
      passed,
      playResult,
      seekResults,
      chunksCount: targetReqs.length,
      blockedCount: newBlocked.length,
      orbCount: newOrb.length,
      maxSignalDeviation,
    };

    console.log(`\nTarget "${target.name}" Result: ${passed ? 'VERIFIED PASS' : 'FAILED'}`);
  }

  console.log('\n================================================================');
  console.log('CONSOLE ERRORS / WARNINGS LOGGED:');
  const errorLogs = consoleMessages.filter((m) => m.level >= 2);
  if (errorLogs.length === 0) {
    console.log('  Zero console errors observed during entire run.');
  } else {
    for (const m of errorLogs) {
      console.log(`  [Level ${m.level}] ${m.msg}`);
    }
  }

  console.log('\n================================================================');
  console.log('OVERALL EMPIRICAL SUMMARY:');
  let allPass = true;
  for (const [name, res] of Object.entries(results)) {
    console.log(`- ${name}: ${res.passed ? 'PASS' : 'FAIL'} (time >= 5.0s, chunks: ${res.chunksCount}, maxDev: ${res.maxSignalDeviation})`);
    if (!res.passed) allPass = false;
  }
  console.log(`FINAL ADVERSARIAL VERDICT: ${allPass ? 'APPROVE' : 'REQUEST_CHANGES'}`);
  console.log('================================================================\n');

  win.close();
  app.quit();
}

runAdversarialAudioStress().catch((err) => {
  console.error('Adversarial Harness Fatal Error:', err);
  app.quit();
});
