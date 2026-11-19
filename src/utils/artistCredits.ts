// src/utils/artistCredits.ts
// Splits singer / producer credit strings into individually clickable segments.

export interface CreditSegment {
  name: string;
  targetId: string;
  /** separator text that follows this credit (e.g. ", " or " & ") */
  separator: string;
}

const JOINERS =
  /\s*,\s*|\s*，\s*|\s+&\s+|\s+＆\s+|\s*•\s*|\s*·\s*|\s*・\s*|\s*、\s*|\s+(?:feat\.?|ft\.?|with|prod\.?\s*by|prod\.?)\s+/gi;

export function parseArtistCredits(
  artistStr?: string | null,
  artists?: { id: string | null; name: string }[],
  artistIds?: string[],
): CreditSegment[] {
  const str = (artistStr || '').trim();
  if (!str) return [];
  const out: CreditSegment[] = [];
  let last = 0;
  const pushName = (raw: string, separator: string) => {
    const name = raw.trim();
    if (!name) return;
    const match = artists?.find((a) => a.name?.trim().toLowerCase() === name.toLowerCase());
    out.push({ name, targetId: match?.id || '', separator });
  };
  let m: RegExpExecArray | null;
  const re = new RegExp(JOINERS.source, 'gi');
  while ((m = re.exec(str)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    pushName(str.slice(last, m.index), m[0]);
    last = m.index + m[0].length;
  }
  pushName(str.slice(last), '');
  const useIds = !!artistIds && artistIds.length === out.length;
  out.forEach((seg, i) => {
    if (!seg.targetId) seg.targetId = (useIds && artistIds![i]) || 'art_' + seg.name;
  });
  return out;
}

export function resolveArtistTarget(
  track: any,
  specificCredit?: { id?: string | null; name: string },
): string {
  if (specificCredit?.id) return specificCredit.id;
  if (specificCredit?.name) return 'art_' + specificCredit.name.trim();
  return (
    track?.artists?.[0]?.id ||
    track?.artistIds?.[0] ||
    track?.artistId ||
    track?.channelId ||
    parseArtistCredits(track?.artist, track?.artists, track?.artistIds)[0]?.targetId ||
    'art_Unknown Artist'
  );
}
