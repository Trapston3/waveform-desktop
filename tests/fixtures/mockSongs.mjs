// tests/fixtures/mockSongs.mjs
// Authoritative mock Song data models conforming to PROJECT.md & spec_miner_survey_3

export const mockSongs = {
  standardYouTube: {
    videoId: 'yt_track_001',
    title: 'Neon Horizon',
    artist: 'Lazerhawk',
    albumName: 'Redline',
    durationText: '4:15',
    thumbnailUrl: 'https://i.ytimg.com/vi/yt_track_001/maxresdefault.jpg',
    albumId: 'alb_redline_01',
    artistId: 'art_lazerhawk_01',
    artistIds: ['art_lazerhawk_01'],
    artists: [{ id: 'art_lazerhawk_01', name: 'Lazerhawk' }],
    year: '2010',
    date: '2010-01-15',
    liked: true,
    totalPlayTimeMs: 255000,
    playCount: 14,
    lastPlayedTimeMs: 1714500000000,
    lyrics: null,
    streamUrl: 'https://rr2---sn-4g5ednls.googlevideo.com/videoplayback?id=yt_track_001',
    sourceQuality: '160kbps Opus',
    isExplicit: false,
    playbackSourceType: 'YOUTUBE',
    playbackSessionId: 'sess_9921_a',
    playlistBrowseId: 'VLPL_synthwave_hits',
    hasOriginalAudio: true,
    isLocal: false,
  },

  localFlac: {
    videoId: 'local_flac_002',
    title: 'Midnight City (Lossless Master)',
    artist: 'M83',
    albumName: 'Hurry Up, We\'re Dreaming',
    durationText: '4:03',
    thumbnailUrl: 'file:///C:/Music/M83/Cover.jpg',
    albumId: 'local_alb_m83_01',
    artistId: 'local_art_m83',
    artistIds: ['local_art_m83'],
    artists: [{ id: 'local_art_m83', name: 'M83' }],
    year: '2011',
    date: '2011-10-18',
    liked: false,
    totalPlayTimeMs: 486000,
    playCount: 2,
    lastPlayedTimeMs: 1714505000000,
    lyrics: '[00:12.30]Waiting in a car\n[00:15.50]Waiting for a ride in the dark',
    streamUrl: 'file:///C:/Music/M83/01_Midnight_City.flac',
    sourceQuality: '24-bit / 96kHz FLAC',
    isExplicit: false,
    playbackSourceType: 'LOCAL',
    playbackSessionId: null,
    playlistBrowseId: null,
    hasOriginalAudio: true,
    isLocal: true,
  },

  explicitHipHop: {
    videoId: 'yt_explicit_003',
    title: 'HUMBLE.',
    artist: 'Kendrick Lamar',
    albumName: 'DAMN.',
    durationText: '2:57',
    thumbnailUrl: 'https://i.ytimg.com/vi/yt_explicit_003/hqdefault.jpg',
    albumId: 'alb_damn_01',
    artistId: 'art_kendrick_01',
    artistIds: ['art_kendrick_01'],
    artists: [{ id: 'art_kendrick_01', name: 'Kendrick Lamar' }],
    year: '2017',
    date: '2017-04-14',
    liked: true,
    totalPlayTimeMs: 177000,
    playCount: 42,
    lastPlayedTimeMs: 1714510000000,
    lyrics: '[00:00.00]Nobody pray for me\n[00:02.10]Even a day for me',
    streamUrl: 'https://rr1---sn-audio.googlevideo.com/videoplayback?id=yt_explicit_003',
    sourceQuality: '320kbps AAC (JioSaavn Fallback)',
    isExplicit: true,
    playbackSourceType: 'STREAM',
    playbackSessionId: 'sess_kendrick_42',
    playlistBrowseId: 'VLPL_rap_caviar',
    hasOriginalAudio: true,
    isLocal: false,
  },

  multiArtistCollaboration: {
    videoId: 'yt_collab_004',
    title: 'Save Your Tears (Remix)',
    artist: 'The Weeknd & Ariana Grande',
    albumName: 'After Hours (Deluxe)',
    durationText: '3:11',
    thumbnailUrl: 'https://i.ytimg.com/vi/yt_collab_004/hqdefault.jpg',
    albumId: 'alb_afterhours_deluxe',
    artistId: 'art_weeknd',
    artistIds: ['art_weeknd', 'art_ariana'],
    artists: [
      { id: 'art_weeknd', name: 'The Weeknd' },
      { id: 'art_ariana', name: 'Ariana Grande' },
    ],
    year: '2021',
    date: '2021-04-23',
    liked: true,
    totalPlayTimeMs: 191000,
    playCount: 8,
    lastPlayedTimeMs: 1714520000000,
    lyrics: null,
    streamUrl: 'https://rr3---sn-audio.googlevideo.com/videoplayback?id=yt_collab_004',
    sourceQuality: 'Dolby Atmos (E-AC-3)',
    isExplicit: false,
    playbackSourceType: 'YOUTUBE',
    playbackSessionId: 'sess_collab_1',
    playlistBrowseId: 'VLPL_pop_hits',
    hasOriginalAudio: false,
    isLocal: false,
  },

  stashedDownload: {
    videoId: 'download_005',
    title: 'Clair de Lune',
    artist: 'Claude Debussy',
    albumName: 'Suite bergamasque',
    durationText: '5:02',
    thumbnailUrl: 'file:///C:/Users/traps/AppData/Local/WaveForm/cache/debussy.jpg',
    albumId: 'alb_debussy_01',
    artistId: 'art_debussy',
    artistIds: ['art_debussy'],
    artists: [{ id: 'art_debussy', name: 'Claude Debussy' }],
    year: '1905',
    date: '1905-01-01',
    liked: false,
    totalPlayTimeMs: 302000,
    playCount: 5,
    lastPlayedTimeMs: 1714530000000,
    lyrics: null,
    streamUrl: 'file:///C:/Users/traps/AppData/Local/WaveForm/downloads/clair_de_lune.opus',
    sourceQuality: '160kbps Opus Offline Cached',
    isExplicit: false,
    playbackSourceType: 'DOWNLOAD',
    playbackSessionId: null,
    playlistBrowseId: null,
    hasOriginalAudio: true,
    isLocal: false,
  },
};

/**
 * Validates that a song model strictly conforms to the WaveForm Song domain interface contract.
 */
export function validateSongContract(song) {
  if (!song || typeof song !== 'object') {
    return { valid: false, error: 'Song must be a non-null object' };
  }
  const requiredStringFields = ['videoId', 'title', 'artist'];
  for (const field of requiredStringFields) {
    if (typeof song[field] !== 'string' || song[field].trim().length === 0) {
      return { valid: false, error: `Mandatory field '${field}' is missing or empty` };
    }
  }
  if (typeof song.liked !== 'boolean') {
    return { valid: false, error: "Field 'liked' must be boolean" };
  }
  if (typeof song.totalPlayTimeMs !== 'number' || song.totalPlayTimeMs < 0) {
    return { valid: false, error: "Field 'totalPlayTimeMs' must be a non-negative number" };
  }
  if (typeof song.playCount !== 'number' || song.playCount < 0) {
    return { valid: false, error: "Field 'playCount' must be a non-negative integer" };
  }
  if (!Array.isArray(song.artistIds) || !Array.isArray(song.artists)) {
    return { valid: false, error: "'artistIds' and 'artists' must be arrays" };
  }
  return { valid: true };
}
