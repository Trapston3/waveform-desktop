// src/services/TrackMatcher.ts
// Reverse-engineered song matching and candidate scoring algorithm
// Ported from WaveForm Android (TrackMatcher.kt / InnertubeParser.kt)

export interface MatchTarget {
  title: string;
  artist: string;
  durationSec?: number | null;
  album?: string | null;
  isExplicit?: boolean | null;
  isVideo?: boolean;
}

export interface MatchCandidate {
  id?: string;
  videoId?: string;
  title: string;
  artist: string;
  channelTitle?: string;
  durationSec?: number | null;
  durationText?: string | null;
  album?: string | null;
  isExplicit?: boolean | null;
  musicVideoType?: string | null;
}

export interface TitleParts {
  words: string[];
  core: string;
  versions: Set<string>;
  context: Set<string>;
}

export class TrackMatcher {
  public static readonly VERSION_WORDS = new Set([
    'remix', 'remixes', 'rmx', 'refix', 'flip', 'bootleg', 'mashup', 'medley',
    'live', 'concert', 'unplugged', 'acoustic', 'instrumental', 'karaoke',
    'vocals', 'vocal', 'acapella', 'acappella', 'backing', 'stems', 'stem',
    'cover', 'demo', 'reprise', 'remake', 'rework', 'extended', 'edit',
    'version', 'mix', 'dub', 'vip', 'session', 'sessions',
    'sped', 'slowed', 'reverb', 'nightcore', 'lofi', 'orchestral', 'symphonic',
    '8d', 'bass boosted', 'bassboosted', 'boosted', 'bass', 'tribute', 'part', 'pt', 'chapter',
    // Non-Latin takes
    'カバー', 'カラオケ', 'リミックス', 'ライブ', 'アコースティック',
    'インスト', 'バージョン', '歌ってみた', '踊ってみた', '弾いてみた',
    '翻唱', '现场', '混音', '커버', '라이브', '리믹스',
  ]);

  public static readonly TRAILING_TAKES = new Set([
    'instrumental', 'karaoke', 'acapella', 'acappella', 'remix', 'rmx', 'nightcore',
    'cover', 'live', 'mashup', 'slowed', 'reverb', 'acoustic', 'tribute', 'lofi',
    'edit', 'mix', 'session', 'sessions', 'concert', 'unplugged', 'vocals', 'stems',
    'reprise', 'remake', 'rework', 'extended', 'dub', 'vip', 'sped', 'orchestral',
    'symphonic', 'bootleg', 'medley', 'flip', 'refix', 'boosted', 'bass',
  ]);

  public static readonly NEUTRAL_SEGMENTS = new Set([
    'albumversion', 'originalversion', 'originalmix', 'singleversion',
    'radioversion', 'radioedit', 'stereoversion', 'monoversion',
    'studioversion', 'fullversion', 'standardversion', 'explicitversion',
    'deluxeversion', 'originaltrack',
  ]);

  public static readonly TRAILING_NOISE = new Set([
    'song', 'songs', 'video', 'audio', 'lyrics', 'lyric', 'lyrical',
    'official', 'full', 'hd', 'hq', '4k', 'mp3', 'ost', 'soundtrack',
  ]);

  public static readonly NOISE_WORDS = new Set([
    'official', 'video', 'audio', 'lyrics', 'lyric', 'lyrical', 'visualizer',
    'song', 'songs', 'full', 'music', 'the', 'and', 'from', 'feat', 'ft',
    'featuring', 'with', 'new', 'latest', 'free', 'download', 'remaster',
    'remastered', 'explicit', 'clean', 'bonus', 'track', 'deluxe', 'original',
    'album', 'single', 'hd', 'hq', '4k', 'mp3',
  ]);

  public static parseSeconds(duration: string | number | null | undefined): number | null {
    if (typeof duration === 'number') return duration > 0 ? Math.round(duration) : null;
    if (!duration || typeof duration !== 'string') return null;
    const parts = duration.trim().split(':').map((p) => parseInt(p, 10));
    if (parts.some((n) => Number.isNaN(n))) return null;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return null;
  }

  public static normalize(text: string): string {
    return (text || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[「『【〈《〔［｛]/g, '(')
      .replace(/[」』】〉》〕］｝]/g, ')');
  }

  public static parseTitle(raw: string, artist = ''): TitleParts {
    const versions = new Set<string>();
    const context = new Set<string>();
    let text = this.normalize(raw);

    // Portuguese feat format: part.
    text = text.replace(/\bpart\.\s+(?!(?:\d|[ivx]+\b))[^)\]]*[)\]]?/gi, ' ');

    // Bracketed asides (up to 3 passes)
    const bracketRegex = /[\(\[]([^\(\)\[\]]*)[\)\]]/g;
    for (let pass = 0; pass < 3; pass++) {
      if (!bracketRegex.test(text)) break;
      text = text.replace(bracketRegex, (_, segment) => {
        this.classify(segment, versions, context);
        return ' ';
      });
    }

    // Unbalanced brackets
    const openIdx = text.search(/[\(\[]/);
    if (openIdx >= 0) {
      this.classify(text.substring(openIdx), versions, context);
      text = text.substring(0, openIdx);
    }

    // Dashes & pipes
    const dashMatch = text.match(/\s+[-–—|]+\s+/);
    if (dashMatch && dashMatch.index !== undefined) {
      const head = text.substring(0, dashMatch.index).trim();
      const tail = text.substring(dashMatch.index + dashMatch[0].length).trim();
      if (this.isArtistName(head, artist)) {
        this.classify(head, versions, context);
        text = tail;
      } else {
        this.classify(tail, versions, context);
        text = head;
      }
    }

    // Featuring
    text = text.replace(/\b(feat|ft|featuring|with)\b.*/gi, ' ');

    const containsCJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/.test(text);

    let words = text
      .split(/[\s.·~〜]+/)
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter((w) => w.length > 0 && w !== 'and');

    while (words.length > 1) {
      const last = words[words.length - 1];
      if (this.TRAILING_NOISE.has(last)) {
        words.pop();
      } else if (this.TRAILING_TAKES.has(last)) {
        versions.add(last);
        words.pop();
      } else {
        break;
      }
    }

    const core = containsCJK
      ? text.replace(/[\s\p{P}・～〜ー-]+/gu, '')
      : words.join('');

    return { words, core, versions, context };
  }

  private static classify(segment: string, versions: Set<string>, context: Set<string>): void {
    const words = segment
      .split(/[\s.·~〜]+/)
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter((w) => w.length > 0);
    if (words.length === 0) return;

    const merged = words.join('');
    if (this.NEUTRAL_SEGMENTS.has(merged)) return;

    let hasVersion = false;
    if (this.VERSION_WORDS.has(merged)) {
      versions.add(merged);
      hasVersion = true;
    }
    for (const w of words) {
      if (this.VERSION_WORDS.has(w)) {
        versions.add(w);
        hasVersion = true;
      }
    }
    if (hasVersion) return;

    for (const w of words) {
      if (w.length > 2 && !this.NOISE_WORDS.has(w)) {
        context.add(w);
      }
    }
  }

  private static isArtistName(text: string, artist: string): boolean {
    if (!artist) return false;
    const normArtist = this.normalize(artist);
    return normArtist.includes(this.normalize(text));
  }

  public static artistNames(value: string): Set<string> {
    const norm = this.normalize(value);
    const parts = norm.split(/\s*(?:[,&/;·|、，×]|\band\b|\bx\b|\bvs\.?\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b)\s*/g);
    const result = new Set<string>();
    for (const p of parts) {
      const cleaned = p.replace(/[^\p{L}\p{N}\s]/gu, '').trim();
      if (cleaned.length > 1) result.add(cleaned);
    }
    return result;
  }

  public static sharesArtist(wanted: string, got: string): boolean {
    const want = this.artistNames(wanted);
    const have = this.artistNames(got);
    if (want.size === 0 || have.size === 0) return false;
    for (const w of want) {
      for (const h of have) {
        if (w === h || w.includes(h) || h.includes(w)) return true;
      }
    }
    return false;
  }

  public static score(candidate: MatchCandidate, target: MatchTarget): number | null {
    const wanted = this.parseTitle(target.title, target.artist);
    const got = this.parseTitle(candidate.title, candidate.artist);

    if (!wanted.core || !got.core) return null;

    // 1. Title Core Match
    const isExactTitle = wanted.core === got.core;
    const isContainmentTitle =
      wanted.core.length > 3 &&
      got.core.length > 3 &&
      (wanted.core.includes(got.core) || got.core.includes(wanted.core));

    if (!isExactTitle && !isContainmentTitle) return null;

    // 2. Strict Version Check: unwanted version keywords -> REJECT
    // If target has no version markers, candidate MUST NOT have any version markers
    const wantedVersions = Array.from(wanted.versions).sort().join(',');
    const gotVersions = Array.from(got.versions).sort().join(',');
    if (wantedVersions !== gotVersions) {
      return null; // Strict rejection of remix, slowed, live, acoustic, cover, etc.
    }

    // 3. Duration Proximity Check
    const wantedSec = target.durationSec ?? null;
    const gotSec = candidate.durationSec ?? this.parseSeconds(candidate.durationText);
    let durationPoints = 0;
    if (wantedSec !== null && gotSec !== null) {
      const drift = Math.abs(wantedSec - gotSec);
      if (drift > 30) {
        return null; // Severe duration mismatch
      }
      if (drift <= 5) {
        durationPoints = 40; // High tight duration bonus
      } else if (drift <= 15) {
        durationPoints = 20;
      } else {
        durationPoints = 5;
      }
    }

    // 4. Artist Score
    let artistPoints = 0;
    const shared = this.sharesArtist(target.artist, candidate.artist);
    if (shared) {
      artistPoints = this.normalize(target.artist) === this.normalize(candidate.artist) ? 25 : 10;
    } else {
      // Disagreed artist: only permitted if duration matches tightly within 2s
      if (wantedSec !== null && gotSec !== null && Math.abs(wantedSec - gotSec) <= 2) {
        artistPoints = -30;
      } else {
        return null;
      }
    }

    // 5. Official Channel & ATV Bonus
    let officialBonus = 0;
    const channelLower = (candidate.channelTitle || '').toLowerCase();
    if (
      channelLower.endsWith('- topic') ||
      channelLower.endsWith('vevo') ||
      candidate.musicVideoType === 'MUSIC_VIDEO_TYPE_ATV'
    ) {
      officialBonus += 30; // Strongly prioritize official artist topic channels
    }

    const baseScore = 100;
    return baseScore + artistPoints + durationPoints + officialBonus;
  }

  public static rankCandidates(candidates: MatchCandidate[], target: MatchTarget): MatchCandidate[] {
    return candidates
      .map((c) => ({ candidate: c, score: this.score(c, target) }))
      .filter((entry): entry is { candidate: MatchCandidate; score: number } => entry.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.candidate);
  }
}
