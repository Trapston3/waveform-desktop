import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fetchAndCacheArtwork } from './localMetadata.js';

export const DISCORD_DEFAULT_CLIENT_ID = '1574112665163530280';
export const GET_WAVEFORM_URL = 'https://github.com/trapston3/waveform-desktop';

export const DISCORD_OP_HANDSHAKE = 0;
export const DISCORD_OP_FRAME = 1;
export const DISCORD_OP_CLOSE = 2;
export const DISCORD_OP_PING = 3;
export const DISCORD_OP_PONG = 4;

export type DiscordDisplayFormat =
  | 'song_on_waveform'
  | 'song_title'
  | 'artist'
  | 'waveform';

export type DiscordConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED';

export interface DiscordRpcConfig {
  enabled?: boolean;
  clientId?: string;
  displayFormat?: DiscordDisplayFormat;
  showTimeRemaining?: boolean;
  showAlbumArt?: boolean;
  showButtons?: boolean;
  userDataDir?: string;
  pipePaths?: string[];
}

export interface DiscordPlaybackInput {
  videoId?: string;
  title?: string;
  artist?: string;
  albumName?: string | null;
  thumbnailUrl?: string | null;
  artworkUrl?: string | null;
  sourceQuality?: string | null;
  isLocal?: boolean;
  playbackSourceType?: string;
  durationSec?: number;
  durationMs?: number;
  positionMs?: number;
  isPlaying?: boolean;
  playbackSpeed?: number;
  partyCode?: string | null;
  partyUrl?: string | null;
}

export interface DiscordActivityPayload {
  type: 2;
  status_display_type?: 0 | 1 | 2;
  details: string;
  state: string;
  timestamps?: { start: number; end: number };
  assets: {
    large_image: string;
    large_text: string;
    small_image: string;
    small_text: string;
  };
  buttons?: Array<{ label: string; url: string }>;
  instance: false;
}

export interface DiscordStatusSnapshot {
  status: DiscordConnectionState;
  connected: boolean;
  enabled: boolean;
  clientId: string;
  pipePath: string | null;
  supportsStatusDisplayType: boolean;
  lastError: string | null;
}

export function getDiscordIpcPipePaths(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const paths: string[] = [];
  if (platform === 'win32') {
    for (let i = 0; i < 10; i++) {
      paths.push(`\\\\?\\pipe\\discord-ipc-${i}`);
    }
    return paths;
  }

  const dirs = Array.from(
    new Set(
      [env.XDG_RUNTIME_DIR, env.TMPDIR, env.TEMP, env.TMP, '/tmp'].filter(
        (d): d is string => typeof d === 'string' && d.trim().length > 0
      )
    )
  );
  for (const dir of dirs) {
    for (let i = 0; i < 10; i++) {
      paths.push(path.join(dir, `discord-ipc-${i}`));
    }
  }
  return paths;
}

export function encodeDiscordFrame(opcode: number, payload: unknown): Buffer {
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  const body = Buffer.from(json, 'utf8');
  const frame = Buffer.allocUnsafe(8 + body.byteLength);
  frame.writeUInt32LE(opcode >>> 0, 0);
  frame.writeUInt32LE(body.byteLength >>> 0, 4);
  body.copy(frame, 8);
  return frame;
}

export function decodeDiscordFrames(buffer: Uint8Array): {
  frames: Array<{ opcode: number; payload: any }>;
  remaining: Buffer;
} {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const frames: Array<{ opcode: number; payload: any }> = [];
  let offset = 0;

  while (offset + 8 <= buf.byteLength) {
    const opcode = buf.readUInt32LE(offset);
    const length = buf.readUInt32LE(offset + 4);
    if (length > 4 * 1024 * 1024) {
      // Corrupt length guard: drop remainder safely
      offset = buf.byteLength;
      break;
    }
    if (offset + 8 + length > buf.byteLength) {
      break;
    }
    const rawJson = buf.subarray(offset + 8, offset + 8 + length).toString('utf8');
    let parsed: any = rawJson;
    if (rawJson.length > 0) {
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        parsed = rawJson;
      }
    } else {
      parsed = {};
    }
    frames.push({ opcode, payload: parsed });
    offset += 8 + length;
  }

  return {
    frames,
    remaining: offset < buf.byteLength ? Buffer.from(buf.subarray(offset)) : Buffer.alloc(0),
  };
}

export function clampDiscord(
  value: string | undefined | null,
  minLen = 2,
  maxLen = 128
): string {
  const safeMax = Math.max(minLen, maxLen);
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return '-'.repeat(Math.max(2, minLen)).slice(0, safeMax);
  }
  if (trimmed.length < minLen) {
    return trimmed.padEnd(minLen, '\u200B');
  }
  if (trimmed.length > safeMax) {
    return `${trimmed.slice(0, safeMax - 1)}…`;
  }
  return trimmed;
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h === '[::1]' ||
    h.endsWith('.local')
  ) {
    return true;
  }
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) {
    return true;
  }
  return false;
}

export function resolveDiscordSafeArtworkUrl(
  rawUrl?: string | null,
  videoId?: string | null,
  isLocal = false
): string {
  const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (trimmed) {
    try {
      const parsed = new URL(trimmed);
      if (!isPrivateOrLoopbackHost(parsed.hostname)) {
        const host = parsed.hostname.toLowerCase();
        if (
          (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
          (host.endsWith('ytimg.com') || host === 'img.youtube.com')
        ) {
          const match = /\/(?:vi|vi_webp)\/([^/]+)\//.exec(parsed.pathname);
          const ytId = match?.[1] || (videoId && !isLocal ? videoId : '');
          if (ytId) {
            return `https://i.ytimg.com/vi/${encodeURIComponent(ytId)}/hqdefault.jpg`;
          }
          parsed.protocol = 'https:';
          return parsed.toString();
        }
        if (parsed.protocol === 'https:') {
          return parsed.toString();
        }
      }
    } catch {
      // Fall through to fallback checks
    }
  }

  if (!isLocal && typeof videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
  }

  return 'waveform_logo';
}

function isNonLocalYouTubeTrack(input: DiscordPlaybackInput): boolean {
  if (input.isLocal || input.playbackSourceType === 'LOCAL') return false;
  const vid = typeof input.videoId === 'string' ? input.videoId.trim() : '';
  if (!vid) return false;
  if (/^(local|file|jiosaavn)[_:-]/i.test(vid)) return false;
  return /^[A-Za-z0-9_-]{4,64}$/.test(vid);
}

export function getStatusDisplayTypeValue(
  format: DiscordDisplayFormat = 'song_on_waveform'
): 0 | 1 | 2 {
  if (format === 'waveform') return 0;
  if (format === 'artist') return 1;
  return 2;
}

export function buildDiscordActivityPayload(
  input: DiscordPlaybackInput,
  options: {
    displayFormat?: DiscordDisplayFormat;
    showTimeRemaining?: boolean;
    showAlbumArt?: boolean;
    showButtons?: boolean;
    includeStatusDisplayType?: boolean;
    resolvedArtworkOverride?: string | null;
    nowMs?: number;
  } = {}
): DiscordActivityPayload {
  const format = options.displayFormat || 'song_on_waveform';
  const showTimeRemaining = options.showTimeRemaining !== false;
  const showAlbumArt = options.showAlbumArt !== false;
  const showButtons = options.showButtons !== false;
  const includeStatusDisplayType = options.includeStatusDisplayType !== false;

  const title = (input.title || 'WaveForm').trim() || 'WaveForm';
  const artist = (input.artist || 'Unknown Artist').trim() || 'Unknown Artist';
  const isPlaying = Boolean(input.isPlaying);
  const rawDurSec =
    typeof input.durationSec === 'number' && input.durationSec > 0
      ? input.durationSec
      : typeof input.durationMs === 'number' && input.durationMs > 0
      ? input.durationMs / 1000
      : 0;
  const posSec = Math.max(0, (Number(input.positionMs) || 0) / 1000);
  const safeSpeed =
    typeof input.playbackSpeed === 'number' && input.playbackSpeed > 0
      ? input.playbackSpeed
      : 1.0;

  const detailsRaw = format === 'song_on_waveform' ? `${title} on WaveForm` : title;
  const stateRaw = `by ${artist}`;

  const rawArt = options.resolvedArtworkOverride || input.thumbnailUrl || input.artworkUrl;
  const largeImage = showAlbumArt
    ? resolveDiscordSafeArtworkUrl(rawArt, input.videoId, Boolean(input.isLocal))
    : 'waveform_logo';

  const quality = (input.sourceQuality || 'Hi-Fi').trim() || 'Hi-Fi';
  const smallImage = isPlaying ? 'waveform_play' : 'waveform_pause';
  const smallText = isPlaying ? `${quality} • WaveForm` : 'Paused • WaveForm';

  const activity: DiscordActivityPayload = {
    type: 2,
    ...(includeStatusDisplayType
      ? { status_display_type: getStatusDisplayTypeValue(format) }
      : {}),
    details: clampDiscord(detailsRaw, 2, 128),
    state: clampDiscord(stateRaw, 2, 128),
    assets: {
      large_image: largeImage,
      large_text: clampDiscord(input.albumName || title || 'WaveForm', 2, 128),
      small_image: smallImage,
      small_text: clampDiscord(smallText, 2, 128),
    },
    instance: false,
  };

  if (isPlaying && rawDurSec > 0 && showTimeRemaining) {
    const nowSec = (options.nowMs ?? Date.now()) / 1000;
    const clampedPosSec = Math.min(rawDurSec, posSec);
    const start = Math.floor(nowSec - clampedPosSec / safeSpeed);
    const end = Math.floor(nowSec + Math.max(0, rawDurSec - clampedPosSec) / safeSpeed);
    activity.timestamps = { start, end };
  }

  if (showButtons) {
    const buttons: Array<{ label: string; url: string }> = [];
    const partyCode = typeof input.partyCode === 'string' ? input.partyCode.trim() : '';
    if (partyCode) {
      const partyUrl =
        typeof input.partyUrl === 'string' && input.partyUrl.startsWith('https://')
          ? input.partyUrl
          : `${GET_WAVEFORM_URL}?party=${encodeURIComponent(partyCode)}`;
      buttons.push({
        label: clampDiscord(`Listen Together (${partyCode})`, 2, 32),
        url: partyUrl,
      });
    }
    if (isNonLocalYouTubeTrack(input) && input.videoId) {
      buttons.push({
        label: 'Listen on YouTube Music',
        url: `https://music.youtube.com/watch?v=${encodeURIComponent(input.videoId)}`,
      });
    }
    buttons.push({
      label: 'Get WaveForm',
      url: GET_WAVEFORM_URL,
    });
    activity.buttons = buttons.slice(0, 2);
  }

  return activity;
}

export class DiscordRpcManager {
  private enabled = true;
  private clientId = DISCORD_DEFAULT_CLIENT_ID;
  private displayFormat: DiscordDisplayFormat = 'song_on_waveform';
  private showTimeRemaining = true;
  private showAlbumArt = true;
  private showButtons = true;
  private userDataDir = '';
  private customPipePaths: string[] | null = null;

  private socket: net.Socket | null = null;
  private status: DiscordConnectionState = 'DISCONNECTED';
  private activePipePath: string | null = null;
  private readBuffer: Buffer = Buffer.alloc(0);
  private supportsStatusDisplayType = true;
  private lastError: string | null = null;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectingPromise: Promise<boolean> | null = null;
  private lastPlayback: DiscordPlaybackInput | null = null;
  private resolvedArtCache = new Map<string, string>();
  private artLookupInFlight = new Set<string>();
  private pendingSetActivity = new Map<
    string,
    { hadStatusDisplayType: boolean; input: DiscordPlaybackInput; artOverride?: string | null }
  >();
  private disposed = false;

  constructor(config: DiscordRpcConfig = {}) {
    this.configure(config);
  }

  public configure(config: DiscordRpcConfig): DiscordStatusSnapshot {
    const prevEnabled = this.enabled;
    const prevClientId = this.clientId;

    if (typeof config.enabled === 'boolean') this.enabled = config.enabled;
    if (typeof config.clientId === 'string' && config.clientId.trim()) {
      this.clientId = config.clientId.trim();
    }
    if (config.displayFormat) this.displayFormat = config.displayFormat;
    if (typeof config.showTimeRemaining === 'boolean') {
      this.showTimeRemaining = config.showTimeRemaining;
    }
    if (typeof config.showAlbumArt === 'boolean') this.showAlbumArt = config.showAlbumArt;
    if (typeof config.showButtons === 'boolean') this.showButtons = config.showButtons;
    if (typeof config.userDataDir === 'string') this.userDataDir = config.userDataDir;
    if (Array.isArray(config.pipePaths)) this.customPipePaths = config.pipePaths;

    if (!this.enabled && prevEnabled) {
      this.clear();
      this.disconnect();
    } else if (this.enabled && (this.clientId !== prevClientId || !prevEnabled)) {
      if (this.clientId !== prevClientId) {
        this.disconnect();
      }
      if (this.lastPlayback) {
        void this.update(this.lastPlayback);
      } else {
        void this.connect();
      }
    } else if (this.enabled && this.lastPlayback && this.status === 'CONNECTED') {
      void this.update(this.lastPlayback);
    }

    return this.getStatus();
  }

  public getStatus(): DiscordStatusSnapshot {
    return {
      status: this.status,
      connected: this.status === 'CONNECTED',
      enabled: this.enabled,
      clientId: this.clientId,
      pipePath: this.activePipePath,
      supportsStatusDisplayType: this.supportsStatusDisplayType,
      lastError: this.lastError,
    };
  }

  public async connect(sendPendingOnReady = true): Promise<boolean> {
    if (this.disposed || !this.enabled) return false;
    if (this.status === 'CONNECTED' && this.socket && !this.socket.destroyed) return true;
    if (this.connectingPromise) return this.connectingPromise;

    this.clearReconnectTimer();
    this.status = 'CONNECTING';

    this.connectingPromise = (async () => {
      const candidates = this.customPipePaths || getDiscordIpcPipePaths();
      for (const pipePath of candidates) {
        if (this.disposed || !this.enabled) break;
        const ok = await this.tryHandshakePipe(pipePath);
        if (ok) {
          this.lastError = null;
          this.connectingPromise = null;
          if (sendPendingOnReady && this.lastPlayback) {
            this.sendActivityNow(this.lastPlayback);
          }
          return true;
        }
      }

      this.status = 'DISCONNECTED';
      this.activePipePath = null;
      this.connectingPromise = null;
      this.scheduleReconnect();
      return false;
    })();

    return this.connectingPromise;
  }

  private tryHandshakePipe(pipePath: string): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      let sock: net.Socket;

      const finish = (ok: boolean, reason?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        if (!ok) {
          if (reason) this.lastError = reason;
          try {
            sock?.destroy();
          } catch {
            // Ignore
          }
          if (this.socket === sock) {
            this.socket = null;
          }
        }
        resolve(ok);
      };

      try {
        sock = net.createConnection(pipePath);
      } catch (err: any) {
        this.lastError = err?.message || String(err);
        resolve(false);
        return;
      }

      // Attach socket error handler immediately before any async boundary
      sock.on('error', (err: Error) => {
        if (!settled) {
          finish(false, err?.message || 'Pipe error');
          return;
        }
        this.handleSocketDrop(sock, err?.message || 'Pipe error');
      });

      sock.on('close', () => {
        if (!settled) {
          finish(false, 'Pipe closed during handshake');
          return;
        }
        this.handleSocketDrop(sock);
      });

      const timeoutHandle = setTimeout(() => {
        finish(false, 'Handshake timeout');
      }, 1500);
      timeoutHandle.unref?.();

      sock.once('connect', () => {
        if (this.disposed || !this.enabled) {
          finish(false, 'Disabled');
          return;
        }
        this.socket = sock;
        this.activePipePath = pipePath;
        this.readBuffer = Buffer.alloc(0);

        sock.on('data', (chunk: Buffer) => {
          const prevReady = this.status === 'CONNECTED';
          this.onSocketData(sock, chunk);
          if (!settled && !prevReady && this.status === 'CONNECTED') {
            finish(true);
          }
        });

        try {
          sock.write(
            encodeDiscordFrame(DISCORD_OP_HANDSHAKE, {
              v: 1,
              client_id: this.clientId,
            })
          );
        } catch (err: any) {
          finish(false, err?.message || 'Handshake write failed');
        }
      });
    });
  }

  private onSocketData(sock: net.Socket, chunk: Buffer): void {
    if (this.socket !== sock) return;
    this.readBuffer =
      this.readBuffer.byteLength === 0 ? Buffer.from(chunk) : Buffer.concat([this.readBuffer, chunk]);

    const { frames, remaining } = decodeDiscordFrames(this.readBuffer);
    this.readBuffer = remaining;

    for (const frame of frames) {
      if (frame.opcode === DISCORD_OP_PING) {
        try {
          sock.write(encodeDiscordFrame(DISCORD_OP_PONG, frame.payload));
        } catch {
          // Ignore write failure
        }
        continue;
      }

      if (frame.opcode === DISCORD_OP_CLOSE) {
        this.handleSocketDrop(sock, frame.payload?.message || 'Discord closed IPC');
        return;
      }

      if (frame.opcode === DISCORD_OP_FRAME && frame.payload && typeof frame.payload === 'object') {
        const msg = frame.payload;
        if (msg.cmd === 'DISPATCH' && msg.evt === 'READY') {
          this.status = 'CONNECTED';
          this.supportsStatusDisplayType = true;
          this.lastError = null;
          continue;
        }

        if (msg.evt === 'ERROR') {
          const nonce = typeof msg.nonce === 'string' ? msg.nonce : '';
          const pending = nonce ? this.pendingSetActivity.get(nonce) : undefined;
          if (nonce) this.pendingSetActivity.delete(nonce);

          const errMsg = String(msg.data?.message || msg.message || '');
          this.lastError = errMsg || 'Discord RPC error';

          if (pending && pending.hadStatusDisplayType) {
            this.supportsStatusDisplayType = false;
            this.sendActivityNow(pending.input, pending.artOverride);
          }
          continue;
        }

        if (typeof msg.nonce === 'string') {
          this.pendingSetActivity.delete(msg.nonce);
        }
      }
    }
  }

  private handleSocketDrop(sock: net.Socket, reason?: string): void {
    if (this.socket !== sock) return;
    this.socket = null;
    this.activePipePath = null;
    this.readBuffer = Buffer.alloc(0);
    this.pendingSetActivity.clear();
    if (reason) this.lastError = reason;
    if (this.status !== 'DISCONNECTED') {
      this.status = 'DISCONNECTED';
    }
    if (this.enabled && !this.disposed) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || !this.enabled || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.disposed && this.enabled && this.status === 'DISCONNECTED') {
        void this.connect();
      }
    }, 15_000);
    this.reconnectTimer.unref?.();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  public async update(input: DiscordPlaybackInput): Promise<boolean> {
    if (this.disposed) return false;
    this.lastPlayback = { ...input };
    if (!this.enabled) return false;

    if (this.status !== 'CONNECTED' || !this.socket || this.socket.destroyed) {
      const ok = await this.connect(false);
      if (!ok) return false;
    }

    const rawArt = (input.thumbnailUrl || input.artworkUrl || '').trim();
    const cacheKey = `${(input.artist || '').toLowerCase()}|${(input.title || '').toLowerCase()}`;
    const cachedArt = this.resolvedArtCache.get(cacheKey);

    this.sendActivityNow(input, cachedArt);

    if (
      this.showAlbumArt &&
      !cachedArt &&
      this.userDataDir &&
      input.title &&
      (rawArt.startsWith('waveform-local://') || rawArt.startsWith('file://') || input.isLocal)
    ) {
      this.resolveLocalArtworkAsync(input, cacheKey);
    }

    return this.status === 'CONNECTED';
  }

  private resolveLocalArtworkAsync(input: DiscordPlaybackInput, cacheKey: string): void {
    if (this.artLookupInFlight.has(cacheKey) || !this.userDataDir) return;
    this.artLookupInFlight.add(cacheKey);

    const durSec =
      typeof input.durationSec === 'number' && input.durationSec > 0
        ? input.durationSec
        : typeof input.durationMs === 'number' && input.durationMs > 0
        ? Math.round(input.durationMs / 1000)
        : undefined;

    void fetchAndCacheArtwork(
      this.userDataDir,
      input.artist || '',
      input.title || '',
      durSec
    )
      .then((url) => {
        if (url && url.startsWith('https://')) {
          this.resolvedArtCache.set(cacheKey, url);
          const current = this.lastPlayback;
          if (
            current &&
            !this.disposed &&
            this.enabled &&
            this.status === 'CONNECTED' &&
            `${(current.artist || '').toLowerCase()}|${(current.title || '').toLowerCase()}` ===
              cacheKey
          ) {
            this.sendActivityNow(current, url);
          }
        }
      })
      .catch(() => {
        // Non-fatal fallback to waveform_logo
      })
      .finally(() => {
        this.artLookupInFlight.delete(cacheKey);
      });
  }

  private sendActivityNow(input: DiscordPlaybackInput, artOverride?: string | null): void {
    if (!this.socket || this.socket.destroyed || this.status !== 'CONNECTED') return;

    const includeStatusDisplayType = this.supportsStatusDisplayType;
    const activity = buildDiscordActivityPayload(input, {
      displayFormat: this.displayFormat,
      showTimeRemaining: this.showTimeRemaining,
      showAlbumArt: this.showAlbumArt,
      showButtons: this.showButtons,
      includeStatusDisplayType,
      resolvedArtworkOverride: artOverride,
    });

    const nonce = randomUUID();
    if (this.pendingSetActivity.size > 32) {
      const oldest = this.pendingSetActivity.keys().next().value;
      if (oldest) this.pendingSetActivity.delete(oldest);
    }
    this.pendingSetActivity.set(nonce, {
      hadStatusDisplayType: includeStatusDisplayType,
      input,
      artOverride,
    });

    try {
      this.socket.write(
        encodeDiscordFrame(DISCORD_OP_FRAME, {
          cmd: 'SET_ACTIVITY',
          args: {
            pid: process.pid,
            activity,
          },
          nonce,
        })
      );
    } catch (err: any) {
      this.handleSocketDrop(this.socket, err?.message || 'Write failed');
    }
  }

  public clear(): void {
    this.lastPlayback = null;
    if (!this.socket || this.socket.destroyed || this.status !== 'CONNECTED') return;
    try {
      this.socket.write(
        encodeDiscordFrame(DISCORD_OP_FRAME, {
          cmd: 'SET_ACTIVITY',
          args: {
            pid: process.pid,
            activity: null,
          },
          nonce: randomUUID(),
        })
      );
    } catch {
      // Ignore clear write failure
    }
  }

  public disconnect(): void {
    this.clearReconnectTimer();
    const sock = this.socket;
    this.socket = null;
    this.activePipePath = null;
    this.status = 'DISCONNECTED';
    this.readBuffer = Buffer.alloc(0);
    this.pendingSetActivity.clear();

    if (sock && !sock.destroyed) {
      try {
        sock.write(encodeDiscordFrame(DISCORD_OP_CLOSE, {}));
      } catch {
        // Ignore close frame error
      }
      try {
        sock.end(() => {
          try {
            sock.destroy();
          } catch {
            // Ignore destroy error
          }
        });
        const t = setTimeout(() => {
          try {
            if (!sock.destroyed) sock.destroy();
          } catch {
            // Ignore
          }
        }, 100);
        t.unref?.();
      } catch {
        // Ignore end error
      }
    }
  }

  public shutdown(): void {
    this.disposed = true;
    this.clear();
    this.disconnect();
  }
}

const sharedDiscordRpc = new DiscordRpcManager();

export function getSharedDiscordRpc(): DiscordRpcManager {
  return sharedDiscordRpc;
}
