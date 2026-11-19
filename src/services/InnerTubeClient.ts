// src/services/InnerTubeClient.ts
// InnerTube client emulating YouTube Music WEB_REMIX with SAPISIDHASH, universal CORS-free transport, and retry backoff

import type { LyricsData, LyricLine, LyricSyllable } from './LyricsService';

export interface InnerTubeClientOptions {
  cookie?: string;
  visitorData?: string;
  clientVersion?: string;
  userAgent?: string;
}

/**
 * Pure-JS synchronous SHA-1 implementation for SAPISIDHASH generation
 * Works identically in Node.js, Electron renderer, and Vite browser bundles without node:crypto externalization.
 */
function sha1Hex(input: string): string {
  const utf8 = new TextEncoder().encode(input);
  const words: number[] = [];
  for (let i = 0; i < utf8.length; i++) {
    words[i >>> 2] |= utf8[i] << (24 - (i % 4) * 8);
  }
  const bitLength = utf8.length * 8;
  words[bitLength >>> 5] |= 0x80 << (24 - (bitLength % 32));
  words[(((bitLength + 64) >>> 9) << 4) + 15] = bitLength;

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Array<number>(80);

  const rol = (n: number, s: number) => (n << s) | (n >>> (32 - s));

  for (let i = 0; i < words.length; i += 16) {
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let j = 0; j < 80; j++) {
      if (j < 16) {
        w[j] = words[i + j] | 0;
      } else {
        w[j] = rol(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
      }
      let f = 0;
      let k = 0;
      if (j < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (j < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rol(a, 5) + f + e + k + w[j]) | 0;
      e = d;
      d = c;
      c = rol(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4);
}

export function extractSapisid(cookieHeader: string): string | null {
  if (!cookieHeader) return null;
  const SAPISID_NAMES = ['SAPISID', '__Secure-3PAPISID', '__Secure-1PAPISID'];
  const cookies = cookieHeader.split(';').reduce<Record<string, string>>((acc, pair) => {
    const [name, ...rest] = pair.trim().split('=');
    if (name && rest.length > 0) acc[name] = rest.join('=');
    return acc;
  }, {});

  for (const name of SAPISID_NAMES) {
    if (cookies[name]) return cookies[name];
  }
  return null;
}

export function generateSapisidHash(sapisid: string, origin = 'https://music.youtube.com'): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const raw = `${timestamp} ${sapisid} ${origin}`;
  const sha1 = sha1Hex(raw);
  return `SAPISIDHASH ${timestamp}_${sha1}`;
}

export interface UniversalFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
  json: <T = any>() => Promise<T>;
}

/**
 * Universal network fetch that automatically routes through:
 * 1. Electron main-process IPC (`window.electronAPI.fetch`) when running inside Electron
 * 2. Vite dev/preview server proxy (`/__waveform_proxy`) when running inside a browser on localhost
 * 3. Direct `fetch()` when running in Node.js or when Electron webRequest handles headers
 */
export async function universalFetch(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<UniversalFetchResponse> {
  const hasWindow = typeof window !== 'undefined';
  const electronFetch = hasWindow ? (window as any).electronAPI?.fetch : undefined;

  if (typeof electronFetch === 'function') {
    const res = await electronFetch(url, options);
    if (res && typeof res.text === 'string') {
      return {
        ok: Boolean(res.ok),
        status: res.status || (res.ok ? 200 : 500),
        statusText: res.statusText || '',
        text: async () => res.text,
        json: async <T = any>() => JSON.parse(res.text) as T,
      };
    }
  }

  if (hasWindow && window.location?.protocol?.startsWith('http')) {
    try {
      const proxyRes = await fetch('/__waveform_proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, options }),
      });
      if (proxyRes.ok) {
        const payload = await proxyRes.json();
        if (payload && typeof payload.text === 'string' && payload.status !== 500) {
          return {
            ok: Boolean(payload.ok),
            status: payload.status,
            statusText: payload.statusText || '',
            text: async () => payload.text,
            json: async <T = any>() => JSON.parse(payload.text) as T,
          };
        }
      }
    } catch {
      // Fall through to direct fetch
    }
  }

  const directRes = await fetch(url, {
    method: options.method || 'GET',
    headers: options.headers,
    body: options.body,
  });

  return {
    ok: directRes.ok,
    status: directRes.status,
    statusText: directRes.statusText,
    text: () => directRes.text(),
    json: <T = any>() => directRes.json() as Promise<T>,
  };
}

/**
 * Ensures an audio stream URL is playable by `<audio crossOrigin="anonymous">` in both Electron and browser dev mode.
 */
export function toPlayableStreamUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl;
  if (
    rawUrl.startsWith('file://') ||
    rawUrl.startsWith('blob:') ||
    rawUrl.startsWith('data:') ||
    rawUrl.startsWith('/__waveform_stream')
  ) {
    return rawUrl;
  }
  const hasWindow = typeof window !== 'undefined';
  const isElectron = hasWindow && Boolean((window as any).electronAPI);
  // In Vite browser dev/preview (non-Electron), route remote googlevideo.com streams through /__waveform_stream
  if (hasWindow && !isElectron && window.location?.protocol?.startsWith('http')) {
    if (rawUrl.includes('googlevideo.com')) {
      return `/__waveform_stream?url=${encodeURIComponent(rawUrl)}`;
    }
  }
  return rawUrl;
}

export class InnerTubeClient {
  private static readonly BASE_URL = 'https://music.youtube.com/youtubei/v1';
  private static readonly CLIENT_NAME = 'WEB_REMIX';
  private static readonly CLIENT_ID = '67';
  private static readonly DEFAULT_VERSION = '1.20250101.01.00';
  private static readonly DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

  private visitorData: string | null = null;
  private cookie: string | null = null;
  private clientVersion: string;
  private userAgent: string;
  private isOnline = true;

  constructor(options?: InnerTubeClientOptions | string) {
    if (typeof options === 'string') {
      this.cookie = options;
      this.clientVersion = InnerTubeClient.DEFAULT_VERSION;
      this.userAgent = InnerTubeClient.DEFAULT_USER_AGENT;
    } else {
      this.cookie = options?.cookie || null;
      this.visitorData = options?.visitorData || null;
      this.clientVersion = options?.clientVersion || InnerTubeClient.DEFAULT_VERSION;
      this.userAgent = options?.userAgent || InnerTubeClient.DEFAULT_USER_AGENT;
    }
  }

  public setOnlineStatus(online: boolean): void {
    this.isOnline = Boolean(online);
  }

  public getOnlineStatus(): boolean {
    return this.isOnline;
  }

  public setVisitorData(visitorData: string): void {
    this.visitorData = visitorData;
  }

  public getVisitorData(): string | null {
    return this.visitorData;
  }

  public setCookie(cookie: string): void {
    this.cookie = cookie;
  }

  public buildHeaders(anonymous = false): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': this.userAgent,
      'Accept-Language': 'en-US,en;q=0.9',
      'X-Origin': 'https://music.youtube.com',
      'Origin': 'https://music.youtube.com',
      'Referer': 'https://music.youtube.com/',
      'X-YouTube-Client-Name': InnerTubeClient.CLIENT_ID,
      'X-YouTube-Client-Version': this.clientVersion,
    };

    if (this.visitorData) {
      headers['X-Goog-Visitor-Id'] = this.visitorData;
    }

    if (!anonymous && this.cookie) {
      headers['Cookie'] = this.cookie;
      const sapisid = extractSapisid(this.cookie);
      if (sapisid) {
        headers['Authorization'] = generateSapisidHash(sapisid);
      }
    }

    return headers;
  }

  public wrapContext(body: Record<string, unknown>, _anonymous = false): Record<string, unknown> {
    return {
      context: {
        client: {
          clientName: InnerTubeClient.CLIENT_NAME,
          clientVersion: this.clientVersion,
          hl: 'en',
          gl: 'US',
          visitorData: this.visitorData || undefined,
        },
        user: {
          lockedSafetyMode: false,
        },
        request: {
          useSsl: true,
        },
      },
      ...body,
    };
  }

  public async post<T = unknown>(
    endpoint: string,
    body: Record<string, unknown>,
    anonymous = false
  ): Promise<T> {
    if (!this.isOnline) {
      throw new Error('Network offline');
    }

    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    const url = `${InnerTubeClient.BASE_URL}/${cleanEndpoint}`;
    const headers = this.buildHeaders(anonymous);
    const payload = this.wrapContext(body, anonymous);

    return this.withRetry(async () => {
      const res = await universalFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`InnerTube HTTP ${res.status}: ${res.statusText}`);
      }

      const json = await res.json<any>();
      if (json?.responseContext?.visitorData && !this.visitorData) {
        this.visitorData = json.responseContext.visitorData;
      }
      return json as T;
    });
  }

  public async withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
    let delayMs = 300;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err: any) {
        if (i === attempts - 1 || err?.name === 'AbortError') {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs *= 2;
      }
    }
    return fn();
  }

  /**
   * Fetches official Musixmatch track lyrics via YouTube Music InnerTube /next and /browse.
   * Returns formatted LyricsData with provider 'innertube', or null if unavailable.
   */
  public async fetchTrackLyrics(videoId: string): Promise<LyricsData | null> {
    if (!videoId || !this.isOnline) return null;

    // Guard against local files or non-YouTube IDs
    if (videoId.startsWith('local_') || videoId.startsWith('file:') || videoId.includes('/')) {
      return null;
    }

    try {
      // Step 1: Query next endpoint for tabs
      const nextRes = await this.post<any>('next', { videoId });
      const tabs =
        nextRes?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
          ?.watchNextTabbedResultsRenderer?.tabs;

      const lyricsTab = tabs?.find(
        (t: any) =>
          t?.tabRenderer?.endpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
            ?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_TRACK_LYRICS'
      );

      // If no tab or tab is unselectable, catalog lacks lyrics
      if (!lyricsTab || lyricsTab.tabRenderer?.unselectable) {
        return null;
      }

      const browseId = lyricsTab.tabRenderer?.endpoint?.browseEndpoint?.browseId;
      if (!browseId) return null;

      // Step 2: Query browse endpoint for lyrics payload
      const browseRes = await this.post<any>('browse', { browseId });
      const sectionContents = browseRes?.contents?.sectionListRenderer?.contents;
      if (!Array.isArray(sectionContents) || sectionContents.length === 0) {
        return null;
      }

      const rtlRegex =
        /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

      // Check for timed lyrics renderer
      for (const section of sectionContents) {
        const timedRenderer =
          section?.timedLyricsRenderer ||
          section?.musicDescriptionShelfRenderer?.contents?.[0]?.timedLyricsRenderer;

        if (timedRenderer?.timedLyricsData?.lyricsData?.lines) {
          const rawLines = timedRenderer.timedLyricsData.lyricsData.lines;
          const footer =
            timedRenderer.timedLyricsData.lyricsData.footer?.runs
              ?.map((r: any) => r.text)
              .join('') || 'Source: Musixmatch';
          let isRtl = false;

          const lines: LyricLine[] = rawLines.map((tl: any, idx: number) => {
            const start = parseInt(tl.startTimeMs, 10) || 0;
            const end = parseInt(tl.endTimeMs, 10) || start + 4000;
            const lineText = (tl.runs?.map((r: any) => r.text).join('') || tl.text || '').trim();
            if (rtlRegex.test(lineText)) isRtl = true;

            const syllables: LyricSyllable[] | undefined = tl.syllables?.map((s: any) => ({
              text: s.text,
              startTimeMs: parseInt(s.startTimeMs, 10) || start,
              endTimeMs: parseInt(s.endTimeMs, 10) || end,
            }));

            return {
              lineIndex: idx,
              startTimeMs: start,
              endTimeMs: end,
              text: lineText,
              syllables: syllables && syllables.length > 0 ? syllables : undefined,
            };
          });

          const hasSyllables = lines.some((l) => l.syllables && l.syllables.length > 0);
          return {
            type: hasSyllables ? 'SYLLABLE_SYNCED' : 'LINE_SYNCED',
            isSynced: true,
            provider: 'innertube',
            isRtl,
            lines,
            sourceAttribution: footer,
          };
        }
      }

      // Check for static musicDescriptionShelfRenderer
      const shelf = sectionContents[0]?.musicDescriptionShelfRenderer;
      if (shelf?.description?.runs) {
        const text = shelf.description.runs.map((r: any) => r.text).join('');
        const footer =
          shelf.footer?.runs?.map((r: any) => r.text).join('') || 'Source: Musixmatch';

        if (text && text.trim()) {
          const rawLines = text.split(/\r?\n/);
          const lines: LyricLine[] = [];
          let isRtl = false;

          for (let i = 0; i < rawLines.length; i++) {
            const lineText = rawLines[i].trim();
            if (!lineText) continue;
            if (rtlRegex.test(lineText)) isRtl = true;
            lines.push({
              lineIndex: lines.length,
              startTimeMs: 0,
              endTimeMs: 0,
              text: lineText,
            });
          }

          if (lines.length > 0) {
            return {
              type: 'UNSYNCED',
              isSynced: false,
              provider: 'innertube',
              isRtl,
              lines,
              sourceAttribution: footer,
            };
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  }
}
