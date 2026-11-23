// src/services/LyricsService.ts
// LRC & TTML syllable-synced lyrics parser and active word tracker conforming to Feature 16 & 22

import { universalFetch, InnerTubeClient } from './InnerTubeClient';
import {
  hasNonLatinScript,
  mapRomanizedWords,
  transliterateToLatin,
} from '../utils/transliterate';

export interface LyricSyllable {
  text: string;
  startTimeMs: number;
  endTimeMs: number;
  startChar?: number;
  endChar?: number;
}

export interface LyricLine {
  lineIndex?: number;
  startTimeMs: number;
  endTimeMs: number;
  text: string;
  syllables?: LyricSyllable[];
  isBackground?: boolean;
  backgroundLine?: LyricLine;
  alignment?: 'start' | 'end';
  romanization?: string;
  romanizedText?: string;
  romanizedWords?: LyricSyllable[];
  translation?: string;
  translatedText?: string;
  isRtl?: boolean;
}

export interface LyricsData {
  type: 'LINE_SYNCED' | 'SYLLABLE_SYNCED' | 'UNSYNCED';
  provider: string; // 'AppleMusic' | 'LrcLib' | 'KuGou' | 'Local' | 'Embedded' | 'innertube'
  language?: string;
  isRtl?: boolean;
  lines: LyricLine[];
  isSynced?: boolean;
  sourceAttribution?: string;
}

export type ParsedLyrics = LyricsData;

export class LyricsService {
  private static readonly RTL_REGEX =
    /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

  public static isRtlText(text: string): boolean {
    return this.RTL_REGEX.test(text);
  }

  public static parseClockTime(raw: string): number {
    if (!raw || typeof raw !== 'string') return 0;
    const trimmed = raw.trim();
    if (!trimmed) return 0;

    if (trimmed.endsWith('ms')) {
      const val = parseFloat(trimmed.slice(0, -2));
      return Number.isFinite(val) ? val : 0;
    }
    if (trimmed.endsWith('s')) {
      const val = parseFloat(trimmed.slice(0, -1));
      return Number.isFinite(val) ? Math.round(val * 1000) : 0;
    }

    const parts = trimmed.split(':');
    if (parts.length === 1) {
      const val = parseFloat(parts[0]);
      return Number.isFinite(val) ? Math.round(val * 1000) : 0;
    } else if (parts.length === 2) {
      const min = parseInt(parts[0], 10);
      const sec = parseFloat(parts[1]);
      if (Number.isFinite(min) && Number.isFinite(sec)) {
        return Math.round((min * 60 + sec) * 1000);
      }
      return 0;
    } else if (parts.length === 3) {
      const hr = parseInt(parts[0], 10);
      const min = parseInt(parts[1], 10);
      const sec = parseFloat(parts[2]);
      if (Number.isFinite(hr) && Number.isFinite(min) && Number.isFinite(sec)) {
        return Math.round((hr * 3600 + min * 60 + sec) * 1000);
      }
      return 0;
    }
    return 0;
  }

  /**
   * Parses standard line-synced LRC text into a structured LyricsData object.
   */
  public static parseLrc(lrcText: string, provider = 'LrcLib'): LyricsData {
    const lines: LyricLine[] = [];
    const regex = /^\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/;
    const rawLines = lrcText.split('\n');

    let isRtl = false;
    for (const raw of rawLines) {
      const match = raw.trim().match(regex);
      if (match) {
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        const frac = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
        const startTimeMs = min * 60000 + sec * 1000 + frac;
        const text = match[4].trim();
        if (this.isRtlText(text)) isRtl = true;
        lines.push({
          lineIndex: lines.length,
          startTimeMs,
          endTimeMs: 0,
          text,
        });
      }
    }

    // Sort chronologically by start time
    lines.sort((a, b) => a.startTimeMs - b.startTimeMs);

    // Calculate end times from subsequent line start times
    for (let i = 0; i < lines.length; i++) {
      lines[i].lineIndex = i;
      lines[i].endTimeMs = i < lines.length - 1 ? lines[i + 1].startTimeMs : lines[i].startTimeMs + 5000;
    }

    return {
      type: 'LINE_SYNCED',
      isSynced: true,
      provider,
      isRtl,
      lines,
    };
  }

  /**
   * Parses Apple Music style TTML XML into syllable-synchronized LyricsData.
   */
  public static parseTtml(ttmlXml: string, provider = 'AppleMusic'): LyricsData {
    const lines: LyricLine[] = [];
    let isRtl = false;

    // Support arbitrary XML attribute order for <p> and <span>
    const pRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
    const spanRegex = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;

    const extractAttr = (attrs: string, name: string): string | null => {
      const match = attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'i'));
      return match ? match[1] : null;
    };

    let pMatch: RegExpExecArray | null;
    let lineIdx = 0;

    while ((pMatch = pRegex.exec(ttmlXml)) !== null) {
      const pAttrs = pMatch[1];
      const innerContent = pMatch[2];

      const beginStr = extractAttr(pAttrs, 'begin');
      const endStr = extractAttr(pAttrs, 'end');

      const pBeginMs = beginStr ? this.parseClockTime(beginStr) : 0;
      const pEndMs = endStr ? this.parseClockTime(endStr) : pBeginMs + 4000;

      const syllables: LyricSyllable[] = [];
      let sMatch: RegExpExecArray | null;

      while ((sMatch = spanRegex.exec(innerContent)) !== null) {
        const sAttrs = sMatch[1];
        const sText = sMatch[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        const sBeginStr = extractAttr(sAttrs, 'begin');
        const sEndStr = extractAttr(sAttrs, 'end');

        const sBeginMs = sBeginStr ? this.parseClockTime(sBeginStr) : pBeginMs;
        const sEndMs = sEndStr ? this.parseClockTime(sEndStr) : sBeginMs + 500;
        if (this.isRtlText(sText)) isRtl = true;

        syllables.push({
          text: sText,
          startTimeMs: sBeginMs,
          endTimeMs: sEndMs,
        });
      }

      const fullText = (
        syllables.map((s) => s.text).join('') ||
        innerContent.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
      );

      lines.push({
        lineIndex: lineIdx++,
        startTimeMs: pBeginMs,
        endTimeMs: pEndMs,
        text: fullText,
        syllables: syllables.length > 0 ? syllables : undefined,
      });
    }

    return {
      type: lines.some((l) => l.syllables && l.syllables.length > 0) ? 'SYLLABLE_SYNCED' : 'LINE_SYNCED',
      isSynced: true,
      provider,
      isRtl,
      lines,
    };
  }

  /**
   * Fast O(log N) binary search active line index.
   */
  public static getActiveLineIndex(lyrics: LyricsData | LyricLine[] | null, currentPosMs: number): number {
    if (!lyrics) return -1;
    const lines = Array.isArray(lyrics) ? lyrics : lyrics.lines;
    if (!lines || lines.length === 0) return -1;

    let low = 0;
    let high = lines.length - 1;
    let candidate = -1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const line = lines[mid];

      if (currentPosMs >= line.startTimeMs && currentPosMs <= line.endTimeMs) {
        return mid;
      } else if (currentPosMs < line.startTimeMs) {
        high = mid - 1;
      } else {
        candidate = mid;
        low = mid + 1;
      }
    }
    return candidate;
  }

  /**
   * Finds active word/syllable and progress fraction (0.0 to 1.0).
   */
  public static getActiveWord(
    line: LyricLine | null,
    currentPosMs: number
  ): {
    activeSyllable: LyricSyllable | null;
    syllableIndex: number;
    progress: number;
  } {
    if (!line || !line.syllables || line.syllables.length === 0) {
      return { activeSyllable: null, syllableIndex: -1, progress: 0 };
    }

    for (let i = 0; i < line.syllables.length; i++) {
      const syl = line.syllables[i];
      if (currentPosMs >= syl.startTimeMs && currentPosMs <= syl.endTimeMs) {
        const span = Math.max(1, syl.endTimeMs - syl.startTimeMs);
        const progress = Math.min(1.0, Math.max(0.0, (currentPosMs - syl.startTimeMs) / span));
        return { activeSyllable: syl, syllableIndex: i, progress };
      }
    }
    return { activeSyllable: null, syllableIndex: -1, progress: 0 };
  }

  /**
   * 5-stage track title and artist cleaner for metadata noise tokens.
   */
  public static cleanTrackMetadata(rawTitle: string, rawArtist?: string): { title: string; artist: string } {
    let title = (rawTitle || '').trim();
    let artist = (rawArtist || '').trim();

    // Stage 1: Strip trailing branding / channel suffixes: | Vevo, - Vevo UK, etc.
    title = title.replace(/\s*[|\-]\s*vevo(?:\s+[a-z0-9]+)?$/i, '');

    // Stage 2: Strip trailing noise with hyphens BEFORE testing for 'Artist - Title' split
    // e.g. "Radioactive - Official Music Video", "Comfortably Numb - 2011 Remastered Version", "Hotel California - Live On MTV / 1994"
    title = title
      .replace(/\s*-\s*(?:official\s*(?:music\s*)?(?:video|audio)|visualizer|audio|lyric\s*video)$/i, '')
      .replace(/\s*-\s*(?:\d{4}\s*)?remaster(?:ed)?(?:\s*(?:version|\d{4}))?$/i, '')
      .replace(/\s*-\s*live(?:\s+(?:at|from|in|on|\/)[^-]*)?$/i, '');

    // Stage 3: Handle 'Artist - Title' format if title contains ' - '
    if (title.includes(' - ')) {
      const parts = title.split(' - ');
      if (parts.length === 2) {
        const p0 = parts[0].trim();
        const p1 = parts[1].trim();
        if (!artist || artist === 'Unknown Artist' || artist.toLowerCase() === p0.toLowerCase()) {
          artist = p0;
          title = p1;
        }
      }
    }

    // Stage 4: Remove bracketed / parenthesized noise tokens
    title = title
      // Video/audio/lyrics/visualizer tags: (Official Music Video), [Audio], (Music Video), (Lyric Video)
      .replace(
        /\s*[\(\[](?:official\s*)?(?:music\s*)?(?:video|audio|visualizer|lyric\s*video|lyrics?|clip\s*officiel|clip|videoclip)[\)\]]/gi,
        ''
      )
      // Quality/resolution tags: (HD), [4K], [HQ], (4K 60FPS), (1080p), (Audio)
      .replace(/\s*[\(\[](?:hd|hq|4k(?:\s*60fps)?|1080p|audio)[\)\]]/gi, '')
      // Remaster tags: (Remastered 2011), [2011 Remaster], (4K Remaster), (4K / 2022 Remaster), [Remastered]
      .replace(
        /\s*[\(\[](?:(?:4k\s*[\/\-]\s*)?(?:\d{4}\s*)?remaster(?:ed)?(?:\s*(?:version|\d{4}))?|4k\s*remaster(?:ed)?)[\)\]]/gi,
        ''
      )
      // Live tags in parens: (Live at ...), [Live in Texas], (Live)
      .replace(/\s*[\(\[]live(?:\s+(?:at|from|in|on)[^\)\]]*)?[\)\]]/gi, '')
      // Featuring in parens/brackets: (feat. XYZ), [ft. ABC], (with XYZ)
      .replace(/\s*[\(\[](?:feat\.?|ft\.?|featuring|with)\s+[^\)\]]+[\)\]]/gi, '')
      // Unparenthesized trailing feat: feat. XYZ, ft. XYZ at end of string
      .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+[^-()\[\]]+$/i, '')
      // Clean up multiple spaces
      .replace(/\s+/g, ' ')
      .trim();

    // Stage 5: Clean artist
    if (artist) {
      artist = artist
        .replace(/\s*-\s*topic$/i, '') // YouTube generated artist channels: "Artist - Topic"
        .replace(/\s*vevo$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    return { title, artist };
  }

  /**
   * Converts plain text lyrics into standard UNSYNCED LyricsData.
   */
  public static parsePlainText(plainText: string, provider = 'YouTubeMusic'): LyricsData {
    const rawLines = plainText.split(/\r?\n/);
    const lines: LyricLine[] = [];
    let isRtl = false;

    for (let i = 0; i < rawLines.length; i++) {
      const lineText = rawLines[i].trim();
      if (!lineText) continue;
      if (this.isRtlText(lineText)) isRtl = true;
      lines.push({
        lineIndex: lines.length,
        startTimeMs: 0,
        endTimeMs: 0,
        text: lineText,
      });
    }

    return {
      type: 'UNSYNCED',
      isSynced: false,
      provider,
      isRtl,
      lines,
    };
  }

  /**
   * Interpolates word-level syllables for line-synced lyrics without capturing whitespace.
   */
  public static interpolateLineSyllables(line: LyricLine): LyricLine {
    if (!line.text || (line.syllables && line.syllables.length > 0)) {
      return line;
    }

    const words = line.text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return line;

    const totalChars = words.reduce((acc, w) => acc + Math.max(2, w.length), 0);
    const spanMs = Math.max(500, line.endTimeMs - line.startTimeMs);

    let currentStart = line.startTimeMs;
    const syllables: LyricSyllable[] = [];

    for (let idx = 0; idx < words.length; idx++) {
      const word = words[idx];
      const weight = Math.max(2, word.length) / totalChars;
      const wordDur = Math.round(spanMs * weight);
      const end =
        idx === words.length - 1
          ? line.endTimeMs
          : Math.min(line.endTimeMs, currentStart + wordDur);

      syllables.push({
        text: word,
        startTimeMs: currentStart,
        endTimeMs: Math.max(currentStart + 50, end),
      });

      currentStart = end;
    }

    return {
      ...line,
      syllables,
    };
  }

  private static readonly lyricsCache = new Map<string, LyricsData>();
  private static readonly pendingFetches = new Map<string, Promise<LyricsData | null>>();
  private static readonly translationCache = new Map<string, string[]>();
  private static readonly pendingTranslations = new Map<string, Promise<LyricsData>>();
  private static readonly MAX_CACHE_SIZE = 100;
  private static readonly TRANSLATE_TIMEOUT_MS = 4000;

  private static enrichLineNonLatin(line: LyricLine): LyricLine {
    const existingRom = (line.romanizedText || line.romanization || '').trim();
    const existingTrans = (line.translatedText || line.translation || '').trim();

    let romText = existingRom;
    if (!romText && hasNonLatinScript(line.text)) {
      const candidate = transliterateToLatin(line.text).trim();
      if (candidate && candidate !== line.text.trim()) {
        romText = candidate;
      }
    }

    let nextBgLine = line.backgroundLine;
    let bgChanged = false;
    if (line.backgroundLine) {
      const enrichedBg = this.enrichLineNonLatin(line.backgroundLine);
      if (enrichedBg !== line.backgroundLine) {
        nextBgLine = enrichedBg;
        bgChanged = true;
      }
    }

    const hasExistingRomWords = Array.isArray(line.romanizedWords) && line.romanizedWords.length > 0;
    let nextRomWords = line.romanizedWords;
    if (romText && !hasExistingRomWords) {
      const sourceWords = (line.syllables || [])
        .filter((s) => typeof s.text === 'string' && s.text.trim().length > 0)
        .map((s) => ({
          text: s.text.trim(),
          startSeconds: Math.max(0, s.startTimeMs / 1000),
          endSeconds: Math.max(Math.max(0, s.startTimeMs / 1000) + 0.02, s.endTimeMs / 1000),
        }));
      const lineStartSec = Math.max(0, line.startTimeMs / 1000);
      const lineEndSec = Math.max(lineStartSec + 0.05, line.endTimeMs / 1000);
      const mapped = mapRomanizedWords(sourceWords, romText, lineStartSec, lineEndSec);
      if (mapped.length > 0) {
        nextRomWords = mapped.map((w) => ({
          text: w.text,
          startTimeMs: Math.round(w.startSeconds * 1000),
          endTimeMs: Math.round(w.endSeconds * 1000),
        }));
      }
    }

    const romNeedsSync = Boolean(romText) && (line.romanizedText !== romText || line.romanization !== romText);
    const transNeedsSync = Boolean(existingTrans) && (line.translatedText !== existingTrans || line.translation !== existingTrans);
    const wordsChanged = nextRomWords !== line.romanizedWords;

    if (!romNeedsSync && !transNeedsSync && !wordsChanged && !bgChanged) {
      return line;
    }

    return {
      ...line,
      ...(romText ? { romanization: romText, romanizedText: romText } : {}),
      ...(nextRomWords ? { romanizedWords: nextRomWords } : {}),
      ...(existingTrans ? { translation: existingTrans, translatedText: existingTrans } : {}),
      ...(bgChanged ? { backgroundLine: nextBgLine } : {}),
    };
  }

  /**
   * Synchronously enriches non-Latin lyrics with deterministic offline romanization
   * and proportional word-level timing, keeping romanization/romanizedText and
   * translation/translatedText synchronized.
   */
  public static enrichNonLatinLyrics(parsed: LyricsData): LyricsData {
    if (!parsed || !Array.isArray(parsed.lines) || parsed.lines.length === 0) {
      return parsed;
    }
    let changed = false;
    const nextLines = parsed.lines.map((line) => {
      const enriched = this.enrichLineNonLatin(line);
      if (enriched !== line) changed = true;
      return enriched;
    });
    return changed ? { ...parsed, lines: nextLines } : parsed;
  }

  /**
   * Lightweight cached async translation enrichment via Google Translate GTX endpoint
   * with a strict 4s timeout and graceful offline fallback.
   */
  public static async translateLyricsLines(parsed: LyricsData, targetLang = 'en'): Promise<LyricsData> {
    if (!parsed || !Array.isArray(parsed.lines) || parsed.lines.length === 0) {
      return parsed;
    }

    const targetIndices: number[] = [];
    for (let i = 0; i < parsed.lines.length; i++) {
      const line = parsed.lines[i];
      const text = (line.text || '').trim();
      const existingTrans = (line.translatedText || line.translation || '').trim();
      if (!text || existingTrans) continue;
      if (/^(source|written by|lyrics licensed by|provided by):/i.test(text)) continue;
      targetIndices.push(i);
    }

    if (targetIndices.length === 0) {
      return parsed;
    }

    const sourceTexts = targetIndices.map((idx) => parsed.lines[idx].text.replace(/[\r\n]+/g, ' ').trim());
    const cacheKey = `${targetLang}:${sourceTexts.join('\n')}`;

    const applyTranslations = (translations: string[]): LyricsData => {
      let changed = false;
      const nextLines = parsed.lines.slice();
      for (let k = 0; k < targetIndices.length; k++) {
        const lineIdx = targetIndices[k];
        const orig = sourceTexts[k];
        const tr = (translations[k] || '').trim();
        if (!tr || tr.toLowerCase() === orig.toLowerCase()) continue;
        nextLines[lineIdx] = {
          ...nextLines[lineIdx],
          translation: tr,
          translatedText: tr,
        };
        changed = true;
      }
      return changed ? { ...parsed, lines: nextLines } : parsed;
    };

    if (this.translationCache.has(cacheKey)) {
      const cached = this.translationCache.get(cacheKey)!;
      this.translationCache.delete(cacheKey);
      this.translationCache.set(cacheKey, cached);
      return applyTranslations(cached);
    }

    if (this.pendingTranslations.has(cacheKey)) {
      return this.pendingTranslations.get(cacheKey)!;
    }

    const translatePromise = (async (): Promise<LyricsData> => {
      try {
        const translatedAll = new Array<string>(sourceTexts.length).fill('');
        let offset = 0;
        let receivedAny = false;

        while (offset < sourceTexts.length) {
          const chunk: string[] = [];
          let chunkChars = 0;
          while (offset + chunk.length < sourceTexts.length && chunk.length < 25) {
            const candidate = sourceTexts[offset + chunk.length];
            if (chunk.length > 0 && chunkChars + candidate.length + 1 > 1400) break;
            chunk.push(candidate);
            chunkChars += candidate.length + 1;
          }

          const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(
            targetLang
          )}&dt=t&q=${encodeURIComponent(chunk.join('\n'))}`;

          let timeoutId: ReturnType<typeof setTimeout> | null = null;
          try {
            const timeoutPromise = new Promise<null>((resolve) => {
              timeoutId = setTimeout(() => resolve(null), this.TRANSLATE_TIMEOUT_MS);
            });
            const res = await Promise.race([
              universalFetch(url, { method: 'GET' }),
              timeoutPromise,
            ]);
            if (res && res.ok) {
              const payload = await res.json<any>();
              if (Array.isArray(payload) && Array.isArray(payload[0])) {
                const joined = payload[0]
                  .map((seg: any) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
                  .join('');
                const parts = joined.split('\n');
                if (parts.length === chunk.length) {
                  for (let j = 0; j < chunk.length; j++) {
                    const t = parts[j].trim();
                    if (t) {
                      translatedAll[offset + j] = t;
                      receivedAny = true;
                    }
                  }
                } else if (chunk.length === 1 && joined.trim()) {
                  translatedAll[offset] = joined.trim();
                  receivedAny = true;
                }
              }
            }
          } catch {
            // Graceful offline / timeout fallback
          } finally {
            if (timeoutId !== null) clearTimeout(timeoutId);
          }

          offset += chunk.length;
        }

        if (!receivedAny) {
          return parsed;
        }

        if (this.translationCache.size >= this.MAX_CACHE_SIZE) {
          const oldestKey = this.translationCache.keys().next().value;
          if (oldestKey !== undefined) this.translationCache.delete(oldestKey);
        }
        this.translationCache.set(cacheKey, translatedAll);
        return applyTranslations(translatedAll);
      } catch {
        return parsed;
      }
    })();

    this.pendingTranslations.set(cacheKey, translatePromise);
    try {
      return await translatePromise;
    } finally {
      this.pendingTranslations.delete(cacheKey);
    }
  }

  /**
   * Centralized lyrics fetcher with in-memory bounded LRU cache, in-flight deduplication,
   * and multi-tier provider hierarchy (LRCLIB exact -> LRCLIB fuzzy -> InnerTube Musixmatch -> fallback).
   */
  public static async fetchLyrics(
    songIdOrTitle: string,
    titleOrArtist?: string,
    artistOrAlbum?: string,
    albumOrDuration?: string | number,
    durationSec?: number
  ): Promise<LyricsData | null> {
    let songId = '';
    let rawTitle = '';
    let rawArtist = '';
    let rawDuration: number | undefined;

    if (durationSec !== undefined) {
      songId = songIdOrTitle;
      rawTitle = titleOrArtist || '';
      rawArtist = artistOrAlbum || '';
      rawDuration = durationSec;
    } else if (typeof albumOrDuration === 'number' && artistOrAlbum !== undefined) {
      songId = songIdOrTitle;
      rawTitle = titleOrArtist || '';
      rawArtist = artistOrAlbum;
      rawDuration = albumOrDuration;
    } else if (typeof albumOrDuration === 'number') {
      rawTitle = songIdOrTitle;
      rawArtist = titleOrArtist || '';
      rawDuration = albumOrDuration;
    } else if (typeof artistOrAlbum === 'number') {
      rawTitle = songIdOrTitle;
      rawArtist = titleOrArtist || '';
      rawDuration = artistOrAlbum;
    } else if (artistOrAlbum !== undefined) {
      songId = songIdOrTitle;
      rawTitle = titleOrArtist || '';
      rawArtist = artistOrAlbum;
    } else {
      rawTitle = songIdOrTitle;
      rawArtist = titleOrArtist || '';
    }

    const { title, artist } = this.cleanTrackMetadata(rawTitle, rawArtist);
    if (!title && !songId) return null;

    const cacheKey = `${songId || ''}:${title.toLowerCase()}:${artist.toLowerCase()}`;

    // 1. Check bounded LRU Cache
    if (this.lyricsCache.has(cacheKey)) {
      const cached = this.lyricsCache.get(cacheKey)!;
      // Refresh LRU recency
      this.lyricsCache.delete(cacheKey);
      this.lyricsCache.set(cacheKey, cached);
      return cached;
    }

    // 2. Check Pending Fetches (in-flight request deduplication)
    if (this.pendingFetches.has(cacheKey)) {
      return this.pendingFetches.get(cacheKey)!;
    }

    const fetchPromise = (async (): Promise<LyricsData | null> => {
      let plainFallback: string | null = null;

      // Tier 1: LRCLIB Exact GET
      if (title && artist) {
        try {
          const durParam = rawDuration && rawDuration > 0 ? `&duration=${Math.round(rawDuration)}` : '';
          const exactUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}${durParam}`;
          const res = await universalFetch(exactUrl, { method: 'GET' });
          if (res.ok) {
            const data = await res.json<any>();
            if (data?.syncedLyrics) {
              const parsed = this.parseLrc(data.syncedLyrics, 'lrclib');
              parsed.lines = parsed.lines.map((l) => this.interpolateLineSyllables(l));
              parsed.type = 'SYLLABLE_SYNCED';
              parsed.isSynced = true;
              return parsed;
            } else if (data?.plainLyrics) {
              plainFallback = data.plainLyrics;
            }
          }
        } catch {}
      }

      // Tier 2: LRCLIB Fuzzy Search
      if (title) {
        try {
          const q = `${title} ${artist}`.trim();
          const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`;
          const res = await universalFetch(searchUrl, { method: 'GET' });
          if (res.ok) {
            const items = await res.json<any[]>();
            if (Array.isArray(items) && items.length > 0) {
              const match = items.find((i) => i.syncedLyrics) || items[0];
              if (match?.syncedLyrics) {
                const parsed = this.parseLrc(match.syncedLyrics, 'lrclib');
                parsed.lines = parsed.lines.map((l) => this.interpolateLineSyllables(l));
                parsed.type = 'SYLLABLE_SYNCED';
                parsed.isSynced = true;
                return parsed;
              } else if (match?.plainLyrics && !plainFallback) {
                plainFallback = match.plainLyrics;
              }
            }
          }
        } catch {}
      }

      // Tier 3: InnerTube native YouTube Music Musixmatch lyrics fallback
      if (songId) {
        try {
          const innerTube = new InnerTubeClient();
          const innerTubeLyrics = await innerTube.fetchTrackLyrics(songId);
          if (innerTubeLyrics && innerTubeLyrics.lines && innerTubeLyrics.lines.length > 0) {
            return innerTubeLyrics;
          }
        } catch {}
      }

      // Tier 4: Plain Lyrics Fallback
      if (plainFallback) {
        return this.parsePlainText(plainFallback, 'lrclib');
      }

      return null;
    })();

    this.pendingFetches.set(cacheKey, fetchPromise);

    try {
      const result = await fetchPromise;
      if (result) {
        if (this.lyricsCache.size >= this.MAX_CACHE_SIZE) {
          const oldestKey = this.lyricsCache.keys().next().value;
          if (oldestKey !== undefined) this.lyricsCache.delete(oldestKey);
        }
        this.lyricsCache.set(cacheKey, result);
      }
      return result;
    } finally {
      this.pendingFetches.delete(cacheKey);
    }
  }

  public static clearCache(): void {
    this.lyricsCache.clear();
    this.pendingFetches.clear();
    this.translationCache.clear();
    this.pendingTranslations.clear();
  }

  public static getCacheSize(): number {
    return this.lyricsCache.size;
  }
}

export function enrichNonLatinLyrics(parsed: LyricsData): LyricsData {
  return LyricsService.enrichNonLatinLyrics(parsed);
}
