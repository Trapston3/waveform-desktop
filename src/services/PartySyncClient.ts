// src/services/PartySyncClient.ts
// Listen Together synchronization client (Direct WS/LAN, Zero-Config MQTT-over-WS + WebRTC P2P),
// persistent Zustand room store (`usePartyStore`), and in-memory MockPartyBroadcastServer.

import { create } from 'zustand';
import type {
  PartyTrack,
  PartyMember,
  PartySnapshot,
  PartyPlayback,
  PartyQueue,
  PartyControlMessage,
  PartyInboundFrame,
  PartyChatMessage,
  PartyReactionEvent,
  PartyControlMode,
  PartyTransportMode,
  PartyConnectionStatus,
} from '../models/Party';

// ---------- Deterministic Pure-TS SHA-256 (for zero-dep room topic hashing) ----------

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function hashPartyRoomCode(partyCode: string): string {
  const input = new TextEncoder().encode(`waveform-party:${partyCode.trim().toUpperCase()}`);
  const bitLen = input.length * 8;
  const paddedLen = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(off + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  let hex = '';
  for (let i = 0; i < 4; i++) {
    hex += h[i].toString(16).padStart(8, '0');
  }
  return hex;
}

export function generatePartyCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 6; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < 6; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

// ---------- Pure-TS MQTT 3.1.1 over WebSocket Client ----------

const MQTT_BROKERS = [
  'wss://broker.emqx.io:8884/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

const STUN_ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function encodeMqttRemainingLength(len: number): number[] {
  const out: number[] = [];
  let x = len;
  do {
    let digit = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) digit |= 0x80;
    out.push(digit);
  } while (x > 0);
  return out;
}

function encodeMqttString(str: string): Uint8Array {
  const utf8 = new TextEncoder().encode(str);
  const out = new Uint8Array(2 + utf8.length);
  out[0] = (utf8.length >> 8) & 0xff;
  out[1] = utf8.length & 0xff;
  out.set(utf8, 2);
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function buildMqttPacket(headerByte: number, body: Uint8Array): Uint8Array {
  const remLen = encodeMqttRemainingLength(body.length);
  const out = new Uint8Array(1 + remLen.length + body.length);
  out[0] = headerByte;
  for (let i = 0; i < remLen.length; i++) out[1 + i] = remLen[i];
  out.set(body, 1 + remLen.length);
  return out;
}

export class MqttWsClient {
  private ws: WebSocket | null = null;
  private rxBuf: Uint8Array = new Uint8Array(0);
  private packetId = 1;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private closed = false;
  private onMessageCb: ((topic: string, payloadText: string) => void) | null = null;
  private onCloseCb: (() => void) | null = null;
  private pendingConnack: ((ok: boolean) => void) | null = null;
  private pendingSubacks = new Map<number, (ok: boolean) => void>();

  public setOnMessage(cb: (topic: string, payloadText: string) => void): void {
    this.onMessageCb = cb;
  }

  public setOnClose(cb: () => void): void {
    this.onCloseCb = cb;
  }

  public isConnected(): boolean {
    return this.connected && this.ws?.readyState === 1;
  }

  public async connect(brokerUrl: string, clientId: string, timeoutMs = 5000): Promise<boolean> {
    this.disconnect();
    this.closed = false;

    const WebSocketImpl =
      typeof WebSocket !== 'undefined' ? WebSocket : (globalThis as any).WebSocket;
    if (!WebSocketImpl) return false;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!ok) {
          this.disconnect();
        }
        resolve(ok);
      };

      const timer = setTimeout(() => finish(false), timeoutMs);

      try {
        const ws = new WebSocketImpl(brokerUrl, ['mqtt']);
        ws.binaryType = 'arraybuffer';
        this.ws = ws;

        ws.onopen = () => {
          this.pendingConnack = (ok) => {
            this.connected = ok;
            if (ok) {
              this.startKeepAlive();
            }
            finish(ok);
          };
          const varHeader = concatBytes([
            encodeMqttString('MQTT'),
            new Uint8Array([0x04, 0x02, 0x00, 0x1e]), // MQTT 3.1.1, CleanSession, KeepAlive 30s
          ]);
          const payload = encodeMqttString(clientId.slice(0, 23));
          ws.send(buildMqttPacket(0x10, concatBytes([varHeader, payload])));
        };

        ws.onmessage = (event: MessageEvent) => {
          const data = event.data;
          let chunk: Uint8Array;
          if (data instanceof ArrayBuffer) {
            chunk = new Uint8Array(data);
          } else if (ArrayBuffer.isView(data)) {
            chunk = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          } else {
            return;
          }
          this.rxBuf = this.rxBuf.length === 0 ? chunk : concatBytes([this.rxBuf, chunk]);
          this.drainPackets();
        };

        ws.onerror = () => {
          finish(false);
        };

        ws.onclose = () => {
          const wasConnected = this.connected;
          this.connected = false;
          this.stopKeepAlive();
          if (!settled) {
            finish(false);
          } else if (wasConnected && !this.closed) {
            this.onCloseCb?.();
          }
        };
      } catch {
        finish(false);
      }
    });
  }

  public async subscribe(topicFilter: string, timeoutMs = 4000): Promise<boolean> {
    if (!this.isConnected() || !this.ws) return false;
    const pid = this.nextPacketId();
    const body = concatBytes([
      new Uint8Array([(pid >> 8) & 0xff, pid & 0xff]),
      encodeMqttString(topicFilter),
      new Uint8Array([0x00]), // QoS 0
    ]);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingSubacks.delete(pid);
        resolve(false);
      }, timeoutMs);
      this.pendingSubacks.set(pid, (ok) => {
        clearTimeout(timer);
        resolve(ok);
      });
      try {
        this.ws!.send(buildMqttPacket(0x82, body));
      } catch {
        clearTimeout(timer);
        this.pendingSubacks.delete(pid);
        resolve(false);
      }
    });
  }

  public publish(topic: string, payload: string | object): void {
    if (!this.isConnected() || !this.ws) return;
    const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const body = concatBytes([encodeMqttString(topic), new TextEncoder().encode(str)]);
    try {
      this.ws.send(buildMqttPacket(0x30, body));
    } catch {
      // Ignore send errors on closed socket
    }
  }

  public disconnect(): void {
    this.closed = true;
    this.connected = false;
    this.stopKeepAlive();
    const pendingConnack = this.pendingConnack;
    this.pendingConnack = null;
    if (pendingConnack) {
      try {
        pendingConnack(false);
      } catch {
        // Ignore
      }
    }
    const pendingSubacks = Array.from(this.pendingSubacks.values());
    this.pendingSubacks.clear();
    for (const resolveSub of pendingSubacks) {
      try {
        resolveSub(false);
      } catch {
        // Ignore
      }
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        if (ws.readyState === 1) {
          ws.send(new Uint8Array([0xe0, 0x00])); // DISCONNECT
        }
        ws.close();
      } catch {
        // Ignore close error
      }
    }
    this.rxBuf = new Uint8Array(0);
  }

  private nextPacketId(): number {
    this.packetId = (this.packetId % 65535) + 1;
    return this.packetId;
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.pingTimer = setInterval(() => {
      if (this.isConnected() && this.ws) {
        try {
          this.ws.send(new Uint8Array([0xc0, 0x00])); // PINGREQ
        } catch {
          // Ignore
        }
      }
    }, 20000);
  }

  private stopKeepAlive(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private drainPackets(): void {
    while (this.rxBuf.length >= 2) {
      const header = this.rxBuf[0];
      let mult = 1;
      let remLen = 0;
      let lenBytes = 0;
      let incomplete = false;

      for (let i = 1; i < 5; i++) {
        if (i >= this.rxBuf.length) {
          incomplete = true;
          break;
        }
        const b = this.rxBuf[i];
        remLen += (b & 0x7f) * mult;
        lenBytes++;
        if ((b & 0x80) === 0) break;
        mult *= 128;
      }

      if (incomplete) return;
      const totalLen = 1 + lenBytes + remLen;
      if (this.rxBuf.length < totalLen) return;

      const body = this.rxBuf.subarray(1 + lenBytes, totalLen);
      this.rxBuf = this.rxBuf.subarray(totalLen);

      const pktType = header & 0xf0;
      if (pktType === 0x20 && body.length >= 2) {
        // CONNACK
        const rc = body[1];
        const cb = this.pendingConnack;
        this.pendingConnack = null;
        cb?.(rc === 0);
      } else if (pktType === 0x90 && body.length >= 3) {
        // SUBACK
        const pid = (body[0] << 8) | body[1];
        const granted = body[2];
        const cb = this.pendingSubacks.get(pid);
        this.pendingSubacks.delete(pid);
        cb?.(granted !== 0x80);
      } else if (pktType === 0x30 && body.length >= 2) {
        // PUBLISH
        const qos = (header >> 1) & 0x03;
        const topicLen = (body[0] << 8) | body[1];
        let pos = 2 + topicLen;
        if (pos > body.length) continue;
        const topic = new TextDecoder().decode(body.subarray(2, pos));
        if (qos > 0) {
          if (pos + 2 > body.length) continue;
          const pid = (body[pos] << 8) | body[pos + 1];
          pos += 2;
          if (qos === 1 && this.ws?.readyState === 1) {
            try {
              this.ws.send(new Uint8Array([0x40, 0x02, (pid >> 8) & 0xff, pid & 0xff]));
            } catch {
              // Ignore
            }
          }
        }
        const payloadText = new TextDecoder().decode(body.subarray(pos));
        this.onMessageCb?.(topic, payloadText);
      }
    }
  }
}

// ---------- Core PartySyncClient (Preserving 100% of existing API & test contracts) ----------

export type PartySyncZone = 'locked' | 'rate_catchup' | 'pause_wait' | 'hard_seek' | 'cooldown';

export interface PartySyncTelemetry {
  rttMs: number | null;
  clockOffsetMs: number;
  driftMs: number;
  syncZone: PartySyncZone;
  playbackRate: number;
  isClockSynced: boolean;
}

export type PartyDriftAction =
  | { action: 'none'; playbackRate: number; zone: PartySyncZone; driftMs: number }
  | { action: 'rate'; playbackRate: number; zone: PartySyncZone; driftMs: number }
  | { action: 'pause_wait'; playbackRate: number; zone: PartySyncZone; driftMs: number }
  | { action: 'resume'; playbackRate: number; zone: PartySyncZone; driftMs: number }
  | { action: 'seek'; targetPosMs: number; playbackRate: number; zone: PartySyncZone; driftMs: number };

function medianNumber(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * 5-sample median NTP offset/RTT estimator + 3-zone zero-loop drift controller.
 */
export class PartyDriftController {
  public static readonly NTP_WINDOW = 5;
  public static readonly DEADZONE_MS = 150;
  public static readonly SETTLE_MS = 80;
  public static readonly RATE_MAX_DRIFT_MS = 2200;
  public static readonly PAUSE_WAIT_MAX_AHEAD_MS = 4500;
  public static readonly PAUSE_RESUME_TOLERANCE_MS = 120;
  public static readonly LEAD_COMPENSATION_MS = 350;
  public static readonly SEEK_COOLDOWN_MS = 4500;
  public static readonly SLOW_RATE = 0.94;
  public static readonly FAST_RATE = 1.06;

  private rttSamples: number[] = [];
  private offsetSamples: number[] = [];
  private clockOffsetMs = 0;
  private rttMs: number | null = null;
  private isClockSynced = false;
  private currentRate = 1.0;
  private inPauseWait = false;
  private seekCooldownUntilMs = 0;
  private syncZone: PartySyncZone = 'locked';
  private lastDriftMs = 0;

  public reset(): void {
    this.rttSamples = [];
    this.offsetSamples = [];
    this.clockOffsetMs = 0;
    this.rttMs = null;
    this.isClockSynced = false;
    this.currentRate = 1.0;
    this.inPauseWait = false;
    this.seekCooldownUntilMs = 0;
    this.syncZone = 'locked';
    this.lastDriftMs = 0;
  }

  public recordPong(clientMs: number, serverMs: number, nowMs = Date.now()): PartySyncTelemetry {
    const rtt = Math.max(0, Math.round(nowMs - clientMs));
    const offset = Math.round(serverMs + rtt / 2 - nowMs);
    this.rttSamples.push(rtt);
    if (this.rttSamples.length > PartyDriftController.NTP_WINDOW) this.rttSamples.shift();
    this.offsetSamples.push(offset);
    if (this.offsetSamples.length > PartyDriftController.NTP_WINDOW) this.offsetSamples.shift();

    this.rttMs = medianNumber(this.rttSamples);
    this.clockOffsetMs = medianNumber(this.offsetSamples);
    this.isClockSynced = true;
    return this.getTelemetry();
  }

  public getClockOffsetMs(): number {
    return this.clockOffsetMs;
  }

  public getIsClockSynced(): boolean {
    return this.isClockSynced;
  }

  public getTelemetry(): PartySyncTelemetry {
    return {
      rttMs: this.rttMs,
      clockOffsetMs: this.clockOffsetMs,
      driftMs: this.lastDriftMs,
      syncZone: this.syncZone,
      playbackRate: this.currentRate,
      isClockSynced: this.isClockSynced,
    };
  }

  public evaluate(localPosMs: number, expectedHostPosMs: number, nowMs = Date.now()): PartyDriftAction {
    const driftMs = Math.round(localPosMs - expectedHostPosMs);
    const absDrift = Math.abs(driftMs);
    this.lastDriftMs = driftMs;

    if (this.inPauseWait) {
      if (driftMs <= PartyDriftController.PAUSE_RESUME_TOLERANCE_MS) {
        this.inPauseWait = false;
        this.currentRate = 1.0;
        this.syncZone = 'locked';
        return { action: 'resume', playbackRate: 1.0, zone: 'locked', driftMs };
      }
      if (driftMs <= PartyDriftController.PAUSE_WAIT_MAX_AHEAD_MS + 1000) {
        this.currentRate = 1.0;
        this.syncZone = 'pause_wait';
        return { action: 'pause_wait', playbackRate: 1.0, zone: 'pause_wait', driftMs };
      }
      this.inPauseWait = false;
    }

    if (nowMs < this.seekCooldownUntilMs) {
      if (absDrift < PartyDriftController.DEADZONE_MS) {
        const hadCustomRate = Math.abs(this.currentRate - 1.0) > 0.001;
        this.currentRate = 1.0;
        this.syncZone = 'cooldown';
        return {
          action: hadCustomRate ? 'rate' : 'none',
          playbackRate: 1.0,
          zone: 'cooldown',
          driftMs,
        };
      }
      if (
        nowMs > this.seekCooldownUntilMs - 3500 &&
        absDrift < PartyDriftController.RATE_MAX_DRIFT_MS
      ) {
        const targetRate = driftMs > 0 ? PartyDriftController.SLOW_RATE : PartyDriftController.FAST_RATE;
        this.currentRate = targetRate;
        this.syncZone = 'cooldown';
        return { action: 'rate', playbackRate: targetRate, zone: 'cooldown', driftMs };
      }
      this.syncZone = 'cooldown';
      return { action: 'none', playbackRate: this.currentRate, zone: 'cooldown', driftMs };
    }

    const isNudging = Math.abs(this.currentRate - 1.0) > 0.001;
    const lockedLimit = isNudging
      ? PartyDriftController.SETTLE_MS
      : PartyDriftController.DEADZONE_MS;

    if (absDrift < lockedLimit) {
      this.currentRate = 1.0;
      this.syncZone = 'locked';
      return {
        action: isNudging ? 'rate' : 'none',
        playbackRate: 1.0,
        zone: 'locked',
        driftMs,
      };
    }

    if (absDrift < PartyDriftController.RATE_MAX_DRIFT_MS) {
      const targetRate = driftMs > 0 ? PartyDriftController.SLOW_RATE : PartyDriftController.FAST_RATE;
      this.currentRate = targetRate;
      this.syncZone = 'rate_catchup';
      return { action: 'rate', playbackRate: targetRate, zone: 'rate_catchup', driftMs };
    }

    if (
      driftMs >= PartyDriftController.RATE_MAX_DRIFT_MS &&
      driftMs <= PartyDriftController.PAUSE_WAIT_MAX_AHEAD_MS
    ) {
      this.inPauseWait = true;
      this.currentRate = 1.0;
      this.syncZone = 'pause_wait';
      return { action: 'pause_wait', playbackRate: 1.0, zone: 'pause_wait', driftMs };
    }

    this.seekCooldownUntilMs = nowMs + PartyDriftController.SEEK_COOLDOWN_MS;
    this.currentRate = 1.0;
    this.syncZone = 'hard_seek';
    return {
      action: 'seek',
      targetPosMs: Math.max(0, Math.round(expectedHostPosMs + PartyDriftController.LEAD_COMPENSATION_MS)),
      playbackRate: 1.0,
      zone: 'hard_seek',
      driftMs,
    };
  }
}

export interface PartyClientCallbacks {
  onSeek?: (targetMs: number) => void;
  onPlaybackRateRequested?: (rate: number) => void;
  onPauseWaitChanged?: (waiting: boolean) => void;
  onSyncTelemetry?: (telemetry: PartySyncTelemetry) => void;
  onTrackChange?: (track: PartyTrack, positionMs: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
  onSnapshotUpdate?: (snapshot: PartySnapshot) => void;
  onQueueUpdate?: (queue: PartyQueue) => void;
  onMembersUpdate?: (members: PartyMember[]) => void;
  onChat?: (message: PartyChatMessage) => void;
  onReaction?: (reaction: PartyReactionEvent) => void;
  onControlModeChange?: (mode: PartyControlMode) => void;
  onStatusChange?: (status: PartyConnectionStatus) => void;
}

export class PartySyncClient {
  public ws: WebSocket | null = null;
  private partyCode: string | null = null;
  private memberId: string | null = null;
  private isHost = false;
  private clockOffsetMs = 0;
  private isClockSynced = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private shouldReconnect = false;
  private manualDisconnect = false;
  private lastConnectArgs: { partyCode: string; token: string; serverUrl: string; memberName?: string } | null = null;

  // Internet Room transport (MQTT-over-WS + WebRTC P2P DataChannel)
  private mqttClient: MqttWsClient | null = null;
  private roomHash: string | null = null;
  private peerConnections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private seenMessageIds = new Set<string>();
  private internetSendHook: ((frame: object) => void) | null = null;

  // Drift and 3-zone controller state
  public static readonly ALIGN_TOLERANCE_MS = 120;
  public static readonly DRIFT_LIMIT_MS = 150;
  public static readonly DRIFT_STRIKES = 2;
  public static readonly DRIFT_COOLDOWN_MS = 4500;

  private driftController = new PartyDriftController();
  private currentSeq = 0;
  private lastAlignedSeq = -1;
  private reconcileQuietUntilMs = 0;

  private onSeekRequested: ((targetMs: number) => void) | null = null;
  private onPlaybackRateRequested: ((rate: number) => void) | null = null;
  private onPauseWaitChanged: ((waiting: boolean) => void) | null = null;
  private onSyncTelemetry: ((telemetry: PartySyncTelemetry) => void) | null = null;
  private onTrackChanged: ((track: PartyTrack, positionMs: number) => void) | null = null;
  private onPlayStateChanged: ((isPlaying: boolean) => void) | null = null;
  private onSnapshotUpdated: ((snapshot: PartySnapshot) => void) | null = null;
  private onQueueUpdated: ((queue: PartyQueue) => void) | null = null;
  private onMembersUpdated: ((members: PartyMember[]) => void) | null = null;
  private onChatReceived: ((message: PartyChatMessage) => void) | null = null;
  private onReactionReceived: ((reaction: PartyReactionEvent) => void) | null = null;
  private onControlModeChanged: ((mode: PartyControlMode) => void) | null = null;
  private onStatusChanged: ((status: PartyConnectionStatus) => void) | null = null;

  public static isValidPartyCode(code: unknown): boolean {
    if (typeof code !== 'string') return false;
    return /^WAVE-\d{4}$/.test(code) || /^[A-Z0-9]{6}$/.test(code);
  }

  public setCallbacks(cbs: PartyClientCallbacks): void {
    if (cbs.onSeek) this.onSeekRequested = cbs.onSeek;
    if (cbs.onPlaybackRateRequested) this.onPlaybackRateRequested = cbs.onPlaybackRateRequested;
    if (cbs.onPauseWaitChanged) this.onPauseWaitChanged = cbs.onPauseWaitChanged;
    if (cbs.onSyncTelemetry) this.onSyncTelemetry = cbs.onSyncTelemetry;
    if (cbs.onTrackChange) this.onTrackChanged = cbs.onTrackChange;
    if (cbs.onPlayStateChange) this.onPlayStateChanged = cbs.onPlayStateChange;
    if (cbs.onSnapshotUpdate) this.onSnapshotUpdated = cbs.onSnapshotUpdate;
    if (cbs.onQueueUpdate) this.onQueueUpdated = cbs.onQueueUpdate;
    if (cbs.onMembersUpdate) this.onMembersUpdated = cbs.onMembersUpdate;
    if (cbs.onChat) this.onChatReceived = cbs.onChat;
    if (cbs.onReaction) this.onReactionReceived = cbs.onReaction;
    if (cbs.onControlModeChange) this.onControlModeChanged = cbs.onControlModeChange;
    if (cbs.onStatusChange) this.onStatusChanged = cbs.onStatusChange;
  }

  public getClockOffsetMs(): number {
    return this.driftController.getIsClockSynced()
      ? this.driftController.getClockOffsetMs()
      : this.clockOffsetMs;
  }

  public getIsClockSynced(): boolean {
    return this.driftController.getIsClockSynced() || this.isClockSynced;
  }

  public getSyncTelemetry(): PartySyncTelemetry {
    return this.driftController.getTelemetry();
  }

  public getMemberId(): string | null {
    return this.memberId;
  }

  public getIsHost(): boolean {
    return this.isHost;
  }

  public setInternetSendHook(hook: ((frame: object) => void) | null): void {
    this.internetSendHook = hook;
  }

  public attachInternetPeers(
    mqtt: MqttWsClient | null,
    roomHash: string | null,
    peers: Map<string, RTCPeerConnection>,
    channels: Map<string, RTCDataChannel>
  ): void {
    this.mqttClient = mqtt;
    this.roomHash = roomHash;
    this.peerConnections = peers;
    this.dataChannels = channels;
  }

  public connect(
    partyCode: string,
    token: string,
    serverUrl = 'ws://localhost:8000',
    options?: { autoReconnect?: boolean; memberName?: string; timeoutMs?: number }
  ): Promise<boolean> {
    this.manualDisconnect = false;
    this.shouldReconnect = Boolean(options?.autoReconnect);
    this.lastConnectArgs = {
      partyCode,
      token,
      serverUrl,
      memberName: options?.memberName,
    };
    this.clearReconnectTimer();

    return this.connectOnce(
      partyCode,
      token,
      serverUrl,
      options?.memberName,
      options?.timeoutMs ?? 5000
    );
  }

  private buildWsUrl(partyCode: string, token: string, serverUrl: string, memberName?: string): string {
    const cleanServer = serverUrl.trim().replace(/\/+$/, '');
    const sep = cleanServer.includes('?') ? '&' : '?';
    const nameParam = memberName ? `&name=${encodeURIComponent(memberName)}` : '';
    if (/\/ws\/parties\//i.test(cleanServer)) {
      if (cleanServer.includes('token=')) {
        return `${cleanServer}${nameParam}`;
      }
      return `${cleanServer}${sep}token=${encodeURIComponent(token)}${nameParam}`;
    }
    return `${cleanServer}/ws/parties/${encodeURIComponent(partyCode)}?token=${encodeURIComponent(token)}${nameParam}`;
  }

  private connectOnce(
    partyCode: string,
    token: string,
    serverUrl: string,
    memberName?: string,
    timeoutMs = 5000
  ): Promise<boolean> {
    return new Promise((resolve) => {
      this.partyCode = partyCode;
      const url = this.buildWsUrl(partyCode, token, serverUrl, memberName);

      let settled = false;
      let opened = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };

      const timer = setTimeout(() => {
        if (!settled) {
          try {
            this.ws?.close();
          } catch {
            // Ignore
          }
          finish(false);
        }
      }, timeoutMs);

      try {
        const WebSocketImpl =
          typeof WebSocket !== 'undefined' ? WebSocket : (globalThis as any).WebSocket;
        if (!WebSocketImpl) {
          finish(false);
          return;
        }

        const ws = new WebSocketImpl(url, ['waveform.v1']);
        this.ws = ws;

        ws.onopen = () => {
          opened = true;
          this.reconnectAttempt = 0;
          this.startClockSync();
          this.onStatusChanged?.('connected');
          finish(true);
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
          finish(false);
        };

        ws.onclose = () => {
          this.stopClockSync();
          if (this.ws === ws) {
            this.ws = null;
          }
          finish(false);
          if (opened && this.shouldReconnect && !this.manualDisconnect) {
            this.scheduleReconnect();
          } else if (!this.shouldReconnect || this.manualDisconnect) {
            this.onStatusChanged?.('disconnected');
          }
        };
      } catch {
        finish(false);
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.manualDisconnect || !this.shouldReconnect || !this.lastConnectArgs) return;
    if (this.reconnectTimer) return;

    this.onStatusChanged?.('reconnecting');
    const baseDelay = Math.min(15000, 1000 * Math.pow(2, this.reconnectAttempt));
    const jitter = Math.floor(Math.random() * 400);
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 6);

    const args = this.lastConnectArgs;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.manualDisconnect || !this.shouldReconnect) return;
      const ok = await this.connectOnce(args.partyCode, args.token, args.serverUrl, args.memberName, 5000);
      if (!ok && this.shouldReconnect && !this.manualDisconnect) {
        this.scheduleReconnect();
      }
    }, baseDelay + jitter);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  public disconnect(): void {
    this.manualDisconnect = true;
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.stopClockSync();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
    for (const dc of this.dataChannels.values()) {
      try {
        dc.close();
      } catch {
        // Ignore
      }
    }
    this.dataChannels.clear();
    for (const pc of this.peerConnections.values()) {
      try {
        pc.close();
      } catch {
        // Ignore
      }
    }
    this.peerConnections.clear();
    if (this.mqttClient) {
      this.mqttClient.disconnect();
      this.mqttClient = null;
    }
    this.internetSendHook = null;
    this.seenMessageIds.clear();
    this.lastAlignedSeq = -1;
    this.currentSeq = 0;
    this.driftController.reset();
    this.clockOffsetMs = 0;
    this.isClockSynced = false;
  }

  private startClockSync(): void {
    this.stopClockSync();
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
    const pingMsg = { type: 'ping', clientMs: Date.now() };
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(pingMsg));
      return;
    }
    this.internetSendHook?.(pingMsg);
  }

  public handleFrame(frame: PartyInboundFrame | any): void {
    if (!frame || typeof frame !== 'object') return;

    switch (frame.type) {
      case 'welcome':
        this.memberId = frame.you?.memberId || null;
        this.isHost = Boolean(frame.you?.isHost);
        if (frame.controlMode) {
          this.onControlModeChanged?.(frame.controlMode);
        } else if (frame.party?.controlMode) {
          this.onControlModeChanged?.(frame.party.controlMode);
        }
        if (frame.party) {
          this.onSnapshotUpdated?.(frame.party);
          if (Array.isArray(frame.party.members)) {
            this.onMembersUpdated?.(frame.party.members);
          }
          if (frame.party.queue) {
            this.onQueueUpdated?.(frame.party.queue);
          }
        }
        break;

      case 'pong': {
        if (typeof frame.clientMs !== 'number' || typeof frame.serverMs !== 'number') break;
        const telemetry = this.driftController.recordPong(frame.clientMs, frame.serverMs, Date.now());
        this.clockOffsetMs = telemetry.clockOffsetMs;
        this.isClockSynced = telemetry.isClockSynced;
        this.onSyncTelemetry?.(telemetry);
        break;
      }

      case 'state':
        this.reconcileState(frame);
        break;

      case 'queue':
        if (frame.queue && typeof frame.queue === 'object') {
          this.onQueueUpdated?.(frame.queue);
        }
        break;

      case 'members':
        if (Array.isArray(frame.members)) {
          this.onMembersUpdated?.(frame.members);
        }
        break;

      case 'chat': {
        const msg: PartyChatMessage | undefined = frame.message || (frame.text ? frame : undefined);
        if (msg && typeof msg.text === 'string') {
          if (msg.id && this.seenMessageIds.has(`chat:${msg.id}`)) break;
          if (msg.id) this.rememberSeenId(`chat:${msg.id}`);
          this.onChatReceived?.(msg);
        }
        break;
      }

      case 'reaction': {
        const reaction: PartyReactionEvent | undefined =
          frame.reaction || (frame.emoji ? frame : undefined);
        if (reaction && typeof reaction.emoji === 'string') {
          if (reaction.id && this.seenMessageIds.has(`rx:${reaction.id}`)) break;
          if (reaction.id) this.rememberSeenId(`rx:${reaction.id}`);
          this.onReactionReceived?.(reaction);
        }
        break;
      }

      case 'controlMode':
        if (frame.controlMode === 'host-only' || frame.controlMode === 'collaborative') {
          this.onControlModeChanged?.(frame.controlMode);
        }
        break;
    }
  }

  private rememberSeenId(key: string): void {
    if (this.seenMessageIds.size > 500) {
      const oldest = this.seenMessageIds.values().next().value;
      if (oldest) this.seenMessageIds.delete(oldest);
    }
    this.seenMessageIds.add(key);
  }

  public getPartyPositionMs(playback: PartyPlayback, nowMs = Date.now()): number {
    if (!playback) return 0;
    if (!playback.isPlaying) return playback.positionMs || 0;
    const serverNow = nowMs + this.getClockOffsetMs();
    const anchor = playback.anchorMs || playback.updatedAtMs || serverNow;
    const elapsed = Math.round((serverNow - anchor) * (playback.speed || 1.0));
    return Math.max(0, (playback.positionMs || 0) + elapsed);
  }

  public reconcileState(frame: any): void {
    const now = Date.now();
    if (now < this.reconcileQuietUntilMs) return;

    const playback: PartyPlayback | null | undefined = frame?.playback;
    if (!playback || typeof playback !== 'object') return;

    const hasExplicitSeq = typeof frame.seq === 'number' && Number.isFinite(frame.seq);
    const targetSeq = hasExplicitSeq ? frame.seq : ++this.currentSeq;

    // Ignore stale out-of-order frames
    if (hasExplicitSeq && this.lastAlignedSeq >= 0 && targetSeq < this.lastAlignedSeq) {
      return;
    }

    if (playback.currentTrack && this.onTrackChanged) {
      this.onTrackChanged(playback.currentTrack, playback.positionMs || 0);
    }
    if (typeof playback.isPlaying === 'boolean' && this.onPlayStateChanged) {
      this.onPlayStateChanged(playback.isPlaying);
    }

    const partyPosMs = this.getPartyPositionMs(playback, now);

    if (targetSeq !== this.lastAlignedSeq) {
      this.lastAlignedSeq = targetSeq;
      if (this.onSeekRequested) {
        this.onSeekRequested(partyPosMs);
      }
    }
  }

  public checkDrift(localPosMs: number, playback: PartyPlayback, nowMs = Date.now()): boolean {
    if (!playback || !playback.isPlaying || !this.getIsClockSynced()) return false;

    const expectedHostPosMs = this.getPartyPositionMs(playback, nowMs);
    const decision = this.driftController.evaluate(localPosMs, expectedHostPosMs, nowMs);
    this.onSyncTelemetry?.(this.driftController.getTelemetry());

    if (decision.action === 'seek') {
      this.onPauseWaitChanged?.(false);
      this.onPlaybackRateRequested?.(1.0);
      this.onSeekRequested?.(decision.targetPosMs);
      return true;
    }
    if (decision.action === 'pause_wait') {
      this.onPlaybackRateRequested?.(1.0);
      this.onPauseWaitChanged?.(true);
      return true;
    }
    if (decision.action === 'resume') {
      this.onPlaybackRateRequested?.(1.0);
      this.onPauseWaitChanged?.(false);
      return true;
    }
    if (decision.action === 'rate') {
      this.onPlaybackRateRequested?.(decision.playbackRate);
      return true;
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

  public publishSetTrack(track: PartyTrack, positionMs: number, isPlaying = true): void {
    this.reconcileQuietUntilMs = Date.now() + 4500;
    this.sendControl('setTrack', { track, positionMs, isPlaying });
  }

  public publishSetQueue(queue: PartyTrack[], currentIndex = 0): void {
    this.reconcileQuietUntilMs = Date.now() + 4500;
    this.sendControl('setQueue', { queue, currentIndex });
  }

  public publishControlMode(controlMode: PartyControlMode): void {
    this.sendControl('setControlMode', { controlMode });
  }

  public publishChat(text: string, senderName?: string): void {
    const clean = text.trim().slice(0, 500);
    if (!clean) return;
    this.sendRawFrame({
      type: 'chat',
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      senderName,
      text: clean,
    });
  }

  public publishReaction(emoji: string, senderName?: string): void {
    const clean = emoji.trim().slice(0, 16);
    if (!clean) return;
    this.sendRawFrame({
      type: 'reaction',
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      senderName,
      emoji: clean,
    });
  }

  private sendControl(action: PartyControlMessage['action'], payload: object): void {
    this.sendRawFrame({ type: 'control', action, ...payload });
  }

  private sendRawFrame(frame: object): void {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(frame));
      return;
    }
    this.internetSendHook?.(frame);
  }
}

// ---------- Persistent Zustand Singleton Store (`usePartyStore`) ----------

export interface PartyStoreState {
  status: PartyConnectionStatus;
  partyCode: string;
  isHost: boolean;
  memberId: string | null;
  nickname: string;
  transportMode: PartyTransportMode;
  relayUrl: string;
  lanUrl: string | null;
  lanIps: string[];
  p2pActive: boolean;
  clockOffsetMs: number;
  isClockSynced: boolean;
  rttMs: number | null;
  driftMs: number;
  syncZone: PartySyncZone;
  syncPlaybackRate: number;
  controlMode: PartyControlMode;
  participants: PartyMember[];
  currentTrack: PartyTrack | null;
  playback: PartyPlayback | null;
  queue: PartyQueue;
  chatMessages: PartyChatMessage[];
  reactions: PartyReactionEvent[];
  error: string | null;
}

export interface PartyStoreActions {
  setTransportMode: (mode: PartyTransportMode) => void;
  setRelayUrl: (url: string) => void;
  setNickname: (name: string) => void;
  createRoom: (options?: {
    transportMode?: PartyTransportMode;
    nickname?: string;
    relayUrl?: string;
    controlMode?: PartyControlMode;
  }) => Promise<boolean>;
  joinRoom: (
    codeOrUrl: string,
    options?: {
      transportMode?: PartyTransportMode;
      nickname?: string;
      relayUrl?: string;
    }
  ) => Promise<boolean>;
  leaveRoom: () => Promise<void>;
  sendChat: (text: string) => void;
  sendReaction: (emoji: string) => void;
  setControlMode: (mode: PartyControlMode) => void;
  publishTrackSnapshot: (track: PartyTrack, positionMs: number, isPlaying: boolean) => void;
  publishPlay: (positionMs: number) => void;
  publishPause: (positionMs: number) => void;
  publishSeek: (positionMs: number) => void;
}

export type PartyStore = PartyStoreState & PartyStoreActions;

let sharedSyncClient: PartySyncClient | null = null;
let sharedInternetCoordinator: InternetPartyCoordinator | null = null;
let playerStoreUnsub: (() => void) | null = null;
let driftCheckTimer: ReturnType<typeof setInterval> | null = null;
let lastPublishedTrackId: string | null = null;
let lastPublishedPlayState: string | null = null;
let remoteApplyDepth = 0;

function getElectronApi(): any {
  return typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
}

function makeSenderId(): string {
  return `wf_${Math.random().toString(36).slice(2, 10)}`;
}

function songToPartyTrack(song: any): PartyTrack | null {
  if (!song || !song.videoId) return null;
  return {
    videoId: song.videoId,
    title: song.title || 'Unknown Track',
    artist: song.artist || 'Unknown Artist',
    album: song.albumName || song.album || undefined,
    durationMs:
      typeof song.durationSec === 'number' && song.durationSec > 0
        ? Math.round(song.durationSec * 1000)
        : song.totalPlayTimeMs || 0,
    durationSec: song.durationSec,
    artworkUrl: song.thumbnailUrl || song.artworkUrl || undefined,
    isrc: song.isrc || undefined,
  };
}

class InternetPartyCoordinator {
  private client: PartySyncClient;
  private mqtt = new MqttWsClient();
  private roomHash: string;
  private partyCode: string;
  private memberId: string;
  private nickname: string;
  private isHost: boolean;
  private controlMode: PartyControlMode;
  private members = new Map<string, PartyMember>();
  private peers = new Map<string, RTCPeerConnection>();
  private channels = new Map<string, RTCDataChannel>();
  private iceFallbackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private seq = 0;
  private playback: PartyPlayback = {
    isPlaying: false,
    positionMs: 0,
    anchorMs: Date.now(),
    updatedAtMs: Date.now(),
    speed: 1.0,
    currentTrack: null,
  };
  private queue: PartyQueue = { tracks: [], currentIndex: 0 };
  private welcomeResolver: ((ok: boolean) => void) | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnecting = false;
  private disposed = false;

  constructor(
    client: PartySyncClient,
    partyCode: string,
    memberId: string,
    nickname: string,
    isHost: boolean,
    controlMode: PartyControlMode
  ) {
    this.client = client;
    this.partyCode = partyCode;
    this.roomHash = hashPartyRoomCode(partyCode);
    this.memberId = memberId;
    this.nickname = nickname;
    this.isHost = isHost;
    this.controlMode = controlMode;

    if (isHost) {
      this.members.set(memberId, {
        id: memberId,
        name: nickname,
        role: 'host',
        isReady: true,
        isHost: true,
        activeAt: new Date().toISOString(),
      });
    }
  }

  private get topicPrefix(): string {
    return `waveform-party-v1/${this.roomHash}`;
  }

  public async start(): Promise<boolean> {
    let mqttConnected = false;
    for (const broker of MQTT_BROKERS) {
      if (this.disposed) return false;
      const ok = await this.mqtt.connect(broker, `wf_${this.memberId.slice(-16)}`, 5000);
      if (ok) {
        mqttConnected = true;
        break;
      }
    }
    if (!mqttConnected || this.disposed) {
      this.stop();
      return false;
    }

    this.mqtt.setOnMessage((topic, payloadText) => {
      this.handleMqttMessage(topic, payloadText);
    });
    this.mqtt.setOnClose(() => {
      if (!this.disposed) {
        usePartyStore.setState({ status: 'reconnecting', p2pActive: false });
        void this.reconnectMqtt();
      }
    });

    const subOk = await this.mqtt.subscribe(`${this.topicPrefix}/#`, 4000);
    if (!subOk || this.disposed) {
      this.stop();
      return false;
    }

    this.client.attachInternetPeers(this.mqtt, this.roomHash, this.peers, this.channels);
    this.client.setInternetSendHook((frame) => this.sendOutboundFrame(frame));

    if (this.isHost) {
      this.client.handleFrame({
        type: 'welcome',
        you: { memberId: this.memberId, name: this.nickname, isHost: true },
        controlMode: this.controlMode,
        party: this.buildSnapshot(),
        serverMs: Date.now(),
      });
      this.heartbeatTimer = setInterval(() => {
        if (!this.disposed && this.mqtt.isConnected()) {
          this.broadcastRoomFrame({
            type: 'members',
            members: Array.from(this.members.values()),
          });
        }
      }, 10000);
      return true;
    }

    // Guest: send join_request and wait for host welcome (with 1 retry)
    usePartyStore.setState({ status: 'syncing' });
    const welcomed = await new Promise<boolean>((resolve) => {
      const sendJoin = () => {
        this.mqtt.publish(`${this.topicPrefix}/control`, {
          type: 'join_request',
          member: { id: this.memberId, name: this.nickname },
          clientMs: Date.now(),
        });
      };
      sendJoin();
      const retry = setTimeout(sendJoin, 1500);
      const wrapped = (ok: boolean) => {
        clearTimeout(retry);
        clearTimeout(timeout);
        if (this.welcomeResolver === wrapped) {
          this.welcomeResolver = null;
        }
        resolve(ok);
      };
      const timeout = setTimeout(() => {
        if (this.welcomeResolver === wrapped) {
          wrapped(false);
        }
      }, 5000);
      this.welcomeResolver = wrapped;
    });

    if (!welcomed || this.disposed) {
      this.stop();
      return false;
    }
    return true;
  }

  private async reconnectMqtt(): Promise<void> {
    if (this.reconnecting || this.disposed) return;
    this.reconnecting = true;
    try {
      for (let attempt = 0; attempt < 5 && !this.disposed; attempt++) {
        const delay = Math.min(15000, 1000 * Math.pow(2, attempt));
        await new Promise((r) => setTimeout(r, delay));
        if (this.disposed) return;
        for (const broker of MQTT_BROKERS) {
          if (this.disposed) return;
          const ok = await this.mqtt.connect(broker, `wf_${this.memberId.slice(-16)}`, 5000);
          if (this.disposed) return;
          if (ok) {
            const subOk = await this.mqtt.subscribe(`${this.topicPrefix}/#`, 4000);
            if (!subOk || this.disposed) {
              this.mqtt.disconnect();
              continue;
            }
            usePartyStore.setState({ status: 'connected' });
            if (!this.isHost) {
              this.mqtt.publish(`${this.topicPrefix}/control`, {
                type: 'join_request',
                member: { id: this.memberId, name: this.nickname },
                clientMs: Date.now(),
              });
            }
            return;
          }
        }
      }
      if (!this.disposed) {
        usePartyStore.setState({ status: 'disconnected', error: 'Internet relay connection lost' });
      }
    } finally {
      this.reconnecting = false;
    }
  }

  public stop(): void {
    this.disposed = true;
    if (this.welcomeResolver) {
      const resolveWelcome = this.welcomeResolver;
      this.welcomeResolver = null;
      resolveWelcome(false);
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const peerId of Array.from(this.peers.keys())) {
      this.cleanupPeer(peerId);
    }
    for (const peerId of Array.from(this.channels.keys())) {
      this.cleanupPeer(peerId);
    }
    for (const t of this.iceFallbackTimers.values()) clearTimeout(t);
    this.iceFallbackTimers.clear();
    if (this.mqtt.isConnected()) {
      this.mqtt.publish(`${this.topicPrefix}/control`, {
        type: 'leave',
        memberId: this.memberId,
      });
    }
    this.client.setInternetSendHook(null);
    this.mqtt.disconnect();
  }

  private sendOutboundFrame(frame: any): void {
    if (this.disposed) return;
    if (this.isHost) {
      if (frame.type === 'control') {
        this.applyHostControl(this.memberId, frame);
      } else if (frame.type === 'chat' || frame.type === 'reaction') {
        const enriched =
          frame.type === 'chat'
            ? {
                type: 'chat',
                message: {
                  id: frame.id,
                  senderId: this.memberId,
                  senderName: frame.senderName || this.nickname,
                  text: frame.text,
                  timestampMs: Date.now(),
                },
              }
            : {
                type: 'reaction',
                reaction: {
                  id: frame.id,
                  senderId: this.memberId,
                  senderName: frame.senderName || this.nickname,
                  emoji: frame.emoji,
                  timestampMs: Date.now(),
                },
              };
        this.client.handleFrame(enriched);
        this.broadcastRoomFrame(enriched);
      }
      return;
    }

    // Guest outbound: prefer open WebRTC DataChannel to host, fallback to MQTT control topic
    const enriched =
      frame.type === 'chat' || frame.type === 'reaction'
        ? { ...frame, senderId: this.memberId, senderName: frame.senderName || this.nickname }
        : { ...frame, senderId: this.memberId };

    let sentP2p = false;
    for (const dc of this.channels.values()) {
      if (dc.readyState === 'open') {
        try {
          dc.send(JSON.stringify(enriched));
          sentP2p = true;
        } catch {
          // Fallback below
        }
      }
    }
    if (!sentP2p) {
      this.mqtt.publish(`${this.topicPrefix}/control`, enriched);
    }
  }

  private broadcastRoomFrame(frame: object): void {
    const json = JSON.stringify(frame);
    let allOpen = this.channels.size > 0 && this.channels.size >= Math.max(0, this.members.size - 1);
    for (const dc of this.channels.values()) {
      if (dc.readyState === 'open') {
        try {
          dc.send(json);
        } catch {
          allOpen = false;
        }
      } else {
        allOpen = false;
      }
    }
    // Always publish to MQTT broadcast unless every peer has an open P2P DataChannel (fallback guarantee)
    if (!allOpen || (frame as any).type === 'welcome' || (frame as any).type === 'members') {
      this.mqtt.publish(`${this.topicPrefix}/broadcast`, json);
    }
  }

  private handleMqttMessage(topic: string, payloadText: string): void {
    if (this.disposed) return;
    let msg: any;
    try {
      msg = JSON.parse(payloadText);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (topic === `${this.topicPrefix}/rtc/${this.memberId}`) {
      void this.handleRtcSignal(msg);
      return;
    }

    if (this.isHost && topic === `${this.topicPrefix}/control`) {
      if (msg.senderId === this.memberId || msg.member?.id === this.memberId) return;
      this.handleHostControlTopic(msg);
      return;
    }

    if (!this.isHost && topic === `${this.topicPrefix}/broadcast`) {
      this.handleGuestBroadcast(msg);
    }
  }

  private handleHostControlTopic(msg: any): void {
    switch (msg.type) {
      case 'join_request': {
        const gid = msg.member?.id;
        if (!gid) return;
        const gName = String(msg.member?.name || 'Listener').slice(0, 40);
        this.members.set(gid, {
          id: gid,
          name: gName,
          role: 'guest',
          isReady: true,
          isHost: false,
          activeAt: new Date().toISOString(),
        });
        const snap = this.buildSnapshot();
        this.mqtt.publish(`${this.topicPrefix}/broadcast`, {
          type: 'welcome',
          targetId: gid,
          you: { memberId: gid, name: gName, isHost: false },
          controlMode: this.controlMode,
          party: snap,
          serverMs: Date.now(),
        });
        if (typeof msg.clientMs === 'number') {
          this.mqtt.publish(`${this.topicPrefix}/broadcast`, {
            type: 'pong',
            targetId: gid,
            clientMs: msg.clientMs,
            serverMs: Date.now(),
          });
        }
        const membersList = Array.from(this.members.values());
        this.client.handleFrame({ type: 'members', members: membersList });
        this.broadcastRoomFrame({ type: 'members', members: membersList });
        void this.initiateWebRtcToGuest(gid);
        break;
      }

      case 'leave': {
        if (msg.memberId && this.members.delete(msg.memberId)) {
          this.cleanupPeer(msg.memberId);
          const membersList = Array.from(this.members.values());
          this.client.handleFrame({ type: 'members', members: membersList });
          this.broadcastRoomFrame({ type: 'members', members: membersList });
        }
        break;
      }

      case 'ping': {
        this.mqtt.publish(`${this.topicPrefix}/broadcast`, {
          type: 'pong',
          targetId: msg.senderId,
          clientMs: msg.clientMs,
          serverMs: Date.now(),
        });
        break;
      }

      case 'control': {
        this.applyHostControl(msg.senderId || 'guest', msg);
        break;
      }

      case 'chat': {
        const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 500) : '';
        if (!text) return;
        const chatFrame = {
          type: 'chat',
          message: {
            id: msg.id || `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            senderId: msg.senderId || 'guest',
            senderName: msg.senderName || 'Listener',
            text,
            timestampMs: Date.now(),
          },
        };
        this.client.handleFrame(chatFrame);
        this.broadcastRoomFrame(chatFrame);
        break;
      }

      case 'reaction': {
        const emoji = typeof msg.emoji === 'string' ? msg.emoji.trim().slice(0, 16) : '';
        if (!emoji) return;
        const rxFrame = {
          type: 'reaction',
          reaction: {
            id: msg.id || `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            senderId: msg.senderId || 'guest',
            senderName: msg.senderName || 'Listener',
            emoji,
            timestampMs: Date.now(),
          },
        };
        this.client.handleFrame(rxFrame);
        this.broadcastRoomFrame(rxFrame);
        break;
      }
    }
  }

  private handleGuestBroadcast(msg: any): void {
    if (msg.targetId && msg.targetId !== this.memberId) return;

    if (msg.type === 'welcome' && this.welcomeResolver) {
      const resolve = this.welcomeResolver;
      this.welcomeResolver = null;
      this.client.handleFrame(msg);
      resolve(true);
      // Kick off NTP sync immediately
      this.mqtt.publish(`${this.topicPrefix}/control`, {
        type: 'ping',
        senderId: this.memberId,
        clientMs: Date.now(),
      });
      return;
    }

    this.client.handleFrame(msg);
  }

  private applyHostControl(senderId: string, msg: any): void {
    const isSenderHost = senderId === this.memberId;
    if (msg.action === 'setControlMode') {
      if (!isSenderHost) return;
      this.controlMode = msg.controlMode === 'collaborative' ? 'collaborative' : 'host-only';
      const frame = { type: 'controlMode', controlMode: this.controlMode };
      this.client.handleFrame(frame);
      this.broadcastRoomFrame(frame);
      return;
    }

    if (this.controlMode === 'host-only' && !isSenderHost) return;

    const now = Date.now();
    let stateChanged = false;
    let queueChanged = false;

    if (msg.action === 'play') {
      this.playback.isPlaying = true;
      if (typeof msg.positionMs === 'number') this.playback.positionMs = Math.max(0, msg.positionMs);
      this.playback.anchorMs = now;
      this.playback.updatedAtMs = now;
      this.playback.lastControllerId = senderId;
      stateChanged = true;
    } else if (msg.action === 'pause') {
      this.playback.isPlaying = false;
      if (typeof msg.positionMs === 'number') this.playback.positionMs = Math.max(0, msg.positionMs);
      this.playback.anchorMs = now;
      this.playback.updatedAtMs = now;
      this.playback.lastControllerId = senderId;
      stateChanged = true;
    } else if (msg.action === 'seek') {
      this.playback.positionMs = Math.max(0, Number(msg.positionMs) || 0);
      this.playback.anchorMs = now;
      this.playback.updatedAtMs = now;
      this.playback.lastControllerId = senderId;
      stateChanged = true;
    } else if (msg.action === 'setTrack') {
      this.playback.currentTrack = msg.track || null;
      this.playback.positionMs = Math.max(0, Number(msg.positionMs) || 0);
      if (typeof msg.isPlaying === 'boolean') this.playback.isPlaying = msg.isPlaying;
      this.playback.anchorMs = now;
      this.playback.updatedAtMs = now;
      this.playback.lastControllerId = senderId;
      stateChanged = true;
    } else if (msg.action === 'setQueue') {
      this.queue = {
        tracks: Array.isArray(msg.queue) ? msg.queue : [],
        currentIndex: typeof msg.currentIndex === 'number' ? msg.currentIndex : 0,
      };
      queueChanged = true;
    }

    if (stateChanged) {
      this.seq++;
      const frame = { type: 'state', seq: this.seq, playback: { ...this.playback } };
      if (!isSenderHost) this.client.handleFrame(frame);
      this.broadcastRoomFrame(frame);
    }
    if (queueChanged) {
      this.seq++;
      const frame = { type: 'queue', seq: this.seq, queue: { ...this.queue } };
      if (!isSenderHost) this.client.handleFrame(frame);
      this.broadcastRoomFrame(frame);
    }
  }

  private async initiateWebRtcToGuest(guestId: string): Promise<void> {
    if (typeof RTCPeerConnection === 'undefined') return;
    this.cleanupPeer(guestId);

    try {
      const pc = new RTCPeerConnection(STUN_ICE_SERVERS);
      this.peers.set(guestId, pc);
      const dc = pc.createDataChannel('waveform-party', { ordered: true });
      this.wireDataChannel(guestId, dc);

      // 5s P2P ICE fallback guard: close P2P attempt cleanly and stay on MQTT topic relay
      const fallbackTimer = setTimeout(() => {
        this.iceFallbackTimers.delete(guestId);
        if (dc.readyState !== 'open') {
          this.cleanupPeer(guestId);
        }
      }, 5000);
      this.iceFallbackTimers.set(guestId, fallbackTimer);

      pc.onicecandidate = (e) => {
        if (e.candidate && !this.disposed) {
          this.mqtt.publish(`${this.topicPrefix}/rtc/${guestId}`, {
            type: 'rtc_ice',
            fromId: this.memberId,
            candidate: e.candidate,
          });
        }
      };

      const offer = await pc.createOffer();
      if (this.disposed) {
        this.cleanupPeer(guestId);
        return;
      }
      await pc.setLocalDescription(offer);
      if (this.disposed) {
        this.cleanupPeer(guestId);
        return;
      }
      this.mqtt.publish(`${this.topicPrefix}/rtc/${guestId}`, {
        type: 'rtc_offer',
        fromId: this.memberId,
        sdp: pc.localDescription,
      });
    } catch {
      this.cleanupPeer(guestId);
    }
  }

  private async handleRtcSignal(msg: any): Promise<void> {
    if (this.disposed || typeof RTCPeerConnection === 'undefined' || !msg.fromId) return;
    const peerId = String(msg.fromId);

    try {
      if (msg.type === 'rtc_offer' && !this.isHost) {
        this.cleanupPeer(peerId);
        const pc = new RTCPeerConnection(STUN_ICE_SERVERS);
        this.peers.set(peerId, pc);

        const fallbackTimer = setTimeout(() => {
          this.iceFallbackTimers.delete(peerId);
          const ch = this.channels.get(peerId);
          if (!ch || ch.readyState !== 'open') {
            this.cleanupPeer(peerId);
          }
        }, 5000);
        this.iceFallbackTimers.set(peerId, fallbackTimer);

        pc.ondatachannel = (evt) => {
          this.wireDataChannel(peerId, evt.channel);
        };
        pc.onicecandidate = (e) => {
          if (e.candidate && !this.disposed) {
            this.mqtt.publish(`${this.topicPrefix}/rtc/${peerId}`, {
              type: 'rtc_ice',
              fromId: this.memberId,
              candidate: e.candidate,
            });
          }
        };

        await pc.setRemoteDescription(msg.sdp);
        if (this.disposed) {
          this.cleanupPeer(peerId);
          return;
        }
        const answer = await pc.createAnswer();
        if (this.disposed) {
          this.cleanupPeer(peerId);
          return;
        }
        await pc.setLocalDescription(answer);
        if (this.disposed) {
          this.cleanupPeer(peerId);
          return;
        }
        this.mqtt.publish(`${this.topicPrefix}/rtc/${peerId}`, {
          type: 'rtc_answer',
          fromId: this.memberId,
          sdp: pc.localDescription,
        });
      } else if (msg.type === 'rtc_answer' && this.isHost) {
        const pc = this.peers.get(peerId);
        if (pc) {
          await pc.setRemoteDescription(msg.sdp);
          if (this.disposed) {
            this.cleanupPeer(peerId);
            return;
          }
        }
      } else if (msg.type === 'rtc_ice' && msg.candidate) {
        const pc = this.peers.get(peerId);
        if (pc) {
          await pc.addIceCandidate(msg.candidate);
          if (this.disposed) {
            this.cleanupPeer(peerId);
            return;
          }
        }
      }
    } catch {
      // Fallback safely to MQTT topic relay
      this.cleanupPeer(peerId);
    }
  }

  private wireDataChannel(peerId: string, dc: RTCDataChannel): void {
    this.channels.set(peerId, dc);
    dc.onopen = () => {
      const t = this.iceFallbackTimers.get(peerId);
      if (t) {
        clearTimeout(t);
        this.iceFallbackTimers.delete(peerId);
      }
      usePartyStore.setState({ p2pActive: true });
    };
    dc.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(String(evt.data));
        if (this.isHost) {
          this.handleHostControlTopic(parsed);
        } else {
          this.client.handleFrame(parsed);
        }
      } catch {
        // Ignore malformed P2P frame
      }
    };
    dc.onclose = () => {
      this.channels.delete(peerId);
      const anyOpen = Array.from(this.channels.values()).some((c) => c.readyState === 'open');
      usePartyStore.setState({ p2pActive: anyOpen });
    };
  }

  private cleanupPeer(peerId: string): void {
    const t = this.iceFallbackTimers.get(peerId);
    if (t) {
      clearTimeout(t);
      this.iceFallbackTimers.delete(peerId);
    }
    const dc = this.channels.get(peerId);
    if (dc) {
      try {
        dc.close();
      } catch {}
      this.channels.delete(peerId);
    }
    const pc = this.peers.get(peerId);
    if (pc) {
      try {
        pc.close();
      } catch {}
      this.peers.delete(peerId);
    }
    const anyOpen = Array.from(this.channels.values()).some((c) => c.readyState === 'open');
    usePartyStore.setState({ p2pActive: anyOpen });
  }

  private buildSnapshot(): PartySnapshot {
    const membersList = Array.from(this.members.values());
    return {
      partyCode: this.partyCode,
      roomId: this.partyCode,
      partyName: `WaveForm Internet Party (${this.partyCode})`,
      hostId: this.isHost ? this.memberId : '',
      controlMode: this.controlMode,
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
}

async function attachPlayerStoreSync(client: PartySyncClient): Promise<void> {
  detachPlayerStoreSync();
  try {
    const { usePlayerStore } = await import('../state/playerStore');
    const initialState = usePlayerStore.getState();
    lastPublishedTrackId = initialState.currentTrack?.videoId || null;
    lastPublishedPlayState = initialState.playbackState;

    playerStoreUnsub = usePlayerStore.subscribe((state, prevState) => {
      if (remoteApplyDepth > 0) return;
      const party = usePartyStore.getState();
      if (party.status !== 'connected' && party.status !== 'syncing') return;
      if (party.controlMode === 'host-only' && !party.isHost) return;

      const trackId = state.currentTrack?.videoId || null;
      const prevTrackId = prevState?.currentTrack?.videoId || null;
      if (trackId && trackId !== prevTrackId && trackId !== lastPublishedTrackId) {
        lastPublishedTrackId = trackId;
        const pt = songToPartyTrack(state.currentTrack);
        if (pt) {
          client.publishSetTrack(pt, state.positionMs || 0, state.playbackState === 'PLAYING');
          return;
        }
      }

      if (state.playbackState !== lastPublishedPlayState) {
        lastPublishedPlayState = state.playbackState;
        if (state.playbackState === 'PLAYING') {
          client.publishPlay(state.positionMs || 0);
        } else if (state.playbackState === 'PAUSED') {
          client.publishPause(state.positionMs || 0);
        }
      }
    });

    driftCheckTimer = setInterval(() => {
      const party = usePartyStore.getState();
      if (party.status !== 'connected' || !party.playback || party.isHost) return;
      const pState = usePlayerStore.getState();
      if (pState.playbackState !== 'PLAYING' && party.syncZone !== 'pause_wait') return;
      const enginePos = pState.audioEngine?.getCurrentPositionMs?.() ?? pState.positionMs;
      client.checkDrift(enginePos, party.playback);
    }, 1000);
  } catch {
    // Non-browser test environments without playerStore
  }
}

function detachPlayerStoreSync(): void {
  if (playerStoreUnsub) {
    playerStoreUnsub();
    playerStoreUnsub = null;
  }
  if (driftCheckTimer) {
    clearInterval(driftCheckTimer);
    driftCheckTimer = null;
  }
  lastPublishedTrackId = null;
  lastPublishedPlayState = null;
  void import('../state/playerStore')
    .then(({ usePlayerStore }) => {
      usePlayerStore.getState().setPlaybackRate(1.0);
    })
    .catch(() => {});
}

function createClientWithStoreBindings(): PartySyncClient {
  const client = new PartySyncClient();
  client.setCallbacks({
    onSyncTelemetry: (telemetry) => {
      usePartyStore.setState({
        rttMs: telemetry.rttMs,
        driftMs: telemetry.driftMs,
        syncZone: telemetry.syncZone,
        syncPlaybackRate: telemetry.playbackRate,
        clockOffsetMs: telemetry.clockOffsetMs,
        isClockSynced: telemetry.isClockSynced,
      });
    },
    onPlaybackRateRequested: async (rate) => {
      try {
        const { usePlayerStore } = await import('../state/playerStore');
        usePlayerStore.getState().setPlaybackRate(rate);
      } catch {
        // Ignore in headless tests
      }
    },
    onPauseWaitChanged: async (waiting) => {
      let applied = false;
      try {
        const { usePlayerStore } = await import('../state/playerStore');
        const pState = usePlayerStore.getState();
        remoteApplyDepth++;
        applied = true;
        if (waiting && pState.playbackState === 'PLAYING') {
          lastPublishedPlayState = 'PAUSED';
          pState.pause();
        } else if (!waiting && usePartyStore.getState().playback?.isPlaying && pState.playbackState !== 'PLAYING') {
          lastPublishedPlayState = 'PLAYING';
          pState.play();
        }
      } catch {
        // Ignore in headless tests
      } finally {
        if (applied) {
          remoteApplyDepth = Math.max(0, remoteApplyDepth - 1);
        }
      }
    },
    onStatusChange: (status) => {
      usePartyStore.setState({
        status,
        clockOffsetMs: client.getClockOffsetMs(),
        isClockSynced: client.getIsClockSynced(),
      });
    },
    onSnapshotUpdate: (snapshot) => {
      const members = snapshot.members || snapshot.participants || [];
      usePartyStore.setState({
        partyCode: snapshot.partyCode || usePartyStore.getState().partyCode,
        participants: members,
        playback: snapshot.playback || usePartyStore.getState().playback,
        currentTrack: snapshot.playback?.currentTrack || snapshot.currentTrack || null,
        queue: snapshot.queue || usePartyStore.getState().queue,
        controlMode: snapshot.controlMode || usePartyStore.getState().controlMode,
        memberId: client.getMemberId() || usePartyStore.getState().memberId,
        clockOffsetMs: client.getClockOffsetMs(),
        isClockSynced: client.getIsClockSynced(),
      });
    },
    onMembersUpdate: (members) => {
      usePartyStore.setState({
        participants: members,
        clockOffsetMs: client.getClockOffsetMs(),
        isClockSynced: client.getIsClockSynced(),
      });
    },
    onQueueUpdate: (queue) => {
      usePartyStore.setState({ queue });
    },
    onControlModeChange: (controlMode) => {
      usePartyStore.setState({ controlMode });
    },
    onChat: (message) => {
      usePartyStore.setState((s) => ({
        chatMessages: [...s.chatMessages.slice(-149), message],
      }));
    },
    onReaction: (reaction) => {
      usePartyStore.setState((s) => ({
        reactions: [...s.reactions.slice(-23), reaction],
      }));
      setTimeout(() => {
        usePartyStore.setState((s) => ({
          reactions: s.reactions.filter((r) => r.id !== reaction.id),
        }));
      }, 4000);
    },
    onTrackChange: async (track, positionMs) => {
      usePartyStore.setState((s) => ({
        currentTrack: track,
        playback: s.playback
          ? { ...s.playback, currentTrack: track, positionMs }
          : {
              isPlaying: true,
              positionMs,
              anchorMs: Date.now(),
              speed: 1.0,
              currentTrack: track,
            },
      }));

      let applied = false;
      try {
        const { usePlayerStore } = await import('../state/playerStore');
        const pState = usePlayerStore.getState();
        if (pState.currentTrack?.videoId === track.videoId) return;
        remoteApplyDepth++;
        applied = true;
        lastPublishedTrackId = track.videoId;
        await pState.loadTrack(
          {
            videoId: track.videoId,
            title: track.title,
            artist: track.artist,
            albumName: track.album,
            thumbnailUrl: track.artworkUrl,
            durationSec:
              track.durationSec || (track.durationMs ? Math.round(track.durationMs / 1000) : undefined),
            totalPlayTimeMs: track.durationMs || 0,
            liked: false,
            playCount: 1,
            artistIds: [],
            artists: [],
            isExplicit: false,
          },
          'active',
          true
        );
        if (positionMs > 0) {
          pState.seek(positionMs);
        }
      } catch {
        // Ignore in headless tests
      } finally {
        if (applied) {
          remoteApplyDepth = Math.max(0, remoteApplyDepth - 1);
        }
      }
    },
    onPlayStateChange: async (isPlaying) => {
      usePartyStore.setState((s) => ({
        playback: s.playback ? { ...s.playback, isPlaying } : null,
        clockOffsetMs: client.getClockOffsetMs(),
        isClockSynced: client.getIsClockSynced(),
      }));
      let applied = false;
      try {
        const { usePlayerStore } = await import('../state/playerStore');
        const pState = usePlayerStore.getState();
        remoteApplyDepth++;
        applied = true;
        lastPublishedPlayState = isPlaying ? 'PLAYING' : 'PAUSED';
        if (isPlaying && pState.playbackState !== 'PLAYING') {
          pState.play();
        } else if (!isPlaying && pState.playbackState === 'PLAYING') {
          pState.pause();
        }
      } catch {
        // Ignore
      } finally {
        if (applied) {
          remoteApplyDepth = Math.max(0, remoteApplyDepth - 1);
        }
      }
    },
    onSeek: async (targetMs) => {
      usePartyStore.setState((s) => ({
        playback: s.playback ? { ...s.playback, positionMs: targetMs, anchorMs: Date.now() } : null,
        clockOffsetMs: client.getClockOffsetMs(),
        isClockSynced: client.getIsClockSynced(),
      }));
      let applied = false;
      try {
        const { usePlayerStore } = await import('../state/playerStore');
        remoteApplyDepth++;
        applied = true;
        usePlayerStore.getState().seek(targetMs);
      } catch {
        // Ignore
      } finally {
        if (applied) {
          remoteApplyDepth = Math.max(0, remoteApplyDepth - 1);
        }
      }
    },
  });
  return client;
}

export const usePartyStore = create<PartyStore>((set, get) => ({
  status: 'disconnected',
  partyCode: '',
  isHost: false,
  memberId: null,
  nickname: 'DesktopListener',
  transportMode: 'internet',
  relayUrl: 'wss://party.waveform.app/ws',
  lanUrl: null,
  lanIps: [],
  p2pActive: false,
  clockOffsetMs: 0,
  isClockSynced: false,
  rttMs: null,
  driftMs: 0,
  syncZone: 'locked',
  syncPlaybackRate: 1.0,
  controlMode: 'host-only',
  participants: [],
  currentTrack: null,
  playback: null,
  queue: { tracks: [], currentIndex: 0 },
  chatMessages: [],
  reactions: [],
  error: null,

  setTransportMode: (transportMode) => set({ transportMode, error: null }),
  setRelayUrl: (relayUrl) => set({ relayUrl, error: null }),
  setNickname: (nickname) => set({ nickname: nickname.trim().slice(0, 40) || 'DesktopListener' }),

  createRoom: async (options) => {
    await get().leaveRoom();

    const transportMode = options?.transportMode || get().transportMode;
    const nickname = (options?.nickname || get().nickname || 'Host').trim().slice(0, 40);
    const relayUrl = (options?.relayUrl || get().relayUrl || '').trim();
    const controlMode: PartyControlMode = options?.controlMode || get().controlMode || 'host-only';
    const partyCode = generatePartyCode();
    const memberId = makeSenderId();

    set({
      status: 'connecting',
      partyCode,
      isHost: true,
      memberId,
      nickname,
      transportMode,
      controlMode,
      error: null,
      chatMessages: [],
      reactions: [],
      participants: [],
      p2pActive: false,
    });

    const client = createClientWithStoreBindings();
    sharedSyncClient = client;

    let ok = false;

    if (transportMode === 'internet') {
      const coordinator = new InternetPartyCoordinator(
        client,
        partyCode,
        memberId,
        nickname,
        true,
        controlMode
      );
      sharedInternetCoordinator = coordinator;
      ok = await coordinator.start();
      if (!ok) {
        sharedInternetCoordinator = null;
        set({
          status: 'disconnected',
          partyCode: '',
          isHost: false,
          error: 'Could not reach public MQTT relay (check internet connection).',
        });
        return false;
      }
    } else if (transportMode === 'lan') {
      const api = getElectronApi();
      if (!api?.partyStartLanHost) {
        set({
          status: 'disconnected',
          partyCode: '',
          isHost: false,
          error: 'LAN host requires WaveForm Desktop (Electron).',
        });
        return false;
      }
      const lanInfo = await api.partyStartLanHost({
        partyCode,
        hostName: nickname,
        controlMode,
      });
      if (!lanInfo?.running || !lanInfo.localWsUrl) {
        set({
          status: 'disconnected',
          partyCode: '',
          isHost: false,
          error: 'Failed to start local LAN WebSocket server.',
        });
        return false;
      }
      set({
        lanUrl: lanInfo.wsUrl || lanInfo.localWsUrl,
        lanIps: Array.isArray(lanInfo.ips) ? lanInfo.ips : [],
      });
      ok = await client.connect(partyCode, lanInfo.hostToken || 'host', lanInfo.localWsUrl, {
        autoReconnect: true,
        memberName: nickname,
      });
      if (!ok) {
        client.disconnect();
        if (sharedSyncClient === client) sharedSyncClient = null;
        await api.partyStopLanHost?.();
        set({
          status: 'disconnected',
          partyCode: '',
          isHost: false,
          lanUrl: null,
          error: 'Failed to connect host client to local LAN server.',
        });
        return false;
      }
    } else {
      if (!relayUrl || !/^wss?:\/\//i.test(relayUrl)) {
        client.disconnect();
        if (sharedSyncClient === client) sharedSyncClient = null;
        set({
          status: 'disconnected',
          partyCode: '',
          isHost: false,
          error: 'Enter a valid ws:// or wss:// relay server URL.',
        });
        return false;
      }
      ok = await client.connect(partyCode, `host_${memberId}`, relayUrl, {
        autoReconnect: true,
        memberName: nickname,
      });
      if (!ok) {
        client.disconnect();
        if (sharedSyncClient === client) sharedSyncClient = null;
        set({
          status: 'disconnected',
          partyCode: '',
          isHost: false,
          error: `Could not connect to relay ${relayUrl}.`,
        });
        return false;
      }
    }

    set({ status: 'connected', error: null });
    await attachPlayerStoreSync(client);

    // Push currently playing track snapshot into the newly created room
    try {
      const { usePlayerStore } = await import('../state/playerStore');
      const pState = usePlayerStore.getState();
      const pt = songToPartyTrack(pState.currentTrack);
      if (pt) {
        client.publishSetTrack(pt, pState.positionMs || 0, pState.playbackState === 'PLAYING');
      }
    } catch {
      // Ignore if playerStore not active
    }

    return true;
  },

  joinRoom: async (codeOrUrl, options) => {
    const raw = (codeOrUrl || '').trim();
    if (!raw) {
      set({ error: 'Enter a 6-character room code or ws:// URL.' });
      return false;
    }

    await get().leaveRoom();

    const isWsUrl = /^wss?:\/\//i.test(raw);
    let partyCode = raw.toUpperCase();
    let targetWsUrl = (options?.relayUrl || get().relayUrl || '').trim();
    let transportMode: PartyTransportMode = options?.transportMode || get().transportMode;

    if (isWsUrl) {
      targetWsUrl = raw;
      const match = /\/ws\/parties\/([^/?#]+)/i.exec(raw);
      partyCode = (match?.[1] || 'LAN001').toUpperCase();
      transportMode = /^ws:\/\/(192\.168\.|10\.|172\.|127\.|localhost)/i.test(raw)
        ? 'lan'
        : 'relay';
    } else {
      if (!PartySyncClient.isValidPartyCode(partyCode)) {
        set({ error: 'Enter a valid 6-character room code (e.g. X7K9P2), WAVE-1234, or ws:// URL.' });
        return false;
      }
    }

    const nickname = (options?.nickname || get().nickname || 'Listener').trim().slice(0, 40);
    const memberId = makeSenderId();

    set({
      status: 'connecting',
      partyCode,
      isHost: false,
      memberId,
      nickname,
      transportMode,
      lanUrl: isWsUrl && transportMode === 'lan' ? raw : null,
      error: null,
      chatMessages: [],
      reactions: [],
      participants: [],
      p2pActive: false,
    });

    const client = createClientWithStoreBindings();
    sharedSyncClient = client;

    let ok = false;

    if (transportMode === 'internet' && !isWsUrl) {
      const coordinator = new InternetPartyCoordinator(
        client,
        partyCode,
        memberId,
        nickname,
        false,
        'host-only'
      );
      sharedInternetCoordinator = coordinator;
      ok = await coordinator.start();
      if (!ok) {
        sharedInternetCoordinator = null;
        set({
          status: 'disconnected',
          partyCode: '',
          error: `Could not join room ${partyCode} (host offline or unreachable).`,
        });
        return false;
      }
    } else {
      if (!targetWsUrl || !/^wss?:\/\//i.test(targetWsUrl)) {
        set({
          status: 'disconnected',
          partyCode: '',
          error: 'Enter a full ws://<ip>:<port>/ws/parties/<CODE> URL to join directly.',
        });
        return false;
      }
      ok = await client.connect(partyCode, `guest_${memberId}`, targetWsUrl, {
        autoReconnect: true,
        memberName: nickname,
      });
      if (!ok) {
        client.disconnect();
        if (sharedSyncClient === client) sharedSyncClient = null;
        set({
          status: 'disconnected',
          partyCode: '',
          error: `Connection failed to ${targetWsUrl}.`,
        });
        return false;
      }
    }

    set({ status: 'connected', error: null });
    await attachPlayerStoreSync(client);
    return true;
  },

  leaveRoom: async () => {
    detachPlayerStoreSync();
    if (sharedInternetCoordinator) {
      sharedInternetCoordinator.stop();
      sharedInternetCoordinator = null;
    }
    if (sharedSyncClient) {
      sharedSyncClient.disconnect();
      sharedSyncClient = null;
    }
    const api = getElectronApi();
    if (get().isHost && get().transportMode === 'lan' && api?.partyStopLanHost) {
      try {
        await api.partyStopLanHost();
      } catch {
        // Ignore
      }
    }
    set({
      status: 'disconnected',
      partyCode: '',
      isHost: false,
      memberId: null,
      lanUrl: null,
      lanIps: [],
      p2pActive: false,
      isClockSynced: false,
      clockOffsetMs: 0,
      rttMs: null,
      driftMs: 0,
      syncZone: 'locked',
      syncPlaybackRate: 1.0,
      participants: [],
      currentTrack: null,
      playback: null,
      queue: { tracks: [], currentIndex: 0 },
      chatMessages: [],
      reactions: [],
      error: null,
    });
  },

  sendChat: (text) => {
    sharedSyncClient?.publishChat(text, get().nickname);
  },

  sendReaction: (emoji) => {
    sharedSyncClient?.publishReaction(emoji, get().nickname);
  },

  setControlMode: (mode) => {
    if (!get().isHost) return;
    set({ controlMode: mode });
    sharedSyncClient?.publishControlMode(mode);
  },

  publishTrackSnapshot: (track, positionMs, isPlaying) => {
    sharedSyncClient?.publishSetTrack(track, positionMs, isPlaying);
  },

  publishPlay: (positionMs) => {
    sharedSyncClient?.publishPlay(positionMs);
  },

  publishPause: (positionMs) => {
    sharedSyncClient?.publishPause(positionMs);
  },

  publishSeek: (positionMs) => {
    sharedSyncClient?.publishSeek(positionMs);
  },
}));

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
