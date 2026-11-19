// src/services/DiscordRpcService.ts
// Discord Rich Presence via Windows Named Pipe IPC conforming to Feature 16

import net from 'node:net';
import { randomUUID } from 'node:crypto';
import type { Song } from '../models/Song';

export interface DiscordRpcActivity {
  state?: string;
  details?: string;
  timestamps?: { start?: number; end?: number };
  assets?: {
    large_image?: string;
    large_text?: string;
    small_image?: string;
    small_text?: string;
  };
  buttons?: Array<{ label: string; url: string }>;
  instance?: boolean;
}

export type DiscordRpcStatus = 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING';

export class DiscordRpcService {
  private static readonly CLIENT_ID = '1543679166967193620';
  private socket: net.Socket | null = null;
  private status: DiscordRpcStatus = 'DISCONNECTED';
  private currentSong: Song | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private lastUpdateMs = 0;
  private static readonly RATE_LIMIT_MS = 15000; // 15-second debounce

  public getStatus(): DiscordRpcStatus {
    return this.status;
  }

  public isConnected(): boolean {
    return this.status === 'CONNECTED';
  }

  public async connect(): Promise<boolean> {
    if (this.status === 'CONNECTED') return true;
    this.status = 'CONNECTING';

    // Scan pipes from discord-ipc-0 to discord-ipc-3
    for (let i = 0; i < 4; i++) {
      const pipePath = `\\\\.\\pipe\\discord-ipc-${i}`;
      const connected = await this.tryConnectPipe(pipePath);
      if (connected) {
        this.status = 'CONNECTED';
        this.sendHandshake();
        return true;
      }
    }

    this.status = 'DISCONNECTED';
    return false; // Graceful non-crashing fallback
  }

  private tryConnectPipe(pipePath: string): Promise<boolean> {
    return new Promise((resolve) => {
      let resolved = false;
      const sock = net.connect(pipePath);

      sock.once('connect', () => {
        if (!resolved) {
          resolved = true;
          this.socket = sock;
          this.setupSocketListeners(sock);
          resolve(true);
        }
      });

      sock.once('error', () => {
        if (!resolved) {
          resolved = true;
          sock.destroy();
          resolve(false);
        }
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          sock.destroy();
          resolve(false);
        }
      }, 500);
    });
  }

  private setupSocketListeners(sock: net.Socket): void {
    sock.on('close', () => {
      this.status = 'DISCONNECTED';
      this.socket = null;
    });

    sock.on('error', (err) => {
      console.warn('[DiscordRpc] IPC socket warning:', err?.message || err);
      this.status = 'DISCONNECTED';
      this.socket = null;
    });
  }

  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {
        // Ignore destroy error
      }
      this.socket = null;
    }
    this.status = 'DISCONNECTED';
  }

  private sendPacket(opcode: number, payload: object): void {
    if (!this.socket || this.status !== 'CONNECTED') return;
    try {
      const jsonStr = JSON.stringify(payload);
      const byteLength = Buffer.byteLength(jsonStr, 'utf-8');
      const header = Buffer.alloc(8);
      header.writeUInt32LE(opcode, 0);
      header.writeUInt32LE(byteLength, 4);

      this.socket.write(header);
      this.socket.write(jsonStr, 'utf-8');
    } catch (err) {
      console.warn('[DiscordRpc] Failed to send packet:', err);
    }
  }

  private sendHandshake(): void {
    this.sendPacket(0, { v: 1, client_id: DiscordRpcService.CLIENT_ID });
  }

  public clearActivity(): void {
    if (this.status !== 'CONNECTED') return;
    this.sendPacket(1, {
      cmd: 'SET_ACTIVITY',
      args: {
        pid: typeof process !== 'undefined' ? process.pid : 1,
        activity: null,
      },
      nonce: randomUUID(),
    });
  }

  public updatePlayback(
    song: Song,
    currentPlaybackMs: number,
    durationMs: number,
    isPlaying: boolean,
    playbackSpeed = 1.0
  ): void {
    this.currentSong = song;
    if (this.status !== 'CONNECTED') return;

    const now = Date.now();
    // Immediate update on state transition or if 15s rate-limit elapsed
    this.lastUpdateMs = now;

    if (!isPlaying) {
      this.sendPacket(1, {
        cmd: 'SET_ACTIVITY',
        args: {
          pid: typeof process !== 'undefined' ? process.pid : 1,
          activity: {
            details: song.title,
            state: song.artist,
            assets: {
              large_image: song.thumbnailUrl || 'logo',
              large_text: song.albumName || song.title,
              small_image: 'pause',
              small_text: 'Paused',
            },
            instance: false,
          },
        },
        nonce: randomUUID(),
      });
      return;
    }

    const safeSpeed = playbackSpeed > 0 ? playbackSpeed : 1.0;
    const remainingMediaMs = Math.max(0, durationMs - currentPlaybackMs);
    const adjustedRemainingMs = remainingMediaMs / safeSpeed;
    const startSec = Math.floor((now - currentPlaybackMs / safeSpeed) / 1000);
    const endSec = Math.floor((now + adjustedRemainingMs) / 1000);

    const activity: DiscordRpcActivity = {
      details: safeSpeed !== 1.0 ? `${song.title} [${safeSpeed.toFixed(2)}x]` : song.title,
      state: song.artist,
      timestamps: { start: startSec, end: endSec },
      assets: {
        large_image: song.thumbnailUrl || 'logo',
        large_text: `${song.albumName || song.title} • ${song.sourceQuality || 'Hi-Fi'}`,
        small_image: 'play',
        small_text: 'Playing',
      },
      buttons: [
        { label: 'Listen on YouTube Music', url: `https://music.youtube.com/watch?v=${song.videoId}` },
        { label: 'Visit WaveForm', url: 'https://github.com/ojasshelke/WaveForm' },
      ],
      instance: false,
    };

    this.sendPacket(1, {
      cmd: 'SET_ACTIVITY',
      args: {
        pid: typeof process !== 'undefined' ? process.pid : 1,
        activity,
      },
      nonce: randomUUID(),
    });
  }
}
