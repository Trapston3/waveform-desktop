// src/services/PartySyncClient.ts
// Listen Together WebSocket synchronization client and in-memory mock broadcast server conforming to Feature 16

import type {
  PartyTrack,
  PartyMember,
  PartySnapshot,
  PartyPlayback,
  PartyQueue,
  PartyControlMessage,
  PartyInboundFrame,
} from '../models/Party';

export class PartySyncClient {
  private ws: WebSocket | null = null;
  private partyCode: string | null = null;
  private memberId: string | null = null;
  private isHost = false;
  private clockOffsetMs = 0;
  private isClockSynced = false;
  private pingInterval: NodeJS.Timeout | null = null;

  // Drift and reconciliation thresholds conforming to spec_miner_survey_3
  public static readonly ALIGN_TOLERANCE_MS = 120;
  public static readonly DRIFT_LIMIT_MS = 200; // ±200ms tight sync
  public static readonly DRIFT_STRIKES = 2;
  public static readonly DRIFT_COOLDOWN_MS = 6000;

  private currentSeq = 0;
  private lastAlignedSeq = -1;
  private driftStrikes = 0;
  private driftCooldownUntilMs = 0;
  private reconcileQuietUntilMs = 0;

  private onSeekRequested: ((targetMs: number) => void) | null = null;
  private onTrackChanged: ((track: PartyTrack, positionMs: number) => void) | null = null;
  private onPlayStateChanged: ((isPlaying: boolean) => void) | null = null;
  private onSnapshotUpdated: ((snapshot: PartySnapshot) => void) | null = null;

  public static isValidPartyCode(code: unknown): boolean {
    if (typeof code !== 'string') return false;
    return /^WAVE-\d{4}$/.test(code) || /^[A-Z0-9]{6}$/.test(code);
  }

  public setCallbacks(cbs: {
    onSeek?: (targetMs: number) => void;
    onTrackChange?: (track: PartyTrack, positionMs: number) => void;
    onPlayStateChange?: (isPlaying: boolean) => void;
    onSnapshotUpdate?: (snapshot: PartySnapshot) => void;
  }): void {
    if (cbs.onSeek) this.onSeekRequested = cbs.onSeek;
    if (cbs.onTrackChange) this.onTrackChanged = cbs.onTrackChange;
    if (cbs.onPlayStateChange) this.onPlayStateChanged = cbs.onPlayStateChange;
    if (cbs.onSnapshotUpdate) this.onSnapshotUpdated = cbs.onSnapshotUpdate;
  }

  public getClockOffsetMs(): number {
    return this.clockOffsetMs;
  }

  public getIsClockSynced(): boolean {
    return this.isClockSynced;
  }

  public connect(partyCode: string, token: string, serverUrl = 'ws://localhost:8000'): Promise<boolean> {
    return new Promise((resolve) => {
      this.partyCode = partyCode;
      const url = `${serverUrl}/ws/parties/${partyCode}?token=${encodeURIComponent(token)}`;

      try {
        const WebSocketImpl = typeof WebSocket !== 'undefined' ? WebSocket : (globalThis as any).WebSocket;
        if (!WebSocketImpl) {
          resolve(false);
          return;
        }

        const ws = new WebSocketImpl(url, ['waveform.v1']);
        this.ws = ws;

        ws.onopen = () => {
          this.startClockSync();
          resolve(true);
        };

        ws.onmessage = (event: MessageEvent) => {
          try {
            const dataStr = typeof event.data === 'string' ? event.data : event.data.toString();
            const frame = JSON.parse(dataStr);
            this.handleFrame(frame);
          } catch (err) {
            console.warn('[PartySyncClient] Malformed party frame:', err);
          }
        };

        ws.onerror = () => {
          resolve(false);
        };

        ws.onclose = () => {
          this.stopClockSync();
          this.ws = null;
        };
      } catch {
        resolve(false);
      }
    });
  }

  public disconnect(): void {
    this.stopClockSync();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
  }

  private startClockSync(): void {
    this.sendPing();
    this.pingInterval = setInterval(() => this.sendPing(), 5000);
  }

  private stopClockSync(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private sendPing(): void {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({ type: 'ping', clientMs: Date.now() }));
  }

  public handleFrame(frame: PartyInboundFrame | any): void {
    switch (frame.type) {
      case 'welcome':
        this.memberId = frame.you?.memberId || null;
        this.isHost = Boolean(frame.you?.isHost);
        if (frame.party && this.onSnapshotUpdated) {
          this.onSnapshotUpdated(frame.party);
        }
        break;

      case 'pong': {
        const now = Date.now();
        const rtt = Math.max(0, now - frame.clientMs);
        const serverEstimate = frame.serverMs + Math.round(rtt / 2);
        this.clockOffsetMs = serverEstimate - now;
        this.isClockSynced = true;
        break;
      }

      case 'state':
        this.reconcileState(frame);
        break;

      case 'queue':
        if (this.onSnapshotUpdated) {
          // Notify queue update
        }
        break;
    }
  }

  public getPartyPositionMs(playback: PartyPlayback): number {
    if (!playback.isPlaying) return playback.positionMs;
    const serverNow = Date.now() + this.clockOffsetMs;
    const anchor = playback.anchorMs || playback.updatedAtMs || serverNow;
    const elapsed = Math.round((serverNow - anchor) * (playback.speed || 1.0));
    return Math.max(0, playback.positionMs + elapsed);
  }

  private reconcileState(frame: any): void {
    const now = Date.now();
    if (now < this.reconcileQuietUntilMs) return;

    const playback: PartyPlayback = frame.playback;
    const targetSeq = frame.seq ?? ++this.currentSeq;

    if (playback.currentTrack && this.onTrackChanged) {
      this.onTrackChanged(playback.currentTrack, playback.positionMs);
    }
    if (this.onPlayStateChanged) {
      this.onPlayStateChanged(playback.isPlaying);
    }

    const partyPosMs = this.getPartyPositionMs(playback);

    if (targetSeq !== this.lastAlignedSeq) {
      this.lastAlignedSeq = targetSeq;
      if (this.onSeekRequested) {
        this.onSeekRequested(partyPosMs);
      }
    }
  }

  public checkDrift(localPosMs: number, playback: PartyPlayback): boolean {
    if (!playback.isPlaying || !this.isClockSynced) return false;
    const now = Date.now();
    if (now < this.driftCooldownUntilMs) return false;

    const partyPosMs = this.getPartyPositionMs(playback);
    const drift = Math.abs(localPosMs - partyPosMs);

    if (drift > PartySyncClient.DRIFT_LIMIT_MS) {
      if (++this.driftStrikes >= PartySyncClient.DRIFT_STRIKES) {
        this.driftStrikes = 0;
        this.driftCooldownUntilMs = now + PartySyncClient.DRIFT_COOLDOWN_MS;
        if (this.onSeekRequested) {
          this.onSeekRequested(partyPosMs);
        }
        return true;
      }
    } else {
      this.driftStrikes = 0;
    }
    return false;
  }

  public publishPlay(positionMs: number): void {
    this.reconcileQuietUntilMs = Date.now() + 4500;
    this.sendControl('play', { positionMs });
  }

  public publishPause(positionMs: number): void {
    this.reconcileQuietUntilMs = Date.now() + 4500;
    this.sendControl('pause', { positionMs });
  }

  public publishSeek(positionMs: number): void {
    this.reconcileQuietUntilMs = Date.now() + 4500;
    this.sendControl('seek', { positionMs });
  }

  public publishSetTrack(track: PartyTrack, positionMs: number): void {
    this.reconcileQuietUntilMs = Date.now() + 4500;
    this.sendControl('setTrack', { track, positionMs });
  }

  private sendControl(action: PartyControlMessage['action'], payload: object): void {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({ type: 'control', action, ...payload }));
  }
}

/**
 * In-memory Mock Broadcast Server for test suites and offline verification
 */
export class MockPartyBroadcastServer {
  private partyCode: string;
  private hostId: string;
  private members: Map<string, PartyMember> = new Map();
  private playback: PartyPlayback;
  private queue: PartyQueue;
  private seq = 0;
  private listenersCount = 0;

  constructor(partyCode = 'WAVE-1234', hostId = 'user_host_01') {
    this.partyCode = partyCode;
    this.hostId = hostId;
    this.playback = {
      isPlaying: false,
      positionMs: 0,
      updatedAtMs: Date.now(),
      anchorMs: Date.now(),
      speed: 1.0,
      currentTrack: null,
    };
    this.queue = {
      tracks: [],
      currentIndex: 0,
    };
  }

  public addMember(id: string, name: string, isHost = false): PartyMember {
    const member: PartyMember = {
      id,
      name,
      role: isHost ? 'host' : 'guest',
      isHost,
      isReady: true,
      activeAt: new Date().toISOString(),
    };
    this.members.set(id, member);
    this.listenersCount = this.members.size;
    return member;
  }

  public removeMember(id: string): void {
    this.members.delete(id);
    this.listenersCount = this.members.size;
  }

  public getRoomStatus(): 'VACANT' | 'ACTIVE' {
    return this.listenersCount <= 0 ? 'VACANT' : 'ACTIVE';
  }

  public getSnapshot(): PartySnapshot {
    const membersList = Array.from(this.members.values());
    return {
      partyCode: this.partyCode,
      roomId: this.partyCode,
      partyName: 'Test Party Room',
      hostId: this.hostId,
      currentTrack: this.playback.currentTrack,
      positionMs: this.playback.positionMs,
      timestamp: Date.now(),
      isPlaying: this.playback.isPlaying,
      participants: membersList,
      members: membersList,
      playback: { ...this.playback },
      queue: { ...this.queue },
      revision: this.seq,
    };
  }

  public handleControl(action: string, payload: any): any {
    this.seq++;
    if (action === 'play') {
      this.playback.isPlaying = true;
      this.playback.positionMs = payload.positionMs ?? this.playback.positionMs;
      this.playback.anchorMs = Date.now();
    } else if (action === 'pause') {
      this.playback.isPlaying = false;
      this.playback.positionMs = payload.positionMs ?? this.playback.positionMs;
    } else if (action === 'seek') {
      this.playback.positionMs = payload.positionMs ?? 0;
      this.playback.anchorMs = Date.now();
    } else if (action === 'setTrack') {
      this.playback.currentTrack = payload.track;
      this.playback.positionMs = payload.positionMs ?? 0;
      this.playback.anchorMs = Date.now();
    }

    return {
      type: 'state',
      seq: this.seq,
      playback: { ...this.playback },
    };
  }
}
