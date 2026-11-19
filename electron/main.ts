import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, session } from 'electron';
import * as electronNs from 'electron';
const protocol = (electronNs as any).protocol as Electron.Protocol | undefined;
const dialog = (electronNs as any).dialog as Electron.Dialog;
import { Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeMetadataCacheKey,
  scanAudioFolderWithMetadata,
  resolveArtProtocolResponse,
  readMetadataDiskCache,
  writeMetadataDiskCache,
  fetchAndCacheArtwork,
} from './localMetadata.js';
import {
  applyYouTubeAuthHeaders,
  fetchSpotifyUserPlaylists,
  fetchSpotifyPlaylistTracks,
} from './accountAuth.js';
import {
  APP_USER_MODEL_ID,
  resolveAppIconPath,
  createTrayIcon,
} from './appIcon.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure command-line switches before app is ready to permit immediate audio output
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.platform === 'win32') {
  (app as any).setAppUserModelId?.(APP_USER_MODEL_ID);
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const isDev = process.env.NODE_ENV === 'development' || (!app.isPackaged && process.env.NODE_ENV !== 'production');

/**
 * Hardened RFC 7233 / RFC 9110 Range Header Rewriter
 * - Correctly parses numeric starts and ends
 * - Resolves suffix ranges (bytes=-SUFFIX) using clen or default offset
 * - Guards against NaN propagation on malformed/non-numeric headers
 * - Injects default bounded chunk (bytes=0-262143) on missing Range for chunked CDNs
 * - Clamps targetEnd to knownContentLength - 1 to prevent past-EOF 416 errors
 */
export function rewriteRangeHeader(
  rawRange: string | undefined | null,
  knownContentLength?: number | null,
  maxChunkSize = 256 * 1024
): string | undefined {
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

function configureMediaAndApiSession(): void {
  try {
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
      if (accountsState.ytmusic?.cookie && /(^|\.)youtube\.com$/.test(new URL(url).hostname)) {
        requestHeaders['Cookie'] = accountsState.ytmusic.cookie;
      }

      if (url.includes('googlevideo.com')) {
        // Strip Origin and Referer to prevent 302 redirect loops to 403 Forbidden on mobile stream URLs
        delete requestHeaders['Origin'];
        delete requestHeaders['Referer'];
        delete requestHeaders['origin'];
        delete requestHeaders['referer'];
        requestHeaders['User-Agent'] =
          'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)';

        // Hardened Range header rewriter specifically for googlevideo.com:
        let clen: number | null = null;
        try {
          const parsedUrl = new URL(url);
          const clenParam = parsedUrl.searchParams.get('clen');
          if (clenParam) {
            const parsed = parseInt(clenParam, 10);
            if (!isNaN(parsed) && parsed > 0) clen = parsed;
          }
        } catch {
          // Ignore URL parse error
        }

        const rawRange = requestHeaders['Range'] || requestHeaders['range'];
        // Pass Chromium's own ranges through (capping truncates <audio> mid-track); only seed when absent.
        if (!rawRange) requestHeaders['Range'] = rewriteRangeHeader(undefined, clen)!;
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

    const mediaCorsFilter = {
      urls: ['http://*/*', 'https://*/*'],
      types: ['media', 'xhr', 'fetch', 'image'] as any,
    };

    ses.webRequest.onHeadersReceived(mediaCorsFilter, (details, callback) => {
      const responseHeaders: Record<string, string | string[]> = {
        ...(details.responseHeaders || {}),
      };
      // Remove duplicate case-variant CORS headers (including ACAC, which conflicts with ACAO: *)
      for (const key of Object.keys(responseHeaders)) {
        const lower = key.toLowerCase();
        if (
          lower === 'access-control-allow-origin' ||
          lower === 'access-control-allow-headers' ||
          lower === 'access-control-allow-methods' ||
          lower === 'access-control-expose-headers' ||
          lower === 'access-control-allow-credentials'
        ) {
          delete responseHeaders[key];
        }
      }
      responseHeaders['Access-Control-Allow-Origin'] = ['*'];
      responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, HEAD, OPTIONS'];
      responseHeaders['Access-Control-Allow-Headers'] = ['*'];
      responseHeaders['Access-Control-Expose-Headers'] = ['Content-Length, Content-Range, Accept-Ranges'];

      callback({ responseHeaders });
    });
  } catch (err) {
    console.warn('Session webRequest configuration skipped:', err);
  }
}

function createWindow(): BrowserWindow {
  const iconPath = resolveAppIconPath(
    __dirname,
    (app as any).getAppPath?.(),
    process.resourcesPath
  );
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    ...(iconPath ? { icon: iconPath } : {}),
    frame: false,
    titleBarStyle: 'hidden',
    transparent: true,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  win.on('ready-to-show', () => {
    win.show();
  });

  // Window maximized state events
  win.on('maximize', () => {
    win.webContents.send('window-maximized-change', true);
  });

  win.on('unmaximize', () => {
    win.webContents.send('window-maximized-change', false);
  });

  loadWindowContent(win).catch((err) => {
    console.error('[WaveForm Main] Error in loadWindowContent:', err);
  });

  return win;
}

async function probeServer(url: string, timeoutMs = 1000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return res.status < 500;
  } catch {
    return false;
  }
}

async function loadWindowContent(win: BrowserWindow): Promise<void> {
  const distCandidatePaths = [
    path.resolve(__dirname, '../dist/index.html'),
    path.resolve(app.getAppPath(), 'dist/index.html'),
  ];
  const distIndexPath = distCandidatePaths.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

  // Safety net: catch did-fail-load event and fall back to local dist/index.html
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.warn(`[WaveForm Main] Page failed to load (${errorCode}: ${errorDescription}) at ${validatedURL}`);
    if (distIndexPath && validatedURL.includes('localhost:5173') && !win.isDestroyed()) {
      console.log('[WaveForm Main] Falling back to pre-built dist/index.html after URL load failure.');
      win.loadFile(distIndexPath).catch((err) => {
        console.error('[WaveForm Main] Fallback loadFile error:', err);
      });
    }
  });

  if (isDev) {
    // 3-attempt probe to dev server with backoff
    const maxAttempts = 3;
    const retryDelayMs = 600;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (win.isDestroyed()) return;
      console.log(`[WaveForm Main] Probing dev server (attempt ${attempt}/${maxAttempts}): ${devServerUrl}`);
      const isActive = await probeServer(devServerUrl, 1000);
      if (isActive) {
        console.log(`[WaveForm Main] Dev server active at ${devServerUrl}. Loading URL...`);
        try {
          await win.loadURL(devServerUrl);
          console.log(`[WaveForm Main] Successfully loaded dev server: ${devServerUrl}`);
          return;
        } catch (err: any) {
          console.warn(`[WaveForm Main] win.loadURL failed (${err?.message || err}).`);
        }
      }

      if (attempt < maxAttempts) {
        console.log(`[WaveForm Main] Dev server not active yet. Retrying in ${retryDelayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      } else {
        console.warn(`[WaveForm Main] Dev server unreachable after ${maxAttempts} probe attempts.`);
      }
    }
  }

  // Graceful fallback to production bundle if probe fails or if production
  if (distIndexPath && !win.isDestroyed()) {
    console.log(`[WaveForm Main] Loading local production bundle: ${distIndexPath}`);
    try {
      await win.loadFile(distIndexPath);
      return;
    } catch (err) {
      console.error('[WaveForm Main] Failed to load local bundle:', err);
    }
  }

  // Informative recovery card if neither dev server nor bundle is found
  if (!win.isDestroyed()) {
    const recoveryHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>WaveForm Desktop</title>
          <style>
            body {
              background-color: #0b0b0f;
              color: #f0f0f5;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              padding: 24px;
              box-sizing: border-box;
            }
            .card {
              background: rgba(255, 255, 255, 0.05);
              border: 1px solid rgba(255, 255, 255, 0.1);
              border-radius: 12px;
              padding: 32px;
              max-width: 520px;
              text-align: center;
              box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            }
            h1 { font-size: 20px; margin-bottom: 12px; color: #fa2d48; }
            p { font-size: 14px; color: #a0a0b0; line-height: 1.6; margin-bottom: 16px; }
            code { background: rgba(0,0,0,0.5); padding: 4px 8px; border-radius: 4px; font-size: 13px; color: #fff; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>WaveForm Desktop Launcher</h1>
            <p>The development server at <code>${devServerUrl}</code> is not running, and pre-built files were not found at <code>dist/index.html</code>.</p>
            <p>To run the developer environment with hot reload:<br /><br /><code>npm run dev</code></p>
            <p>Or to build and launch the desktop client:<br /><br /><code>npm run build && npm start</code></p>
          </div>
        </body>
      </html>
    `;
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(recoveryHtml)}`);
  }
}

function createTray(win: BrowserWindow): Tray | null {
  try {
    const icon = createTrayIcon(
      nativeImage,
      __dirname,
      (app as any).getAppPath?.(),
      process.resourcesPath
    );
    if (!icon) {
      console.warn('Tray icon file empty or missing');
      return null;
    }

    const trayInstance = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'WaveForm',
        click: () => {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'Play / Pause',
        click: () => {
          win.webContents.send('media-toggle-playback');
        },
      },
      {
        label: 'Next Track',
        click: () => {
          win.webContents.send('media-next-track');
        },
      },
      {
        label: 'Previous Track',
        click: () => {
          win.webContents.send('media-prev-track');
        },
      },
      { type: 'separator' },
      {
        label: 'Quit WaveForm',
        click: () => {
          app.quit();
        },
      },
    ]);

    trayInstance.setToolTip('WaveForm Music Player');
    trayInstance.setContextMenu(contextMenu);
    trayInstance.on('double-click', () => {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });

    return trayInstance;
  } catch (err) {
    console.warn('System tray initialization bypassed:', err);
    return null;
  }
}

// Window control IPC handlers
ipcMain.handle('window-minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('window-close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

ipcMain.handle('window-is-maximized', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow.isMaximized();
  }
  return false;
});

// CORS-free main-process network fetch handler for InnerTube, JioSaavn, LRCLIB, etc.
ipcMain.handle('network-fetch', async (_event, payload: { url: string; options?: Record<string, any> }) => {
  try {
    if (!payload || typeof payload.url !== 'string') {
      return { ok: false, status: 400, statusText: 'Invalid URL', text: '' };
    }
    const opts = payload.options || {};
    const headers = applyYouTubeAuthHeaders(
      payload.url,
      opts.headers || {},
      accountsState.ytmusic?.cookie
    );
    const response = await fetch(payload.url, {
      method: opts.method || 'GET',
      headers,
      body: opts.body,
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      text,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 500,
      statusText: err?.message || 'Network Fetch Error',
      text: '',
    };
  }
});

// AutoEQ Database IPC Handlers
let autoEqDatabaseInstance: any = null;

function getAutoEqDatabase(): any {
  if (autoEqDatabaseInstance) return autoEqDatabaseInstance;
  try {
    const { DatabaseSync } = (process as any).getBuiltinModule
      ? (process as any).getBuiltinModule('node:sqlite')
      : require('node:sqlite');
    if (!DatabaseSync) return null;

    const candidatePaths = [
      process.env.AUTOEQ_DB_PATH,
      path.resolve(__dirname, '../src/assets/data/auto_eq.db'),
      path.resolve(__dirname, '../dist/assets/data/auto_eq.db'),
      path.resolve(app.getAppPath(), 'src/assets/data/auto_eq.db'),
      path.resolve(app.getAppPath(), 'dist/assets/data/auto_eq.db'),
      path.resolve(process.resourcesPath, 'assets/data/auto_eq.db'),
      path.resolve(process.resourcesPath, 'src/assets/data/auto_eq.db'),
      path.resolve(process.cwd(), 'src/assets/data/auto_eq.db'),
      path.resolve(process.cwd(), 'dist/assets/data/auto_eq.db'),
    ].filter((p): p is string => typeof p === 'string' && p.length > 0);

    for (const candidate of candidatePaths) {
      if (fs.existsSync(candidate)) {
        autoEqDatabaseInstance = new DatabaseSync(candidate, { readOnly: true });
        break;
      }
    }
  } catch (err) {
    console.warn('[WaveForm Main] AutoEQ Database load bypassed:', err);
  }
  return autoEqDatabaseInstance;
}

const PAP_TAG_MAP: Record<number, string> = {
  0x7003: 'PEAKING',
  0x7004: 'LOW_SHELF',
  0x7005: 'HIGH_SHELF',
  0x7006: 'LOW_PASS',
  0x7007: 'HIGH_PASS',
  0x7008: 'BAND_PASS',
};

function decodePapBlobInMain(blob: Uint8Array): any[] {
  const HEADER_SIZE = 36;
  const RECORD_SIZE = 20;
  if (!blob || blob.byteLength < HEADER_SIZE) return [];
  if (blob[0] !== 0x50 || blob[1] !== 0x61 || blob[2] !== 0x50 || blob[3] !== 0x01) {
    return [];
  }
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const filters: any[] = [];
  const maxNyquist = 21609;
  for (let i = HEADER_SIZE; i + RECORD_SIZE <= blob.byteLength; i += RECORD_SIZE) {
    const tag = view.getUint32(i, true);
    const gainDb = view.getFloat32(i + 4, true);
    const freq = view.getUint32(i + 8, true);
    const q = view.getFloat32(i + 12, true);
    const safeFreq = Math.min(freq, maxNyquist);
    const safeQ = q > 0.1 ? q : 0.1;
    const safeGain = Math.max(-24, Math.min(12, gainDb));
    filters.push({
      type: PAP_TAG_MAP[tag] || 'PEAKING',
      freq: safeFreq,
      q: Number(safeQ.toFixed(2)),
      gainDb: Number(safeGain.toFixed(1)),
    });
  }
  return filters;
}

function calculatePreampInMain(filters: any[]): number {
  let maxBoost = 0;
  for (const f of filters) {
    if (f.gainDb > maxBoost) maxBoost = f.gainDb;
  }
  return maxBoost > 0 ? -Number(maxBoost.toFixed(1)) : 0.0;
}

ipcMain.handle('autoeq-search', async (_event, query: string, limit = 20) => {
  if (!query || typeof query !== 'string' || !query.trim()) return [];
  const trimmed = query.trim().toLowerCase();
  const db = getAutoEqDatabase();
  const results: any[] = [];

  const curated = [
    { id: 'sony_wh1000xm4', name: 'Sony WH-1000XM4', meta: 'Oratory1990', parametric: true },
    { id: 'sennheiser_hd600', name: 'Sennheiser HD 600', meta: 'Crinacle', parametric: true },
    { id: 'apple_airpods_max', name: 'Apple AirPods Max', meta: 'Rtings', parametric: true },
  ];
  for (const c of curated) {
    if (c.name.toLowerCase().includes(trimmed) || c.id.includes(trimmed)) {
      results.push(c);
    }
  }

  if (db) {
    try {
      const rows = db.prepare(
        'SELECT _id, name, meta, parametric FROM eq_presets WHERE LOWER(name) LIKE ? ORDER BY parametric DESC LIMIT ?'
      ).all(`%${trimmed}%`, limit);
      for (const row of rows) {
        if (!results.some((r: any) => r.name.toLowerCase() === row.name.toLowerCase())) {
          results.push({
            id: row._id,
            name: row.name,
            meta: row.meta,
            parametric: row.parametric === 1,
          });
        }
      }
    } catch (err) {
      console.warn('[WaveForm Main] AutoEQ IPC search error:', err);
    }
  }
  return results.slice(0, limit);
});

ipcMain.handle('autoeq-find-profile', async (_event, nameOrId: string) => {
  if (!nameOrId || typeof nameOrId !== 'string') return null;
  const trimmed = nameOrId.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  const curatedProfiles: Record<string, any> = {
    sony_wh1000xm4: {
      id: 'sony_wh1000xm4',
      name: 'Sony WH-1000XM4',
      type: 'Over-Ear',
      source: 'Oratory1990',
      preampGainDb: -5.6,
      filters: [
        { type: 'LOW_SHELF', freq: 105, q: 0.71, gainDb: -4.5 },
        { type: 'PEAKING', freq: 210, q: 1.4, gainDb: 2.8 },
        { type: 'PEAKING', freq: 1100, q: 2.1, gainDb: -3.2 },
        { type: 'PEAKING', freq: 3200, q: 3.0, gainDb: 4.5 },
        { type: 'PEAKING', freq: 6400, q: 2.5, gainDb: -2.0 },
        { type: 'HIGH_SHELF', freq: 10000, q: 0.71, gainDb: -1.5 },
      ],
    },
    sennheiser_hd600: {
      id: 'sennheiser_hd600',
      name: 'Sennheiser HD 600',
      type: 'Open-Back Over-Ear',
      source: 'Crinacle',
      preampGainDb: -6.2,
      filters: [
        { type: 'LOW_SHELF', freq: 80, q: 0.71, gainDb: 5.5 },
        { type: 'PEAKING', freq: 200, q: 1.2, gainDb: -1.0 },
        { type: 'PEAKING', freq: 3500, q: 2.5, gainDb: -2.5 },
        { type: 'PEAKING', freq: 5800, q: 4.0, gainDb: 2.0 },
        { type: 'HIGH_SHELF', freq: 12000, q: 0.71, gainDb: 1.0 },
      ],
    },
    apple_airpods_max: {
      id: 'apple_airpods_max',
      name: 'Apple AirPods Max',
      type: 'Over-Ear ANC',
      source: 'Rtings',
      preampGainDb: -3.8,
      filters: [
        { type: 'LOW_SHELF', freq: 90, q: 0.71, gainDb: -2.0 },
        { type: 'PEAKING', freq: 1250, q: 1.8, gainDb: 1.5 },
        { type: 'PEAKING', freq: 4100, q: 2.8, gainDb: -3.0 },
        { type: 'HIGH_SHELF', freq: 8500, q: 0.71, gainDb: 2.2 },
      ],
    },
  };

  for (const [key, prof] of Object.entries(curatedProfiles)) {
    if (key === lower || prof.name.toLowerCase() === lower) {
      return prof;
    }
  }

  const db = getAutoEqDatabase();
  if (db) {
    try {
      let row = db.prepare(
        `SELECT name, meta, data_blob FROM eq_presets 
         WHERE LOWER(name) = ? AND parametric = 1 
         ORDER BY CASE WHEN meta LIKE '%Oratory1990%' THEN 1 WHEN meta LIKE '%Crinacle%' THEN 2 WHEN meta LIKE '%Rtings%' THEN 3 ELSE 4 END, _id ASC LIMIT 1`
      ).get(lower);

      if (!row || !row.data_blob) {
        row = db.prepare(
          `SELECT name, meta, data_blob FROM eq_presets 
           WHERE LOWER(name) LIKE ? AND parametric = 1 
           ORDER BY CASE WHEN meta LIKE '%Oratory1990%' THEN 1 WHEN meta LIKE '%Crinacle%' THEN 2 WHEN meta LIKE '%Rtings%' THEN 3 ELSE 4 END, _id ASC LIMIT 1`
        ).get(`%${lower}%`);
      }

      if (row && row.data_blob) {
        const uint8 = new Uint8Array(row.data_blob);
        const filters = decodePapBlobInMain(uint8);
        const preampGainDb = calculatePreampInMain(filters);
        return {
          id: row.name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
          name: row.name,
          source: row.meta || 'AutoEQ',
          preampGainDb,
          filters,
        };
      }
    } catch (err) {
      console.warn('[WaveForm Main] AutoEQ IPC find profile error:', err);
    }
  }
  return null;
});

// App lifecycle

// ---------- Local media: waveform-local:// protocol, folder picker, scanner ----------
const AUDIO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg; codecs=opus',
};

protocol?.registerSchemesAsPrivileged([
  { scheme: 'waveform-local', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } },
]);

function registerLocalProtocol(): void {
  protocol?.handle('waveform-local', async (request) => {
    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      'Accept-Ranges': 'bytes',
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    try {
      const parsedUrl = new URL(request.url);
      if (parsedUrl.hostname === 'art') {
        return resolveArtProtocolResponse(parsedUrl, app.getPath('userData'));
      }
      const filePath = parsedUrl.searchParams.get('path') || '';
      const mime = AUDIO_MIME[path.extname(filePath).toLowerCase()];
      if (!filePath || !mime) return new Response('Forbidden', { status: 403, headers: corsHeaders });
      const size = (await fs.promises.stat(filePath)).size;
      const base = { ...corsHeaders, 'Content-Type': mime };
      const m = /^bytes=(\d*)-(\d*)$/.exec((request.headers.get('range') || '').trim());
      let start = 0;
      let end = size - 1;
      if (m && (m[1] || m[2])) {
        if (m[1]) {
          start = parseInt(m[1], 10);
          if (m[2]) end = Math.min(parseInt(m[2], 10), size - 1);
        } else {
          start = Math.max(0, size - parseInt(m[2], 10));
        }
        if (start > end || start >= size) {
          return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
        }
        const body = Readable.toWeb(fs.createReadStream(filePath, { start, end })) as unknown as ReadableStream;
        return new Response(body, { status: 206, headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
      }
      if (size === 0) return new Response(null, { status: 200, headers: { ...base, 'Content-Length': '0' } });
      const body = Readable.toWeb(fs.createReadStream(filePath)) as unknown as ReadableStream;
      return new Response(body, { status: 200, headers: { ...base, 'Content-Length': String(size) } });
    } catch {
      return new Response('Not found', { status: 404, headers: corsHeaders });
    }
  });
}

function resolveDiskCacheKeyArg(
  keyOrTrack: string | { artist?: string; title?: string; durationSec?: number }
): string {
  if (typeof keyOrTrack === 'string') {
    return keyOrTrack;
  }
  if (keyOrTrack && typeof keyOrTrack === 'object') {
    return computeMetadataCacheKey(
      keyOrTrack.artist || '',
      keyOrTrack.title || '',
      keyOrTrack.durationSec
    );
  }
  return '';
}

ipcMain.handle('select-local-folder', async () => {
  const r = mainWindow
    ? await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    : await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return { canceled: r.canceled, folderPath: r.canceled ? null : r.filePaths[0] ?? null };
});

ipcMain.handle('scan-local-folder', (_e, folderPath: string) =>
  typeof folderPath === 'string' && folderPath
    ? scanAudioFolderWithMetadata(folderPath, app.getPath('userData'))
    : []
);

ipcMain.handle(
  'local-get-metadata-cache',
  async (_e, keyOrTrack: string | { artist?: string; title?: string; durationSec?: number }) => {
    const key = resolveDiskCacheKeyArg(keyOrTrack);
    return key ? readMetadataDiskCache(app.getPath('userData'), key) : null;
  }
);

ipcMain.handle(
  'local-set-metadata-cache',
  async (
    _e,
    keyOrTrack: string | { artist?: string; title?: string; durationSec?: number },
    patch: Record<string, any>
  ) => {
    const key = resolveDiskCacheKeyArg(keyOrTrack);
    if (!key || !patch || typeof patch !== 'object') return null;
    return writeMetadataDiskCache(app.getPath('userData'), key, patch);
  }
);

ipcMain.handle(
  'local-enrich-artwork',
  async (
    _e,
    payload: { artist?: string; title?: string; durationSec?: number }
  ) => {
    if (!payload || typeof payload.title !== 'string') return null;
    return fetchAndCacheArtwork(
      app.getPath('userData'),
      payload.artist || '',
      payload.title,
      payload.durationSec
    );
  }
);

// ---------- Accounts: YouTube Music + Spotify ----------
type Provider = 'ytmusic' | 'spotify';
interface StoredAccount { connected: boolean; displayName?: string; cookie?: string; connectedAt?: number }
const accountsFile = () => path.join(app.getPath('userData'), 'accounts.json');
const accountsState: Partial<Record<Provider, StoredAccount>> = (() => {
  try { return JSON.parse(fs.readFileSync(accountsFile(), 'utf-8')); } catch { return {}; }
})();
const saveAccounts = () => { try { fs.writeFileSync(accountsFile(), JSON.stringify(accountsState)); } catch { /* ignore */ } };

const PROVIDERS: Record<Provider, { url: string; domain: string; cookie: string[] }> = {
  ytmusic: { url: 'https://music.youtube.com', domain: 'youtube.com', cookie: ['SAPISID', '__Secure-3PAPISID'] },
  spotify: { url: 'https://accounts.spotify.com/en/login?continue=https%3A%2F%2Fopen.spotify.com%2F', domain: 'spotify.com', cookie: ['sp_dc'] },
};

function loginProvider(provider: Provider): Promise<{ connected: boolean; displayName?: string }> {
  const cfg = PROVIDERS[provider];
  return new Promise((resolve) => {
    const ses = session.fromPartition('persist:' + provider);
    const win = new BrowserWindow({ width: 520, height: 720, parent: mainWindow ?? undefined, title: 'Sign in', webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false } });
    win.setMenuBarVisibility(false);
    let done = false;
    const finish = async (ok: boolean) => {
      if (done) return;
      done = true;
      ses.cookies.removeListener('changed', check);
      if (!win.isDestroyed()) win.close();
      resolve(ok ? { connected: true, displayName: accountsState[provider]?.displayName } : { connected: false });
    };
    const check = async () => {
      if (done) return;
      const cookies = await ses.cookies.get({ domain: cfg.domain });
      if (!cookies.some((c) => cfg.cookie.includes(c.name) && c.value)) return;
      let displayName: string | undefined;
      try {
        displayName = provider === 'ytmusic'
          ? (await win.webContents.executeJavaScript(`document.querySelector('ytmusic-settings-button img')?.alt || ''`)) || undefined
          : undefined;
      } catch { /* ignore */ }
      accountsState[provider] = {
        connected: true, displayName: displayName || (provider === 'ytmusic' ? 'YouTube Music' : 'Spotify'),
        cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '), connectedAt: Date.now(),
      };
      saveAccounts();
      void finish(true);
    };
    ses.cookies.on('changed', check);
    win.on('closed', () => void finish(false));
    void win.loadURL(cfg.url);
  });
}

ipcMain.handle('account-login', (_e, provider: Provider) => PROVIDERS[provider] ? loginProvider(provider) : { connected: false });
ipcMain.handle('account-status', () => ({
  ytmusic: { connected: !!accountsState.ytmusic?.connected, displayName: accountsState.ytmusic?.displayName },
  spotify: { connected: !!accountsState.spotify?.connected, displayName: accountsState.spotify?.displayName },
}));
ipcMain.handle('account-logout', async (_e, provider: Provider) => {
  if (!PROVIDERS[provider]) return;
  delete accountsState[provider];
  saveAccounts();
  await session.fromPartition('persist:' + provider).clearStorageData();
});

ipcMain.handle('spotify-get-playlists', async () => {
  const cookie = accountsState.spotify?.cookie;
  if (!cookie) return [];
  return fetchSpotifyUserPlaylists(cookie);
});

ipcMain.handle('spotify-get-playlist-tracks', async (_e, playlistId: string) => {
  const cookie = accountsState.spotify?.cookie;
  if (!cookie || !playlistId || typeof playlistId !== 'string') return [];
  return fetchSpotifyPlaylistTracks(cookie, playlistId);
});
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerLocalProtocol();
    configureMediaAndApiSession();
    mainWindow = createWindow();
    tray = createTray(mainWindow);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
