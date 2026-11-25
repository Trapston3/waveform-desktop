import type { LyricLine, Lyrics, LyricWord } from './models';

export interface LrcParseOptions {
  readonly providerName?: string;
  readonly trackDurationSeconds?: number;
}

const LINE_TAG_REGEX = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TAG_REGEX = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>([^<]*)/g;
const OFFSET_TAG_REGEX = /^\[offset:\s*([+-]?\d+)\s*\]$/i;
const METADATA_TAG_REGEX = /^\[(ar|ti|al|au|by|length|re|ve|la|id):.*\]$/i;
const ZERO_WIDTH_BIDI_REGEX = /[\u200B-\u200F\u202A-\u202E\uFEFF]/g;
const MEANINGFUL_CONTENT_REGEX = /[\p{L}\p{N}]|(?![\u{1F3B5}\u{1F3B6}\u{1F3BC}])\p{Extended_Pictographic}/u;
const WRAPPED_INSTRUMENTAL_TAG_REGEX =
  /^[\[\(\{<【（*~♪♫\-–—\s]+(?:instrumental(?:\s+(?:break|interlude|solo|intro|outro|part|music))?|interlude|music(?:\s+playing)?|solo|(?:guitar|piano|sax|saxophone|bass|drum|synth|violin|trumpet|flute|organ)\s+solo|outro|intro|break|instrumental\s+music|纯音乐|間奏|間奏中|간주|간주중)[\]\)\}>】）*~♪♫\-–—\s]+$/i;
const BARE_INSTRUMENTAL_TAG_REGEX =
  /^(?:instrumental(?:\s+(?:break|interlude|solo|intro|outro|part|music))?|interlude|music\s+playing|(?:guitar|piano|sax|saxophone|bass|drum|synth|violin)\s+solo|纯音乐|間奏|間奏中|간주|간주중|no\s+lyrics|lyrics\s+unavailable)$/i;

/**
 * Returns true if a lyric line is empty/whitespace (ignoring zero-width/BiDi chars),
 * pure punctuation/dividers/musical notes with no letters or digits, or an explicit
 * instrumental marker tag (e.g. [Instrumental], (Music), *Interlude*, [Solo], [Outro], [Intro], [Break]).
 */
export function isBlankOrInstrumentalLineText(text: string): boolean {
  if (typeof text !== 'string') return true;
  const cleaned = text.replace(ZERO_WIDTH_BIDI_REGEX, '').trim();
  if (!cleaned) return true;
  if (!MEANINGFUL_CONTENT_REGEX.test(cleaned)) return true;
  if (WRAPPED_INSTRUMENTAL_TAG_REGEX.test(cleaned)) return true;
  if (BARE_INSTRUMENTAL_TAG_REGEX.test(cleaned)) return true;
  return false;
}

function clampWordsToEnd(words: readonly LyricWord[], endSeconds: number): LyricWord[] {
  return words.map((w) => {
    const wStart = Math.min(Math.max(0, endSeconds - 0.02), w.startSeconds);
    const wEnd = Math.max(wStart + 0.02, Math.min(endSeconds, w.endSeconds));
    return {
      text: w.text,
      startSeconds: wStart,
      endSeconds: wEnd,
    };
  });
}

/**
 * Filters out blank/instrumental lines while clamping the preceding vocal line's
 * endSeconds (and word endSeconds) to min(endSeconds, breakTimestamp).
 */
export function filterBlankAndInstrumentalLines(lines: readonly LyricLine[]): LyricLine[] {
  let hasBlank = false;
  for (let i = 0; i < lines.length; i++) {
    if (isBlankOrInstrumentalLineText(lines[i].text)) {
      hasBlank = true;
      break;
    }
  }
  if (!hasBlank) {
    return lines as LyricLine[];
  }

  const filtered: LyricLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isBlankOrInstrumentalLineText(line.text)) {
      if (filtered.length > 0) {
        const prev = filtered[filtered.length - 1];
        const breakSec = line.startSeconds;
        if (Number.isFinite(breakSec) && breakSec > prev.startSeconds && breakSec < prev.endSeconds) {
          const clampedEnd = Math.max(prev.startSeconds + 0.05, Math.min(prev.endSeconds, breakSec));
          filtered[filtered.length - 1] = {
            ...prev,
            endSeconds: clampedEnd,
            words: prev.words.length > 0 ? clampWordsToEnd(prev.words, clampedEnd) : prev.words,
            ...(prev.romanizedWords && prev.romanizedWords.length > 0
              ? { romanizedWords: clampWordsToEnd(prev.romanizedWords, clampedEnd) }
              : {}),
          };
        }
      }
      continue;
    }
    filtered.push(line);
  }
  return filtered;
}

function parseTimestampSeconds(minStr: string, secStr: string, fracStr?: string): number {
  const minutes = Number.parseInt(minStr, 10);
  const seconds = Number.parseInt(secStr, 10);
  let fraction = 0;
  if (fracStr) {
    if (fracStr.length === 1) {
      fraction = Number.parseInt(fracStr, 10) / 10;
    } else if (fracStr.length === 2) {
      fraction = Number.parseInt(fracStr, 10) / 100;
    } else {
      fraction = Number.parseInt(fracStr.slice(0, 3), 10) / 1000;
    }
  }
  return minutes * 60 + seconds + fraction;
}

interface RawParsedLine {
  startSeconds: number;
  text: string;
  words: LyricWord[];
}

export function parseLrc(raw: string, options: LrcParseOptions = {}): Lyrics | null {
  if (!raw || !raw.trim()) {
    return null;
  }

  const providerName = options.providerName ?? 'LRC Parser';
  const rawLines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let offsetSeconds = 0;
  const timedEntries: RawParsedLine[] = [];
  const breakBoundaries: number[] = [];
  const unsyncedLines: string[] = [];

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const offsetMatch = OFFSET_TAG_REGEX.exec(trimmed);
    if (offsetMatch) {
      const offsetMs = Number.parseInt(offsetMatch[1], 10);
      if (Number.isFinite(offsetMs)) {
        // Standard LRC: positive [offset:+ms] shifts lyrics earlier
        offsetSeconds = offsetMs / 1000;
      }
      continue;
    }

    if (METADATA_TAG_REGEX.test(trimmed)) {
      continue;
    }

    LINE_TAG_REGEX.lastIndex = 0;
    const timestamps: number[] = [];
    let lastTagEnd = 0;
    let match: RegExpExecArray | null;

    while ((match = LINE_TAG_REGEX.exec(trimmed)) !== null) {
      const ts = Math.max(0, parseTimestampSeconds(match[1], match[2], match[3]) - offsetSeconds);
      timestamps.push(ts);
      lastTagEnd = LINE_TAG_REGEX.lastIndex;
    }

    if (timestamps.length === 0) {
      if (!isBlankOrInstrumentalLineText(trimmed)) {
        unsyncedLines.push(trimmed);
      }
      continue;
    }

    const content = trimmed.slice(lastTagEnd).trim();
    if (!content) {
      for (const ts of timestamps) {
        breakBoundaries.push(ts);
      }
      continue;
    }

    // Check for enhanced A2/ELRC word tags: <mm:ss.xx>word
    WORD_TAG_REGEX.lastIndex = 0;
    const parsedWords: { startSeconds: number; text: string }[] = [];
    let wordMatch: RegExpExecArray | null;
    while ((wordMatch = WORD_TAG_REGEX.exec(content)) !== null) {
      const wordStart = Math.max(
        0,
        parseTimestampSeconds(wordMatch[1], wordMatch[2], wordMatch[3]) - offsetSeconds,
      );
      const wordText = wordMatch[4].trim();
      if (wordText.length > 0) {
        parsedWords.push({ startSeconds: wordStart, text: wordText });
      }
    }

    const cleanText =
      parsedWords.length > 0
        ? parsedWords.map((w) => w.text).join(' ')
        : content.replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, '').trim();

    if (!cleanText || isBlankOrInstrumentalLineText(cleanText)) {
      for (const ts of timestamps) {
        breakBoundaries.push(ts);
      }
      continue;
    }

    for (const lineStart of timestamps) {
      // For multi-timestamp lines, if there are inline word tags and only 1 timestamp, use exact word starts;
      // if multiple timestamps share one line, shift word timings relative to first timestamp.
      const baseShift = timestamps.length > 1 ? lineStart - timestamps[0] : 0;
      const words: LyricWord[] = [];

      if (parsedWords.length > 0) {
        for (let i = 0; i < parsedWords.length; i++) {
          const wStart = Math.max(lineStart, parsedWords[i].startSeconds + baseShift);
          const nextStart =
            i + 1 < parsedWords.length
              ? Math.max(wStart + 0.05, parsedWords[i + 1].startSeconds + baseShift)
              : wStart + 0.45;
          words.push({
            text: parsedWords[i].text,
            startSeconds: wStart,
            endSeconds: nextStart,
          });
        }
      }

      timedEntries.push({
        startSeconds: lineStart,
        text: cleanText,
        words,
      });
    }
  }

  if (timedEntries.length === 0) {
    if (unsyncedLines.length === 0) {
      return null;
    }
    const lines: LyricLine[] = unsyncedLines.map((text) => ({
      startSeconds: 0,
      endSeconds: 0,
      text,
      words: [],
      isSynthesizedWords: false,
    }));
    return {
      providerName,
      sourceKind: 'Unsynced',
      lines,
    };
  }

  timedEntries.sort((a, b) => a.startSeconds - b.startSeconds);
  breakBoundaries.sort((a, b) => a - b);
  let breakPtr = 0;

  let hasAnyWordTags = false;
  const finalLines: LyricLine[] = [];

  for (let i = 0; i < timedEntries.length; i++) {
    const entry = timedEntries[i];
    const nextEntry = timedEntries[i + 1];

    const lastWordEnd =
      entry.words.length > 0 ? entry.words[entry.words.length - 1].endSeconds : entry.startSeconds + 4.0;

    let endSeconds: number;
    if (nextEntry) {
      endSeconds = Math.max(entry.startSeconds + 0.25, Math.min(nextEntry.startSeconds, Math.max(lastWordEnd, nextEntry.startSeconds)));
      // Clamp strictly to next line start when next line is after current start + 0.1s
      if (nextEntry.startSeconds > entry.startSeconds + 0.1) {
        endSeconds = nextEntry.startSeconds;
      }
    } else if (options.trackDurationSeconds && options.trackDurationSeconds > entry.startSeconds) {
      endSeconds = Math.min(options.trackDurationSeconds, Math.max(lastWordEnd, entry.startSeconds + 5.0));
    } else {
      endSeconds = Math.max(lastWordEnd, entry.startSeconds + 4.5);
    }

    while (breakPtr < breakBoundaries.length && breakBoundaries[breakPtr] <= entry.startSeconds + 0.05) {
      breakPtr++;
    }
    if (breakPtr < breakBoundaries.length) {
      const nextBreak = breakBoundaries[breakPtr];
      if (nextBreak < endSeconds) {
        endSeconds = Math.max(entry.startSeconds + 0.05, nextBreak);
      }
    }

    const clampedWords: LyricWord[] = [];
    if (entry.words.length > 0) {
      hasAnyWordTags = true;
      for (let w = 0; w < entry.words.length; w++) {
        const word = entry.words[w];
        const wStart = Math.min(endSeconds - 0.02, Math.max(entry.startSeconds, word.startSeconds));
        const nextWordStart =
          w + 1 < entry.words.length
            ? Math.min(endSeconds, Math.max(wStart + 0.02, entry.words[w + 1].startSeconds))
            : endSeconds;
        const wEnd = Math.max(wStart + 0.02, Math.min(endSeconds, nextWordStart));
        clampedWords.push({
          text: word.text,
          startSeconds: wStart,
          endSeconds: wEnd,
        });
      }
    }

    finalLines.push({
      startSeconds: entry.startSeconds,
      endSeconds,
      text: entry.text,
      words: clampedWords,
      isSynthesizedWords: false,
    });
  }

  return {
    providerName,
    sourceKind: hasAnyWordTags ? 'WordSynced' : 'LineSynced',
    lines: finalLines,
  };
}
