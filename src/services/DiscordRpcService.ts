// src/services/DiscordRpcService.ts
// Sandboxed-renderer-safe Discord Rich Presence service forwarding via Electron Main IPC,
// plus pure framing & activity payload helpers matching Discord IPC specifications.

import type { Song } from '../models/Song';

export const DISCORD_DEFAULT_CLIENT_ID = '1574112665163530280';
export const GET_WAVEFORM_URL = 'https://github.com/trapston3/waveform-desktop';

export type DiscordDisplayFormat =
  | 'song_on_waveform'
  | 'song_title'
  | 'artist'
  | 'waveform';

export interface DiscordRpcActivity {
  type: 2;
  status_display_type?: 0 | 1 | 2;
  state: string;
  details: string;
  timestamps?: { start?: number; end?: number };
  assets: {
    large_image: string;
    large_text: string;
    small_image: string;
    small_text: string;
  };
  buttons?: Array<{ label: string; url: string }>;
  instance?: boolean;
}

export type DiscordRpcStatus = 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING';

export interface DiscordRpcConfig {
  enabled?: boolean;
  clientId?: string;
  displayFormat?: DiscordDisplayFormat;
  showTimeRemaining?: boolean;
  showAlbumArt?: boolean;
  showButtons?: boolean;
}

export interface DiscordActivityInput {
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

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeDiscordFrame(opcode: number, payload: unknown): Uint8Array {
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  const body = textEncoder.encode(json);
  const frame = new Uint8Array(8 + body.byteLength);
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  view.setUint32(0, opcode >>> 0, true);
  view.setUint32(4, body.byteLength >>> 0, true);
  frame.set(body, 8);
  return frame;
}

export function decodeDiscordFrames(buffer: Uint8Array): {
  frames: Array<{ opcode: number; payload: any }>;
  remaining: Uint8Array;
} {
  const frames: Array<{ opcode: number; payload: any }> = [];
  let offset = 0;

  while (offset + 8 <= buffer.byteLength) {
    const view = new DataView(
      buffer.buffer,
      buffer.byteOffset + offset,
      buffer.byteLength - offset
    );
    const opcode = view.getUint32(0, true);
    const length = view.getUint32(4, true);

    if (length > 4 * 1024 * 1024) {
      offset = buffer.byteLength;
      break;
    }
    if (offset + 8 + length > buffer.byteLength) {
      break;
    }

    const rawJson = textDecoder.decode(buffer.subarray(offset + 8, offset + 8 + length));
    let parsed: any = {};
    if (rawJson.length > 0) {
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        parsed = rawJson;
      }
    }

    frames.push({ opcode, payload: parsed });
    offset += 8 + length;
  }

  return {
    frames,
    remaining: offset < buffer.byteLength ? buffer.slice(offset) : new Uint8Array(0),
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
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
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
      // Ignore malformed URLs
    }
  }

  if (!isLocal && typeof videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
  }

  return 'waveform_logo';
}

function isNonLocalTrack(input: DiscordActivityInput): boolean {
  if (input.isLocal || input.playbackSourceType === 'LOCAL') return false;
  const vid = typeof input.videoId === 'string' ? input.videoId.trim() : '';
  if (!vid) return false;
  if (/^(local|file|jiosaavn)[_:-]/i.test(vid)) return false;
  return /^[A-Za-z0-9_-]{4,64}$/.test(vid);
}

export function buildDiscordActivityPayload(
  input: DiscordActivityInput,
  options: {
    displayFormat?: DiscordDisplayFormat;
    showTimeRemaining?: boolean;
    showAlbumArt?: boolean;
    showButtons?: boolean;
    includeStatusDisplayType?: boolean;
    nowMs?: number;
  } = {}
): DiscordRpcActivity {
  const format = options.displayFormat || 'song_on_waveform';
  const showTimeRemaining = options.showTimeRemaining !== false;
  const showAlbumArt = options.showAlbumArt !== false;
  const showButtons = options.showButtons !== false;
  const includeStatusDisplayType = options.includeStatusDisplayType !== false;

  const statusDisplayType: 0 | 1 | 2 =
    format === 'waveform' ? 0 : format === 'artist' ? 1 : 2;

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

  const largeImage = showAlbumArt
    ? resolveDiscordSafeArtworkUrl(
        input.thumbnailUrl || input.artworkUrl,
        input.videoId,
        Boolean(input.isLocal)
      )
    : 'waveform_logo';

  const quality = (input.sourceQuality || 'Hi-Fi').trim() || 'Hi-Fi';
  const smallImage = isPlaying ? 'waveform_play' : 'waveform_pause';
  const smallText = isPlaying ? `${quality} • WaveForm` : 'Paused • WaveForm';

  const activity: DiscordRpcActivity = {
    type: 2,
    ...(includeStatusDisplayType ? { status_display_type: statusDisplayType } : {}),
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
    if (isNonLocalTrack(input) && input.videoId) {
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

function getElectronDiscordApi(): {
  discordRpcUpdate?: (payload: Record<string, any>) => Promise<boolean>;
  discordRpcClear?: () => Promise<boolean>;
  discordRpcGetStatus?: () => Promise<{ status?: DiscordRpcStatus; connected?: boolean }>;
  discordRpcConfigure?: (config: Record<string, any>) => Promise<{ status?: DiscordRpcStatus }>;
} | null {
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    return (window as any).electronAPI;
  }
  return null;
}

export class DiscordRpcService {
  private static readonly CLIENT_ID = DISCORD_DEFAULT_CLIENT_ID;
  private status: DiscordRpcStatus = 'DISCONNECTED';
  private config: DiscordRpcConfig = {
    enabled: true,
    clientId: DiscordRpcService.CLIENT_ID,
    displayFormat: 'song_on_waveform',
    showTimeRemaining: true,
    showAlbumArt: true,
    showButtons: true,
  };
  private partyCode: string | null = null;
  private partyUrl: string | null = null;
  private currentSong: Song | null = null;
  private lastActivity: DiscordRpcActivity | null = null;

  public getStatus(): DiscordRpcStatus {
    return this.status;
  }

  public isConnected(): boolean {
    return this.status === 'CONNECTED';
  }

  public getLastActivity(): DiscordRpcActivity | null {
    return this.lastActivity;
  }

  public configure(config: DiscordRpcConfig): void {
    this.config = { ...this.config, ...config };
    const api = getElectronDiscordApi();
    if (api?.discordRpcConfigure) {
      void api
        .discordRpcConfigure(this.config)
        .then((snap) => {
          if (snap?.status) this.status = snap.status;
        })
        .catch(() => {});
    }
  }

  public setPartyState(partyCode: string | null, partyUrl?: string | null): void {
    this.partyCode = partyCode ? partyCode.trim() : null;
    this.partyUrl = partyUrl || null;
  }

  public async connect(): Promise<boolean> {
    const api = getElectronDiscordApi();
    if (!api?.discordRpcConfigure) {
      this.status = 'DISCONNECTED';
      return false;
    }

    this.status = 'CONNECTING';
    try {
      const snap = await api.discordRpcConfigure({
        ...this.config,
        enabled: true,
      });
      if (snap?.status === 'CONNECTED') {
        this.status = 'CONNECTED';
        return true;
      }
      if (api.discordRpcGetStatus) {
        const latest = await api.discordRpcGetStatus();
        this.status = latest?.status || 'DISCONNECTED';
        return this.status === 'CONNECTED';
      }
    } catch {
      // Non-fatal graceful fallback
    }
    this.status = 'DISCONNECTED';
    return false;
  }

  public disconnect(): void {
    const api = getElectronDiscordApi();
    if (api?.discordRpcClear) {
      void api.discordRpcClear().catch(() => {});
    }
    if (api?.discordRpcConfigure) {
      void api.discordRpcConfigure({ enabled: false }).catch(() => {});
    }
    this.status = 'DISCONNECTED';
  }

  public clearActivity(): void {
    this.currentSong = null;
    this.lastActivity = null;
    const api = getElectronDiscordApi();
    if (api?.discordRpcClear) {
      void api.discordRpcClear().catch(() => {});
    }
  }

  public updatePlayback(
    song: Song,
    currentPlaybackMs: number,
    durationMs: number,
    isPlaying: boolean,
    playbackSpeed = 1.0
  ): void {
    this.currentSong = song;
    const durSec =
      typeof song.durationSec === 'number' && song.durationSec > 0
        ? song.durationSec
        : durationMs > 0
        ? durationMs / 1000
        : 0;

    const payloadInput: DiscordActivityInput = {
      videoId: song.videoId,
      title: song.title,
      artist: song.artist,
      albumName: song.albumName || song.album || null,
      thumbnailUrl: song.thumbnailUrl || song.artworkUrl || null,
      sourceQuality: song.sourceQuality || song.audioQuality || null,
      isLocal: Boolean(song.isLocal || song.playbackSourceType === 'LOCAL'),
      playbackSourceType: song.playbackSourceType,
      durationSec: durSec,
      durationMs,
      positionMs: currentPlaybackMs,
      isPlaying,
      playbackSpeed,
      partyCode: this.partyCode,
      partyUrl: this.partyUrl,
    };

    this.lastActivity = buildDiscordActivityPayload(payloadInput, {
      displayFormat: this.config.displayFormat,
      showTimeRemaining: this.config.showTimeRemaining,
      showAlbumArt: this.config.showAlbumArt,
      showButtons: this.config.showButtons,
    });

    const api = getElectronDiscordApi();
    if (api?.discordRpcUpdate && this.config.enabled !== false) {
      void api
        .discordRpcUpdate(payloadInput)
        .then((connected) => {
          this.status = connected ? 'CONNECTED' : 'DISCONNECTED';
        })
        .catch(() => {
          this.status = 'DISCONNECTED';
        });
    }
  }
}
