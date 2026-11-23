import type { LyricLine, Lyrics, LyricsSourceKind, LyricWord } from './models';
import { mapRomanizedWords } from '../../utils/transliterate';

const VOWEL_CLUSTER_REGEX = /[aeiouy\u00C0-\u024F]+/gi;
const STRONG_PUNCT_REGEX = /[.!?;:]$/;
const SOFT_PUNCT_REGEX = /[,-\u2014\u2013]$/;

export function estimateWordWeight(word: string): number {
  const cleaned = word.trim();
  if (!cleaned) return 0.5;

  const vowelMatches = cleaned.match(VOWEL_CLUSTER_REGEX);
  const syllableCount = Math.max(1, vowelMatches ? vowelMatches.length : 1);
  const charFactor = Math.max(0.4, cleaned.length * 0.14);

  let punctPause = 0;
  if (STRONG_PUNCT_REGEX.test(cleaned)) {
    punctPause = 0.85;
  } else if (SOFT_PUNCT_REGEX.test(cleaned)) {
    punctPause = 0.45;
  }

  return syllableCount * 0.75 + charFactor + punctPause;
}

export function synthesizeWordsForLine(line: LyricLine): LyricLine {
  if (line.words.length > 0 && !line.isSynthesizedWords) {
    return line;
  }

  const tokens = line.text
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (tokens.length === 0) {
    return {
      ...line,
      words: [],
      isSynthesizedWords: true,
    };
  }

  const lineStart = line.startSeconds;
  const lineEnd = Math.max(lineStart + 0.05, line.endSeconds);
  const totalDuration = lineEnd - lineStart;

  const weights = tokens.map(estimateWordWeight);
  const totalWeight = weights.reduce((acc, w) => acc + w, 0) || tokens.length;

  const words: LyricWord[] = [];
  let cursor = lineStart;

  for (let i = 0; i < tokens.length; i++) {
    const isLast = i === tokens.length - 1;
    const slice = isLast ? lineEnd - cursor : (weights[i] / totalWeight) * totalDuration;
    const wordEnd = isLast ? lineEnd : Math.min(lineEnd, Math.max(cursor + 0.001, cursor + slice));

    words.push({
      text: tokens[i],
      startSeconds: cursor,
      endSeconds: wordEnd,
    });

    cursor = wordEnd;
  }

  const romanizedWords =
    line.romanizedWords && line.romanizedWords.length > 0
      ? line.romanizedWords
      : line.romanizedText
      ? mapRomanizedWords(words, line.romanizedText, lineStart, lineEnd)
      : undefined;

  return {
    ...line,
    startSeconds: lineStart,
    endSeconds: lineEnd,
    text: line.text,
    words,
    isSynthesizedWords: true,
    ...(romanizedWords !== undefined ? { romanizedWords } : {}),
  };
}

export function synthesizeLyricsWords(
  lyrics: Lyrics,
  options: { readonly sourceKind?: LyricsSourceKind } = {},
): Lyrics {
  let didSynthesize = false;
  const lines: LyricLine[] = lyrics.lines.map((line) => {
    if (line.words.length > 0 && !line.isSynthesizedWords) {
      return line;
    }
    didSynthesize = true;
    return synthesizeWordsForLine(line);
  });

  if (!didSynthesize) {
    return lyrics;
  }

  const resolvedSourceKind: LyricsSourceKind =
    options.sourceKind ??
    (lyrics.sourceKind === 'WordSynced' ? 'WordSynced' : 'FallbackSynthesis');

  return {
    ...lyrics,
    sourceKind: resolvedSourceKind,
    lines,
  };
}
