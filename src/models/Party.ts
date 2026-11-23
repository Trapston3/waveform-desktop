// src/models/Party.ts
// Listen Together party models conforming to backend/ specifications

export type PartyControlMode = 'host-only' | 'collaborative';
export type PartyTransportMode = 'internet' | 'lan' | 'relay';
export type PartyConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'reconnecting';

export interface PartyTrack {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  durationSec?: number;
  artworkUrl?: string;
  isrc?: string;
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

export interface PartyChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestampMs: number;
  isSystem?: boolean;
}

export interface PartyReactionEvent {
  id: string;
  senderId: string;
  senderName: string;
  emoji: string;
  timestampMs: number;
}

export interface PartySnapshot {
  roomId?: string;                      // UI shorthand alias for partyCode
  partyCode: string;                    // 6-character room code
  partyName?: string;
  hostId: string;
  controlMode?: PartyControlMode;
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
  action:
    | 'play'
    | 'pause'
    | 'seek'
    | 'setTrack'
    | 'setQueue'
    | 'queueAdd'
    | 'queueMove'
    | 'setControlMode';
  positionMs?: number;
  isPlaying?: boolean;
  track?: PartyTrack;
  queue?: PartyTrack[];
  currentIndex?: number;
  fromIndex?: number;
  toIndex?: number;
  controlMode?: PartyControlMode;
}

export interface PartyWelcomeMessage {
  type: 'welcome';
  you: {
    memberId: string;
    name: string;
    isHost: boolean;
  };
  party: PartySnapshot;
  controlMode?: PartyControlMode;
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

export interface PartyChatMessageFrame {
  type: 'chat';
  message: PartyChatMessage;
}

export interface PartyReactionFrame {
  type: 'reaction';
  reaction: PartyReactionEvent;
}

export interface PartyControlModeFrame {
  type: 'controlMode';
  controlMode: PartyControlMode;
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
  | PartyChatMessageFrame
  | PartyReactionFrame
  | PartyControlModeFrame
  | PartyPongMessage;
