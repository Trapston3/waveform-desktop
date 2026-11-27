// src/ui/views/RadioPartyView.tsx
// Radio & Listen Together Party Hub (macOS Apple Music Desktop Experience with Liquid Glass):
// 1. Curated Apple Music Live Radio Stations with 1-click playback
// 2. Listen Together Party Sync Hub (usePartyStore singleton: Internet Room / Direct LAN / Custom Relay)

import React, { useState, useEffect, memo } from 'react';
import {
  Radio,
  Users,
  Wifi,
  WifiOff,
  Copy,
  Check,
  Sparkles,
  Globe,
  Laptop,
  Server,
  Send,
  Shield,
  Crown,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { usePartyStore } from '../../services/PartySyncClient';
import { MusicService } from '../../services/MusicService';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore } from '../../state/queueStore';
import { useSettingsStore } from '../../state/settingsStore';
import { PlayerPlayIcon } from '../common/WaveFormIcons';
import type { Song } from '../../models/Song';
import type { PartyConnectionStatus, PartyTransportMode } from '../../models/Party';

interface RadioStation {
  id: string;
  name: string;
  curator: string;
  tagline: string;
  gradient: string;
  coverUrl: string;
  searchQuery: string;
}

const CURATED_STATIONS: RadioStation[] = [
  {
    id: 'station_1',
    name: 'Apple Music 1',
    curator: 'Apple Music Radio',
    tagline: 'The new music that matters, live 24/7 across the globe.',
    gradient: 'from-rose-600/40 via-red-900/30 to-black/60',
    coverUrl: 'https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg',
    searchQuery: 'Top hits 2026',
  },
  {
    id: 'station_2',
    name: 'Night Drive Electronic',
    curator: 'WaveForm Curated',
    tagline: 'Dark synthwave, analog arpeggios, and neon electro basslines.',
    gradient: 'from-purple-600/40 via-indigo-950/30 to-black/60',
    coverUrl: 'https://i.ytimg.com/vi/DCas2ZWGwl4/hqdefault.jpg',
    searchQuery: 'Synthwave electronic',
  },
  {
    id: 'station_3',
    name: 'Lo-Fi Chill & Study',
    curator: 'Ambient Lab',
    tagline: 'Dusty vinyl beats, jazzy chords, and peaceful binaural textures.',
    gradient: 'from-amber-600/40 via-emerald-950/30 to-black/60',
    coverUrl: 'https://i.ytimg.com/vi/MWdFrw53n6s/hqdefault.jpg',
    searchQuery: 'Lofi beats focus study',
  },
  {
    id: 'station_4',
    name: 'Deep Techno & Club',
    curator: 'Sub-Bass Collective',
    tagline: '128 BPM underground warehouse rhythms and hypnotic modular synth.',
    gradient: 'from-cyan-600/40 via-blue-950/30 to-black/60',
    coverUrl: 'https://i.ytimg.com/vi/dX3k_QDnzHE/hqdefault.jpg',
    searchQuery: 'Deep techno club mix',
  },
  {
    id: 'station_5',
    name: 'Acoustic & Indie Sunset',
    curator: 'Apple Music Folk',
    tagline: 'Warm acoustic guitars, intimate songwriting, and golden hour vibes.',
    gradient: 'from-orange-600/40 via-amber-950/30 to-black/60',
    coverUrl: 'https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg',
    searchQuery: 'Acoustic indie mellow',
  },
];

const REACTION_EMOJIS = ['❤️', '🔥', '🎵', '✨', '🙌', '🤯'];

const TRANSPORT_OPTIONS: Array<{
  id: PartyTransportMode;
  label: string;
  desc: string;
  icon: React.FC<{ size?: number; className?: string }>;
}> = [
  { id: 'internet', label: 'Internet Room', desc: 'Zero-config global P2P + relay', icon: Globe },
  { id: 'lan', label: 'Direct LAN', desc: 'Local Wi-Fi WebSocket host', icon: Laptop },
  { id: 'relay', label: 'Custom Relay', desc: 'Your own ws:// server', icon: Server },
];

function getStatusBadge(status: PartyConnectionStatus): {
  label: string;
  classes: string;
  pulse: boolean;
} {
  switch (status) {
    case 'connected':
      return {
        label: 'Connected',
        classes: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
        pulse: false,
      };
    case 'syncing':
      return {
        label: 'Syncing',
        classes: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30',
        pulse: true,
      };
    case 'connecting':
      return {
        label: 'Connecting',
        classes: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
        pulse: true,
      };
    case 'reconnecting':
      return {
        label: 'Reconnecting',
        classes: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
        pulse: true,
      };
    default:
      return {
        label: 'Disconnected',
        classes: 'bg-white/10 text-[#8E8E93] border border-white/15',
        pulse: false,
      };
  }
}

export const RadioPartyView: React.FC = memo(() => {
  const status = usePartyStore((s) => s.status);
  const partyCode = usePartyStore((s) => s.partyCode);
  const isHost = usePartyStore((s) => s.isHost);
  const nickname = usePartyStore((s) => s.nickname);
  const transportMode = usePartyStore((s) => s.transportMode);
  const relayUrl = usePartyStore((s) => s.relayUrl);
  const lanUrl = usePartyStore((s) => s.lanUrl);
  const p2pActive = usePartyStore((s) => s.p2pActive);
  const isClockSynced = usePartyStore((s) => s.isClockSynced);
  const clockOffsetMs = usePartyStore((s) => s.clockOffsetMs);
  const rttMs = usePartyStore((s) => s.rttMs);
  const driftMs = usePartyStore((s) => s.driftMs);
  const syncZone = usePartyStore((s) => s.syncZone);
  const syncPlaybackRate = usePartyStore((s) => s.syncPlaybackRate);
  const controlMode = usePartyStore((s) => s.controlMode);
  const participants = usePartyStore((s) => s.participants);
  const currentTrack = usePartyStore((s) => s.currentTrack);
  const chatMessages = usePartyStore((s) => s.chatMessages);
  const reactions = usePartyStore((s) => s.reactions);
  const error = usePartyStore((s) => s.error);

  const setTransportMode = usePartyStore((s) => s.setTransportMode);
  const setRelayUrl = usePartyStore((s) => s.setRelayUrl);
  const setNickname = usePartyStore((s) => s.setNickname);
  const createRoom = usePartyStore((s) => s.createRoom);
  const joinRoom = usePartyStore((s) => s.joinRoom);
  const leaveRoom = usePartyStore((s) => s.leaveRoom);
  const sendChat = usePartyStore((s) => s.sendChat);
  const sendReaction = usePartyStore((s) => s.sendReaction);
  const setControlMode = usePartyStore((s) => s.setControlMode);

  const settingsNickname = useSettingsStore((s) => s.settings['listenTogether.nickname']);
  const settingsServerUrl = useSettingsStore((s) => s.settings['listenTogether.serverUrl']);

  const [joinInput, setJoinInput] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLan, setCopiedLan] = useState(false);

  const loadTrack = usePlayerStore((s) => s.loadTrack);
  const { setContextQueue } = useQueueStore();

  useEffect(() => {
    if (status === 'disconnected') {
      if (settingsNickname && nickname === 'DesktopListener') {
        setNickname(settingsNickname);
      }
      if (settingsServerUrl && relayUrl === 'wss://party.waveform.app/ws') {
        setRelayUrl(settingsServerUrl);
      }
    }
  }, [status, settingsNickname, settingsServerUrl, nickname, relayUrl, setNickname, setRelayUrl]);

  const isActiveRoom = status !== 'disconnected';
  const isBusy = status === 'connecting';
  const badge = getStatusBadge(status);

  const handleCreateRoom = async () => {
    await createRoom({ transportMode, nickname, relayUrl, controlMode });
  };

  const handleJoinRoom = async () => {
    if (!joinInput.trim()) return;
    await joinRoom(joinInput.trim(), { transportMode, nickname, relayUrl });
  };

  const handleCopyCode = () => {
    if (partyCode && typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(partyCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    }
  };

  const handleCopyLanUrl = () => {
    if (lanUrl && typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(lanUrl);
      setCopiedLan(true);
      setTimeout(() => setCopiedLan(false), 1800);
    }
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    sendChat(chatInput);
    setChatInput('');
  };

  const handlePlayStation = async (station: RadioStation) => {
    try {
      const musicService = new MusicService();
      const results = await musicService.search(station.searchQuery, 'songs');
      const songs: Song[] = results.items
        .filter((it: any) => !it.isAlbum && !it.isPlaylist && !it.isArtist && (it.videoId || it.id))
        .map((it: any) => ({
          ...it,
          videoId: it.videoId || it.id,
          artist: it.artist || it.subtitle || station.curator,
        }));

      if (songs.length > 0) {
        setContextQueue(songs, 0, {
          id: station.id,
          browseId: station.id,
          title: station.name,
          type: 'radio',
          currentIndex: 0,
        });
        loadTrack(songs[0], 'active', true);
      }
    } catch (err) {
      console.warn('[RadioPartyView] Failed to start radio station:', err);
    }
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-16 select-none animate-in fade-in duration-200">
      {/* 1. Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full liquid-glass-pill text-[11px] font-bold text-[#FA2D48] mb-2">
            <Radio size={12} />
            Live Broadcasts & Party Sync
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white">
            Radio & Listen Together
          </h1>
          <p className="text-xs text-[#A1A1A6] pt-1">
            24/7 global broadcast stations and real-time synchronized group listening across Internet, LAN, or custom relay.
          </p>
        </div>
      </div>

      {/* 2. Listen Together Party Room Control Capsule */}
      <section className="acrylic-tile relative overflow-hidden rounded-3xl p-6 md:p-8 space-y-6">
        {/* Floating Reactions Overlay */}
        {reactions.length > 0 && (
          <div className="pointer-events-none absolute right-6 top-6 flex gap-2 z-20">
            {reactions.slice(-6).map((rx) => (
              <div
                key={rx.id}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/60 border border-white/15 backdrop-blur-md text-xs animate-bounce shadow-lg"
              >
                <span>{rx.emoji}</span>
                <span className="text-[10px] text-white/80 font-medium">{rx.senderName}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <div className="space-y-3 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold ${badge.classes}`}>
                {status === 'reconnecting' ? (
                  <RefreshCw size={12} className="animate-spin" />
                ) : status === 'disconnected' ? (
                  <WifiOff size={12} />
                ) : (
                  <Wifi size={12} className={badge.pulse ? 'animate-pulse' : ''} />
                )}
                {badge.label}
              </span>

              {isActiveRoom && (
                <>
                  <span className="liquid-glass-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold text-white/90">
                    <Users size={12} className="text-[#FA2D48]" />
                    {Math.max(1, participants.length)} {participants.length === 1 ? 'Listener' : 'Listeners'}
                  </span>

                  <span className="liquid-glass-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold text-white/80">
                    {transportMode === 'internet'
                      ? p2pActive
                        ? 'Internet P2P'
                        : 'Internet Relay'
                      : transportMode === 'lan'
                      ? 'Direct LAN'
                      : 'Custom Relay'}
                  </span>

                  {isClockSynced && (
                    <>
                      <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-mono text-[#A1A1A6]">
                        NTP {clockOffsetMs >= 0 ? `+${clockOffsetMs}` : clockOffsetMs}ms
                        {typeof rttMs === 'number' ? ` · RTT ${rttMs}ms` : ''}
                      </span>
                      <span
                        data-testid="party-sync-telemetry"
                        className={`px-2.5 py-1 rounded-full border text-[10px] font-semibold ${
                          syncZone === 'locked'
                            ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                            : syncZone === 'rate_catchup'
                            ? 'bg-cyan-500/15 border-cyan-400/30 text-cyan-300'
                            : 'bg-amber-500/15 border-amber-400/30 text-amber-200'
                        }`}
                      >
                        {syncZone === 'locked'
                          ? `Synced · ±${Math.abs(Math.round(driftMs))}ms`
                          : syncZone === 'rate_catchup'
                          ? `Adjusting speed (${syncPlaybackRate.toFixed(2)}x)...`
                          : syncZone === 'pause_wait'
                          ? 'Syncing with host...'
                          : 'Buffering sync...'}
                      </span>
                    </>
                  )}
                </>
              )}
            </div>

            <h2 className="text-xl md:text-2xl font-black text-white">
              Listen Together Party
            </h2>
            <p className="text-xs text-[#A1A1A6] leading-relaxed">
              Host a zero-config Internet room (P2P DataChannel + relay fallback) or local LAN WebSocket room. Room stays active while browsing other tabs.
            </p>
          </div>

          {/* Room Actions */}
          <div className="flex flex-col items-stretch sm:items-end gap-3 z-10">
            {!isActiveRoom ? (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <button
                  onClick={handleCreateRoom}
                  disabled={isBusy}
                  className="spring-press flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-[#FA2D48] hover:bg-[#e0263f] disabled:opacity-50 text-white font-bold text-xs cursor-pointer shadow-lg shadow-[#FA2D48]/25 transition-all"
                >
                  <Sparkles size={14} />
                  <span>{isBusy ? 'Connecting...' : 'Create Room'}</span>
                </button>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Room code or ws:// URL..."
                    value={joinInput}
                    onChange={(e) => setJoinInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleJoinRoom();
                    }}
                    className="liquid-glass h-9 px-3.5 rounded-full text-xs text-white placeholder-[#8E8E93] outline-none w-52"
                  />
                  <button
                    onClick={handleJoinRoom}
                    disabled={isBusy}
                    className="spring-press flex items-center justify-center gap-1.5 px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 disabled:opacity-50 border border-white/15 text-white font-semibold text-xs cursor-pointer transition-all"
                  >
                    <span>Join</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/15">
                  <span className="text-[10px] uppercase tracking-wider text-[#A1A1A6]">Code</span>
                  <span className="text-xs font-mono font-bold text-white tracking-widest">
                    {partyCode}
                  </span>
                  <button
                    onClick={handleCopyCode}
                    title="Copy room code"
                    className="p-1 hover:text-[#FA2D48] text-[#A1A1A6] transition-colors cursor-pointer"
                  >
                    {copiedCode ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                </div>

                <button
                  onClick={() => void leaveRoom()}
                  className="spring-press px-4 py-2 rounded-full bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300 font-semibold text-xs cursor-pointer transition-all"
                >
                  Leave Room
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-200">
            <AlertCircle size={14} className="shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Transport Selector (when disconnected) */}
        {!isActiveRoom && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
            {TRANSPORT_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const selected = transportMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setTransportMode(opt.id)}
                  className={`flex items-center gap-3 p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                    selected
                      ? 'bg-[#FA2D48]/15 border-[#FA2D48]/50 text-white'
                      : 'bg-white/5 border-white/10 text-[#A1A1A6] hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <div className={`p-2 rounded-xl ${selected ? 'bg-[#FA2D48]/25 text-[#FA2D48]' : 'bg-white/10'}`}>
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate">{opt.label}</div>
                    <div className="text-[11px] opacity-75 truncate">{opt.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Relay URL Input (only when Custom Relay selected before joining) */}
        {!isActiveRoom && transportMode === 'relay' && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
            <span className="text-[11px] font-semibold text-[#A1A1A6] shrink-0">Relay Server URL:</span>
            <input
              type="text"
              value={relayUrl}
              onChange={(e) => setRelayUrl(e.target.value)}
              placeholder="wss://party.waveform.app/ws"
              className="liquid-glass h-9 px-3.5 rounded-xl text-xs text-white placeholder-[#8E8E93] outline-none flex-1 font-mono"
            />
          </div>
        )}

        {/* Active LAN Endpoint Banner */}
        {isActiveRoom && lanUrl && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-white/5 border border-white/10">
            <div className="flex items-center gap-2 min-w-0">
              <Laptop size={14} className="text-cyan-400 shrink-0" />
              <span className="text-[11px] font-semibold text-[#A1A1A6] shrink-0">LAN WebSocket URL:</span>
              <code className="text-xs font-mono text-cyan-300 truncate">{lanUrl}</code>
            </div>
            <button
              onClick={handleCopyLanUrl}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 hover:bg-white/15 text-[11px] font-semibold text-white cursor-pointer transition-colors"
            >
              {copiedLan ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              <span>{copiedLan ? 'Copied' : 'Copy ws://'}</span>
            </button>
          </div>
        )}

        {/* Active Room Controls, Participants, Chat & Reactions */}
        {isActiveRoom && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 pt-2 border-t border-white/10">
            {/* Left Column: Participants & Control Mode */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[#A1A1A6]">
                  Control Mode
                </span>
                {isHost ? (
                  <div className="inline-flex rounded-full bg-white/5 p-0.5 border border-white/10">
                    <button
                      type="button"
                      onClick={() => setControlMode('host-only')}
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-all cursor-pointer ${
                        controlMode === 'host-only'
                          ? 'bg-[#FA2D48] text-white'
                          : 'text-[#A1A1A6] hover:text-white'
                      }`}
                    >
                      Host Only
                    </button>
                    <button
                      type="button"
                      onClick={() => setControlMode('collaborative')}
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-all cursor-pointer ${
                        controlMode === 'collaborative'
                          ? 'bg-[#FA2D48] text-white'
                          : 'text-[#A1A1A6] hover:text-white'
                      }`}
                    >
                      Collaborative
                    </button>
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/10 text-[10px] font-bold text-white">
                    <Shield size={11} className="text-[#FA2D48]" />
                    {controlMode === 'host-only' ? 'Host Only' : 'Collaborative Queue'}
                  </span>
                )}
              </div>

              {/* Synced Now Playing */}
              {currentTrack && (
                <div className="p-3 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3">
                  {currentTrack.artworkUrl && (
                    <img
                      src={currentTrack.artworkUrl}
                      alt={currentTrack.title}
                      className="w-10 h-10 rounded-xl object-cover shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-[#FA2D48] font-bold">
                      Synced Track
                    </div>
                    <div className="text-xs font-bold text-white truncate">{currentTrack.title}</div>
                    <div className="text-[11px] text-[#A1A1A6] truncate">{currentTrack.artist}</div>
                  </div>
                </div>
              )}

              {/* Participants List */}
              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-[#A1A1A6]">
                  Participants ({participants.length})
                </div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {participants.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/5 border border-white/5 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                        <span className="font-semibold text-white truncate">{member.name}</span>
                      </div>
                      {member.isHost && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold shrink-0">
                          <Crown size={10} />
                          Host
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right 2 Columns: Live Chat & Emoji Reactions */}
            <div className="lg:col-span-2 flex flex-col justify-between rounded-2xl bg-black/30 border border-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[#A1A1A6]">
                  Room Chat & Reactions
                </span>
                <div className="flex items-center gap-1">
                  {REACTION_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => sendReaction(emoji)}
                      className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center text-sm transition-transform active:scale-125 cursor-pointer"
                      title={`React ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-44 overflow-y-auto space-y-2 pr-1">
                {chatMessages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-[#8E8E93]">
                    No messages yet — say hi or drop a reaction!
                  </div>
                ) : (
                  chatMessages.map((msg) => (
                    <div key={msg.id} className="text-xs leading-relaxed">
                      <span className="font-bold text-[#FA2D48] mr-1.5">{msg.senderName}:</span>
                      <span className="text-white/90 select-text">{msg.text}</span>
                    </div>
                  ))
                )}
              </div>

              <form onSubmit={handleSendChat} className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Send a message to the room..."
                  className="liquid-glass h-9 px-3.5 rounded-full text-xs text-white placeholder-[#8E8E93] outline-none flex-1"
                />
                <button
                  type="submit"
                  className="spring-press h-9 px-4 rounded-full bg-[#FA2D48] hover:bg-[#e0263f] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Send size={13} />
                  <span>Send</span>
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Ambient Glow */}
        <div
          style={{ background: isActiveRoom ? 'rgba(16, 185, 129, 0.15)' : 'rgba(250, 45, 72, 0.15)' }}
          className="absolute -right-16 -top-16 w-80 h-80 rounded-full blur-3xl pointer-events-none"
        />
      </section>

      {/* 3. Curated Apple Music Live Radio Stations */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio size={18} className="text-[#FA2D48]" />
            <h2 className="text-xl font-bold tracking-tight text-white">Apple Music Live Stations</h2>
          </div>
          <span className="text-xs text-[#8E8E93] font-medium">Broadcasts in High-Res AAC</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {CURATED_STATIONS.map((station) => (
            <div
              key={station.id}
              onClick={() => handlePlayStation(station)}
              className="acrylic-tile group relative p-5 rounded-3xl cursor-pointer overflow-hidden transition-all hover:border-white/20 flex flex-col justify-between h-56"
            >
              {/* Top Row: Station badge & live pill */}
              <div className="flex items-start justify-between">
                <span className="liquid-glass-pill-active inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-white">
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  Live Station
                </span>

                <div className="artwork-lockup relative w-16 h-16 rounded-2xl overflow-hidden bg-neutral-900 shadow-lg">
                  <img
                    src={station.coverUrl}
                    alt={station.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <div className="w-8 h-8 rounded-full bg-[#FA2D48] text-white flex items-center justify-center shadow-md">
                      <PlayerPlayIcon size={14} className="ml-0.5" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Station Info */}
              <div className="space-y-1 z-10">
                <div className="text-[11px] font-bold text-[#FA2D48] uppercase tracking-wider">
                  {station.curator}
                </div>
                <h3 className="text-lg font-black text-white group-hover:text-[#FA2D48] transition-colors truncate">
                  {station.name}
                </h3>
                <p className="text-xs text-[#A1A1A6] line-clamp-2 leading-relaxed">
                  {station.tagline}
                </p>
              </div>

              {/* Background Ambient Gradient */}
              <div className={`absolute inset-0 bg-gradient-to-br ${station.gradient} opacity-50 pointer-events-none group-hover:opacity-75 transition-opacity`} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
});

RadioPartyView.displayName = 'RadioPartyView';
