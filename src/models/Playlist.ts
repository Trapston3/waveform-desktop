// src/models/Playlist.ts
// Playlist, Favorites, and Monthly Listening History models

import type { Song } from './Song';

export interface Playlist {
  id: string;
  title: string;
  description?: string;
  thumbnailUrl?: string | null;
  isCustom: boolean;
  createdAt: string;            // ISO 8601 string
  updatedAt: string;            // ISO 8601 string
  songIds: string[];            // Track IDs in playback order
  songCount: number;
  totalDurationSec: number;
}

export type Favorites = Song[];

export interface MonthlyTopTrack {
  videoId: string;
  title: string;
  artist: string;
  playCount: number;
  durationSec: number;
}

export interface MonthlyTopArtist {
  artistId?: string;
  artistName: string;
  playCount: number;
  durationSec: number;
}

export interface MonthlyHistory {
  yearMonth: string;                  // Format: "YYYY-MM" (e.g. "2026-04")
  totalListeningTimeSec: number;
  totalPlaysCount: number;
  uniqueTracksCount: number;
  uniqueArtistsCount: number;
  topTracks: MonthlyTopTrack[];
  topArtists: MonthlyTopArtist[];
  dailyPlays: Record<string, number>; // "YYYY-MM-DD" -> count
}

export interface ListeningHistoryEntry {
  videoId: string;
  title: string;
  artist: string;
  timestamp: number;                  // Date.now()
  durationSec: number;
}
