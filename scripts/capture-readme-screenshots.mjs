// scripts/capture-readme-screenshots.mjs
// Standalone Electron screenshot generator & DOM visual-integrity verifier for WaveForm Desktop.
// Usage: node scripts/capture-readme-screenshots.mjs
//
// Launches Electron at 1600x960 against pre-built dist/index.html using an isolated temporary
// userData directory, seeds procedural high-DPI album artwork + synced LRC lyrics with magic words,
// verifies zero broken images / zero off-screen left-edge bleed / zero top-left artifacts,
// and captures 6 flagship PNG screenshots into docs/screenshots/.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const screenshotsDir = path.resolve(rootDir, 'docs', 'screenshots');

const isElectronRuntime = Boolean(process.versions && process.versions.electron);

if (!isElectronRuntime) {
  const require = createRequire(import.meta.url);
  const electronBinary = require('electron');
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'waveform-screenshots-'));

  console.log(`[capture-screenshots] Spawning Electron screenshot harness (userData: ${tempUserData})...`);
  const env = { ...process.env, NODE_ENV: 'production' };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(
    electronBinary,
    [__filename, '--electron-worker', `--user-data-dir=${tempUserData}`],
    {
      cwd: rootDir,
      stdio: 'inherit',
      env,
    }
  );

  child.on('exit', (code) => {
    try {
      fs.rmSync(tempUserData, { recursive: true, force: true });
    } catch {
      // Ignore temp cleanup errors
    }
    process.exit(code ?? 1);
  });
} else {
  runElectronScreenshotHarness().catch((err) => {
    console.error('[capture-screenshots] Fatal error:', err);
    process.exit(1);
  });
}

/**
 * Generates a real 90-second 8kHz 16-bit mono PCM WAV file with a 124 BPM rhythmic pulse
 * and warm harmonic chord tones so HTML5 <audio> and Web Audio AnalyserNode run live at 60fps.
 */
function writeShowcaseWavFile(filePath, durationSec = 90) {
  const sampleRate = 8000;
  const numSamples = sampleRate * durationSec;
  const dataBytes = numSamples * 2;
  const buf = Buffer.alloc(44 + dataBytes);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20);  // PCM format
  buf.writeUInt16LE(1, 22);  // Mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);

  const beatPeriodSec = 60 / 124; // 124 BPM
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const beatPhase = (t % beatPeriodSec) / beatPeriodSec;
    const kickEnv = Math.exp(-beatPhase * 9.5);
    const kickFreq = 58 + 70 * Math.exp(-beatPhase * 18);
    const kick = Math.sin(2 * Math.PI * kickFreq * t) * kickEnv * 0.55;
    const pad =
      (Math.sin(2 * Math.PI * 220 * t) * 0.16 +
        Math.sin(2 * Math.PI * 277.18 * t) * 0.13 +
        Math.sin(2 * Math.PI * 329.63 * t) * 0.13 +
        Math.sin(2 * Math.PI * 440 * t) * 0.08) *
      (0.75 + 0.25 * Math.sin(2 * Math.PI * 0.5 * t));
    const sample = Math.max(-0.95, Math.min(0.95, kick + pad));
    buf.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }

  fs.writeFileSync(filePath, buf);
}

/**
 * Synced LRC lyrics carefully authored with timestamps across 0:00..1:25
 * containing all required magic words & code tokens:
 * - iOS Chat magic words / emojis: fire, rainbow, sparkle, plane, midnight
 * - Code Editor Kinetic tokens: cant, broken, back
 */
function buildShowcaseLrc() {
  return [
    '[00:00.00] Midnight signals glowing through the liquid glass horizon',
    '[00:04.20] Silver waves reflect the neon city lights tonight',
    '[00:08.50] Every heartbeat locks into the velvet stereo pulse',
    '[00:12.60] Chasing electric dreams across the crimson skyline',
    '[00:16.20] Under the midnight moon a silver plane flies high',
    '[00:19.60] Hearts on fire dancing through a neon rainbow sky',
    '[00:23.00] Every little sparkle turns the darkness into gold',
    '[00:26.40] Calling on the phone before the morning light appears',
    '[00:29.80] I cant erase the static from the midnight frequency',
    '[00:33.20] We turn back through the broken glass to find the spark',
    '[00:36.80] Never let the signal fade away into the void',
    '[00:40.40] Starfighter engines burning through the deep space asteroid belt',
    '[00:44.20] Hyperdrive velocity locked onto the distant nebula core',
    '[00:48.00] Banking past the cosmic debris into starlight harbor',
    '[00:52.50] Golden horizon rising over the crystal ocean tide',
    '[00:57.00] Echoes of the chorus floating in the midnight air',
  ].join('\n');
}

function buildParsedLyricsFromLrc(lrcText) {
  const rawLines = lrcText.split(/\r?\n/);
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const m = /^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.+)$/.exec(rawLines[i].trim());
    if (!m) continue;
    const mins = parseInt(m[1], 10);
    const secs = parseInt(m[2], 10);
    const frac = m[3].length === 2 ? parseInt(m[3], 10) * 10 : parseInt(m[3], 10);
    const startTimeMs = (mins * 60 + secs) * 1000 + frac;
    lines.push({
      lineIndex: lines.length,
      startTimeMs,
      endTimeMs: startTimeMs + 3400,
      text: m[4],
    });
  }
  for (let i = 0; i < lines.length - 1; i++) {
    lines[i].endTimeMs = lines[i + 1].startTimeMs;
  }
  return {
    type: 'SYNCED',
    provider: 'Embedded',
    isSynced: true,
    isRtl: false,
    lines,
  };
}

async function runElectronScreenshotHarness() {
  const electron = await import('electron');
  const { app, BrowserWindow, ipcMain, nativeImage, protocol } = electron.default || electron;

  const userDataArg = process.argv.find((a) => a.startsWith('--user-data-dir='));
  const tempUserDataDir = userDataArg
    ? userDataArg.slice('--user-data-dir='.length)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'waveform-shots-'));

  app.setPath('userData', tempUserDataDir);
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.commandLine.appendSwitch('mute-audio');
  app.commandLine.appendSwitch('force-device-scale-factor', '1');

  protocol?.registerSchemesAsPrivileged?.([
    {
      scheme: 'waveform-local',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
        corsEnabled: true,
      },
    },
    {
      scheme: 'waveform-stream',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
        corsEnabled: true,
      },
    },
  ]);

  await app.whenReady();

  fs.mkdirSync(screenshotsDir, { recursive: true });
  const showcaseWavPath = path.join(tempUserDataDir, 'showcase.wav');
  writeShowcaseWavFile(showcaseWavPath, 90);
  const showcaseLrc = buildShowcaseLrc();
  const showcaseParsedLyrics = buildParsedLyricsFromLrc(showcaseLrc);

  // Serve local WAV audio cleanly via waveform-local:// protocol
  protocol?.handle?.('waveform-local', async (request) => {
    const parsedUrl = new URL(request.url);
    const filePath = parsedUrl.searchParams.get('path') || showcaseWavPath;
    const buf = fs.readFileSync(fs.existsSync(filePath) ? filePath : showcaseWavPath);
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(buf.byteLength),
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      },
    });
  });

  // Register deterministic offline IPC handlers so the app never waits on network I/O
  let localLibraryCachePayload = { version: 1, folders: ['C:/Music/Lossless'], tracks: [], updatedAt: Date.now() };

  ipcMain.handle('window-minimize', () => {});
  ipcMain.handle('window-maximize', () => {});
  ipcMain.handle('window-close', () => {});
  ipcMain.handle('window-is-maximized', () => false);
  ipcMain.handle('window-set-fullscreen', () => false);
  ipcMain.handle('window-is-fullscreen', () => false);
  ipcMain.handle('network-fetch', async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: JSON.stringify({ contents: {} }),
  }));
  ipcMain.handle('autoeq-search', async () => [
    { id: 'sennheiser_hd600', name: 'Sennheiser HD 600', meta: 'Crinacle', parametric: true },
    { id: 'sony_wh1000xm4', name: 'Sony WH-1000XM4', meta: 'Oratory1990', parametric: true },
    { id: 'apple_airpods_max', name: 'Apple AirPods Max', meta: 'Rtings', parametric: true },
  ]);
  ipcMain.handle('autoeq-find-profile', async () => null);
  ipcMain.handle('select-local-folder', async () => ({ canceled: true, folderPath: null }));
  ipcMain.handle('scan-local-folder', async () => localLibraryCachePayload.tracks);
  ipcMain.handle('local-library-load-cache', async () => localLibraryCachePayload);
  ipcMain.handle('local-library-save-cache', async (_e, payload) => {
    if (payload && Array.isArray(payload.tracks)) {
      localLibraryCachePayload = { ...localLibraryCachePayload, ...payload, updatedAt: Date.now() };
    }
    return localLibraryCachePayload;
  });
  ipcMain.handle('local-library-incremental-scan', async () => ({
    folders: localLibraryCachePayload.folders,
    tracks: localLibraryCachePayload.tracks,
    added: 0,
    updated: 0,
    removed: 0,
  }));
  ipcMain.handle('local-library-remove-folder', async () => localLibraryCachePayload);
  ipcMain.handle('show-item-in-folder', async () => true);
  ipcMain.handle('local-get-metadata-cache', async () => ({
    lyrics: showcaseParsedLyrics,
  }));
  ipcMain.handle('local-set-metadata-cache', async (_e, _k, patch) => patch || null);
  ipcMain.handle('local-enrich-artwork', async () => null);
  ipcMain.handle('account-login', async () => ({ connected: false }));
  ipcMain.handle('account-status', async () => ({
    ytmusic: { connected: true, displayName: 'Audiophile Studio' },
    spotify: { connected: true, displayName: 'Spotify HiFi' },
  }));
  ipcMain.handle('account-logout', async () => {});
  ipcMain.handle('spotify-get-playlists', async () => []);
  ipcMain.handle('spotify-get-playlist-tracks', async () => []);
  ipcMain.handle('resolve-youtube-stream', async () => null);
  ipcMain.handle('get-artwork-pixels', async (_e, rawUrl) => {
    try {
      const m = /^data:image\/[^,;]+(?:;[^,;]+)*;base64,(.+)$/is.exec(String(rawUrl || '').trim());
      if (!m) return null;
      const buf = Buffer.from(m[1], 'base64');
      const img = nativeImage.createFromBuffer(buf);
      if (!img || img.isEmpty()) return null;
      const resized = img.resize({ width: 48, height: 48, quality: 'good' });
      const { width, height } = resized.getSize();
      const bitmap = resized.toBitmap();
      const expectedBytes = width * height * 4;
      const rgba = new Uint8Array(expectedBytes);
      for (let i = 0; i < expectedBytes; i += 4) {
        rgba[i] = bitmap[i + 2];
        rgba[i + 1] = bitmap[i + 1];
        rgba[i + 2] = bitmap[i];
        rgba[i + 3] = bitmap[i + 3];
      }
      return { width, height, rgba };
    } catch {
      return null;
    }
  });
  ipcMain.handle('lv-get-monitors', async () => [
    { id: 'primary', label: 'Primary Studio Display (1600×960)', isPrimary: true },
  ]);
  ipcMain.handle('lv-set-overlay-config', async (_e, cfg) => cfg);
  ipcMain.handle('lv-open-ambient', async () => true);
  ipcMain.handle('lv-close-ambient', async () => true);
  ipcMain.handle('lv-set-ambient-settings', async (_e, s) => s);
  ipcMain.handle('lv-get-lyrics-cache', async () => null);
  ipcMain.handle('lv-set-lyrics-cache', async () => true);
  ipcMain.handle('lv-get-song-offset', async () => 0);
  ipcMain.handle('lv-set-song-offset', async (_e, _k, offset) => offset || 0);
  ipcMain.handle('lv-request-snapshot', async () => null);
  ipcMain.handle('lv-set-keep-awake', async () => true);

  const preloadPath = path.join(rootDir, 'dist-electron', 'preload.cjs');
  const distIndexPath = path.join(rootDir, 'dist', 'index.html');

  if (!fs.existsSync(distIndexPath) || !fs.existsSync(preloadPath)) {
    throw new Error(
      `Missing built production assets (${distIndexPath} or ${preloadPath}). Run "npm run build" first.`
    );
  }

  const win = new BrowserWindow({
    width: 1600,
    height: 960,
    useContentSize: true,
    frame: false,
    show: false,
    backgroundColor: '#08080c',
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  win.setContentSize(1600, 960);
  await win.loadFile(distIndexPath);

  // Generate 9 distinct high-contrast procedural album covers in Canvas2D inside the renderer
  // and build our deterministic showcase library & playback session.
  const seededData = await win.webContents.executeJavaScript(`
    (() => {
      const albumSpecs = [
        {
          id: 'alb_prism_odyssey',
          trackId: 'local_prism_odyssey_01',
          title: 'Starlight Horizon',
          artist: 'Aether & Nova',
          album: 'Prism Odyssey',
          year: '2026',
          durationSec: 90,
          colors: ['#FF2E63', '#7928CA', '#00D2FF', '#120824'],
          accent: '#00F5D4',
          motif: 'prism',
        },
        {
          id: 'alb_cyber_bloom',
          trackId: 'local_cyber_bloom_01',
          title: 'Neon Protocol',
          artist: 'Kuroshio Syndicate',
          album: 'Cybernetic Bloom',
          year: '2026',
          durationSec: 90,
          colors: ['#0A84FF', '#5E5CE6', '#30D158', '#06101E'],
          accent: '#64D2FF',
          motif: 'rings',
        },
        {
          id: 'alb_obsidian_echo',
          trackId: 'local_obsidian_echo_01',
          title: 'Compiler of Glass',
          artist: 'Zero Allocation',
          album: 'Obsidian Runtime',
          year: '2026',
          durationSec: 90,
          colors: ['#FF2E3B', '#F5A623', '#7AA2F7', '#08090F'],
          accent: '#FF2E3B',
          motif: 'grid',
        },
        {
          id: 'alb_hyperdrive',
          trackId: 'local_hyperdrive_01',
          title: 'Valkyrie Vector',
          artist: 'Helios Command',
          album: 'Deep Space Telemetry',
          year: '2026',
          durationSec: 90,
          colors: ['#38BDF8', '#818CF8', '#F43F5E', '#050814'],
          accent: '#38BDF8',
          motif: 'star',
        },
        {
          id: 'alb_velvet_tides',
          trackId: 'local_velvet_tides_01',
          title: 'Midnight Harbor',
          artist: 'Sora Takahashi',
          album: 'Velvet Tides',
          year: '2025',
          durationSec: 214,
          colors: ['#F97316', '#EC4899', '#6366F1', '#14081C'],
          accent: '#FDBA74',
          motif: 'waves',
        },
        {
          id: 'alb_analog_dreams',
          trackId: 'local_analog_dreams_01',
          title: 'Phosphor CRT',
          artist: 'Modular 84',
          album: 'Analog Dreams',
          year: '2025',
          durationSec: 198,
          colors: ['#10B981', '#06B6D4', '#3B82F6', '#04120E'],
          accent: '#34D399',
          motif: 'rings',
        },
        {
          id: 'alb_chrome_heart',
          trackId: 'local_chrome_heart_01',
          title: 'Liquid Mercury',
          artist: 'Celeste Vance',
          album: 'Chrome Heart',
          year: '2026',
          durationSec: 226,
          colors: ['#C084FC', '#F472B6', '#38BDF8', '#0D0718'],
          accent: '#E879F9',
          motif: 'prism',
        },
        {
          id: 'alb_tokyo_rain',
          trackId: 'local_tokyo_rain_01',
          title: 'Shibuya Overpass',
          artist: 'Kenji & The Pulse',
          album: 'After Hours FM',
          year: '2025',
          durationSec: 242,
          colors: ['#F43F5E', '#FB923C', '#A855F7', '#160710'],
          accent: '#FDA4AF',
          motif: 'waves',
        },
        {
          id: 'alb_nordic_aurora',
          trackId: 'local_nordic_aurora_01',
          title: 'Glacier Frequency',
          artist: 'Freja Lindqvist',
          album: 'Polaris Spatial',
          year: '2026',
          durationSec: 205,
          colors: ['#2DD4BF', '#38BDF8', '#818CF8', '#041019'],
          accent: '#5EEAD4',
          motif: 'star',
        },
      ];

      function renderCoverDataUrl(spec) {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // Base multi-stop diagonal gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 512, 512);
        bgGrad.addColorStop(0, spec.colors[0]);
        bgGrad.addColorStop(0.45, spec.colors[1]);
        bgGrad.addColorStop(0.82, spec.colors[2]);
        bgGrad.addColorStop(1, spec.colors[3]);
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, 512, 512);

        // Vibrant radial orb highlights for multi-peak OKLCH palette extraction
        const orb1 = ctx.createRadialGradient(130, 140, 10, 130, 140, 230);
        orb1.addColorStop(0, spec.colors[0]);
        orb1.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = orb1;
        ctx.fillRect(0, 0, 512, 512);

        const orb2 = ctx.createRadialGradient(390, 360, 15, 390, 360, 240);
        orb2.addColorStop(0, spec.colors[2]);
        orb2.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = orb2;
        ctx.fillRect(0, 0, 512, 512);

        // Geometric artwork motif
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
        ctx.lineWidth = 2.5;
        if (spec.motif === 'prism') {
          for (let i = 0; i < 6; i++) {
            const r = 70 + i * 26;
            ctx.beginPath();
            ctx.moveTo(256, 256 - r);
            ctx.lineTo(256 + r * 0.9, 256 + r * 0.72);
            ctx.lineTo(256 - r * 0.9, 256 + r * 0.72);
            ctx.closePath();
            ctx.stroke();
          }
        } else if (spec.motif === 'rings') {
          for (let i = 1; i <= 7; i++) {
            ctx.beginPath();
            ctx.arc(256, 256, i * 28, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else if (spec.motif === 'grid') {
          for (let x = 64; x < 512; x += 48) {
            ctx.beginPath();
            ctx.moveTo(x, 48);
            ctx.lineTo(x, 464);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(48, x);
            ctx.lineTo(464, x);
            ctx.stroke();
          }
        } else if (spec.motif === 'star') {
          for (let i = 0; i < 16; i++) {
            const angle = (i / 16) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(256, 256);
            ctx.lineTo(256 + Math.cos(angle) * 210, 256 + Math.sin(angle) * 210);
            ctx.stroke();
          }
        } else {
          for (let row = 0; row < 8; row++) {
            ctx.beginPath();
            for (let x = 40; x <= 472; x += 12) {
              const y = 140 + row * 34 + Math.sin(x * 0.03 + row) * 18;
              if (x === 40) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
        }
        ctx.restore();

        // Dark glass lower badge for crisp album typography
        const scrim = ctx.createLinearGradient(0, 310, 0, 512);
        scrim.addColorStop(0, 'rgba(6, 7, 12, 0)');
        scrim.addColorStop(0.45, 'rgba(6, 7, 12, 0.62)');
        scrim.addColorStop(1, 'rgba(6, 7, 12, 0.88)');
        ctx.fillStyle = scrim;
        ctx.fillRect(0, 310, 512, 202);

        ctx.fillStyle = spec.accent;
        ctx.font = '700 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText(spec.artist.toUpperCase(), 38, 418);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = '800 34px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText(spec.album, 36, 458);

        ctx.fillStyle = 'rgba(255,255,255,0.68)';
        ctx.font = '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText('24-BIT / 96KHZ HI-RES LOSSLESS • ' + spec.year, 38, 484);

        return canvas.toDataURL('image/png');
      }

      return albumSpecs.map((spec) => ({
        ...spec,
        coverDataUrl: renderCoverDataUrl(spec),
      }));
    })()
  `);

  const streamUrl = `waveform-local://track?path=${encodeURIComponent(showcaseWavPath)}`;
  const tracks = seededData.map((item, idx) => ({
    videoId: item.trackId,
    id: item.trackId,
    title: item.title,
    artist: item.artist,
    album: item.album,
    albumName: item.album,
    albumArtist: item.artist,
    albumId: item.id,
    artistId: `artist_${idx}`,
    artistIds: [`artist_${idx}`],
    artists: [{ id: `artist_${idx}`, name: item.artist }],
    year: item.year,
    durationSec: item.durationSec,
    totalPlayTimeMs: item.durationSec * 1000,
    durationText: '1:30',
    thumbnailUrl: item.coverDataUrl,
    artworkUrl: item.coverDataUrl,
    streamUrl,
    localFilePath: showcaseWavPath,
    folderPath: 'C:/Music/Lossless',
    source: 'local',
    isLocal: true,
    playbackSourceType: 'LOCAL',
    sourceQuality: '24-bit / 96kHz FLAC',
    codec: 'FLAC',
    bitrate: 1411000,
    sampleRate: 96000,
    bitDepth: 24,
    liked: true,
    playCount: 14 + idx * 3,
    isExplicit: false,
    lyrics: showcaseLrc,
  }));

  localLibraryCachePayload = {
    version: 1,
    folders: ['C:/Music/Lossless'],
    tracks,
    updatedAt: Date.now(),
  };

  async function configureSceneAndReload({
    trackIndex = 0,
    positionMs = 16000,
    nowPlayingLyricsMode = 'classic',
    styleId = 'AppleMusicFlow',
    variationByStyle = {},
    nowPlayingLayout = 'split',
    hideAlbumCover = false,
    textAlign = 'left',
  }) {
    const activeTrack = tracks[trackIndex] || tracks[0];
    const sessionObj = {
      version: 1,
      savedAt: Date.now(),
      player: {
        currentTrack: activeTrack,
        positionMs,
        durationMs: activeTrack.totalPlayTimeMs,
        volume: 0.82,
        isMuted: false,
        preMuteVolume: 0.82,
        isShuffle: true,
        repeatMode: 'all',
        playbackState: 'PAUSED',
      },
      queue: {
        tiers: {
          USER_QUEUE: tracks.slice(1, 5),
          CONTEXT: tracks,
          AUTOPLAY: [],
        },
        currentSong: activeTrack,
        currentTier: 'CONTEXT',
        currentIndex: trackIndex,
        history: [tracks[0]],
        context: { type: 'ALBUM', id: activeTrack.albumId, title: activeTrack.album },
      },
    };

    const lvStorageObj = {
      config: {
        styleId,
        variationByStyle,
        fontId: 'SFProDisplay',
        fontSizeScale: 1.0,
        albumArtColorMatch: true,
        audioReactive: true,
        reduceMotion: false,
        motionIntensity: 'vivid',
        backgroundOpacity: 0.96,
        vignetteStrength: 0.55,
        textAlign,
        nowPlayingLayout,
        hideAlbumCover,
        overlayEnabled: false,
        overlayMonitorIds: ['primary'],
        overlayOpacity: 0.9,
        overlayLocked: true,
        idleAmbientSeconds: 0,
        keepAwakeInAmbient: true,
        gameGuardEnabled: true,
        sandboxEnabled: false,
      },
      perSongOffsetsMs: {},
      nowPlayingLyricsMode,
    };

    const appSettingsObj = {
      'ui.themeMode': 'dark',
      'ui.dynamicAccentColor': true,
      'ui.nowPlayingLayout': nowPlayingLayout,
      'ui.hideAlbumCover': hideAlbumCover,
      'ui.lyricsAlignment': textAlign,
      nowPlayingLayout,
      hideAlbumCover,
      lyricsAlignment: textAlign,
      'storage.localFolders': ['C:/Music/Lossless'],
    };

    const playlistsObj = [
      {
        id: 'pl_audiophile_reference',
        title: 'Audiophile Reference Masters',
        description: '24-Bit / 96kHz Spatial & Lossless Showcase',
        thumbnailUrl: tracks[0].thumbnailUrl,
        isCustom: true,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-22T00:00:00.000Z',
        songIds: tracks.map((t) => t.videoId),
        songCount: tracks.length,
        totalDurationSec: tracks.reduce((acc, t) => acc + t.durationSec, 0),
      },
    ];

    await win.webContents.executeJavaScript(`
      (() => {
        localStorage.setItem('waveform_playback_session', ${JSON.stringify(JSON.stringify(sessionObj))});
        localStorage.setItem('waveform.lyricVisualizer.v1', ${JSON.stringify(JSON.stringify(lvStorageObj))});
        localStorage.setItem('waveform_storage:waveform-desktop/settings.json', ${JSON.stringify(JSON.stringify(appSettingsObj))});
        localStorage.setItem('waveform_storage:waveform-desktop/favorites.json', ${JSON.stringify(JSON.stringify(tracks))});
        localStorage.setItem('waveform_storage:waveform-desktop/playlists.json', ${JSON.stringify(JSON.stringify(playlistsObj))});
        localStorage.setItem('waveform_sidebar_collapsed', 'false');
      })()
    `);

    await win.loadFile(distIndexPath);
    await new Promise((r) => setTimeout(r, 750));
  }

  async function openNowPlayingAndSeek(targetSec, seekClicks = []) {
    const opened = await win.webContents.executeJavaScript(`
      (async () => {
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }
        // Wait for BottomPlayerBar artwork lockup to mount after session hydration
        for (let i = 0; i < 30; i++) {
          if (document.querySelector('.artwork-lockup')) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        const lockup = document.querySelector('.artwork-lockup');
        if (lockup) {
          lockup.click();
        }
        await new Promise((r) => setTimeout(r, 150));
        if (!document.querySelector('[data-fullscreen]')) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true }));
        }
        for (let i = 0; i < 20; i++) {
          if (document.querySelector('[data-fullscreen]')) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        // Start playback via 'Space' shortcut so visualizers & fluid mesh animate live
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
        return Boolean(document.querySelector('[data-fullscreen]'));
      })()
    `);
    if (!opened) {
      throw new Error('NowPlayingScreen ([data-fullscreen]) failed to open! Cannot capture Now Playing screenshot.');
    }
    await new Promise((r) => setTimeout(r, 400));

    // Apply deterministic relative seek keystrokes + sync <audio> currentTime directly
    await win.webContents.executeJavaScript(`
      (() => {
        const steps = ${JSON.stringify(seekClicks)};
        for (const step of steps) {
          window.dispatchEvent(new KeyboardEvent('keydown', {
            key: step.key,
            code: step.code,
            shiftKey: Boolean(step.shiftKey),
            bubbles: true,
          }));
        }
        const target = ${Number(targetSec)};
        for (const a of document.querySelectorAll('audio')) {
          try {
            a.currentTime = target;
            a.dispatchEvent(new Event('timeupdate'));
            a.dispatchEvent(new Event('seeked'));
          } catch {}
        }
        // Nudge mouse slightly to keep minimal Now Playing chrome visible when desired
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 800, clientY: 480, bubbles: true }));
      })()
    `);
    await new Promise((r) => setTimeout(r, 950));
  }

  async function assertCleanDom(sceneName) {
    const audit = await win.webContents.executeJavaScript(`
      (() => {
        const brokenImages = [];
        const topLeftArtifacts = [];
        for (const img of document.querySelectorAll('img')) {
          const style = window.getComputedStyle(img);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
            continue;
          }
          const rect = img.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          if (img.complete && img.naturalWidth === 0) {
            brokenImages.push({
              src: (img.getAttribute('src') || '').slice(0, 80),
              alt: img.getAttribute('alt') || '',
              rect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
            });
            if (rect.left < 64 && rect.top < 64) {
              topLeftArtifacts.push({ src: img.getAttribute('src') || '', rect });
            }
          }
        }

        const leftEdgeBleeds = [];
        const candidates = document.querySelectorAll('p, span, h1, h2, h3, h4, div, button');
        for (const el of candidates) {
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
            continue;
          }
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          // Check for elements poking slightly onto the left edge of the viewport from off-screen negative X
          if (rect.right > 0 && rect.left < -4 && rect.right < 48) {
            const directText = Array.from(el.childNodes)
              .filter((n) => n.nodeType === Node.TEXT_NODE)
              .map((n) => (n.textContent || '').trim())
              .join('');
            if (directText.length > 0) {
              leftEdgeBleeds.push({
                tag: el.tagName,
                className: String(el.className || '').slice(0, 80),
                text: directText.slice(0, 40),
                rect: { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top) },
              });
            }
          }
        }

        return {
          brokenImages,
          topLeftArtifacts,
          leftEdgeBleeds,
          canvasCount: document.querySelectorAll('canvas').length,
        };
      })()
    `);

    if (audit.brokenImages.length > 0) {
      throw new Error(
        `[${sceneName}] Found ${audit.brokenImages.length} broken <img> tag(s): ${JSON.stringify(audit.brokenImages)}`
      );
    }
    if (audit.topLeftArtifacts.length > 0) {
      throw new Error(
        `[${sceneName}] Found ${audit.topLeftArtifacts.length} stray top-left broken icon(s): ${JSON.stringify(audit.topLeftArtifacts)}`
      );
    }
    if (audit.leftEdgeBleeds.length > 0) {
      throw new Error(
        `[${sceneName}] Found ${audit.leftEdgeBleeds.length} element(s) poking left of viewport: ${JSON.stringify(audit.leftEdgeBleeds)}`
      );
    }
    console.log(
      `[capture-screenshots] DOM check PASS for ${sceneName} (0 broken images, 0 left-edge bleeds, 0 top-left artifacts, ${audit.canvasCount} active canvases)`
    );
  }

  async function capturePng(fileName, sceneName) {
    await assertCleanDom(sceneName);
    const image = await win.webContents.capturePage();
    const pngBuffer = image.toPNG();
    const size = image.getSize();
    const outPath = path.join(screenshotsDir, fileName);
    fs.writeFileSync(outPath, pngBuffer);
    console.log(
      `[capture-screenshots] Saved ${fileName} (${size.width}x${size.height}, ${(pngBuffer.byteLength / 1024).toFixed(1)} KB)`
    );
  }

  // 1. 01-now-playing-apple-mesh.png (Classic Split View Apple Music fluid mesh)
  await configureSceneAndReload({
    trackIndex: 0,
    positionMs: 15000,
    nowPlayingLyricsMode: 'classic',
    styleId: 'AppleMusicFlow',
    nowPlayingLayout: 'split',
    hideAlbumCover: false,
    textAlign: 'left',
  });
  await openNowPlayingAndSeek(15.2, [{ key: 'ArrowRight', code: 'ArrowRight', shiftKey: true }]);
  await capturePng('01-now-playing-apple-mesh.png', '01-now-playing-apple-mesh');

  // 2. 02-visualizer-ios-chat.png (iOS Chat with Tapback pill & magic word / embed)
  await configureSceneAndReload({
    trackIndex: 1,
    positionMs: 20000,
    nowPlayingLyricsMode: 'visualizer',
    styleId: 'IosTextingMotion',
    variationByStyle: { IosTextingMotion: 'ios-dark' },
    nowPlayingLayout: 'split',
    hideAlbumCover: false,
    textAlign: 'center',
  });
  await openNowPlayingAndSeek(20.4, [
    { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true },
    { key: 'ArrowRight', code: 'ArrowRight', shiftKey: false },
  ]);
  await capturePng('02-visualizer-ios-chat.png', '02-visualizer-ios-chat');

  // 3. 03-visualizer-code-kinetic.png (Code Editor Kinetic IDE Macro)
  await configureSceneAndReload({
    trackIndex: 2,
    positionMs: 34000,
    nowPlayingLyricsMode: 'visualizer',
    styleId: 'CodeEditorKinetic',
    variationByStyle: { CodeEditorKinetic: 'ide-macro' },
    nowPlayingLayout: 'split',
    hideAlbumCover: false,
    textAlign: 'left',
  });
  await openNowPlayingAndSeek(34.2, [
    { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true },
    { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true },
    { key: 'ArrowRight', code: 'ArrowRight', shiftKey: false },
  ]);
  await capturePng('03-visualizer-code-kinetic.png', '03-visualizer-code-kinetic');

  // 4. 04-visualizer-spaceship-3d.png (Spaceship 3D starfighter + asteroids)
  await configureSceneAndReload({
    trackIndex: 3,
    positionMs: 45000,
    nowPlayingLyricsMode: 'visualizer',
    styleId: 'StarfieldShip3D',
    variationByStyle: { StarfieldShip3D: 'deep-space' },
    nowPlayingLayout: 'split',
    hideAlbumCover: false,
    textAlign: 'center',
  });
  await openNowPlayingAndSeek(45.0, [
    { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true },
    { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true },
    { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true },
  ]);
  await capturePng('04-visualizer-spaceship-3d.png', '04-visualizer-spaceship-3d');

  // 5. 05-centered-lyrics-mode.png (Centered Lyric Mode with hidden album cover & minimal bottom dock)
  await configureSceneAndReload({
    trackIndex: 4,
    positionMs: 20000,
    nowPlayingLyricsMode: 'classic',
    styleId: 'AppleMusicFlow',
    nowPlayingLayout: 'centered',
    hideAlbumCover: true,
    textAlign: 'center',
  });
  await openNowPlayingAndSeek(20.2, [
    { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true },
    { key: 'ArrowRight', code: 'ArrowRight', shiftKey: false },
  ]);
  await capturePng('05-centered-lyrics-mode.png', '05-centered-lyrics-mode');

  // 6. 06-cover-flow-library.png (Cover Flow & Desktop Library shell)
  await configureSceneAndReload({
    trackIndex: 0,
    positionMs: 15000,
    nowPlayingLyricsMode: 'classic',
    styleId: 'AppleMusicFlow',
    nowPlayingLayout: 'split',
    hideAlbumCover: false,
    textAlign: 'left',
  });
  await win.webContents.executeJavaScript(`
    (() => {
      const btn = document.querySelector('button[title="Albums (3D Flow)"]');
      if (btn) btn.click();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    })()
  `);
  await new Promise((r) => setTimeout(r, 950));
  await capturePng('06-cover-flow-library.png', '06-cover-flow-library');

  win.destroy();
  app.quit();
}
