// src/models/Party.ts
// Listen Together party models conforming to backend/ specifications

export interface PartyTrack {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  artworkUrl?: string;
  requestedBy?: string;
}

export interface PartyMember {
  id: string;
  name: string;
  role: 'host' | 'guest' | string;
  avatarUrl?: string;
  isReady: boolean;
  isHost: boolean;
  activeAt?: string;
}

export interface PartyPlayback {
  isPlaying: boolean;
  positionMs: number;
  anchorMs?: number;
  updatedAtMs?: number;
  speed: number;
  currentTrack: PartyTrack | null;
  lastControllerId?: string;
}

export interface PartyQueue {
  tracks: PartyTrack[];
  currentIndex: number;
}

export interface PartySnapshot {
  roomId?: string;                      // UI shorthand alias for partyCode
  partyCode: string;                    // 6-character room code
  partyName?: string;
  hostId: string;
  currentTrack?: PartyTrack | null;     // Direct convenience accessor
  positionMs?: number;                  // Direct convenience accessor
  timestamp?: number;                   // Direct convenience accessor
  isPlaying?: boolean;
  participants?: PartyMember[];         // Convenience alias for members
  members: PartyMember[];
  playback: PartyPlayback;
  queue: PartyQueue;
  revision: number;                     // Monotonically increasing state version
}

export interface PartyControlMessage {
  type: 'control';
  action: 'play' | 'pause' | 'seek' | 'setTrack' | 'setQueue' | 'queueMove';
  positionMs?: number;
  track?: PartyTrack;
  queue?: PartyTrack[];
  fromIndex?: number;
  toIndex?: number;
}

export interface PartyWelcomeMessage {
  type: 'welcome';
  you: {
    memberId: string;
    name: string;
    isHost: boolean;
  };
  party: PartySnapshot;
  serverMs: number;
}

export interface PartyStateMessage {
  type: 'state';
  seq: number;
  playback: PartyPlayback;
}

export interface PartyQueueMessage {
  type: 'queue';
  seq: number;
  queue: PartyQueue;
}

export interface PartyMembersMessage {
  type: 'members';
  members: PartyMember[];
}

export interface PartyPingMessage {
  type: 'ping';
  clientMs: number;
}

export interface PartyPongMessage {
  type: 'pong';
  clientMs: number;
  serverMs: number;
}

export type PartyInboundFrame =
  | PartyWelcomeMessage
  | PartyStateMessage
  | PartyQueueMessage
  | PartyMembersMessage
  | PartyPongMessage;
