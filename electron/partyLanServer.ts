import http, { type IncomingMessage, type Server } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Duplex } from 'node:stream';
import os from 'node:os';

export type LanControlMode = 'host-only' | 'collaborative';

export interface LanPartyTrack {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  artworkUrl?: string;
  isrc?: string;
  requestedBy?: string;
}

export interface LanPartyMember {
  id: string;
  name: string;
  role: 'host' | 'guest';
  isReady: boolean;
  isHost: boolean;
  activeAt: string;
}

export interface LanPartyPlayback {
  isPlaying: boolean;
  positionMs: number;
  anchorMs: number;
  updatedAtMs: number;
  speed: number;
  currentTrack: LanPartyTrack | null;
  lastControllerId?: string;
}

export interface LanPartyQueue {
  tracks: LanPartyTrack[];
  currentIndex: number;
}

export interface LanHostOptions {
  partyCode?: string;
  port?: number;
  hostName?: string;
  controlMode?: LanControlMode;
}

export interface LanHostInfo {
  running: boolean;
  partyCode: string | null;
  port: number | null;
  ip: string | null;
  ips: string[];
  wsUrl: string | null;
  localWsUrl: string | null;
  hostToken: string | null;
  controlMode: LanControlMode;
  memberCount: number;
}

interface ConnectedClient {
  id: string;
  name: string;
  isHost: boolean;
  socket: Duplex;
  buffer: Buffer;
  fragmentOpcode: number | null;
  fragmentChunks: Buffer[];
  closed: boolean;
}

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME_BYTES = 2 * 1024 * 1024; // 2 MB cap per frame

export function discoverLanIpv4Addresses(): string[] {
  const nets = os.networkInterfaces();
  const candidates: Array<{ ip: string; score: number }> = [];

  for (const [ifaceName, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    const lowerName = ifaceName.toLowerCase();
    const virtualPenalty =
      lowerName.includes('virtual') ||
      lowerName.includes('vmware') ||
      lowerName.includes('vbox') ||
      lowerName.includes('hyper-v') ||
      lowerName.includes('vethernet') ||
      lowerName.includes('wsl') ||
      lowerName.includes('docker') ||
      lowerName.includes('loopback')
        ? -20
        : 0;

    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const ip = addr.address;
      if (ip.startsWith('169.254.')) continue; // Skip link-local APIPA
      let score = virtualPenalty;
      if (ip.startsWith('192.168.')) score += 100;
      else if (ip.startsWith('10.')) score += 80;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) score += 60;
      else score += 20;

      if (lowerName.includes('wi-fi') || lowerName.includes('wifi') || lowerName.includes('wlan')) {
        score += 10;
      } else if (lowerName.includes('ethernet') || lowerName.includes('eth')) {
        score += 15;
      }
      candidates.push({ ip, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return Array.from(new Set(candidates.map((c) => c.ip)));
}

export function encodeWebSocketFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  const firstByte = 0x80 | (opcode & 0x0f);

  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[0] = firstByte;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[0] = firstByte;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = firstByte;
    header[1] = 127;
    header.writeUInt32BE(Math.floor(len / 0x100000000), 2);
    header.writeUInt32BE(len >>> 0, 6);
  }

  return Buffer.concat([header, payload]);
}

function generateSixCharCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

export class PartyLanServer {
  private server: Server | null = null;
  private clients = new Map<string, ConnectedClient>();
  private partyCode: string | null = null;
  private hostId = 'lan_host';
  private hostToken: string | null = null;
  private port: number | null = null;
  private controlMode: LanControlMode = 'host-only';
  private seq = 0;

  private playback: LanPartyPlayback = {
    isPlaying: false,
    positionMs: 0,
    anchorMs: Date.now(),
    updatedAtMs: Date.now(),
    speed: 1.0,
    currentTrack: null,
  };

  private queue: LanPartyQueue = {
    tracks: [],
    currentIndex: 0,
  };

  public async start(options: LanHostOptions = {}): Promise<LanHostInfo> {
    await this.stop();

    const code = (options.partyCode || generateSixCharCode()).trim().toUpperCase();
    const requestedPort =
      typeof options.port === 'number' && options.port >= 0 && options.port <= 65535
        ? Math.floor(options.port)
        : 0;

    this.partyCode = code;
    this.hostId = `host_${randomUUID().slice(0, 8)}`;
    this.hostToken = randomBytes(16).toString('hex');
    this.controlMode = options.controlMode === 'collaborative' ? 'collaborative' : 'host-only';
    this.seq = 0;
    this.playback = {
      isPlaying: false,
      positionMs: 0,
      anchorMs: Date.now(),
      updatedAtMs: Date.now(),
      speed: 1.0,
      currentTrack: null,
    };
    this.queue = { tracks: [], currentIndex: 0 };

    const server = http.createServer((req, res) => {
      if (req.url?.startsWith('/health')) {
        const body = JSON.stringify({
          ok: true,
          partyCode: this.partyCode,
          port: this.port,
          members: this.clients.size,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
        return;
      }
      res.writeHead(426, { 'Content-Type': 'text/plain' });
      res.end('WaveForm LAN Party WebSocket Server');
    });

    server.on('upgrade', (req, socket, head) => {
      this.handleUpgrade(req, socket, head);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        server.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        const addr = server.address();
        this.port = addr && typeof addr === 'object' ? addr.port : requestedPort;
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(requestedPort, '0.0.0.0');
    });

    this.server = server;
    return this.getInfo();
  }

  public async stop(): Promise<void> {
    for (const client of this.clients.values()) {
      this.closeClient(client, 1001, 'Host closed room');
    }
    this.clients.clear();

    if (this.server) {
      const srv = this.server;
      this.server = null;
      await new Promise<void>((resolve) => {
        srv.close(() => resolve());
        setTimeout(resolve, 400).unref?.();
      });
    }

    this.partyCode = null;
    this.port = null;
    this.hostToken = null;
  }

  public getInfo(): LanHostInfo {
    const ips = discoverLanIpv4Addresses();
    const primaryIp = ips[0] || '127.0.0.1';
    const running = this.server !== null && this.port !== null && this.partyCode !== null;
    const pathSuffix = this.partyCode ? `/ws/parties/${this.partyCode}` : '';

    return {
      running,
      partyCode: this.partyCode,
      port: this.port,
      ip: running ? primaryIp : null,
      ips: running ? ips : [],
      wsUrl: running ? `ws://${primaryIp}:${this.port}${pathSuffix}` : null,
      localWsUrl: running ? `ws://127.0.0.1:${this.port}${pathSuffix}` : null,
      hostToken: running ? this.hostToken : null,
      controlMode: this.controlMode,
      memberCount: this.clients.size,
    };
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const upgradeHdr = String(req.headers['upgrade'] || '').toLowerCase();
    const wsKey = req.headers['sec-websocket-key'];
    if (upgradeHdr !== 'websocket' || typeof wsKey !== 'string' || !wsKey) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const pathMatch = /^\/ws\/parties\/([^/]+)$/i.exec(parsedUrl.pathname);
    const reqCode = (pathMatch?.[1] || parsedUrl.searchParams.get('code') || '').trim().toUpperCase();
    if (this.partyCode && reqCode && reqCode !== this.partyCode) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const acceptKey = createHash('sha1').update(`${wsKey}${WS_GUID}`).digest('base64');
    const rawProtocols = String(req.headers['sec-websocket-protocol'] || '');
    const requestedProtocols = rawProtocols
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const responseLines = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
    ];
    if (requestedProtocols.includes('waveform.v1')) {
      responseLines.push('Sec-WebSocket-Protocol: waveform.v1');
    }
    responseLines.push('\r\n');
    socket.write(responseLines.join('\r\n'));

    const tokenParam = parsedUrl.searchParams.get('token') || '';
    const isHost = Boolean(this.hostToken && tokenParam === this.hostToken);
    const memberId = isHost
      ? this.hostId
      : parsedUrl.searchParams.get('memberId') || `guest_${randomUUID().slice(0, 8)}`;
    const rawName = (parsedUrl.searchParams.get('name') || '').trim();
    const name =
      rawName.slice(0, 40) || (isHost ? 'Host' : `Listener ${this.clients.size + 1}`);

    const client: ConnectedClient = {
      id: memberId,
      name,
      isHost,
      socket,
      buffer: head && head.length > 0 ? Buffer.from(head) : Buffer.alloc(0),
      fragmentOpcode: null,
      fragmentChunks: [],
      closed: false,
    };

    // Replace stale socket if same memberId reconnects
    const existing = this.clients.get(memberId);
    if (existing) {
      this.closeClient(existing, 1000, 'Reconnected');
    }
    this.clients.set(memberId, client);

    socket.on('data', (chunk: Buffer) => {
      this.onSocketData(client, chunk);
    });
    socket.on('close', () => {
      this.removeClient(client);
    });
    socket.on('error', () => {
      this.removeClient(client);
    });

    this.sendJson(client, {
      type: 'welcome',
      you: {
        memberId: client.id,
        name: client.name,
        isHost: client.isHost,
      },
      party: this.buildSnapshot(),
      controlMode: this.controlMode,
      serverMs: Date.now(),
    });

    this.broadcastMembers();

    if (client.buffer.length > 0) {
      this.drainClientFrames(client);
    }
  }

  private removeClient(client: ConnectedClient): void {
    if (client.closed) return;
    client.closed = true;
    const current = this.clients.get(client.id);
    if (current === client) {
      this.clients.delete(client.id);
      this.broadcastMembers();
    }
  }

  private closeClient(client: ConnectedClient, code = 1000, reason = ''): void {
    if (client.closed) return;
    client.closed = true;
    this.clients.delete(client.id);
    try {
      const reasonBuf = Buffer.from(reason.slice(0, 120), 'utf8');
      const payload = Buffer.allocUnsafe(2 + reasonBuf.length);
      payload.writeUInt16BE(code, 0);
      reasonBuf.copy(payload, 2);
      client.socket.write(encodeWebSocketFrame(0x8, payload));
    } catch {
      // Ignore write error on closing socket
    }
    try {
      client.socket.end();
      client.socket.destroy();
    } catch {
      // Ignore socket close error
    }
  }

  private onSocketData(client: ConnectedClient, chunk: Buffer): void {
    if (client.closed) return;
    client.buffer =
      client.buffer.length === 0 ? chunk : Buffer.concat([client.buffer, chunk]);
    if (client.buffer.length > MAX_FRAME_BYTES * 2) {
      this.closeClient(client, 1009, 'Payload too large');
      return;
    }
    this.drainClientFrames(client);
  }

  private drainClientFrames(client: ConnectedClient): void {
    while (!client.closed && client.buffer.length >= 2) {
      const buf = client.buffer;
      const b0 = buf[0];
      const b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (buf.length < offset + 2) return;
        payloadLen = buf.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLen === 127) {
        if (buf.length < offset + 8) return;
        const hi = buf.readUInt32BE(offset);
        const lo = buf.readUInt32BE(offset + 4);
        payloadLen = hi * 0x100000000 + lo;
        offset += 8;
      }

      if (payloadLen > MAX_FRAME_BYTES || !Number.isFinite(payloadLen)) {
        this.closeClient(client, 1009, 'Frame exceeds limit');
        return;
      }

      const maskLen = masked ? 4 : 0;
      if (buf.length < offset + maskLen + payloadLen) return;

      let payload: Buffer;
      if (masked) {
        const maskKey = buf.subarray(offset, offset + 4);
        offset += 4;
        payload = Buffer.allocUnsafe(payloadLen);
        for (let i = 0; i < payloadLen; i++) {
          payload[i] = buf[offset + i] ^ maskKey[i & 3];
        }
      } else {
        payload = Buffer.from(buf.subarray(offset, offset + payloadLen));
      }

      client.buffer = buf.subarray(offset + payloadLen);

      if (opcode === 0x8) {
        this.closeClient(client, 1000, 'Client closed');
        return;
      }
      if (opcode === 0x9) {
        try {
          client.socket.write(encodeWebSocketFrame(0xa, payload));
        } catch {
          // Ignore pong write error
        }
        continue;
      }
      if (opcode === 0xa) {
        continue;
      }

      if (opcode === 0x1 || opcode === 0x2) {
        if (fin) {
          this.handleTextPayload(client, payload.toString('utf8'));
        } else {
          client.fragmentOpcode = opcode;
          client.fragmentChunks = [payload];
        }
      } else if (opcode === 0x0 && client.fragmentOpcode !== null) {
        client.fragmentChunks.push(payload);
        if (fin) {
          const full = Buffer.concat(client.fragmentChunks);
          client.fragmentOpcode = null;
          client.fragmentChunks = [];
          this.handleTextPayload(client, full.toString('utf8'));
        }
      }
    }
  }

  private handleTextPayload(client: ConnectedClient, rawText: string): void {
    let msg: any;
    try {
      msg = JSON.parse(rawText);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'ping': {
        this.sendJson(client, {
          type: 'pong',
          clientMs: typeof msg.clientMs === 'number' ? msg.clientMs : Date.now(),
          serverMs: Date.now(),
        });
        break;
      }

      case 'control': {
        this.handleControl(client, msg);
        break;
      }

      case 'chat': {
        const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 500) : '';
        if (!text) return;
        this.broadcastJson({
          type: 'chat',
          message: {
            id: typeof msg.id === 'string' ? msg.id : randomUUID(),
            senderId: client.id,
            senderName: client.name,
            text,
            timestampMs: Date.now(),
          },
        });
        break;
      }

      case 'reaction': {
        const emoji = typeof msg.emoji === 'string' ? msg.emoji.trim().slice(0, 16) : '';
        if (!emoji) return;
        this.broadcastJson({
          type: 'reaction',
          reaction: {
            id: typeof msg.id === 'string' ? msg.id : randomUUID(),
            senderId: client.id,
            senderName: client.name,
            emoji,
            timestampMs: Date.now(),
          },
        });
        break;
      }
    }
  }

  private handleControl(client: ConnectedClient, msg: any): void {
    const action = msg.action;

    if (action === 'setControlMode') {
      if (!client.isHost) return;
      this.controlMode = msg.controlMode === 'collaborative' ? 'collaborative' : 'host-only';
      this.broadcastJson({
        type: 'controlMode',
        controlMode: this.controlMode,
      });
      return;
    }

    if (this.controlMode === 'host-only' && !client.isHost) {
      this.sendJson(client, {
        type: 'error',
        code: 'HOST_ONLY',
        message: 'Room is in Host-Only control mode',
      });
      return;
    }

    const now = Date.now();
    let stateChanged = false;
    let queueChanged = false;

    if (action === 'play') {
      this.playback.isPlaying = true;
      if (typeof msg.positionMs === 'number' && Number.isFinite(msg.positionMs)) {
        this.playback.positionMs = Math.max(0, msg.positionMs);
      }
      this.playback.anchorMs = now;
      this.playback.updatedAtMs = now;
      this.playback.lastControllerId = client.id;
      stateChanged = true;
    } else if (action === 'pause') {
      this.playback.isPlaying = false;
      if (typeof msg.positionMs === 'number' && Number.isFinite(msg.positionMs)) {
        this.playback.positionMs = Math.max(0, msg.positionMs);
      }
      this.playback.anchorMs = now;
      this.playback.updatedAtMs = now;
      this.playback.lastControllerId = client.id;
      stateChanged = true;
    } else if (action === 'seek') {
      this.playback.positionMs = Math.max(0, Number(msg.positionMs) || 0);
      this.playback.anchorMs = now;
      this.playback.updatedAtMs = now;
      this.playback.lastControllerId = client.id;
      stateChanged = true;
    } else if (action === 'setTrack') {
      this.playback.currentTrack = msg.track || null;
      this.playback.positionMs = Math.max(0, Number(msg.positionMs) || 0);
      if (typeof msg.isPlaying === 'boolean') {
        this.playback.isPlaying = msg.isPlaying;
      }
      this.playback.anchorMs = now;
      this.playback.updatedAtMs = now;
      this.playback.lastControllerId = client.id;
      stateChanged = true;
    } else if (action === 'setQueue') {
      this.queue = {
        tracks: Array.isArray(msg.queue) ? msg.queue : [],
        currentIndex: typeof msg.currentIndex === 'number' ? msg.currentIndex : 0,
      };
      queueChanged = true;
    } else if (action === 'queueAdd' && msg.track) {
      this.queue = {
        ...this.queue,
        tracks: [...this.queue.tracks, msg.track],
      };
      queueChanged = true;
    } else if (
      action === 'queueMove' &&
      typeof msg.fromIndex === 'number' &&
      typeof msg.toIndex === 'number'
    ) {
      const nextTracks = [...this.queue.tracks];
      if (
        msg.fromIndex >= 0 &&
        msg.fromIndex < nextTracks.length &&
        msg.toIndex >= 0 &&
        msg.toIndex < nextTracks.length
      ) {
        const [moved] = nextTracks.splice(msg.fromIndex, 1);
        nextTracks.splice(msg.toIndex, 0, moved);
        this.queue = { ...this.queue, tracks: nextTracks };
        queueChanged = true;
      }
    }

    if (stateChanged) {
      this.seq++;
      this.broadcastJson({
        type: 'state',
        seq: this.seq,
        playback: { ...this.playback },
      });
    }
    if (queueChanged) {
      this.seq++;
      this.broadcastJson({
        type: 'queue',
        seq: this.seq,
        queue: { ...this.queue },
      });
    }
  }

  private buildMembersList(): LanPartyMember[] {
    const nowIso = new Date().toISOString();
    return Array.from(this.clients.values()).map((c) => ({
      id: c.id,
      name: c.name,
      role: c.isHost ? 'host' : 'guest',
      isReady: true,
      isHost: c.isHost,
      activeAt: nowIso,
    }));
  }

  private buildSnapshot(): Record<string, unknown> {
    const members = this.buildMembersList();
    return {
      partyCode: this.partyCode,
      roomId: this.partyCode,
      partyName: `WaveForm LAN Party (${this.partyCode})`,
      hostId: this.hostId,
      controlMode: this.controlMode,
      currentTrack: this.playback.currentTrack,
      positionMs: this.playback.positionMs,
      timestamp: Date.now(),
      isPlaying: this.playback.isPlaying,
      participants: members,
      members,
      playback: { ...this.playback },
      queue: { ...this.queue },
      revision: this.seq,
    };
  }

  private broadcastMembers(): void {
    this.broadcastJson({
      type: 'members',
      members: this.buildMembersList(),
    });
  }

  private sendJson(client: ConnectedClient, payload: unknown): void {
    if (client.closed) return;
    try {
      const frame = encodeWebSocketFrame(0x1, Buffer.from(JSON.stringify(payload), 'utf8'));
      client.socket.write(frame);
    } catch {
      this.removeClient(client);
    }
  }

  private broadcastJson(payload: unknown): void {
    const frame = encodeWebSocketFrame(0x1, Buffer.from(JSON.stringify(payload), 'utf8'));
    for (const client of this.clients.values()) {
      if (client.closed) continue;
      try {
        client.socket.write(frame);
      } catch {
        this.removeClient(client);
      }
    }
  }
}

const sharedLanServer = new PartyLanServer();

export function startPartyLanHost(options?: LanHostOptions): Promise<LanHostInfo> {
  return sharedLanServer.start(options);
}

export function stopPartyLanHost(): Promise<void> {
  return sharedLanServer.stop();
}

export function getPartyLanInfo(): LanHostInfo {
  return sharedLanServer.getInfo();
}
