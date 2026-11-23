// Context-aware lyric semantics engine:
// - Phrase-first (15) + Concrete Noun (8-10) + Generic Verb (1-3) weighted emoji scorer
// - Full iOS 18+ Tapback library (35 reactions)
// - 15 Magic Word effect categories (+ legacy compatibility aliases)
// - Rich iOS Embed Card detection

import type { LyricLine } from '../core/models';

export const IOS18_TAPBACK_LIBRARY = [
  '❤️', '👍', '👎', '😂', '‼️', '❓', '🔥', '😭', '💀', '✨',
  '🥹', '🤯', '🫶', '👀', '💔', '🎵', '🥂', '🥀', '⚡', '🦋',
  '👑', '👻', '🌙', '☀️', '🌊', '🌧️', '✈️', '🛳️', '🚗', '🚀',
  '🏍️', '🚆', '🌹', '💎', '⏰',
] as const;

export type TapbackKind = (typeof IOS18_TAPBACK_LIBRARY)[number] | '♥' | '!!' | '?' | (string & {});

export type MagicWordKind =
  | 'rainbow'
  | 'sparkle'
  | 'shiny'
  | 'fire'
  | 'ice'
  | 'electric'
  | 'heartbeat'
  | 'broken'
  | 'glitch'
  | 'float'
  | 'fall'
  | 'spin'
  | 'neon'
  | 'whisper'
  | 'time'
  // Compatibility aliases preserved for existing contracts
  | 'love'
  | 'impact'
  | 'water'
  | 'ghost';

export type LyricEmbedCardKind =
  | 'maps'
  | 'voiceMemo'
  | 'missedCall'
  | 'linkPreview'
  | 'timeWeather';

export interface LyricEmbedCard {
  readonly kind: LyricEmbedCardKind;
  readonly title: string;
  readonly subtitle: string;
  readonly badge?: string;
  readonly domain?: string;
}

interface SemanticRule {
  readonly regex: RegExp;
  readonly emoji: string;
  readonly weight: number;
}

// Tier 1: Multi-word Phrases & Idioms (weight 15)
const PHRASE_RULES: readonly SemanticRule[] = [
  { regex: /\b(ride\s+a\s+cruise|on\s+a\s+cruise|cruise\s+ship)\b/i, emoji: '🛳️', weight: 15 },
  { regex: /\b(ride\s+(?:a|the)\s+waves?|riding\s+(?:a|the)\s+waves?|tidal\s+wave|ocean\s+wave)\b/i, emoji: '🌊', weight: 15 },
  { regex: /\b(ride\s+a\s+horse|wild\s+horses?|white\s+horse)\b/i, emoji: '🐎', weight: 15 },
  { regex: /\b(ride\s+a\s+bike|dirt\s+bike|motor\s*bike)\b/i, emoji: '🏍️', weight: 15 },
  { regex: /\b(ride\s+or\s+die|set\s+on\s+fire|watch\s+it\s+burn)\b/i, emoji: '🔥', weight: 15 },
  { regex: /\b(private\s+jet|paper\s+(?:air)?plane|flying\s+on\s+a\s+plane|first\s+class)\b/i, emoji: '✈️', weight: 15 },
  { regex: /\b(shooting\s+star|falling\s+star|wish\s+upon\s+a\s+star)\b/i, emoji: '🌠', weight: 15 },
  { regex: /\b(broken\s+heart|break\s+my\s+heart|broke\s+my\s+heart|heart\s*break|heart\s*ache|shattered\s+heart)\b/i, emoji: '💔', weight: 15 },
  { regex: /\b(late\s+night|3\s*am|after\s+midnight|all\s+night|full\s+moon|crescent\s+moon)\b/i, emoji: '🌙', weight: 15 },
  { regex: /\b(red\s+light|green\s+light|traffic\s+light|stop\s+light)\b/i, emoji: '🚦', weight: 15 },
  { regex: /\b(raise\s+a\s+glass|champagne\s+toast|pop\s+(?:the\s+)?champagne|cheers\s+to)\b/i, emoji: '🥂', weight: 15 },
  { regex: /\b(wilted\s+rose|dead\s+rose|withered\s+rose|dying\s+rose)\b/i, emoji: '🥀', weight: 15 },
  { regex: /\b(mind\s+blown|blow\s+my\s+mind|blew\s+my\s+mind)\b/i, emoji: '🤯', weight: 15 },
  { regex: /\b(tears\s+of\s+joy|laughing\s+so\s+hard|dying\s+laughing)\b/i, emoji: '😂', weight: 15 },
  { regex: /\b(holding\s+back\s+tears|tearing\s+up|almost\s+cried)\b/i, emoji: '🥹', weight: 15 },
  { regex: /\b(all\s+eyes|look\s+at\s+me|eyes\s+on)\b/i, emoji: '👀', weight: 15 },
  { regex: /\b(outer\s+space|blast\s+off|to\s+the\s+moon)\b/i, emoji: '🚀', weight: 15 },
  { regex: /\b(lightning\s+bolt|thunder\s*storm|electric\s+shock)\b/i, emoji: '⚡', weight: 15 },
  { regex: /\b(midnight\s+train|subway\s+train|bullet\s+train)\b/i, emoji: '🚆', weight: 15 },
  { regex: /\b(love\s+you|in\s+love|whole\s+heart)\b/i, emoji: '❤️', weight: 15 },
];

// Tier 2: High-Specificity Concrete Nouns (weights 8-10)
const CONCRETE_NOUN_RULES: readonly SemanticRule[] = [
  { regex: /\b(cruise|cruises|ship|ships|yacht|ferry|boat|boats|sail|sailing)\b/i, emoji: '🛳️', weight: 10 },
  { regex: /\b(plane|planes|airplane|airplanes|jet|jets|flight|flights|airport|runway)\b/i, emoji: '✈️', weight: 10 },
  { regex: /\b(horse|horses|stallion|mustang|saddle)\b/i, emoji: '🐎', weight: 10 },
  { regex: /\b(motorcycle|motorcycles|motorbike|chopper|bike|bikes|harley)\b/i, emoji: '🏍️', weight: 10 },
  { regex: /\b(train|trains|subway|metro|rail|railroad|station)\b/i, emoji: '🚆', weight: 9 },
  { regex: /\b(rocket|rockets|spaceship|orbit|galaxy|astronaut)\b/i, emoji: '🚀', weight: 9 },
  { regex: /\b(car|cars|sedan|coupe|highway|freeway|lamborghini|ferrari|porsche|convertible)\b/i, emoji: '🚗', weight: 9 },
  { regex: /\b(champagne|toast|prosecco|cheers|cocktail|martini)\b/i, emoji: '🥂', weight: 9 },
  { regex: /\b(diamond|diamonds|crystal|emerald|sapphire|jewel|bling)\b/i, emoji: '💎', weight: 9 },
  { regex: /\b(butterfly|butterflies)\b/i, emoji: '🦋', weight: 9 },
  { regex: /\b(crown|king|queen|royal|royalty|throne|tiara)\b/i, emoji: '👑', weight: 9 },
  { regex: /\b(ghost|ghosts|phantom|haunt|haunted|haunting)\b/i, emoji: '👻', weight: 9 },
  { regex: /\b(unicorn|unicorns)\b/i, emoji: '🦄', weight: 10 },
  { regex: /\b(rainbow|rainbows|prism|spectrum)\b/i, emoji: '🌈', weight: 9 },
  { regex: /\b(rose|roses|flower|flowers|bloom|petal|petals)\b/i, emoji: '🌹', weight: 9 },
  { regex: /\b(wave|waves|ocean|oceans|sea|tsunami|surf|beach|tide)\b/i, emoji: '🌊', weight: 9 },
  { regex: /\b(rain|raining|raindrop|raindrops|storm|drizzle|downpour|showers)\b/i, emoji: '🌧️', weight: 9 },
  { regex: /\b(lightning|thunder|electric|electricity|volt|voltage)\b/i, emoji: '⚡', weight: 9 },
  { regex: /\b(skull|skulls|skeleton|grave)\b/i, emoji: '💀', weight: 9 },
  { regex: /\b(heartbreak|heartache)\b/i, emoji: '💔', weight: 10 },
  { regex: /\b(moon|moonlight|midnight|lunar)\b/i, emoji: '🌙', weight: 8 },
  { regex: /\b(sun|sunlight|sunshine|sunrise|sunset|daylight)\b/i, emoji: '☀️', weight: 8 },
  { regex: /\b(clock|alarm|ticking|curfew)\b/i, emoji: '⏰', weight: 8 },
  { regex: /\b(music|song|songs|radio|melody|tune|guitar|piano|vinyl)\b/i, emoji: '🎵', weight: 8 },
  { regex: /\b(fire|fires|flame|flames|blaze|inferno|wildfire)\b/i, emoji: '🔥', weight: 8 },
  { regex: /\b(phone|facetime|voicemail|dial)\b/i, emoji: '📱', weight: 8 },
  { regex: /\b(money|cash|dollar|dollars|rich|bills)\b/i, emoji: '💸', weight: 8 },
  { regex: /\b(home|house|harbor|harbour)\b/i, emoji: '🏠', weight: 8 },
  { regex: /\b(space)\b/i, emoji: '🚀', weight: 8 },
];

// Tier 3: Low-Specificity Generic Verbs & Modifiers (weights 1-3)
const GENERIC_VERB_RULES: readonly SemanticRule[] = [
  { regex: /\b(ride|riding|drive|driving)\b/i, emoji: '🚗', weight: 2 },
  { regex: /\b(fly|flying)\b/i, emoji: '✈️', weight: 2 },
  { regex: /\b(burn|burning|hot|heat)\b/i, emoji: '🔥', weight: 2 },
  { regex: /\b(cry|crying|tears|tear|sob|weeping)\b/i, emoji: '😭', weight: 3 },
  { regex: /\b(dead|dying|death)\b/i, emoji: '💀', weight: 2 },
  { regex: /\b(broken|shattered|hurt|pain)\b/i, emoji: '💔', weight: 3 },
  { regex: /\b(love|loving|kiss|kisses|heart|hearts|darling|baby)\b/i, emoji: '❤️', weight: 2 },
  { regex: /\b(laugh|laughing|haha|funny|smile|joy)\b/i, emoji: '😂', weight: 2 },
  { regex: /\b(sparkle|sparkles|magic|magical|glitter|shine|shining|star|stars|glow)\b/i, emoji: '✨', weight: 2 },
  { regex: /\b(look|eyes|watching|stare|see)\b/i, emoji: '👀', weight: 2 },
  { regex: /\b(time|hour|hours|minute|late)\b/i, emoji: '⏰', weight: 2 },
  { regex: /\b(call|calling|ring|ringing)\b/i, emoji: '📱', weight: 2 },
  { regex: /\b(hug|hold|together|forever|care)\b/i, emoji: '🫶', weight: 2 },
  { regex: /\b(yes|yeah|good|great|okay|ready)\b/i, emoji: '👍', weight: 1 },
  { regex: /\b(no|nah|bad|wrong|never)\b/i, emoji: '👎', weight: 1 },
];

const ALL_SEMANTIC_RULES: readonly SemanticRule[] = [
  ...PHRASE_RULES,
  ...CONCRETE_NOUN_RULES,
  ...GENERIC_VERB_RULES,
];

export interface EmojiScoreResult {
  readonly emoji: string;
  readonly score: number;
}

export function scoreContextualEmojis(text: string): EmojiScoreResult[] {
  if (!text || typeof text !== 'string') return [];
  const cleaned = text.trim();
  if (!cleaned) return [];

  const totals = new Map<string, number>();
  for (let i = 0; i < ALL_SEMANTIC_RULES.length; i++) {
    const rule = ALL_SEMANTIC_RULES[i];
    if (rule.regex.test(cleaned)) {
      totals.set(rule.emoji, (totals.get(rule.emoji) ?? 0) + rule.weight);
    }
  }

  const out: EmojiScoreResult[] = [];
  for (const [emoji, score] of totals.entries()) {
    out.push({ emoji, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export function resolveContextualEmoji(text: string, seed = 0): string | null {
  const scored = scoreContextualEmojis(text);
  if (scored.length === 0) return null;
  const maxScore = scored[0].score;
  let tiedCount = 1;
  while (tiedCount < scored.length && scored[tiedCount].score === maxScore) {
    tiedCount++;
  }
  if (tiedCount === 1) return scored[0].emoji;
  const idx = Math.abs(Math.trunc(Number.isFinite(seed) ? seed : 0)) % tiedCount;
  return scored[idx].emoji;
}

// ---------------------------------------------------------------------------
// 15 Magic Word Categories (+ legacy compatibility aliases)
// ---------------------------------------------------------------------------

const MAGIC_WORD_MAP: Readonly<Record<string, MagicWordKind>> = {
  // 1. rainbow
  rainbow: 'rainbow', rainbows: 'rainbow', unicorn: 'rainbow', unicorns: 'rainbow',
  color: 'rainbow', colors: 'rainbow', colour: 'rainbow', colours: 'rainbow',
  prism: 'rainbow', spectrum: 'rainbow',
  // 2. sparkle
  sparkle: 'sparkle', sparkles: 'sparkle', sparkling: 'sparkle', star: 'sparkle',
  stars: 'sparkle', starlight: 'sparkle', magic: 'sparkle', magical: 'sparkle',
  glitter: 'sparkle', twinkle: 'sparkle', fairy: 'sparkle',
  // 3. shiny
  shiny: 'shiny', shine: 'shiny', shining: 'shiny', gleam: 'shiny',
  gold: 'shiny', golden: 'shiny', diamond: 'shiny', diamonds: 'shiny',
  glow: 'shiny', glowing: 'shiny', bright: 'shiny', sun: 'shiny',
  sunlight: 'shiny', light: 'shiny', crown: 'shiny', royal: 'shiny',
  // 4. fire
  fire: 'fire', fires: 'fire', burn: 'fire', burning: 'fire',
  burned: 'fire', flame: 'fire', flames: 'fire', hot: 'fire',
  heat: 'fire', blaze: 'fire', inferno: 'fire', wildfire: 'fire',
  // 5. ice
  ice: 'ice', icy: 'ice', cold: 'ice', freeze: 'ice',
  freezing: 'ice', frozen: 'ice', snow: 'ice', snowing: 'ice',
  winter: 'ice', chill: 'ice', frost: 'ice',
  // 6. electric
  electric: 'electric', electricity: 'electric', lightning: 'electric', thunder: 'electric',
  volt: 'electric', voltage: 'electric', shock: 'electric', zap: 'electric',
  wire: 'electric', sparks: 'electric',
  // 7. heartbeat (+ legacy 'love' for 'heart')
  heartbeat: 'heartbeat', pulse: 'heartbeat', pulsing: 'heartbeat', throb: 'heartbeat',
  beating: 'heartbeat', chest: 'heartbeat', alive: 'heartbeat', breath: 'heartbeat',
  breathe: 'heartbeat', breathing: 'heartbeat',
  love: 'love', loving: 'love', loved: 'love', heart: 'love',
  hearts: 'love', kiss: 'love', kisses: 'love', darling: 'love', baby: 'love',
  // 8. broken
  broken: 'broken', shatter: 'broken', shattered: 'broken', crack: 'broken',
  cracked: 'broken', split: 'broken', torn: 'broken', apart: 'broken',
  heartbreak: 'broken', fracture: 'broken',
  // 9. glitch (+ legacy 'impact' for 'boom')
  glitch: 'glitch', glitching: 'glitch', static: 'glitch', error: 'glitch',
  corrupt: 'glitch', virus: 'glitch', distort: 'glitch', distortion: 'glitch',
  boom: 'impact', crash: 'impact', shake: 'impact', shaking: 'impact',
  scream: 'impact', screaming: 'impact', crazy: 'impact', wild: 'impact',
  loud: 'impact', run: 'impact', running: 'impact',
  // 10. float (+ legacy 'water' for 'ocean')
  float: 'float', floating: 'float', drift: 'float', drifting: 'float',
  fly: 'float', flying: 'float', cloud: 'float', clouds: 'float',
  heaven: 'float', sky: 'float', wings: 'float', soar: 'float', levitate: 'float',
  ocean: 'water', wave: 'water', waves: 'water', water: 'water',
  waters: 'water', rain: 'water', raining: 'water', tears: 'water',
  tear: 'water', cry: 'water', crying: 'water', swim: 'water', swimming: 'water',
  // 11. fall
  fall: 'fall', falling: 'fall', fell: 'fall', drop: 'fall',
  dropping: 'fall', sink: 'fall', sinking: 'fall', down: 'fall',
  collapse: 'fall', gravity: 'fall',
  // 12. spin
  spin: 'spin', spinning: 'spin', dizzy: 'spin', around: 'spin',
  carousel: 'spin', orbit: 'spin', whirl: 'spin', spiral: 'spin',
  twist: 'spin', turn: 'spin', turning: 'spin',
  // 13. neon
  neon: 'neon', laser: 'neon', lasers: 'neon', club: 'neon',
  disco: 'neon', strobe: 'neon', flash: 'neon', flashing: 'neon',
  cyber: 'neon', ultraviolet: 'neon',
  // 14. whisper (+ legacy 'ghost' for 'shadow')
  whisper: 'whisper', whispers: 'whisper', whispering: 'whisper', hush: 'whisper',
  quiet: 'whisper', quietly: 'whisper', silent: 'whisper', silence: 'whisper',
  secret: 'whisper', secrets: 'whisper', softly: 'whisper', murmur: 'whisper',
  ghost: 'ghost', ghosts: 'ghost', fade: 'ghost', fading: 'ghost',
  faded: 'ghost', shadow: 'ghost', shadows: 'ghost', disappear: 'ghost', alone: 'ghost',
  // 15. time
  time: 'time', clock: 'time', midnight: 'time', forever: 'time',
  tick: 'time', ticking: 'time', wait: 'time', waiting: 'time',
  second: 'time', seconds: 'time', hour: 'time', hours: 'time',
  minute: 'time', minutes: 'time', moment: 'time', eternity: 'time',
};

export function detectMagicWordEffect(word: string): MagicWordKind | null {
  if (!word || typeof word !== 'string') return null;
  const cleaned = word.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');
  if (!cleaned) return null;
  const direct = MAGIC_WORD_MAP[cleaned];
  if (direct) return direct;
  const plain = cleaned.replace(/[^a-z]/g, '');
  return plain ? (MAGIC_WORD_MAP[plain] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Smart iOS 18+ Tapback Selector
// ---------------------------------------------------------------------------

export function chooseSmartTapback(
  line: LyricLine | string,
  idx: number,
  side: 'left' | 'right',
  seed: number
): TapbackKind | null {
  const t = (typeof line === 'string' ? line : line.text).trim();
  if (!t) return null;

  if (t.endsWith('?')) return '?';
  if (t.endsWith('!') || /\b(boom|crash|scream|loud|wild)\b/i.test(t)) return '‼️';
  if (/\b(broken\s+heart|heartbreak|heartache|shattered)\b/i.test(t)) return '💔';
  if (/\b(cry|crying|tears|sob|weeping)\b/i.test(t)) return '😭';
  if (/\b(mind\s+blown|crazy|insane|unbelievable)\b/i.test(t)) return '🤯';
  if (/\b(fire|burn|burning|flames|blaze)\b/i.test(t)) return '🔥';
  if (/\b(skull|dead|dying|kill)\b/i.test(t)) return '💀';
  if (/\b(tearing\s+up|holding\s+back\s+tears|so\s+proud)\b/i.test(t)) return '🥹';
  if (/\b(laugh|smile|haha|funny|joy|happy)\b/i.test(t)) return '😂';
  if (/\b(electric|lightning|thunder|volt|shock)\b/i.test(t)) return '⚡';
  if (/\b(watch|eyes|looking|stare)\b/i.test(t)) return '👀';
  if (/\b(hold|hug|forever|together|care)\b/i.test(t)) return '🫶';
  if (/\b(love|heart|starlight|dream|kiss|darling|baby)\b/i.test(t)) return '❤️';
  if (/\b(no|nah|wrong|hate|worst)\b/i.test(t)) return '👎';
  if (/\b(yes|yeah|good|great|ready|steady|guide|right|true)\b/i.test(t)) return '👍';

  const contextual = resolveContextualEmoji(t, seed + idx * 13);
  if (contextual && (IOS18_TAPBACK_LIBRARY as readonly string[]).includes(contextual)) {
    return contextual;
  }

  if (side === 'left' && idx % 4 === 2) {
    const cycle: readonly TapbackKind[] = ['❤️', '👍', '😂', '✨', '🔥', '🥹', '🫶'];
    return cycle[(idx + seed) % cycle.length];
  }
  if (side === 'right' && idx % 5 === 3) {
    const cycle: readonly TapbackKind[] = ['❤️', '👍', '✨', '👀'];
    return cycle[(idx + seed) % cycle.length];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rich iOS Embed Card Detector
// ---------------------------------------------------------------------------

const MAPS_PLACE_REGEX =
  /\b(home|highway|bridge|ocean|hotel|new york|tokyo|la|l\.a\.|los angeles|downtown|street|city|harbor|harbour|road|avenue|boulevard|airport|station|beach|coast|bay|paris|london)\b/i;

const MISSED_CALL_REGEX = /\b(call me|phone|missed|facetime|dial|ring)\b/i;
const VOICE_MEMO_REGEX = /\b(voicemail|song|radio|listen|voice|audio|melody|record)\b/i;
const LINK_PHOTO_REGEX = /\b(link|website|picture|photo|polaroid|camera|snapshot|url)\b/i;
const TIME_WEATHER_REGEX = /\b(midnight|3\s*am|rain|summer|winter|storm|snow|morning|sunset|sunrise)\b/i;

function extractMatchedTitle(text: string, regex: RegExp, fallback: string): string {
  const match = regex.exec(text);
  if (!match || !match[1]) return fallback;
  const raw = match[1].trim();
  return raw
    .split(/\s+/)
    .map((part) => (part.length <= 2 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1).toLowerCase()))
    .join(' ');
}

export function detectLyricEmbedCard(text: string): LyricEmbedCard | null {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text.trim();
  if (!cleaned) return null;

  if (MAPS_PLACE_REGEX.test(cleaned)) {
    const place = extractMatchedTitle(cleaned, MAPS_PLACE_REGEX, 'Marked Location');
    return {
      kind: 'maps',
      title: place,
      subtitle: 'Marked Location · 0.8 mi',
      badge: 'MAPS',
    };
  }

  if (MISSED_CALL_REGEX.test(cleaned)) {
    const isFaceTime = /\bfacetime\b/i.test(cleaned);
    return {
      kind: 'missedCall',
      title: isFaceTime ? 'Missed FaceTime Audio' : 'Missed Audio Call',
      subtitle: 'Tap to call back',
      badge: 'MISSED',
    };
  }

  if (VOICE_MEMO_REGEX.test(cleaned)) {
    const label = extractMatchedTitle(cleaned, VOICE_MEMO_REGEX, 'Voice Memo');
    return {
      kind: 'voiceMemo',
      title: `${label} · Audio Clip`,
      subtitle: '0:18',
      badge: 'AUDIO',
    };
  }

  if (LINK_PHOTO_REGEX.test(cleaned)) {
    const isPhoto = /\b(picture|photo|polaroid|camera|snapshot)\b/i.test(cleaned);
    return {
      kind: 'linkPreview',
      title: isPhoto ? 'Shared Memory Attachment' : 'Shared Link Preview',
      subtitle: cleaned.length > 42 ? `${cleaned.slice(0, 39)}...` : cleaned,
      domain: isPhoto ? 'photos.local' : 'waveform.audio',
      badge: isPhoto ? 'PHOTO' : 'LINK',
    };
  }

  if (TIME_WEATHER_REGEX.test(cleaned)) {
    const term = extractMatchedTitle(cleaned, TIME_WEATHER_REGEX, 'Tonight');
    return {
      kind: 'timeWeather',
      title: term,
      subtitle: /\b(rain|storm|snow)\b/i.test(cleaned) ? '62° · Showers' : 'Clear Night',
      badge: 'LIVE',
    };
  }

  return null;
}
