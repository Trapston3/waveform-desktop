// tests/fixtures/mockPlaylists.mjs
// Playlists, Library Collections, Queue Tiers & Listening History Models

import { mockSongs } from './mockSongs.mjs';

export const mockPlaylists = {
  customPlaylists: [
    {
      id: 'pl_favorites_01',
      title: 'Synthwave Driving',
      description: 'High octane retro synth tracks for night drives',
      thumbnailUrl: 'https://i.ytimg.com/vi/yt_track_001/hqdefault.jpg',
      isCustom: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-04-15T12:00:00Z',
      songIds: ['yt_track_001', 'local_flac_002', 'redline_track_01'],
      songCount: 3,
      totalDurationSec: 759,
    },
    {
      id: 'pl_ambient_02',
      title: 'Deep Focus & Ambient',
      description: 'Calm classical and ambient pieces',
      thumbnailUrl: 'https://i.ytimg.com/vi/download_005/hqdefault.jpg',
      isCustom: true,
      createdAt: '2026-02-10T10:00:00Z',
      updatedAt: '2026-03-20T14:30:00Z',
      songIds: ['download_005'],
      songCount: 1,
      totalDurationSec: 302,
    },
  ],

  queueTiers: {
    USER_QUEUE: [mockSongs.standardYouTube],
    CONTEXT: [mockSongs.localFlac, mockSongs.explicitHipHop],
    AUTOPLAY: [mockSongs.multiArtistCollaboration, mockSongs.stashedDownload],
  },

  monthlyListeningStats: {
    yearMonth: '2026-04',
    totalListeningTimeSec: 84600,
    totalPlaysCount: 312,
    uniqueTracksCount: 148,
    uniqueArtistsCount: 56,
    topTracks: [
      { videoId: 'yt_track_001', title: 'Neon Horizon', artist: 'Lazerhawk', playCount: 42, durationSec: 10710 },
      { videoId: 'local_flac_002', title: 'Midnight City', artist: 'M83', playCount: 28, durationSec: 6804 },
    ],
    topArtists: [
      { artistId: 'art_lazerhawk_01', artistName: 'Lazerhawk', playCount: 65, durationSec: 16575 },
      { artistId: 'local_art_m83', artistName: 'M83', playCount: 35, durationSec: 8505 },
    ],
    dailyPlays: {
      '2026-04-01': 12,
      '2026-04-02': 18,
      '2026-04-15': 25,
      '2026-04-30': 14,
    },
  },
};
