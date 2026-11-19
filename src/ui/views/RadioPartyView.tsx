// src/ui/views/RadioPartyView.tsx
// Radio & Listen Together Party Hub (macOS Apple Music Desktop Experience with Liquid Glass):
// 1. Curated Apple Music Live Radio Stations with 1-click playback
// 2. Listen Together Party Sync Hub (Feature 16 / PartySyncClient.ts) with drift calibration

import React, { useState, useEffect, memo } from 'react';
import {
  Radio,
  Users,
  Wifi,
  WifiOff,
  Copy,
  Check,
  Play,
  Sparkles,
  Music2,
  Volume2,
  Disc3,
  Layers,
} from 'lucide-react';
import { PartySyncClient } from '../../services/PartySyncClient';
import { MusicService } from '../../services/MusicService';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore } from '../../state/queueStore';
import { PlayerPlayIcon } from '../common/WaveFormIcons';
import type { Song } from '../../models/Song';

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

export const RadioPartyView: React.FC = memo(() => {
  // Party Room State
  const [partyCode, setPartyCode] = useState<string>('');
  const [inputCode, setInputCode] = useState<string>('');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isHost, setIsHost] = useState<boolean>(false);
  const [memberCount, setMemberCount] = useState<number>(1);
  const [copied, setCopied] = useState<boolean>(false);
  const [partyStatusText, setPartyStatusText] = useState<string>('Not connected');
  const [clientInstance, setClientInstance] = useState<PartySyncClient | null>(null);

  // Playback bindings (atomic selectors conforming to 0Hz invariant)
  const loadTrack = usePlayerStore((s) => s.loadTrack);
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.videoId);
  const { setContextQueue } = useQueueStore();

  useEffect(() => {
    const client = new PartySyncClient();
    setClientInstance(client);

    client.setCallbacks({
      onTrackChange: (track, positionMs) => {
        const mappedSong: Song = {
          videoId: track.videoId,
          title: track.title,
          artist: track.artist,
          thumbnailUrl: track.artworkUrl,
          totalPlayTimeMs: track.durationMs || 240000,
          liked: false,
          playCount: 1,
          artistIds: [],
          artists: [],
          isExplicit: false,
        };
        loadTrack(mappedSong, 'active', true);
      },
      onSnapshotUpdate: (snapshot) => {
        setMemberCount(snapshot.members?.length || snapshot.participants?.length || 1);
        setIsConnected(true);
      },
    });

    return () => {
      client.disconnect();
    };
  }, [loadTrack]);

  const handleCreateRoom = async () => {
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const code = `WAVE-${randomDigits}`;
    setPartyCode(code);
    setIsHost(true);
    setIsConnected(true);
    setMemberCount(1);
    setPartyStatusText(`Broadcasting as Host (${code})`);

    if (clientInstance) {
      await clientInstance.connect(code, 'host_token_demo');
    }
  };

  const handleJoinRoom = async () => {
    const cleanCode = inputCode.trim().toUpperCase();
    if (!PartySyncClient.isValidPartyCode(cleanCode)) {
      alert('Please enter a valid party code e.g. WAVE-1234 or 6-character code.');
      return;
    }
    setPartyCode(cleanCode);
    setIsHost(false);
    setIsConnected(true);
    setMemberCount(2);
    setPartyStatusText(`Connected to party room ${cleanCode}`);

    if (clientInstance) {
      await clientInstance.connect(cleanCode, 'listener_token_demo');
    }
  };

  const handleLeaveRoom = () => {
    if (clientInstance) {
      clientInstance.disconnect();
    }
    setIsConnected(false);
    setPartyCode('');
    setIsHost(false);
    setPartyStatusText('Disconnected');
  };

  const handleCopyCode = () => {
    if (partyCode && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(partyCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
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
            24/7 global broadcast stations and real-time synchronized group listening with friends.
          </p>
        </div>
      </div>

      {/* 2. Listen Together Party Room Control Capsule */}
      <section className="acrylic-tile relative overflow-hidden rounded-3xl p-6 md:p-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold ${
                isConnected ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-white/10 text-[#8E8E93] border border-white/15'
              }`}>
                {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
                {isConnected ? 'Party Room Active' : 'Offline'}
              </span>
              {isConnected && (
                <span className="liquid-glass-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold text-white/90">
                  <Users size={12} className="text-[#FA2D48]" />
                  {memberCount} {memberCount === 1 ? 'Listener' : 'Listeners'}
                </span>
              )}
            </div>

            <h2 className="text-xl md:text-2xl font-black text-white">
              Listen Together Party
            </h2>
            <p className="text-xs text-[#A1A1A6] leading-relaxed">
              Synchronize audio playback in real time with ±120ms clock alignment. All listeners share the same 68-bar seekbar playhead and queue.
            </p>
          </div>

          {/* Party Room Actions */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {!isConnected ? (
              <>
                <button
                  onClick={handleCreateRoom}
                  className="spring-press flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-[#FA2D48] hover:bg-[#e0263f] text-white font-bold text-xs cursor-pointer shadow-lg shadow-[#FA2D48]/25 transition-all"
                >
                  <Sparkles size={14} />
                  <span>Create Room</span>
                </button>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Enter code (WAVE-1234)..."
                    value={inputCode}
                    onChange={(e) => setInputCode(e.target.value)}
                    className="liquid-glass h-9 px-3.5 rounded-full text-xs text-white placeholder-[#8E8E93] outline-none w-44"
                  />
                  <button
                    onClick={handleJoinRoom}
                    className="spring-press flex items-center justify-center gap-1.5 px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-white font-semibold text-xs cursor-pointer transition-all"
                  >
                    <span>Join</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/15">
                  <span className="text-xs font-mono font-bold text-white tracking-widest">{partyCode}</span>
                  <button
                    onClick={handleCopyCode}
                    title="Copy party code"
                    className="p-1 hover:text-[#FA2D48] text-[#A1A1A6] transition-colors cursor-pointer"
                  >
                    {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                </div>

                <button
                  onClick={handleLeaveRoom}
                  className="spring-press px-4 py-2 rounded-full bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300 font-semibold text-xs cursor-pointer transition-all"
                >
                  Leave Room
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Ambient Glow */}
        <div
          style={{ background: isConnected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(250, 45, 72, 0.15)' }}
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
