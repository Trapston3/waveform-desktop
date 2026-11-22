// src/models/Song.ts
// Dual-compatible Song domain entity conforming to PROJECT.md and mockSongs.mjs

export type PlaybackSourceType = 'YOUTUBE' | 'LOCAL' | 'DOWNLOAD' | 'STREAM' | 'STASHED';

export interface ArtistRef {
  id: string | null;
  name: string;
}

export interface Song {
  // Primary Identifiers
  id?: string;                        // UI shorthand alias for videoId
  videoId: string;                    // Canonical required identifier
  title: string;
  artist: string;                     // Primary display artist string
  artists: ArtistRef[];               // Structured list of contributing artists
  artistIds: string[];                // Array of artist IDs
  artistId?: string | null;           // Primary artist ID

  // Album & Collection
  album?: string;                     // UI shorthand alias for albumName
  albumName?: string | null;
  albumArtist?: string | null;        // Album artist for accurate compilation/album grouping
  albumId?: string | null;
  trackNumber?: number;               // Disc/album track number

  // Duration & Playback Metrics
  durationSec?: number;               // Duration in seconds
  durationText?: string | null;       // Display duration e.g. "4:15"
  totalPlayTimeMs: number;            // Cumulative listening time in milliseconds
  playCount: number;                  // Number of completed plays
  lastPlayedTimeMs?: number | null;   // Epoch timestamp of last playback
  lastModifiedMs?: number;            // Local file mtimeMs

  // Artwork & Visuals
  artworkUrl?: string;                // UI shorthand alias for thumbnailUrl
  thumbnailUrl?: string | null;
  artworkHash?: string | null;        // SHA-1 hash of embedded/folder artwork bytes

  // Audio Stream & Source Metadata
  source?: 'local' | 'online';        // Unified library provenance
  streamUrl?: string | null;          // Direct playback URI or file path
  bitrate?: number | string;          // Numeric kbps (e.g. 320) or string (e.g. "160kbps")
  codec?: string;                     // Audio codec e.g. FLAC, MP3, AAC, Opus
  bitDepth?: number;                  // Bits per sample e.g. 16, 24
  sampleRate?: number;                // Sample rate in Hz e.g. 44100, 96000
  isDolbyAtmos?: boolean;             // True only when active stream is Dolby Atmos
  audioQuality?: string;              // UI shorthand alias for sourceQuality
  sourceQuality?: string | null;      // e.g. "160kbps Opus", "24-bit / 96kHz FLAC"
  playbackSourceType?: PlaybackSourceType;
  playbackSessionId?: string | null;  // Active playback session UUID
  playlistBrowseId?: string | null;   // Origin playlist context ID
  hasOriginalAudio?: boolean;
  isLocal?: boolean;
  loudnessDb?: number;                // EBU R128 loudness offset in dB
  replayGainDb?: number;              // ReplayGain track gain offset in dB
  bpm?: number;

  // Ratings & Content Flags
  liked: boolean;
  isExplicit: boolean;
  explicit?: boolean;                 // UI shorthand alias for isExplicit
  year?: string | null;
  date?: string | null;               // ISO date e.g. "2021-04-23"

  // Lyrics
  lyrics?: string | null;             // Embedded LRC or synced lyric string
  lyricsId?: string | null;           // Remote lyrics provider ID

  // Extensible custom properties
  [key: string]: unknown;
}

/**
 * Validates that a song model strictly conforms to the WaveForm Song domain contract.
 * Strictly matches tests/fixtures/mockSongs.mjs validateSongContract.
 */
export function validateSongContract(song: unknown): { valid: boolean; error?: string } {
  if (!song || typeof song !== 'object') {
    return { valid: false, error: 'Song must be a non-null object' };
  }
  const s = song as Record<string, unknown>;
  const requiredStringFields = ['videoId', 'title', 'artist'];
  for (const field of requiredStringFields) {
    if (typeof s[field] !== 'string' || (s[field] as string).trim().length === 0) {
      return { valid: false, error: `Mandatory field '${field}' is missing or empty` };
    }
  }
  if (typeof s.liked !== 'boolean') {
    return { valid: false, error: "Field 'liked' must be boolean" };
  }
  if (typeof s.totalPlayTimeMs !== 'number' || (s.totalPlayTimeMs as number) < 0) {
    return { valid: false, error: "Field 'totalPlayTimeMs' must be a non-negative number" };
  }
  if (typeof s.playCount !== 'number' || (s.playCount as number) < 0) {
    return { valid: false, error: "Field 'playCount' must be a non-negative integer" };
  }
  if (!Array.isArray(s.artistIds) || !Array.isArray(s.artists)) {
    return { valid: false, error: "'artistIds' and 'artists' must be arrays" };
  }
  return { valid: true };
}

/**
 * Normalizes a partial or shorthand song object into a fully conforming Song entity.
 */
export function normalizeSong(raw: Partial<Song> & Record<string, unknown>): Song {
  const videoId = (raw.videoId as string) || (raw.id as string) || `track_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const title = (typeof raw.title === 'string' ? raw.title : 'Unknown Title').trim();
  const artist = (typeof raw.artist === 'string' ? raw.artist : 'Unknown Artist').trim();

  const artists: ArtistRef[] = Array.isArray(raw.artists) && raw.artists.length > 0
    ? (raw.artists as ArtistRef[])
    : [{ id: (raw.artistId as string) || null, name: artist }];

  const artistIds: string[] = Array.isArray(raw.artistIds) && raw.artistIds.length > 0
    ? (raw.artistIds as string[])
    : artists.map(a => a.id).filter((id): id is string => Boolean(id));

  const albumName = (raw.albumName as string | null | undefined) ?? (raw.album as string | null | undefined) ?? null;
  const album = (raw.album as string | undefined) ?? (albumName ?? undefined);

  let durationText = (raw.durationText as string | null | undefined) ?? null;
  if (!durationText && typeof raw.secondaryText === 'string') {
    const durMatch = raw.secondaryText.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
    if (durMatch) {
      durationText = durMatch[1];
    }
  }

  let durationSec = typeof raw.durationSec === 'number' && raw.durationSec > 0 ? raw.durationSec : undefined;
  if (durationSec === undefined && durationText) {
    const parts = durationText.trim().split(':').map((p) => parseInt(p, 10));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      durationSec = parts[0] * 60 + parts[1];
    } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      durationSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
  }

  if (!durationText && durationSec !== undefined) {
    const mins = Math.floor(durationSec / 60);
    const secs = Math.floor(durationSec % 60);
    durationText = `${mins}:${String(secs).padStart(2, '0')}`;
  } else if (durationSec === undefined && typeof raw.totalPlayTimeMs === 'number' && raw.totalPlayTimeMs > 0) {
    durationSec = Math.round(raw.totalPlayTimeMs / 1000);
  }

  const thumbnailUrl = (raw.thumbnailUrl as string | null | undefined) ?? (raw.artworkUrl as string | null | undefined) ?? null;
  const artworkUrl = (raw.artworkUrl as string | undefined) ?? (thumbnailUrl ?? undefined);

  const sourceQuality = (raw.sourceQuality as string | null | undefined) ??
    (raw.audioQuality as string | null | undefined) ??
    (typeof raw.bitrate === 'string' ? raw.bitrate : null);
  const audioQuality = (raw.audioQuality as string | undefined) ?? (sourceQuality ?? undefined);

  const isExplicit = Boolean(raw.isExplicit ?? raw.explicit);
  const explicit = isExplicit;

  const totalPlayTimeMs =
    typeof raw.totalPlayTimeMs === 'number' && raw.totalPlayTimeMs > 0
      ? raw.totalPlayTimeMs
      : durationSec !== undefined && durationSec > 0
      ? Math.round(durationSec * 1000)
      : 0;
  const playCount = typeof raw.playCount === 'number' && raw.playCount >= 0 ? raw.playCount : 0;

  const isLocal = Boolean(
    raw.isLocal || raw.source === 'local' || raw.playbackSourceType === 'LOCAL'
  );
  const source: 'local' | 'online' =
    raw.source === 'local' || raw.source === 'online'
      ? raw.source
      : isLocal
      ? 'local'
      : 'online';

  return {
    ...raw,
    id: videoId,
    videoId,
    title,
    artist,
    artists,
    artistIds,
    artistId: (raw.artistId as string | null | undefined) ?? (artists[0]?.id ?? null),
    albumName,
    album,
    albumArtist: (raw.albumArtist as string | null | undefined) ?? null,
    albumId: (raw.albumId as string | null | undefined) ?? null,
    trackNumber: typeof raw.trackNumber === 'number' && raw.trackNumber > 0 ? raw.trackNumber : undefined,
    durationSec,
    durationText,
    totalPlayTimeMs,
    playCount,
    lastPlayedTimeMs: (raw.lastPlayedTimeMs as number | null | undefined) ?? null,
    lastModifiedMs:
      typeof raw.lastModifiedMs === 'number'
        ? raw.lastModifiedMs
        : typeof raw.mtimeMs === 'number'
        ? raw.mtimeMs
        : undefined,
    artworkUrl,
    thumbnailUrl,
    artworkHash: (raw.artworkHash as string | null | undefined) ?? null,
    source,
    streamUrl: (raw.streamUrl as string | null | undefined) ?? null,
    bitrate: (raw.bitrate as number | string | undefined),
    codec: typeof raw.codec === 'string' ? raw.codec : undefined,
    bitDepth: typeof raw.bitDepth === 'number' ? raw.bitDepth : undefined,
    sampleRate: typeof raw.sampleRate === 'number' ? raw.sampleRate : undefined,
    isDolbyAtmos: typeof raw.isDolbyAtmos === 'boolean' ? raw.isDolbyAtmos : undefined,
    audioQuality,
    sourceQuality,
    playbackSourceType: (raw.playbackSourceType as PlaybackSourceType | undefined) ?? (isLocal ? 'LOCAL' : 'YOUTUBE'),
    playbackSessionId: (raw.playbackSessionId as string | null | undefined) ?? null,
    playlistBrowseId: (raw.playlistBrowseId as string | null | undefined) ?? null,
    hasOriginalAudio: raw.hasOriginalAudio !== undefined ? Boolean(raw.hasOriginalAudio) : true,
    isLocal,
    loudnessDb: typeof raw.loudnessDb === 'number' ? raw.loudnessDb : undefined,
    replayGainDb: typeof raw.replayGainDb === 'number' ? raw.replayGainDb : undefined,
    bpm: typeof raw.bpm === 'number' ? raw.bpm : undefined,
    liked: Boolean(raw.liked),
    isExplicit,
    explicit,
    year: (raw.year as string | null | undefined) ?? null,
    date: (raw.date as string | null | undefined) ?? null,
    lyrics: (raw.lyrics as string | null | undefined) ?? null,
    lyricsId: (raw.lyricsId as string | null | undefined) ?? null,
  };
}
