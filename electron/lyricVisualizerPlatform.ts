import type {
  App,
  BrowserWindow as BrowserWindowType,
  IpcMain,
  Screen,
  PowerMonitor,
  PowerSaveBlocker,
} from 'electron';
import * as electronNs from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -----------------------------------------------------------------------------
// Electron Safe Accessors (Permits unit testing & minimal Electron mock imports)
// -----------------------------------------------------------------------------
const getScreenApi = (): Screen | undefined => (electronNs as any).screen;
const getPowerMonitorApi = (): PowerMonitor | undefined => (electronNs as any).powerMonitor;
const getPowerSaveBlockerApi = (): PowerSaveBlocker | undefined => (electronNs as any).powerSaveBlocker;

// -----------------------------------------------------------------------------
// Type Definitions
// -----------------------------------------------------------------------------
export interface MonitorDisplayInfo {
  id: string;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
}

export interface OverlayConfig {
  enabled: boolean;
  monitorIds: string[];
  opacity: number;
  locked: boolean;
}

export interface AmbientSettings {
  keepAwake: boolean;
  keepAwakeInAmbient?: boolean;
  idleAmbientSeconds: number;
  gameGuardEnabled: boolean;
}

export interface CachedLyricsRecord {
  trackKey: string;
  lyrics: any | null; // null represents cached negative miss
  cachedAt: number;
  ttlMs: number;
}

export interface DiskCachePayload {
  version: number;
  entries: Record<string, CachedLyricsRecord>;
  offsets: Record<string, number>;
}

// -----------------------------------------------------------------------------
// Pure Helpers
// -----------------------------------------------------------------------------

/**
 * Windows QUERY_USER_NOTIFICATION_STATE mapping:
 * QUNS_NOT_PRESENT = 1
 * QUNS_BUSY = 2
 * QUNS_RUNNING_D3D_FULL_SCREEN = 3
 * QUNS_PRESENTATION_MODE = 4
 * QUNS_ACCEPTS_NOTIFICATIONS = 5
 * QUNS_QUIET_TIME = 6
 * QUNS_APP = 7
 *
 * States 2, 3, 4, and 7 indicate fullscreen gaming, video playback, presentations,
 * or full-screen immersive Direct3D applications that should suppress overlays.
 */
export function isBlockingNotificationState(state: number): boolean {
  return state === 2 || state === 3 || state === 4 || state === 7;
}

export const POSITIVE_LYRICS_TTL_MS = 30 * 86400 * 1000; // 30 days
export const NEGATIVE_LYRICS_TTL_MS = 24 * 3600 * 1000;  // 24 hours
export const MIN_OFFSET_MS = -2000;
export const MAX_OFFSET_MS = 2000;

export function clampSongOffset(offsetMs: number): number {
  if (typeof offsetMs !== 'number' || Number.isNaN(offsetMs)) return 0;
  return Math.min(MAX_OFFSET_MS, Math.max(MIN_OFFSET_MS, Math.round(offsetMs)));
}

// -----------------------------------------------------------------------------
// Subsystem 6: Persistent LyricsCacheAndOffsetStore
// -----------------------------------------------------------------------------
export class LyricsCacheAndOffsetStore {
  private filePath: string;
  private nowFn: () => number;
  private entries: Map<string, CachedLyricsRecord> = new Map();
  private offsets: Map<string, number> = new Map();
  private isLoaded = false;

  constructor(filePath: string, nowFn: () => number = () => Date.now()) {
    this.filePath = filePath;
    this.nowFn = nowFn;
    this.loadFromDisk();
  }

  public getFilePath(): string {
    return this.filePath;
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const data: DiskCachePayload = JSON.parse(raw);
        if (data && typeof data === 'object') {
          if (data.entries) {
            for (const [k, v] of Object.entries(data.entries)) {
              if (v && typeof v === 'object') {
                this.entries.set(k, v);
              }
            }
          }
          if (data.offsets) {
            for (const [k, v] of Object.entries(data.offsets)) {
              if (typeof v === 'number') {
                this.offsets.set(k, clampSongOffset(v));
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[LyricsCacheAndOffsetStore] Failed to read disk cache:', err);
    }
    this.isLoaded = true;
  }

  public flushToDiskSync(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const payload: DiskCachePayload = {
        version: 1,
        entries: Object.fromEntries(this.entries.entries()),
        offsets: Object.fromEntries(this.offsets.entries()),
      };

      const tempFile = `${this.filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tempFile, this.filePath);
    } catch (err) {
      console.warn('[LyricsCacheAndOffsetStore] Failed to save disk cache atomically:', err);
    }
  }

  public getLyrics(trackKey: string): any | undefined {
    if (!trackKey) return undefined;
    const record = this.entries.get(trackKey);
    if (!record) return undefined;

    const now = this.nowFn();
    const age = now - record.cachedAt;
    if (age > record.ttlMs) {
      // Expired entry
      this.entries.delete(trackKey);
      return undefined;
    }
    return record.lyrics;
  }

  public setLyrics(trackKey: string, lyrics: any | null): void {
    if (!trackKey) return;
    const ttlMs = lyrics != null ? POSITIVE_LYRICS_TTL_MS : NEGATIVE_LYRICS_TTL_MS;
    const record: CachedLyricsRecord = {
      trackKey,
      lyrics,
      cachedAt: this.nowFn(),
      ttlMs,
    };
    this.entries.set(trackKey, record);
    this.flushToDiskSync();
  }

  public getOffset(trackKey: string): number {
    if (!trackKey) return 0;
    return this.offsets.get(trackKey) ?? 0;
  }

  public setOffset(trackKey: string, offsetMs: number): number {
    if (!trackKey) return 0;
    const clamped = clampSongOffset(offsetMs);
    this.offsets.set(trackKey, clamped);
    this.flushToDiskSync();
    return clamped;
  }

  public clear(): void {
    this.entries.clear();
    this.offsets.clear();
    this.flushToDiskSync();
  }
}

// -----------------------------------------------------------------------------
// Subsystem 5: KeepAwakeService
// -----------------------------------------------------------------------------
export class KeepAwakeService {
  private powerSaveBlockerApi: PowerSaveBlocker | undefined;
  private blockerId: number | null = null;
  private activeReason: 'prevent-display-sleep' | 'prevent-app-suspension' = 'prevent-display-sleep';

  constructor(powerSaveBlockerApi?: PowerSaveBlocker) {
    this.powerSaveBlockerApi = powerSaveBlockerApi || getPowerSaveBlockerApi();
  }

  public isActive(): boolean {
    return this.blockerId !== null;
  }

  public start(reason: 'prevent-display-sleep' | 'prevent-app-suspension' = 'prevent-display-sleep'): boolean {
    if (this.blockerId !== null) return true;
    if (!this.powerSaveBlockerApi) return false;

    try {
      this.activeReason = reason;
      this.blockerId = this.powerSaveBlockerApi.start(reason);
      return this.blockerId !== null;
    } catch (err) {
      console.warn('[KeepAwakeService] Failed to start power save blocker:', err);
      this.blockerId = null;
      return false;
    }
  }

  public stop(): void {
    if (this.blockerId !== null && this.powerSaveBlockerApi) {
      try {
        if (typeof this.powerSaveBlockerApi.isStarted === 'function') {
          if (this.powerSaveBlockerApi.isStarted(this.blockerId)) {
            this.powerSaveBlockerApi.stop(this.blockerId);
          }
        } else {
          this.powerSaveBlockerApi.stop(this.blockerId);
        }
      } catch (err) {
        console.warn('[KeepAwakeService] Error stopping blocker:', err);
      }
      this.blockerId = null;
    }
  }
}

// -----------------------------------------------------------------------------
// Subsystem 4: Game / Fullscreen Video Notification Guard
// -----------------------------------------------------------------------------
export class WindowsGameNotificationGuard {
  private childProcess: ChildProcessWithoutNullStreams | null = null;
  private isChecking = false;
  private lastState = 5; // Default QUNS_ACCEPTS_NOTIFICATIONS
  private isDisposed = false;

  constructor() {
    if (process.platform === 'win32') {
      this.initPersistentProcess();
    }
  }

  private initPersistentProcess(): void {
    try {
      // Simple lightweight PowerShell worker listening on stdin
      const psCommand = `
        Add-Type -TypeDefinition @"
        using System;
        using System.Runtime.InteropServices;
        public class WinNotificationQuery {
            [DllImport("shell32.dll")]
            public static extern int SHQueryUserNotificationState(out int pquns);
            public static int CheckState() {
                int state;
                SHQueryUserNotificationState(out state);
                return state;
            }
        }
"@
        while ($true) {
            $line = [Console]::ReadLine()
            if ($line -eq $null -or $line -eq "exit") { break }
            try {
                $res = [WinNotificationQuery]::CheckState()
                [Console]::WriteLine($res)
            } catch {
                [Console]::WriteLine(5)
            }
        }
      `;
      this.childProcess = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCommand]);
      this.childProcess.on('error', (err) => {
        console.warn('[WindowsGameNotificationGuard] PowerShell worker spawn error:', err);
        this.childProcess = null;
      });
      this.childProcess.on('exit', () => {
        this.childProcess = null;
      });
    } catch {
      this.childProcess = null;
    }
  }

  public async queryState(): Promise<number> {
    if (process.platform !== 'win32' || this.isDisposed) {
      return 5; // Non-blocking default
    }

    if (!this.childProcess || !this.childProcess.stdin || !this.childProcess.stdout) {
      return 5;
    }

    if (this.isChecking) {
      return this.lastState;
    }

    this.isChecking = true;
    try {
      const state = await new Promise<number>((resolve) => {
        const timeout = setTimeout(() => {
          cleanup();
          resolve(this.lastState);
        }, 1200);

        const onData = (data: Buffer) => {
          const str = data.toString().trim();
          const parsed = parseInt(str, 10);
          if (!Number.isNaN(parsed)) {
            cleanup();
            resolve(parsed);
          }
        };

        const cleanup = () => {
          clearTimeout(timeout);
          this.childProcess?.stdout.removeListener('data', onData);
        };

        this.childProcess!.stdout.once('data', onData);
        this.childProcess!.stdin.write('check\n');
      });

      this.lastState = state;
      return state;
    } catch {
      return 5;
    } finally {
      this.isChecking = false;
    }
  }

  public dispose(): void {
    this.isDisposed = true;
    if (this.childProcess) {
      try {
        this.childProcess.stdin.write('exit\n');
        this.childProcess.kill();
      } catch {}
      this.childProcess = null;
    }
  }
}

// -----------------------------------------------------------------------------
// Main Platform Controller Factory & Implementation
// -----------------------------------------------------------------------------
export interface PlatformControllerOptions {
  app?: App;
  BrowserWindow?: typeof BrowserWindowType;
  ipcMain?: IpcMain;
  userDataDir?: string;
  preloadPath?: string;
  loadWindowRoute?: (win: BrowserWindowType, hashRoute: string) => void;
  // Overrides for unit testing / mocking
  screenMock?: Partial<Screen>;
  powerMonitorMock?: Partial<PowerMonitor>;
  powerSaveBlockerMock?: Partial<PowerSaveBlocker>;
  gameGuardMock?: { queryState: () => Promise<number>; dispose: () => void };
}

export function createLyricVisualizerPlatformController(options: PlatformControllerOptions = {}) {
  const browserWindowCtor = options.BrowserWindow || electronNs.BrowserWindow;
  const ipcMain = options.ipcMain || electronNs.ipcMain;
  const screenApi: Screen | undefined = (options.screenMock as any) || getScreenApi();
  const powerMonitorApi: PowerMonitor | undefined = (options.powerMonitorMock as any) || getPowerMonitorApi();
  const powerSaveBlockerApi: PowerSaveBlocker | undefined =
    (options.powerSaveBlockerMock as any) || getPowerSaveBlockerApi();

  const userDataDir = options.userDataDir || (options.app ? options.app.getPath('userData') : process.cwd());
  const cacheFilePath = path.join(userDataDir, 'lyric-visualizer-cache.json');
  const cacheStore = new LyricsCacheAndOffsetStore(cacheFilePath);

  const keepAwakeService = new KeepAwakeService(powerSaveBlockerApi);
  const gameGuard = options.gameGuardMock || new WindowsGameNotificationGuard();

  // State
  let overlayWindows = new Map<string, BrowserWindowType>();
  let ambientWindow: BrowserWindowType | null = null;
  let isAmbientKeepAwakeRequested = false;
  let overlayConfig: OverlayConfig = {
    enabled: false,
    monitorIds: [],
    opacity: 0.9,
    locked: false,
  };
  let ambientSettings: AmbientSettings = {
    keepAwake: false,
    idleAmbientSeconds: 0,
    gameGuardEnabled: true,
  };

  let isSystemLocked = false;
  let isGameGuardBlocking = false;
  let pollIntervalTimer: NodeJS.Timeout | null = null;
  let isDisposed = false;

  // Window route loader helper
  const loadRoute = (win: BrowserWindowType, route: string) => {
    if (options.loadWindowRoute) {
      options.loadWindowRoute(win, route);
      return;
    }
    // Default route loading logic
    const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    const isDev = process.env.NODE_ENV === 'development' || !options.app?.isPackaged;
    if (isDev) {
      win.loadURL(`${devServerUrl}#${route}`).catch((err) => {
        console.warn(`[LV Platform] Failed to load dev route #${route}:`, err);
      });
    } else {
      const distIndex = path.resolve(__dirname, '../dist/index.html');
      win.loadFile(distIndex, { hash: route }).catch((err) => {
        console.warn(`[LV Platform] Failed to load production route #${route}:`, err);
      });
    }
  };

  // Broadcast event helper to all windows
  const emitPlatformEvent = (type: string, data?: any) => {
    const payload = { type, data };
    const allWindows: BrowserWindowType[] = [];
    if (browserWindowCtor && typeof browserWindowCtor.getAllWindows === 'function') {
      allWindows.push(...browserWindowCtor.getAllWindows());
    }
    for (const win of allWindows) {
      try {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send('lv-platform-event', payload);
        }
      } catch {}
    }
  };

  // 1. Monitors
  const getAvailableMonitors = (): MonitorDisplayInfo[] => {
    if (!screenApi) return [];
    try {
      const primaryDisplay = screenApi.getPrimaryDisplay();
      const all = screenApi.getAllDisplays();
      return all.map((d, index) => ({
        id: String(d.id),
        label: d.label || `Display ${index + 1}`,
        bounds: d.bounds,
        workArea: d.workArea,
        scaleFactor: d.scaleFactor || 1,
        isPrimary: primaryDisplay ? d.id === primaryDisplay.id : index === 0,
      }));
    } catch (err) {
      console.warn('[LV Platform] Error reading displays:', err);
      return [];
    }
  };

  // Overlay management
  const updateOverlaysVisibility = () => {
    const shouldHide = !overlayConfig.enabled || isSystemLocked || (ambientSettings.gameGuardEnabled && isGameGuardBlocking);
    for (const [_, win] of overlayWindows) {
      if (!win.isDestroyed()) {
        if (shouldHide) {
          win.hide();
        } else {
          win.showInactive();
        }
      }
    }
  };

  const applyOverlayConfigToWindow = (win: BrowserWindowType, config: OverlayConfig) => {
    if (win.isDestroyed()) return;
    const clampedOpacity = Math.min(1, Math.max(0.1, config.opacity));
    try {
      if (typeof win.setOpacity === 'function') {
        win.setOpacity(clampedOpacity);
      }
      if (typeof win.setIgnoreMouseEvents === 'function') {
        win.setIgnoreMouseEvents(Boolean(config.locked), { forward: true });
      }
      if (typeof win.setAlwaysOnTop === 'function') {
        win.setAlwaysOnTop(true, 'screen-saver');
      }
    } catch (err) {
      console.warn('[LV Platform] Error applying overlay config to window:', err);
    }
  };

  const syncOverlays = () => {
    if (!overlayConfig.enabled) {
      for (const [id, win] of overlayWindows) {
        if (!win.isDestroyed()) win.close();
      }
      overlayWindows.clear();
      updatePollingState();
      return;
    }

    const monitors = getAvailableMonitors();
    const monitorsMap = new Map(monitors.map((m) => [m.id, m]));
    const targetIds = new Set(overlayConfig.monitorIds.filter((id) => monitorsMap.has(id)));

    // Fallback: if monitorIds is empty, use primary display
    if (targetIds.size === 0 && monitors.length > 0) {
      const primary = monitors.find((m) => m.isPrimary) || monitors[0];
      targetIds.add(primary.id);
    }

    // Close windows for removed monitors
    for (const [id, win] of overlayWindows) {
      if (!targetIds.has(id)) {
        if (!win.isDestroyed()) win.close();
        overlayWindows.delete(id);
      }
    }

    // Create or update windows for target monitors
    for (const monitorId of targetIds) {
      const mon = monitorsMap.get(monitorId)!;
      let win = overlayWindows.get(monitorId);

      if (!win || win.isDestroyed()) {
        win = new browserWindowCtor({
          x: mon.workArea.x,
          y: mon.workArea.y,
          width: mon.workArea.width,
          height: mon.workArea.height,
          transparent: true,
          frame: false,
          backgroundColor: '#00000000',
          hasShadow: false,
          skipTaskbar: true,
          focusable: false,
          alwaysOnTop: true,
          show: false,
          webPreferences: {
            ...(options.preloadPath ? { preload: options.preloadPath } : {}),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });

        const currentWin = win;
        currentWin.on('closed', () => {
          overlayWindows.delete(monitorId);
        });

        loadRoute(win, `/overlay?monitorId=${encodeURIComponent(monitorId)}`);
        overlayWindows.set(monitorId, win);
      } else {
        win.setBounds(mon.workArea);
      }

      applyOverlayConfigToWindow(win, overlayConfig);
    }

    updateOverlaysVisibility();
    updatePollingState();
  };

  const setOverlayConfig = (config: Partial<OverlayConfig>): OverlayConfig => {
    overlayConfig = {
      ...overlayConfig,
      ...config,
      opacity: typeof config.opacity === 'number' ? config.opacity : overlayConfig.opacity,
      locked: typeof config.locked === 'boolean' ? config.locked : overlayConfig.locked,
    };
    syncOverlays();
    return overlayConfig;
  };

  // 2. Ambient Mode Window
  const openAmbientWindow = (keepAwake: boolean): boolean => {
    isAmbientKeepAwakeRequested = Boolean(keepAwake);
    if (ambientWindow && !ambientWindow.isDestroyed()) {
      ambientWindow.focus();
      if (isAmbientKeepAwakeRequested && !isSystemLocked) {
        keepAwakeService.start('prevent-display-sleep');
      }
      return true;
    }

    ambientWindow = new browserWindowCtor({
      fullscreen: true,
      frame: false,
      backgroundColor: '#050508',
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        ...(options.preloadPath ? { preload: options.preloadPath } : {}),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    ambientWindow.once('ready-to-show', () => {
      ambientWindow?.show();
    });

    ambientWindow.on('closed', () => {
      ambientWindow = null;
      isAmbientKeepAwakeRequested = false;
      if (!ambientSettings.keepAwake) {
        keepAwakeService.stop();
      }
      emitPlatformEvent('ambient-closed');
      updatePollingState();
    });

    loadRoute(ambientWindow, '/ambient');

    if (keepAwake && !isSystemLocked) {
      keepAwakeService.start('prevent-display-sleep');
    }

    updatePollingState();
    return true;
  };

  const closeAmbientWindow = (): void => {
    if (ambientWindow && !ambientWindow.isDestroyed()) {
      ambientWindow.close();
      ambientWindow = null;
    }
    isAmbientKeepAwakeRequested = false;
    keepAwakeService.stop();
  };

  const setAmbientSettings = (settings: Partial<AmbientSettings>): AmbientSettings => {
    const nextKeepAwake =
      typeof settings.keepAwake === 'boolean'
        ? settings.keepAwake
        : typeof settings.keepAwakeInAmbient === 'boolean'
        ? settings.keepAwakeInAmbient
        : ambientSettings.keepAwake;
    ambientSettings = {
      ...ambientSettings,
      ...settings,
      keepAwake: nextKeepAwake,
    };

    if (ambientSettings.keepAwake && !isSystemLocked && ambientWindow && !ambientWindow.isDestroyed()) {
      keepAwakeService.start('prevent-display-sleep');
    } else if (!ambientSettings.keepAwake && !ambientWindow) {
      keepAwakeService.stop();
    }

    updatePollingState();
    return ambientSettings;
  };

  // 3 & 5. Poller: Guard & Idle Check
  const updatePollingState = () => {
    const hasActiveOverlays = overlayConfig.enabled && overlayWindows.size > 0;
    const hasIdleTimer = ambientSettings.idleAmbientSeconds > 0;
    const needsPolling = !isDisposed && !isSystemLocked && (hasActiveOverlays || hasIdleTimer);

    if (needsPolling && !pollIntervalTimer) {
      pollIntervalTimer = setInterval(async () => {
        await pollLoopStep();
      }, 2000);
    } else if (!needsPolling && pollIntervalTimer) {
      clearInterval(pollIntervalTimer);
      pollIntervalTimer = null;
    }
  };

  const pollLoopStep = async () => {
    if (isDisposed || isSystemLocked) return;

    // Check Windows Notification State (game guard)
    if (ambientSettings.gameGuardEnabled) {
      try {
        const state = await gameGuard.queryState();
        const isBlocking = isBlockingNotificationState(state);
        if (isBlocking !== isGameGuardBlocking) {
          isGameGuardBlocking = isBlocking;
          emitPlatformEvent('game-guard', { blocked: isGameGuardBlocking, suppressed: isGameGuardBlocking, state });
          updateOverlaysVisibility();
        }
      } catch (err) {
        console.warn('[LV Platform] Game guard poll error:', err);
      }
    } else if (isGameGuardBlocking) {
      isGameGuardBlocking = false;
      updateOverlaysVisibility();
    }

    // Check Idle Time
    if (ambientSettings.idleAmbientSeconds > 0 && !isGameGuardBlocking && !ambientWindow) {
      try {
        if (powerMonitorApi && typeof powerMonitorApi.getSystemIdleTime === 'function') {
          const idleSeconds = powerMonitorApi.getSystemIdleTime();
          if (idleSeconds >= ambientSettings.idleAmbientSeconds) {
            emitPlatformEvent('idle-ambient', { idleSeconds, threshold: ambientSettings.idleAmbientSeconds });
          }
        }
      } catch (err) {
        console.warn('[LV Platform] Idle check error:', err);
      }
    }
  };

  // Screen events listener setup
  const onDisplayChange = () => {
    if (overlayConfig.enabled) {
      syncOverlays();
    }
    emitPlatformEvent('displays-changed', { monitors: getAvailableMonitors() });
  };

  if (screenApi && typeof screenApi.on === 'function') {
    screenApi.on('display-added', onDisplayChange);
    screenApi.on('display-removed', onDisplayChange);
    screenApi.on('display-metrics-changed', onDisplayChange);
  }

  // Lock-screen 0% GPU Pause
  const handleLock = () => {
    isSystemLocked = true;
    keepAwakeService.stop();
    updateOverlaysVisibility();
    emitPlatformEvent('power-lock', { locked: true });
    updatePollingState();
  };

  const handleUnlock = () => {
    isSystemLocked = false;
    if (ambientWindow && (ambientSettings.keepAwake || isAmbientKeepAwakeRequested)) {
      keepAwakeService.start('prevent-display-sleep');
    }
    updateOverlaysVisibility();
    emitPlatformEvent('power-lock', { locked: false });
    updatePollingState();
  };

  if (powerMonitorApi && typeof powerMonitorApi.on === 'function') {
    powerMonitorApi.on('lock-screen', handleLock);
    powerMonitorApi.on('suspend', handleLock);
    powerMonitorApi.on('unlock-screen', handleUnlock);
    powerMonitorApi.on('resume', handleUnlock);
  }

  // 7. IPC Handlers Registration
  const registerIpcHandlers = () => {
    if (!ipcMain) return;

    ipcMain.handle('lv-get-monitors', async () => {
      return getAvailableMonitors();
    });

    ipcMain.handle('lv-set-overlay-config', async (_event, config: Partial<OverlayConfig>) => {
      return setOverlayConfig(config);
    });

    ipcMain.handle('lv-open-ambient', async (_event, keepAwake?: boolean) => {
      return openAmbientWindow(Boolean(keepAwake ?? ambientSettings.keepAwake));
    });

    ipcMain.handle('lv-close-ambient', async () => {
      closeAmbientWindow();
      return true;
    });

    ipcMain.handle('lv-set-ambient-settings', async (_event, settings: Partial<AmbientSettings>) => {
      return setAmbientSettings(settings);
    });

    ipcMain.handle('lv-get-lyrics-cache', async (_event, trackKey: string) => {
      return cacheStore.getLyrics(trackKey);
    });

    ipcMain.handle('lv-set-lyrics-cache', async (_event, trackKey: string, lyrics: any) => {
      cacheStore.setLyrics(trackKey, lyrics);
      return true;
    });

    ipcMain.handle('lv-get-song-offset', async (_event, trackKey: string) => {
      return cacheStore.getOffset(trackKey);
    });

    ipcMain.handle('lv-set-song-offset', async (_event, trackKey: string, offsetMs: number) => {
      return cacheStore.setOffset(trackKey, offsetMs);
    });

    // Relay state broadcast across all open overlay / ambient windows
    ipcMain.on('lv-broadcast-state', (_event, payload: any) => {
      const targets: BrowserWindowType[] = [];
      for (const [_, win] of overlayWindows) {
        if (!win.isDestroyed()) targets.push(win);
      }
      if (ambientWindow && !ambientWindow.isDestroyed()) {
        targets.push(ambientWindow);
      }
      for (const target of targets) {
        try {
          if (!target.isDestroyed() && target.webContents) {
            target.webContents.send('lv-state-broadcast', payload);
          }
        } catch {}
      }
    });
  };

  // Dispose & Cleanup
  const dispose = () => {
    isDisposed = true;
    if (pollIntervalTimer) {
      clearInterval(pollIntervalTimer);
      pollIntervalTimer = null;
    }
    keepAwakeService.stop();
    gameGuard.dispose();

    for (const [_, win] of overlayWindows) {
      if (!win.isDestroyed()) win.close();
    }
    overlayWindows.clear();

    if (ambientWindow && !ambientWindow.isDestroyed()) {
      ambientWindow.close();
      ambientWindow = null;
    }

    if (screenApi && typeof screenApi.removeListener === 'function') {
      screenApi.removeListener('display-added', onDisplayChange);
      screenApi.removeListener('display-removed', onDisplayChange);
      screenApi.removeListener('display-metrics-changed', onDisplayChange);
    }
  };

  return {
    getAvailableMonitors,
    setOverlayConfig,
    openAmbientWindow,
    closeAmbientWindow,
    setAmbientSettings,
    cacheStore,
    keepAwakeService,
    gameGuard,
    syncOverlays,
    registerIpcHandlers,
    dispose,
    // exposed for inspection/tests
    _getOverlayWindows: () => overlayWindows,
    _getAmbientWindow: () => ambientWindow,
    _getOverlayConfig: () => overlayConfig,
    _getAmbientSettings: () => ambientSettings,
    _isSystemLocked: () => isSystemLocked,
    _isGameGuardBlocking: () => isGameGuardBlocking,
    _handleLock: handleLock,
    _handleUnlock: handleUnlock,
  };
}
