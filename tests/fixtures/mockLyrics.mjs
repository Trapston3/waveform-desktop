// tests/fixtures/mockLyrics.mjs
// Authoritative syllable-synced and line-synced lyrics models conforming to Survey 1 & 3

export const mockLyrics = {
  // Apple Music style syllable-synced TTML lyrics
  syllableSynced: {
    type: 'SYLLABLE_SYNCED',
    provider: 'AppleMusic',
    language: 'en',
    lines: [
      {
        lineIndex: 0,
        startTimeMs: 12000,
        endTimeMs: 15400,
        text: 'Waiting in a car',
        syllables: [
          { text: 'Wait-', startTimeMs: 12000, endTimeMs: 12500 },
          { text: 'ing ', startTimeMs: 12500, endTimeMs: 13100 },
          { text: 'in ', startTimeMs: 13100, endTimeMs: 13600 },
          { text: 'a ', startTimeMs: 13600, endTimeMs: 14100 },
          { text: 'car', startTimeMs: 14100, endTimeMs: 15400 },
        ],
      },
      {
        lineIndex: 1,
        startTimeMs: 15500,
        endTimeMs: 19800,
        text: 'Waiting for a ride in the dark',
        syllables: [
          { text: 'Wait-', startTimeMs: 15500, endTimeMs: 16100 },
          { text: 'ing ', startTimeMs: 16100, endTimeMs: 16700 },
          { text: 'for ', startTimeMs: 16700, endTimeMs: 17200 },
          { text: 'a ', startTimeMs: 17200, endTimeMs: 17600 },
          { text: 'ride ', startTimeMs: 17600, endTimeMs: 18400 },
          { text: 'in ', startTimeMs: 18400, endTimeMs: 18800 },
          { text: 'the ', startTimeMs: 18800, endTimeMs: 19100 },
          { text: 'dark', startTimeMs: 19100, endTimeMs: 19800 },
        ],
      },
      {
        lineIndex: 2,
        startTimeMs: 20000,
        endTimeMs: 24500,
        text: 'The city is my church',
        syllables: [
          { text: 'The ', startTimeMs: 20000, endTimeMs: 20500 },
          { text: 'ci-', startTimeMs: 20500, endTimeMs: 21100 },
          { text: 'ty ', startTimeMs: 21100, endTimeMs: 21800 },
          { text: 'is ', startTimeMs: 21800, endTimeMs: 22300 },
          { text: 'my ', startTimeMs: 22300, endTimeMs: 23100 },
          { text: 'church', startTimeMs: 23100, endTimeMs: 24500 },
        ],
      },
    ],
  },

  // Standard LRC line-synced lyrics
  lineSyncedLrc: `[00:12.00]Waiting in a car
[00:15.50]Waiting for a ride in the dark
[00:20.00]The city is my church
[00:24.60]It wraps me in the blinding twilight`,

  // RTL Hebrew / Arabic test case
  rtlLyrics: {
    type: 'LINE_SYNCED',
    provider: 'LrcLib',
    language: 'he',
    isRtl: true,
    lines: [
      { startTimeMs: 5000, endTimeMs: 9000, text: 'שלום עולם של מוזיקה' },
      { startTimeMs: 9100, endTimeMs: 14000, text: 'הלילה עוד צעיר' },
    ],
  },
};

/**
 * Parses raw LRC string into structured line array.
 */
export function parseLrc(lrcText) {
  const lines = [];
  const regex = /^\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/;
  const rawLines = lrcText.split('\n');

  for (const raw of rawLines) {
    const match = raw.trim().match(regex);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const frac = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      const startTimeMs = min * 60000 + sec * 1000 + frac;
      const text = match[4].trim();
      lines.push({ startTimeMs, text });
    }
  }

  // Calculate end times from subsequent line start times
  for (let i = 0; i < lines.length; i++) {
    lines[i].endTimeMs = i < lines.length - 1 ? lines[i + 1].startTimeMs : lines[i].startTimeMs + 5000;
  }
  return lines;
}

/**
 * Finds the currently active line and active syllable in syllable-synced lyrics.
 */
export function findActiveLyricElements(lyricsData, currentPosMs) {
  if (!lyricsData || !lyricsData.lines) {
    return { activeLine: null, activeSyllable: null, activeLineIndex: -1 };
  }

  let activeLine = null;
  let activeLineIndex = -1;
  let activeSyllable = null;

  for (let i = 0; i < lyricsData.lines.length; i++) {
    const line = lyricsData.lines[i];
    if (currentPosMs >= line.startTimeMs && currentPosMs <= line.endTimeMs) {
      activeLine = line;
      activeLineIndex = i;
      if (line.syllables) {
        for (const syl of line.syllables) {
          if (currentPosMs >= syl.startTimeMs && currentPosMs <= syl.endTimeMs) {
            activeSyllable = syl;
            break;
          }
        }
      }
      break;
    }
  }

  return { activeLine, activeSyllable, activeLineIndex };
}
