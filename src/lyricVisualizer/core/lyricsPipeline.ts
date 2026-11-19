import { parseLrc } from './lrcParser';
import type { ILyricsProvider, LyricLine, Lyrics, LyricWord, TrackInfo } from './models';
import { synthesizeLyricsWords } from './wordSynthesizer';

export interface LyricsCacheAdapter {
  getCachedLyrics(songKey: string): Promise<Lyrics | null> | Lyrics | null;
  setCachedLyrics(songKey: string, lyrics: Lyrics): Promise<void> | void;
}

export function buildLyricsCacheKey(track: TrackInfo): string {
  if (track.id && track.id.trim().length > 0) {
    return track.id.trim();
  }
  const artist = (track.artist || 'unknown').trim().toLowerCase();
  const title = (track.title || 'unknown').trim().toLowerCase();
  const dur = Math.round(track.durationSeconds || 0);
  return `${artist}::${title}::${dur}`;
}

export class EmbeddedTrackLyricsProvider implements ILyricsProvider {
  readonly name = 'EmbeddedTrack';
  readonly supportedGranularity = 'Word' as const;

  async getLyricsAsync(track: TrackInfo, signal?: AbortSignal): Promise<Lyrics | null> {
    if (signal?.aborted) return null;

    if (track.parsedLyricsLines && track.parsedLyricsLines.length > 0) {
      let hasWordLevel = false;
      const lines: LyricLine[] = track.parsedLyricsLines.map((line) => {
        const startSeconds = Math.max(0, line.startTimeMs / 1000);
        const endSeconds = Math.max(startSeconds + 0.05, line.endTimeMs / 1000);
        const words: LyricWord[] =
          line.words && line.words.length > 0
            ? line.words.map((w) => ({
                text: w.text,
                startSeconds: Math.max(startSeconds, w.startTimeMs / 1000),
                endSeconds: Math.max(
                  Math.max(startSeconds, w.startTimeMs / 1000) + 0.02,
                  w.endTimeMs / 1000,
                ),
              }))
            : [];

        if (words.length > 0) {
          hasWordLevel = true;
        }

        return {
          startSeconds,
          endSeconds,
          text: line.text,
          words,
          isSynthesizedWords: false,
        };
      });

      return {
        providerName: this.name,
        sourceKind: hasWordLevel ? 'WordSynced' : 'LineSynced',
        lines,
      };
    }

    if (track.rawSyncedLyrics && track.rawSyncedLyrics.trim().length > 0) {
      return parseLrc(track.rawSyncedLyrics, {
        providerName: this.name,
        trackDurationSeconds: track.durationSeconds,
      });
    }

    return null;
  }
}

export interface LrclibProviderOptions {
  readonly baseUrl?: string;
  readonly fetchFn?: typeof fetch;
}

export class LrclibLyricsProvider implements ILyricsProvider {
  readonly name = 'LRCLIB';
  readonly supportedGranularity = 'Line' as const;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch | undefined;

  constructor(options: LrclibProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://lrclib.net/api').replace(/\/+$/, '');
    this.fetchFn = options.fetchFn ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  }

  async getLyricsAsync(track: TrackInfo, signal?: AbortSignal): Promise<Lyrics | null> {
    if (signal?.aborted || !this.fetchFn) return null;
    if (!track.title || !track.artist) return null;

    try {
      const params = new URLSearchParams({
        track_name: track.title,
        artist_name: track.artist,
      });
      if (track.album) {
        params.set('album_name', track.album);
      }
      if (track.durationSeconds > 0) {
        params.set('duration', String(Math.round(track.durationSeconds)));
      }

      const response = await this.fetchFn(`${this.baseUrl}/get?${params.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      });

      if (!response.ok) return null;
      const data = (await response.json()) as {
        syncedLyrics?: string | null;
        plainLyrics?: string | null;
      };

      if (data.syncedLyrics && data.syncedLyrics.trim().length > 0) {
        return parseLrc(data.syncedLyrics, {
          providerName: this.name,
          trackDurationSeconds: track.durationSeconds,
        });
      }

      if (data.plainLyrics && data.plainLyrics.trim().length > 0) {
        return parseLrc(data.plainLyrics, {
          providerName: this.name,
          trackDurationSeconds: track.durationSeconds,
        });
      }

      return null;
    } catch {
      return null;
    }
  }
}

export interface LyricsPipelineOptions {
  readonly providers?: readonly ILyricsProvider[];
  readonly cache?: LyricsCacheAdapter;
  readonly enableLrclibFallback?: boolean;
}

export class LyricsPipeline {
  private readonly providers: ILyricsProvider[];
  private cache: LyricsCacheAdapter | undefined;

  constructor(options: LyricsPipelineOptions = {}) {
    if (options.providers) {
      this.providers = [...options.providers];
    } else {
      this.providers = [new EmbeddedTrackLyricsProvider()];
      if (options.enableLrclibFallback) {
        this.providers.push(new LrclibLyricsProvider());
      }
    }
    this.cache = options.cache;
  }

  setCacheAdapter(cache: LyricsCacheAdapter | undefined): void {
    this.cache = cache;
  }

  registerProvider(provider: ILyricsProvider, prepend = false): void {
    if (prepend) {
      this.providers.unshift(provider);
    } else {
      this.providers.push(provider);
    }
  }

  getProviders(): readonly ILyricsProvider[] {
    return this.providers;
  }

  async resolveLyricsAsync(track: TrackInfo | null, signal?: AbortSignal): Promise<Lyrics | null> {
    if (!track || signal?.aborted) return null;

    const cacheKey = buildLyricsCacheKey(track);

    if (this.cache) {
      try {
        const cached = await this.cache.getCachedLyrics(cacheKey);
        if (signal?.aborted) return null;
        if (cached && cached.lines.length > 0) {
          return this.ensureWordTimings(cached);
        }
      } catch {
        // Cache read failure must never crash the lyrics pipeline
      }
    }

    for (const provider of this.providers) {
      if (signal?.aborted) return null;
      try {
        const raw = await provider.getLyricsAsync(track, signal);
        if (signal?.aborted) return null;
        if (raw && raw.lines.length > 0) {
          const normalized = this.ensureWordTimings(raw);
          if (this.cache) {
            try {
              await this.cache.setCachedLyrics(cacheKey, normalized);
            } catch {
              // Cache write failure must never crash the pipeline
            }
          }
          return normalized;
        }
      } catch {
        // Individual provider failure falls through to next provider
      }
    }

    return null;
  }

  private ensureWordTimings(lyrics: Lyrics): Lyrics {
    if (lyrics.sourceKind === 'WordSynced' && lyrics.lines.every((l) => l.words.length > 0)) {
      return lyrics;
    }
    return synthesizeLyricsWords(lyrics, {
      sourceKind: lyrics.sourceKind === 'LineSynced' ? 'LineSynced' : 'FallbackSynthesis',
    });
  }
}
