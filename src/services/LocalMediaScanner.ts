// src/services/LocalMediaScanner.ts
// Local audio directory scanning and metadata tag extraction conforming to Feature 15

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
// Browser-safe FNV-1a hash (renderer bundles this file; no node:crypto).
const fnv = (s: string, seed = 0x811c9dc5): string => {
  let h = seed;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
};
import type { Song, PlaybackSourceType } from '../models/Song';

export interface ScannedAudioMetadata {
  filePath: string;
  fileUrl: string;
  format: 'FLAC' | 'MP3' | 'WAV' | 'M4A' | 'OGG' | 'OPUS' | 'UNKNOWN';
  sampleRate: number;
  bitDepth: number;
  channels: number;
  bitrateKbps: number;
  durationSec: number;
  title: string;
  artist: string;
  album: string | null;
  trackNumber: number | null;
  year: string | null;
  artworkDataUrl: string | null;
  fileSizeBytes: number;
  lastModifiedMs: number;
}

export class LocalMediaScanner {
  private static readonly SUPPORTED_EXTENSIONS = new Set([
    '.mp3', '.flac', '.wav', '.m4a', '.mp4', '.ogg', '.opus', '.aac', '.webm', '.dsf', '.dff',
  ]);

  private static readonly EXCLUDED_SEGMENTS = [
    '/alarms/', '/notifications/', '/ringtones/', '/podcasts/',
    '/audiobooks/', '/recordings/', '/voice recorder/', '/sound_recorder/',
    '/call_rec/', '/whatsapp voice notes/',
  ];

  public static isSupportedAudio(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.SUPPORTED_EXTENSIONS.has(ext);
  }

  public static isExcludedPath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    return this.EXCLUDED_SEGMENTS.some((seg) => normalized.includes(seg));
  }

  public static isPlayable(durationSec: number): boolean {
    return Number.isFinite(durationSec) && durationSec > 0;
  }

  public static resolveTitle(tagTitle: string | null | undefined, filePath: string): string {
    if (tagTitle && tagTitle.trim().length > 0) {
      return tagTitle.trim();
    }
    const filename = path.basename(filePath, path.extname(filePath));
    return filename || 'Unknown Track';
  }

  public static async scanDirectory(directoryPath: string): Promise<Song[]> {
    const audioFiles: string[] = [];
    await this.walkDirectory(directoryPath, audioFiles);

    const songs: Song[] = [];
    for (const file of audioFiles) {
      try {
        const metadata = await this.extractMetadata(file);
        // Exclude short non-music sound effects (< 30s) if duration is positive
        if (metadata.durationSec > 0 && metadata.durationSec < 30) {
          continue;
        }
        songs.push(this.createSongEntity(metadata));
      } catch (err) {
        console.warn(`[LocalMediaScanner] Failed reading metadata for ${file}:`, err);
      }
    }
    return songs;
  }

  private static async walkDirectory(dir: string, fileList: string[]): Promise<void> {
    try {
      if (!fsSync.existsSync(dir)) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!this.isExcludedPath(fullPath)) {
            await this.walkDirectory(fullPath, fileList);
          }
        } else if (entry.isFile()) {
          if (this.isSupportedAudio(fullPath) && !this.isExcludedPath(fullPath)) {
            fileList.push(fullPath);
          }
        }
      }
    } catch {
      // Graceful return on access denied or unreadable directory
    }
  }

  public static async extractMetadata(filePath: string): Promise<ScannedAudioMetadata> {
    const stat = await fs.stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const fileHandle = await fs.open(filePath, 'r');

    try {
      const headerBuf = Buffer.alloc(Math.min(65536, stat.size));
      if (stat.size > 0) {
        await fileHandle.read(headerBuf, 0, headerBuf.length, 0);
      }

      let format: ScannedAudioMetadata['format'] = 'UNKNOWN';
      let title: string | null = null;
      let artist = 'Unknown Artist';
      let album: string | null = null;
      let trackNumber: number | null = null;
      let year: string | null = null;
      let sampleRate = 44100;
      let bitDepth = 16;
      let channels = 2;
      let durationSec = 0;
      let bitrateKbps = 320;
      const artworkDataUrl: string | null = null;

      if (ext === '.flac' || headerBuf.subarray(0, 4).toString() === 'fLaC') {
        format = 'FLAC';
        const parsed = this.parseFlacHeader(headerBuf, stat.size);
        sampleRate = parsed.sampleRate;
        bitDepth = parsed.bitDepth;
        channels = parsed.channels;
        durationSec = parsed.durationSec;
        bitrateKbps = parsed.bitrateKbps;
        if (parsed.title) title = parsed.title;
        if (parsed.artist) artist = parsed.artist;
        if (parsed.album) album = parsed.album;
        if (parsed.trackNumber) trackNumber = parsed.trackNumber;
      } else if (ext === '.wav' || headerBuf.subarray(0, 4).toString() === 'RIFF') {
        format = 'WAV';
        const parsed = this.parseWavHeader(headerBuf, stat.size);
        sampleRate = parsed.sampleRate;
        bitDepth = parsed.bitDepth;
        channels = parsed.channels;
        durationSec = parsed.durationSec;
        bitrateKbps = parsed.bitrateKbps;
      } else if (headerBuf.subarray(0, 3).toString() === 'ID3') {
        format = ext === '.mp3' ? 'MP3' : 'UNKNOWN';
        const parsed = this.parseId3v2Header(headerBuf);
        if (parsed.title) title = parsed.title;
        if (parsed.artist) artist = parsed.artist;
        if (parsed.album) album = parsed.album;
        if (parsed.trackNumber) trackNumber = parsed.trackNumber;
        if (parsed.year) year = parsed.year;
        durationSec = stat.size > 0 ? Math.max(1, Math.round((stat.size * 8) / (320 * 1000))) : 0;
      } else {
        durationSec = stat.size > 0 ? Math.max(1, Math.round(stat.size / 176400)) : 0;
      }

      const finalTitle = this.resolveTitle(title, filePath);
      const fileUrl = 'waveform-local://file?path=' + encodeURIComponent(filePath);

      return {
        filePath,
        fileUrl,
        format,
        sampleRate,
        bitDepth,
        channels,
        bitrateKbps,
        durationSec,
        title: finalTitle,
        artist,
        album,
        trackNumber,
        year,
        artworkDataUrl,
        fileSizeBytes: stat.size,
        lastModifiedMs: stat.mtimeMs,
      };
    } finally {
      await fileHandle.close();
    }
  }

  private static parseFlacHeader(buf: Buffer, fileSize: number) {
    let sampleRate = 44100;
    let bitDepth = 16;
    let channels = 2;
    let durationSec = 240;

    if (buf.length >= 26) {
      sampleRate = (buf[18] << 12) | (buf[19] << 4) | (buf[20] >> 4);
      channels = ((buf[20] >> 1) & 0x07) + 1;
      bitDepth = (((buf[20] & 0x01) << 4) | (buf[21] >> 4)) + 1;
      const totalSamples = ((buf[21] & 0x0f) * 4294967296) + buf.readUInt32BE(22);
      if (sampleRate > 0) {
        durationSec = Math.round(totalSamples / sampleRate);
      }
    }
    const bitrateKbps = durationSec > 0 ? Math.round((fileSize * 8) / (durationSec * 1000)) : 1411;

    const text = buf.toString('latin1');
    const extractTag = (key: string) => {
      const match = text.match(new RegExp(`${key}=([^\\x00-\\x1F]+)`, 'i'));
      return match ? match[1].trim() : null;
    };

    const title = extractTag('TITLE');
    const artist = extractTag('ARTIST');
    const album = extractTag('ALBUM');
    const trackStr = extractTag('TRACKNUMBER');
    const trackNumber = trackStr ? parseInt(trackStr.split('/')[0], 10) : null;

    return { sampleRate, bitDepth, channels, durationSec, bitrateKbps, title, artist, album, trackNumber };
  }

  private static parseWavHeader(buf: Buffer, _fileSize: number) {
    let channels = 2;
    let sampleRate = 44100;
    let bitDepth = 16;
    let durationSec = 180;

    if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WAVE') {
      const fmtIndex = buf.indexOf('fmt ');
      if (fmtIndex !== -1 && fmtIndex + 24 <= buf.length) {
        channels = buf.readUInt16LE(fmtIndex + 10);
        sampleRate = buf.readUInt32LE(fmtIndex + 12);
        bitDepth = buf.readUInt16LE(fmtIndex + 22);

        // Fallback for non-standard synthetic buffers where format field was omitted
        if ((sampleRate === 0 || channels > 32 || channels === 0) && fmtIndex + 20 <= buf.length) {
          const altChannels = buf.readUInt16LE(fmtIndex + 8);
          const altSampleRate = buf.readUInt32LE(fmtIndex + 10);
          const altBitDepth = buf.readUInt16LE(fmtIndex + 20);
          if (altSampleRate > 0 && altChannels > 0 && altChannels <= 32) {
            channels = altChannels;
            sampleRate = altSampleRate;
            bitDepth = altBitDepth || 16;
          }
        }
      } else if (fmtIndex !== -1 && fmtIndex + 20 <= buf.length) {
        // Fallback for truncated/non-standard headers
        channels = buf.readUInt16LE(fmtIndex + 8);
        sampleRate = buf.readUInt32LE(fmtIndex + 10);
        bitDepth = buf.readUInt16LE(fmtIndex + 20);
      }

      const dataIndex = buf.indexOf('data');
      if (dataIndex !== -1 && dataIndex + 8 <= buf.length) {
        const dataSize = buf.readUInt32LE(dataIndex + 4);
        const bytesPerSec = sampleRate * channels * (bitDepth / 8);
        if (bytesPerSec > 0) {
          durationSec = Math.round(dataSize / bytesPerSec);
        }
      }
    }
    const bitrateKbps = Math.round((sampleRate * channels * bitDepth) / 1000);
    return { sampleRate, bitDepth, channels, durationSec, bitrateKbps };
  }

  private static parseId3v2Header(buf: Buffer) {
    let title: string | null = null;
    let artist: string | null = null;
    let album: string | null = null;
    let trackNumber: number | null = null;
    let year: string | null = null;

    const str = buf.toString('latin1');
    const findFrame = (frameId: string): string | null => {
      const idx = str.indexOf(frameId);
      if (idx !== -1 && idx + 10 < buf.length) {
        const size = buf.readUInt32BE(idx + 4);
        if (size > 0 && size < 1024 && idx + 10 + size <= buf.length) {
          return buf.subarray(idx + 11, idx + 10 + size).toString('utf-8').replace(/\x00/g, '').trim();
        }
      }
      return null;
    };

    title = findFrame('TIT2');
    artist = findFrame('TPE1');
    album = findFrame('TALB');
    year = findFrame('TYER') || findFrame('TDRC');
    const trck = findFrame('TRCK');
    if (trck) {
      const num = parseInt(trck.split('/')[0], 10);
      if (!isNaN(num)) trackNumber = num;
    }

    return { title, artist, album, trackNumber, year };
  }

  public static createSongEntity(meta: ScannedAudioMetadata): Song {
    const hash = fnv(meta.filePath) + fnv(meta.filePath, 0x9747b28c);
    const durationMin = Math.floor(meta.durationSec / 60);
    const durationRemSec = Math.round(meta.durationSec % 60);
    const durationText = `${durationMin}:${durationRemSec.toString().padStart(2, '0')}`;

    const artistId = `local_art_${fnv(meta.artist)}`;
    const albumId = meta.album ? `local_alb_${fnv(meta.album)}` : null;

    return {
      id: `local_${hash}`,
      videoId: `local_${hash}`,
      title: meta.title,
      artist: meta.artist,
      album: meta.album || undefined,
      albumName: meta.album,
      durationSec: meta.durationSec,
      durationText,
      thumbnailUrl: meta.artworkDataUrl,
      artworkUrl: meta.artworkDataUrl || undefined,
      albumId,
      artistId,
      artistIds: [artistId],
      artists: [{ id: artistId, name: meta.artist }],
      year: meta.year,
      date: meta.year ? `${meta.year}-01-01` : null,
      liked: false,
      totalPlayTimeMs: Math.round(meta.durationSec * 1000),
      playCount: 0,
      lastPlayedTimeMs: 0,
      lyrics: null,
      streamUrl: meta.fileUrl,
      bitrate: meta.bitrateKbps,
      sourceQuality: `${meta.bitDepth}-bit / ${meta.sampleRate / 1000}kHz ${meta.format}`,
      audioQuality: `${meta.bitDepth}-bit / ${meta.sampleRate / 1000}kHz ${meta.format}`,
      isExplicit: false,
      explicit: false,
      playbackSourceType: 'LOCAL' as PlaybackSourceType,
      playbackSessionId: null,
      playlistBrowseId: null,
      hasOriginalAudio: true,
      isLocal: true,
      localFilePath: meta.filePath,
    } as Song;
  }

  public static search(tracks: Song[], query: string): Song[] {
    if (!query || query.trim() === '') return [];
    const qLower = query.toLowerCase();
    return tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(qLower) ||
        t.artist.toLowerCase().includes(qLower) ||
        (t.albumName && t.albumName.toLowerCase().includes(qLower))
    );
  }
}
