import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, session } from 'electron';
import * as electronNs from 'electron';
const protocol = (electronNs as any).protocol as Electron.Protocol | undefined;
const dialog = (electronNs as any).dialog as Electron.Dialog;
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
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
  loadLocalLibraryCache,
  saveLocalLibraryCache,
  incrementalScanLocalFolders,
  removeLocalLibraryFolder,
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
import {
  resolveYoutubeStreamForIpc,
  resolveYoutubeStreamProtocolRequest,
  resolveRemoteAudioProxyRequest,
  destroyAllSabrStreams,
} from './youtubeSabrStream.js';
import { createLyricVisualizerPlatformController } from './lyricVisualizerPlatform.js';
import {
  prewarmAutoEqDb,
  searchAutoEqDb,
  getAutoEqProfile,
  getAutoEqStatus,
} from './autoEqDb.js';
import {
  startPartyLanHost,
  stopPartyLanHost,
  getPartyLanInfo,
  type LanHostOptions,
} from './partyLanServer.js';
import {
  getSharedDiscordRpc,
  type DiscordPlaybackInput,
  type DiscordRpcConfig,
} from './discordRpc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure command-line switches before app is ready to permit immediate audio output
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.platform === 'win32') {
  (app as any).setAppUserModelId?.(APP_USER_MODEL_ID);
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let lyricVisualizerPlatform: ReturnType<typeof createLyricVisualizerPlatformController> | null = null;
let isQuitting = false;
const trayBehavior = {
  minimizeToTray: true,
  closeToTray: false,
};

const isDev = !app.isPackaged && (process.env.NODE_ENV === 'development' || process.env.NODE_ENV !== 'production');

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

    const mediaCorsFilter: Electron.WebRequestFilter = {
      urls: ['http://*/*', 'https://*/*'],
      types: ['media', 'xhr', 'image'],
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

  win.on('enter-full-screen', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('window-fullscreen-change', true);
    }
  });

  win.on('leave-full-screen', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('window-fullscreen-change', false);
    }
  });

  win.on('minimize', (event: Electron.Event) => {
    if (!isQuitting && tray && trayBehavior.minimizeToTray && !win.isDestroyed()) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('close', (event: Electron.Event) => {
    if (!isQuitting && tray && trayBehavior.closeToTray && !win.isDestroyed()) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
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

async function loadWindowContent(win: BrowserWindow, hashRoute?: string): Promise<void> {
  const cleanHash = hashRoute ? hashRoute.replace(/^#/, '') : '';
  const loadOptions = cleanHash ? { hash: cleanHash } : undefined;
  const distCandidatePaths = [
    path.resolve(__dirname, '../dist/index.html'),
    path.resolve(app.getAppPath(), 'dist/index.html'),
    ...(process.resourcesPath
      ? [
          path.resolve(process.resourcesPath, 'app.asar/dist/index.html'),
          path.resolve(process.resourcesPath, 'app/dist/index.html'),
          path.resolve(process.resourcesPath, 'dist/index.html'),
        ]
      : []),
  ];
  const distIndexPath = distCandidatePaths.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  const targetDevUrl = cleanHash ? `${devServerUrl}#${cleanHash}` : devServerUrl;

  // Safety net: catch did-fail-load event and fall back to local dist/index.html
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.warn(`[WaveForm Main] Page failed to load (${errorCode}: ${errorDescription}) at ${validatedURL}`);
    if (distIndexPath && validatedURL.includes('localhost:5173') && !win.isDestroyed()) {
      console.log('[WaveForm Main] Falling back to pre-built dist/index.html after URL load failure.');
      win.loadFile(distIndexPath, loadOptions).catch((err) => {
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
        console.log(`[WaveForm Main] Dev server active at ${targetDevUrl}. Loading URL...`);
        try {
          await win.loadURL(targetDevUrl);
          console.log(`[WaveForm Main] Successfully loaded dev server: ${targetDevUrl}`);
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
      await win.loadFile(distIndexPath, loadOptions);
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

function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray(): Tray | null {
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
          showMainWindow();
        },
      },
      { type: 'separator' },
      {
        label: 'Play / Pause',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('media-toggle-playback');
          }
        },
      },
      {
        label: 'Next Track',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('media-next-track');
          }
        },
      },
      {
        label: 'Previous Track',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('media-prev-track');
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Quit WaveForm',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);

    trayInstance.setToolTip('WaveForm Music Player');
    trayInstance.setContextMenu(contextMenu);
    trayInstance.on('double-click', () => {
      showMainWindow();
    });

    return trayInstance;
  } catch (err) {
    console.warn('System tray initialization bypassed:', err);
    return null;
  }
}

// Window control IPC handlers
ipcMain.handle('ui:setTrayBehavior', (_event, behavior?: { minimizeToTray?: boolean; closeToTray?: boolean }) => {
  if (behavior && typeof behavior === 'object') {
    if (typeof behavior.minimizeToTray === 'boolean') {
      trayBehavior.minimizeToTray = behavior.minimizeToTray;
    }
    if (typeof behavior.closeToTray === 'boolean') {
      trayBehavior.closeToTray = behavior.closeToTray;
    }
  }
});
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

ipcMain.handle('window-set-fullscreen', (_event, flag: boolean) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(Boolean(flag));
    return mainWindow.isFullScreen();
  }
  return false;
});

ipcMain.handle('window-is-fullscreen', () => {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isFullScreen() : false;
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

// AutoEQ Database & Packaged Data Asset Resolution (`auto_eq.db`, `.onnx` models)
export function resolveDataAssetCandidatePaths(filename: string): string[] {
  const safeName = path.basename(filename);
  const unpackedResourceCandidates = process.resourcesPath
    ? [
        path.resolve(process.resourcesPath, 'assets/data', safeName),
        path.resolve(process.resourcesPath, 'src/assets/data', safeName),
        path.resolve(process.resourcesPath, 'dist/assets/data', safeName),
      ]
    : [];
  const appAndDevCandidates = [
    path.resolve(__dirname, '../src/assets/data', safeName),
    path.resolve(__dirname, '../dist/assets/data', safeName),
    path.resolve(app.getAppPath(), 'src/assets/data', safeName),
    path.resolve(app.getAppPath(), 'dist/assets/data', safeName),
    path.resolve(process.cwd(), 'src/assets/data', safeName),
    path.resolve(process.cwd(), 'dist/assets/data', safeName),
  ];
  const ordered = app.isPackaged
    ? [...unpackedResourceCandidates, ...appAndDevCandidates]
    : [...appAndDevCandidates, ...unpackedResourceCandidates];
  return Array.from(new Set(ordered.filter((p): p is string => typeof p === 'string' && p.length > 0)));
}

export function resolvePackagedDataAssetPath(filename: string): string | null {
  for (const candidate of resolveDataAssetCandidatePaths(filename)) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore inaccessible candidate path
    }
  }
  return null;
}

const handleAutoEqSearch = async (_event: Electron.IpcMainInvokeEvent, query: string, limit = 20) => {
  return searchAutoEqDb(query, limit, resolveDataAssetCandidatePaths('auto_eq.db'));
};

const handleAutoEqProfile = async (_event: Electron.IpcMainInvokeEvent, nameOrId: string | number) => {
  return getAutoEqProfile(nameOrId, resolveDataAssetCandidatePaths('auto_eq.db'));
};

ipcMain.handle('autoeq:search', handleAutoEqSearch);
ipcMain.handle('autoeq:getProfile', handleAutoEqProfile);
ipcMain.handle('autoeq:status', async () => getAutoEqStatus(resolveDataAssetCandidatePaths('auto_eq.db')));
ipcMain.handle('autoeq-search', handleAutoEqSearch);
ipcMain.handle('autoeq-find-profile', handleAutoEqProfile);

// Listen Together LAN WebSocket Host IPC
ipcMain.handle('party:startLanHost', async (_event, options?: LanHostOptions) => {
  return startPartyLanHost(options);
});

ipcMain.handle('party:stopLanHost', async () => {
  await stopPartyLanHost();
  return true;
});

ipcMain.handle('party:getLanInfo', async () => {
  return getPartyLanInfo();
});

// Discord Rich Presence IPC
ipcMain.handle('discordRpc:update', async (_event, payload: DiscordPlaybackInput) => {
  if (!payload || typeof payload !== 'object') return false;
  return getSharedDiscordRpc().update(payload);
});

ipcMain.handle('discordRpc:clear', async () => {
  getSharedDiscordRpc().clear();
  return true;
});

ipcMain.handle('discordRpc:getStatus', async () => {
  return getSharedDiscordRpc().getStatus();
});

ipcMain.handle('discordRpc:configure', async (_event, config: DiscordRpcConfig) => {
  const safeConfig = config && typeof config === 'object' ? config : {};
  return getSharedDiscordRpc().configure({
    ...safeConfig,
    userDataDir: app.getPath('userData'),
  });
});

// App lifecycle

// ---------- Local media: waveform-local:// protocol, folder picker, scanner ----------
const AUDIO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg; codecs=opus',
  '.webm': 'audio/webm',
};

const ARTIST_ART_EXT_MIME: Array<{ ext: string; mime: string }> = [
  { ext: 'png', mime: 'image/png' },
  { ext: 'jpg', mime: 'image/jpeg' },
  { ext: 'webp', mime: 'image/webp' },
  { ext: 'gif', mime: 'image/gif' },
  { ext: 'avif', mime: 'image/avif' },
  { ext: 'svg', mime: 'image/svg+xml' },
];

function extForArtistArtMime(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('avif')) return 'avif';
  if (ct.includes('svg')) return 'svg';
  return 'jpg';
}

async function resolveArtistArtProtocolRequest(
  parsedUrl: URL,
  userDataPath: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const rawUrl = (parsedUrl.searchParams.get('url') || '').trim();
  let targetUrl: URL;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    return new Response('Not found', { status: 404, headers: corsHeaders });
  }
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return new Response('Not found', { status: 404, headers: corsHeaders });
  }

  const cacheDir = path.join(userDataPath, 'artist-art-cache');
  const urlHash = createHash('sha1').update(targetUrl.toString()).digest('hex');

  for (const { ext, mime } of ARTIST_ART_EXT_MIME) {
    const cachedPath = path.join(cacheDir, `${urlHash}.${ext}`);
    try {
      const stat = await fs.promises.stat(cachedPath);
      if (stat.isFile() && stat.size > 0) {
        const bytes = await fs.promises.readFile(cachedPath);
        return new Response(bytes, {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': mime,
            'Content-Length': String(bytes.byteLength),
            'Cache-Control': 'public, max-age=604800',
          },
        });
      }
    } catch {
      // Cache miss for this extension
    }
  }

  try {
    const res = await fetch(targetUrl.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'image/*',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!res.ok || !contentType.startsWith('image/')) {
      return new Response('Not found', { status: 404, headers: corsHeaders });
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength === 0) {
      return new Response('Not found', { status: 404, headers: corsHeaders });
    }

    const ext = extForArtistArtMime(contentType);
    try {
      await fs.promises.mkdir(cacheDir, { recursive: true });
      const destPath = path.join(cacheDir, `${urlHash}.${ext}`);
      const tmpPath = `${destPath}.${Date.now()}.tmp`;
      await fs.promises.writeFile(tmpPath, bytes);
      await fs.promises.rename(tmpPath, destPath);
    } catch {
      // Non-fatal cache write failure
    }

    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'public, max-age=604800',
      },
    });
  } catch {
    return new Response('Not found', { status: 404, headers: corsHeaders });
  }
}

protocol?.registerSchemesAsPrivileged([
  { scheme: 'waveform-local', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } },
  { scheme: 'waveform-stream', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } },
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
    const isHead = request.method === 'HEAD';
    try {
      const parsedUrl = new URL(request.url);
      if (parsedUrl.hostname === 'art') {
        return resolveArtProtocolResponse(parsedUrl, app.getPath('userData'));
      }
      if (parsedUrl.hostname === 'artist-art') {
        return resolveArtistArtProtocolRequest(parsedUrl, app.getPath('userData'), corsHeaders);
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
        if (isHead) {
          return new Response(null, { status: 206, headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
        }
        const body = Readable.toWeb(fs.createReadStream(filePath, { start, end })) as unknown as ReadableStream;
        return new Response(body, { status: 206, headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
      }
      if (size === 0 || isHead) return new Response(null, { status: 200, headers: { ...base, 'Content-Length': String(size) } });
      const body = Readable.toWeb(fs.createReadStream(filePath)) as unknown as ReadableStream;
      return new Response(body, { status: 200, headers: { ...base, 'Content-Length': String(size) } });
    } catch {
      return new Response('Not found', { status: 404, headers: corsHeaders });
    }
  });

  const streamCacheDir = path.join(app.getPath('userData'), 'stream-cache');
  protocol?.handle('waveform-stream', (request) => {
    try {
      const parsedUrl = new URL(request.url);
      if (parsedUrl.hostname === 'proxy') {
        return resolveRemoteAudioProxyRequest(request);
      }
    } catch {
      // Fall through to YouTube SABR stream handler
    }
    return resolveYoutubeStreamProtocolRequest(request, streamCacheDir);
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

ipcMain.handle('local-library-load-cache', () =>
  loadLocalLibraryCache(app.getPath('userData'))
);

ipcMain.handle(
  'local-library-save-cache',
  (_e, payload: { folders: string[]; tracks: any[] }) => {
    if (!payload || typeof payload !== 'object') return null;
    return saveLocalLibraryCache(app.getPath('userData'), payload);
  }
);

ipcMain.handle(
  'local-library-incremental-scan',
  (_e, extraFolders?: string[]) =>
    incrementalScanLocalFolders(
      app.getPath('userData'),
      Array.isArray(extraFolders) ? extraFolders : undefined
    )
);

ipcMain.handle('local-library-remove-folder', (_e, folderPath: string) =>
  typeof folderPath === 'string' && folderPath
    ? removeLocalLibraryFolder(app.getPath('userData'), folderPath)
    : null
);

function resolveShowInFolderTarget(rawTarget: string): string | null {
  const trimmed = rawTarget.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('waveform-local://')) {
    try {
      const parsed = new URL(trimmed);
      const filePath = parsed.searchParams.get('path');
      return filePath ? path.resolve(filePath) : null;
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith('file://')) {
    try {
      return path.resolve(fileURLToPath(trimmed));
    } catch {
      const stripped = decodeURIComponent(trimmed.replace(/^file:\/\/\/?/i, ''));
      return stripped ? path.resolve(stripped) : null;
    }
  }
  return path.resolve(trimmed);
}

ipcMain.handle('show-item-in-folder', (_e, filePathOrUrl: string) => {
  if (typeof filePathOrUrl !== 'string') return false;
  const resolvedPath = resolveShowInFolderTarget(filePathOrUrl);
  if (!resolvedPath) return false;
  try {
    electronNs.shell?.showItemInFolder(resolvedPath);
    return true;
  } catch {
    return false;
  }
});

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
    let checking = false;
    let pendingRecheck = false;
    const finish = async (ok: boolean) => {
      if (done) return;
      done = true;
      ses.cookies.removeListener('changed', check);
      if (!win.isDestroyed()) win.close();
      resolve(ok ? { connected: true, displayName: accountsState[provider]?.displayName } : { connected: false });
    };
    const check = async () => {
      if (done || win.isDestroyed()) return;
      if (checking) {
        pendingRecheck = true;
        return;
      }
      checking = true;
      try {
        const cookies = await ses.cookies.get({ domain: cfg.domain });
        if (done || win.isDestroyed()) return;
        if (!cookies.some((c) => cfg.cookie.includes(c.name) && c.value)) return;
        let displayName: string | undefined;
        try {
          displayName = provider === 'ytmusic'
            ? (await win.webContents.executeJavaScript(`document.querySelector('ytmusic-settings-button img')?.alt || ''`)) || undefined
            : undefined;
        } catch { /* ignore */ }
        if (done || win.isDestroyed()) return;
        accountsState[provider] = {
          connected: true, displayName: displayName || (provider === 'ytmusic' ? 'YouTube Music' : 'Spotify'),
          cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '), connectedAt: Date.now(),
        };
        saveAccounts();
        void finish(true);
      } finally {
        checking = false;
        if (pendingRecheck && !done && !win.isDestroyed()) {
          pendingRecheck = false;
          void check();
        }
      }
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

ipcMain.handle('resolve-youtube-stream', async (_e, videoId: string) => {
  if (!videoId || typeof videoId !== 'string') return null;
  return resolveYoutubeStreamForIpc(videoId, path.join(app.getPath('userData'), 'stream-cache'));
});

interface ArtworkPixelsResult {
  width: number;
  height: number;
  rgba: Uint8Array;
}

const ARTWORK_PIXELS_CACHE_MAX = 120;
const artworkPixelsCache = new Map<string, ArtworkPixelsResult>();
const artworkPixelsInFlight = new Map<string, Promise<ArtworkPixelsResult | null>>();

async function decodeArtworkPixelsFromUrl(rawUrl: string): Promise<ArtworkPixelsResult | null> {
  const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!url) return null;

  const cached = artworkPixelsCache.get(url);
  if (cached) {
    artworkPixelsCache.delete(url);
    artworkPixelsCache.set(url, cached);
    return cached;
  }

  const pending = artworkPixelsInFlight.get(url);
  if (pending) return pending;

  const task = (async (): Promise<ArtworkPixelsResult | null> => {
    try {
      let buf: Buffer | null = null;
      const dataMatch = /^data:image\/[^,;]+(?:;[^,;]+)*;base64,(.+)$/is.exec(url);
      if (dataMatch) {
        buf = Buffer.from(dataMatch[1], 'base64');
      } else {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol === 'waveform-local:') {
          let res: Response | null = null;
          if (parsedUrl.hostname === 'art') {
            res = await resolveArtProtocolResponse(parsedUrl, app.getPath('userData'));
          } else if (parsedUrl.hostname === 'artist-art') {
            res = await resolveArtistArtProtocolRequest(parsedUrl, app.getPath('userData'), {});
          }
          if (res && res.ok) {
            buf = Buffer.from(await res.arrayBuffer());
          }
        } else if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
          const res = await fetch(parsedUrl.toString(), {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              Accept: 'image/png, image/jpeg, image/*;q=0.8',
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(10000),
          });
          if (res.ok) {
            const ab = await res.arrayBuffer();
            if (ab.byteLength > 0 && ab.byteLength <= 25 * 1024 * 1024) {
              buf = Buffer.from(ab);
            }
          }
        }
      }

      if (!buf || buf.byteLength === 0) return null;

      const img = nativeImage.createFromBuffer(buf);
      if (!img || img.isEmpty()) return null;

      const resized = img.resize({ width: 48, height: 48, quality: 'good' });
      const { width, height } = resized.getSize();
      if (width <= 0 || height <= 0) return null;

      const bitmap = resized.toBitmap();
      const expectedBytes = width * height * 4;
      if (!bitmap || bitmap.byteLength < expectedBytes) return null;

      // nativeImage.toBitmap() returns BGRA bytes; convert to RGBA for OKLCH extractor
      const rgba = new Uint8Array(expectedBytes);
      for (let i = 0; i < expectedBytes; i += 4) {
        rgba[i] = bitmap[i + 2];
        rgba[i + 1] = bitmap[i + 1];
        rgba[i + 2] = bitmap[i];
        rgba[i + 3] = bitmap[i + 3];
      }

      const result: ArtworkPixelsResult = { width, height, rgba };
      if (artworkPixelsCache.has(url)) {
        artworkPixelsCache.delete(url);
      } else if (artworkPixelsCache.size >= ARTWORK_PIXELS_CACHE_MAX) {
        const oldestKey = artworkPixelsCache.keys().next().value;
        if (oldestKey !== undefined) artworkPixelsCache.delete(oldestKey);
      }
      artworkPixelsCache.set(url, result);
      return result;
    } catch {
      return null;
    } finally {
      artworkPixelsInFlight.delete(url);
    }
  })();

  artworkPixelsInFlight.set(url, task);
  return task;
}

ipcMain.handle('get-artwork-pixels', async (_e, url: string) => {
  if (!url || typeof url !== 'string') return null;
  return decodeArtworkPixelsFromUrl(url);
});
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(() => {
    registerLocalProtocol();
    configureMediaAndApiSession();
    void prewarmAutoEqDb(resolveDataAssetCandidatePaths('auto_eq.db'));
    getSharedDiscordRpc().configure({ userDataDir: app.getPath('userData') });
    mainWindow = createWindow();
    tray = createTray();

    lyricVisualizerPlatform = createLyricVisualizerPlatformController({
      app,
      BrowserWindow,
      ipcMain,
      userDataDir: app.getPath('userData'),
      preloadPath: path.join(__dirname, 'preload.cjs'),
      loadWindowRoute: (win, hashRoute) => {
        void loadWindowContent(win, hashRoute);
      },
    });
    lyricVisualizerPlatform.registerIpcHandlers();

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

  app.on('before-quit', () => {
    isQuitting = true;
    getSharedDiscordRpc().shutdown();
  });

  app.on('will-quit', () => {
    tray?.destroy();
    tray = null;
    lyricVisualizerPlatform?.dispose();
    lyricVisualizerPlatform = null;
    getSharedDiscordRpc().shutdown();
    void stopPartyLanHost();
    void destroyAllSabrStreams();
  });
}
