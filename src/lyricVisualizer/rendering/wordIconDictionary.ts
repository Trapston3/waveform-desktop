// src/lyricVisualizer/rendering/wordIconDictionary.ts
// Zero-allocation SF-Symbol-inspired monochrome geometric vector icon dictionary
// for Canvas2D kinetic lyric visualizers (120+ keyword & phrase mappings).

export type WordIconId =
  | 'hourglass'
  | 'clock'
  | 'heart'
  | 'brokenHeart'
  | 'fire'
  | 'moon'
  | 'sun'
  | 'rain'
  | 'star'
  | 'plane'
  | 'car'
  | 'money'
  | 'home'
  | 'phone'
  | 'music'
  | 'eye'
  | 'ghost'
  | 'crown'
  | 'skull'
  | 'lightning'
  | 'wave'
  | 'rose'
  | 'key'
  | 'lock'
  | 'world'
  | 'wings'
  | 'diamond'
  | 'rocket'
  | 'train'
  | 'bike'
  | 'ship'
  | 'glass'
  | 'butterfly'
  | 'mic'
  | 'headphones'
  | 'compass'
  | 'pin'
  | 'cloud'
  | 'snowflake'
  | 'camera'
  | 'book'
  | 'bell'
  | 'trophy'
  | 'shield'
  | 'infinity'
  | 'sparkle';

const PHRASE_ICON_RULES: readonly { readonly re: RegExp; readonly id: WordIconId }[] = [
  { re: /\b(broken\s+heart|heart\s*break|heart\s*ache)\b/i, id: 'brokenHeart' },
  { re: /\b(wait\s+a\s+(?:sec|second|minute)|one\s+minute|another\s+minute)\b/i, id: 'clock' },
  { re: /\b(running\s+out\s+of\s+time|out\s+of\s+time|pass(?:ing)?\s+time)\b/i, id: 'hourglass' },
  { re: /\b(late\s+night|after\s+midnight|full\s+moon|3\s*am)\b/i, id: 'moon' },
  { re: /\b(private\s+jet|paper\s+plane|first\s+class)\b/i, id: 'plane' },
  { re: /\b(raise\s+a\s+glass|champagne\s+toast|cheers\s+to)\b/i, id: 'glass' },
  { re: /\b(outer\s+space|blast\s+off)\b/i, id: 'rocket' },
  { re: /\b(midnight\s+train|subway\s+train)\b/i, id: 'train' },
  { re: /\b(shooting\s+star|falling\s+star)\b/i, id: 'star' },
];

const WORD_ICON_ENTRIES: readonly [string, WordIconId][] = [
  // Hourglass / waiting / patience (5)
  ['wait', 'hourglass'], ['waiting', 'hourglass'], ['waited', 'hourglass'], ['patience', 'hourglass'], ['sand', 'hourglass'],
  // Clock / minutes / time (9)
  ['time', 'clock'], ['minute', 'clock'], ['minutes', 'clock'], ['hour', 'clock'], ['hours', 'clock'],
  ['clock', 'clock'], ['second', 'clock'], ['alarm', 'clock'], ['tonight', 'clock'],
  // Heart / love (8)
  ['heart', 'heart'], ['hearts', 'heart'], ['love', 'heart'], ['loved', 'heart'],
  ['loving', 'heart'], ['lover', 'heart'], ['kiss', 'heart'], ['forever', 'heart'],
  // Broken heart (5)
  ['broken', 'brokenHeart'], ['break', 'brokenHeart'], ['broke', 'brokenHeart'],
  ['heartbreak', 'brokenHeart'], ['shattered', 'brokenHeart'],
  // Fire / heat (7)
  ['fire', 'fire'], ['burn', 'fire'], ['burning', 'fire'], ['flame', 'fire'],
  ['flames', 'fire'], ['blaze', 'fire'], ['hot', 'fire'],
  // Moon / night (6)
  ['moon', 'moon'], ['moonlight', 'moon'], ['night', 'moon'], ['midnight', 'moon'],
  ['dark', 'moon'], ['sleep', 'moon'],
  // Sun / day (6)
  ['sun', 'sun'], ['sunlight', 'sun'], ['sunshine', 'sun'], ['day', 'sun'],
  ['morning', 'sun'], ['sunrise', 'sun'],
  // Rain / tears (6)
  ['rain', 'rain'], ['raining', 'rain'], ['cry', 'rain'], ['crying', 'rain'],
  ['tears', 'rain'], ['storm', 'rain'],
  // Star / shine (5)
  ['star', 'star'], ['stars', 'star'], ['shine', 'star'], ['shining', 'star'], ['constellation', 'star'],
  // Sparkle / magic (5)
  ['sparkle', 'sparkle'], ['magic', 'sparkle'], ['glitter', 'sparkle'], ['glow', 'sparkle'], ['flash', 'sparkle'],
  // Plane / fly (4)
  ['plane', 'plane'], ['flight', 'plane'], ['airport', 'plane'], ['fly', 'plane'],
  // Car / drive (5)
  ['car', 'car'], ['drive', 'car'], ['driving', 'car'], ['highway', 'car'], ['road', 'car'],
  // Money / pay (8)
  ['money', 'money'], ['cash', 'money'], ['dollar', 'money'], ['dollars', 'money'],
  ['pay', 'money'], ['rich', 'money'], ['gold', 'money'], ['spend', 'money'],
  // Home (4)
  ['home', 'home'], ['house', 'home'], ['room', 'home'], ['door', 'home'],
  // Phone / call (6)
  ['phone', 'phone'], ['call', 'phone'], ['calling', 'phone'], ['ring', 'phone'], ['text', 'phone'], ['message', 'phone'],
  // Music / song (6)
  ['music', 'music'], ['song', 'music'], ['melody', 'music'], ['rhythm', 'music'], ['dance', 'music'], ['sing', 'music'],
  // Eye / see (5)
  ['eye', 'eye'], ['eyes', 'eye'], ['see', 'eye'], ['look', 'eye'], ['watch', 'eye'],
  // Ghost (3)
  ['ghost', 'ghost'], ['phantom', 'ghost'], ['haunt', 'ghost'],
  // Crown / royal (4)
  ['crown', 'crown'], ['king', 'crown'], ['queen', 'crown'], ['royal', 'crown'],
  // Skull / danger (3)
  ['skull', 'skull'], ['dead', 'skull'], ['die', 'skull'],
  // Lightning / electric (5)
  ['lightning', 'lightning'], ['thunder', 'lightning'], ['electric', 'lightning'], ['shock', 'lightning'], ['energy', 'lightning'],
  // Wave / ocean (5)
  ['wave', 'wave'], ['waves', 'wave'], ['ocean', 'wave'], ['sea', 'wave'], ['water', 'wave'],
  // Rose / flower (4)
  ['rose', 'rose'], ['roses', 'rose'], ['flower', 'rose'], ['bloom', 'rose'],
  // Key / unlock (2)
  ['key', 'key'], ['keys', 'key'],
  // Lock (3)
  ['lock', 'lock'], ['locked', 'lock'], ['secret', 'lock'],
  // World / earth (4)
  ['world', 'world'], ['earth', 'world'], ['planet', 'world'], ['city', 'world'],
  // Wings / angel (4)
  ['wings', 'wings'], ['angel', 'wings'], ['heaven', 'wings'], ['sky', 'wings'],
  // Diamond (4)
  ['diamond', 'diamond'], ['diamonds', 'diamond'], ['crystal', 'diamond'], ['ice', 'diamond'],
  // Rocket / space (3)
  ['rocket', 'rocket'], ['space', 'rocket'], ['orbit', 'rocket'],
  // Train / bike / ship (6)
  ['train', 'train'], ['subway', 'train'], ['bike', 'bike'], ['ride', 'bike'], ['ship', 'ship'], ['boat', 'ship'],
  // Glass / toast (3)
  ['glass', 'glass'], ['champagne', 'glass'], ['drink', 'glass'],
  // Butterfly (2)
  ['butterfly', 'butterfly'], ['butterflies', 'butterfly'],
  // Mic / headphones (4)
  ['mic', 'mic'], ['voice', 'mic'], ['headphones', 'headphones'], ['stereo', 'headphones'],
  // Compass / pin / travel (4)
  ['lost', 'compass'], ['direction', 'compass'], ['street', 'pin'], ['map', 'pin'],
  // Cloud / snow (4)
  ['cloud', 'cloud'], ['clouds', 'cloud'], ['snow', 'snowflake'], ['cold', 'snowflake'],
  // Camera / book / bell / trophy / shield / infinity (7)
  ['camera', 'camera'], ['picture', 'camera'], ['story', 'book'], ['bell', 'bell'],
  ['win', 'trophy'], ['safe', 'shield'], ['always', 'infinity'],
];

const WORD_ICON_MAP = new Map<string, WordIconId>(WORD_ICON_ENTRIES);
export const WORD_ICON_COUNT = WORD_ICON_MAP.size;

function normalizeWordToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .trim();
}

export function resolveWordIcon(word: string, lineText?: string): WordIconId | null {
  const token = normalizeWordToken(word);
  if (!token) return null;

  const direct = WORD_ICON_MAP.get(token);
  if (direct) {
    if (lineText) {
      for (let i = 0; i < PHRASE_ICON_RULES.length; i++) {
        const rule = PHRASE_ICON_RULES[i];
        const m = rule.re.exec(lineText);
        if (m && m[0].toLowerCase().includes(token)) {
          return rule.id;
        }
      }
    }
    return direct;
  }

  return null;
}

/**
 * Draws a crisp SF-Symbol-inspired monochrome geometric vector icon centered at (cx, cy).
 * Zero allocations; uses caller's Canvas2D context directly.
 */
export function drawWordIcon(
  ctx: CanvasRenderingContext2D,
  iconId: WordIconId,
  cx: number,
  cy: number,
  size: number,
  color: string,
  scalePop = 1.0
): void {
  const r = Math.max(4, size * 0.46);
  const pop = Number.isFinite(scalePop) && scalePop > 0 ? scalePop : 1.0;

  ctx.save();
  ctx.translate(cx, cy);
  if (pop !== 1.0) ctx.scale(pop, pop);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.4, size * 0.095);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (iconId) {
    case 'hourglass': {
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.9);
      ctx.lineTo(r * 0.7, -r * 0.9);
      ctx.moveTo(-r * 0.55, -r * 0.9);
      ctx.lineTo(r * 0.55, r * 0.9);
      ctx.moveTo(r * 0.55, -r * 0.9);
      ctx.lineTo(-r * 0.55, r * 0.9);
      ctx.moveTo(-r * 0.7, r * 0.9);
      ctx.lineTo(r * 0.7, r * 0.9);
      ctx.stroke();
      break;
    }
    case 'clock': {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2);
      ctx.moveTo(0, -r * 0.55);
      ctx.lineTo(0, 0);
      ctx.lineTo(r * 0.42, r * 0.2);
      ctx.stroke();
      break;
    }
    case 'heart': {
      ctx.beginPath();
      ctx.moveTo(0, r * 0.85);
      ctx.bezierCurveTo(-r * 1.1, r * 0.15, -r * 1.0, -r * 0.85, 0, -r * 0.25);
      ctx.bezierCurveTo(r * 1.0, -r * 0.85, r * 1.1, r * 0.15, 0, r * 0.85);
      ctx.fill();
      break;
    }
    case 'brokenHeart': {
      ctx.beginPath();
      ctx.moveTo(0, r * 0.85);
      ctx.bezierCurveTo(-r * 1.1, r * 0.15, -r * 1.0, -r * 0.85, 0, -r * 0.25);
      ctx.bezierCurveTo(r * 1.0, -r * 0.85, r * 1.1, r * 0.15, 0, r * 0.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.25);
      ctx.lineTo(-r * 0.18, r * 0.08);
      ctx.lineTo(r * 0.18, r * 0.34);
      ctx.lineTo(0, r * 0.82);
      ctx.stroke();
      break;
    }
    case 'fire': {
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.95);
      ctx.bezierCurveTo(r * 0.75, -r * 0.2, r * 0.8, r * 0.85, 0, r * 0.92);
      ctx.bezierCurveTo(-r * 0.85, r * 0.85, -r * 0.75, -r * 0.15, -r * 0.15, -r * 0.45);
      ctx.quadraticCurveTo(-r * 0.1, -r * 0.8, 0, -r * 0.95);
      ctx.stroke();
      break;
    }
    case 'moon': {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.86, Math.PI * 0.35, Math.PI * 1.75);
      ctx.quadraticCurveTo(-r * 0.2, -r * 0.15, Math.cos(Math.PI * 0.35) * r * 0.86, Math.sin(Math.PI * 0.35) * r * 0.86);
      ctx.stroke();
      break;
    }
    case 'sun': {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.moveTo(Math.cos(a) * r * 0.68, Math.sin(a) * r * 0.68);
        ctx.lineTo(Math.cos(a) * r * 0.96, Math.sin(a) * r * 0.96);
      }
      ctx.stroke();
      break;
    }
    case 'rain': {
      ctx.beginPath();
      ctx.arc(-r * 0.25, -r * 0.12, r * 0.38, Math.PI * 0.85, Math.PI * 1.95);
      ctx.arc(r * 0.22, -r * 0.18, r * 0.44, Math.PI * 1.15, Math.PI * 0.15);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.35, r * 0.45);
      ctx.lineTo(-r * 0.5, r * 0.88);
      ctx.moveTo(r * 0.05, r * 0.45);
      ctx.lineTo(-r * 0.1, r * 0.88);
      ctx.moveTo(r * 0.42, r * 0.45);
      ctx.lineTo(r * 0.28, r * 0.88);
      ctx.stroke();
      break;
    }
    case 'star':
    case 'sparkle': {
      const spikes = iconId === 'sparkle' ? 4 : 5;
      const innerR = iconId === 'sparkle' ? r * 0.3 : r * 0.42;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const rad = i % 2 === 0 ? r * 0.96 : innerR;
        const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI * 0.5;
        if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
        else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'lightning': {
      ctx.beginPath();
      ctx.moveTo(r * 0.15, -r * 0.95);
      ctx.lineTo(-r * 0.48, r * 0.05);
      ctx.lineTo(r * 0.05, r * 0.05);
      ctx.lineTo(-r * 0.18, r * 0.95);
      ctx.lineTo(r * 0.52, -r * 0.1);
      ctx.lineTo(0, -r * 0.1);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'music': {
      ctx.beginPath();
      ctx.arc(-r * 0.4, r * 0.55, r * 0.26, 0, Math.PI * 2);
      ctx.arc(r * 0.42, r * 0.4, r * 0.26, 0, Math.PI * 2);
      ctx.moveTo(-r * 0.14, r * 0.52);
      ctx.lineTo(-r * 0.14, -r * 0.68);
      ctx.lineTo(r * 0.68, -r * 0.84);
      ctx.lineTo(r * 0.68, r * 0.38);
      ctx.stroke();
      break;
    }
    case 'diamond': {
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.95);
      ctx.lineTo(r * 0.82, 0);
      ctx.lineTo(0, r * 0.95);
      ctx.lineTo(-r * 0.82, 0);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'wave': {
      ctx.beginPath();
      ctx.moveTo(-r * 0.9, -r * 0.18);
      ctx.bezierCurveTo(-r * 0.3, -r * 0.72, r * 0.3, r * 0.35, r * 0.9, -r * 0.18);
      ctx.moveTo(-r * 0.9, r * 0.36);
      ctx.bezierCurveTo(-r * 0.3, -r * 0.18, r * 0.3, r * 0.88, r * 0.9, r * 0.36);
      ctx.stroke();
      break;
    }
    case 'crown': {
      ctx.beginPath();
      ctx.moveTo(-r * 0.85, r * 0.58);
      ctx.lineTo(-r * 0.85, -r * 0.42);
      ctx.lineTo(-r * 0.35, r * 0.12);
      ctx.lineTo(0, -r * 0.68);
      ctx.lineTo(r * 0.35, r * 0.12);
      ctx.lineTo(r * 0.85, -r * 0.42);
      ctx.lineTo(r * 0.85, r * 0.58);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'eye': {
      ctx.beginPath();
      ctx.moveTo(-r * 0.96, 0);
      ctx.quadraticCurveTo(0, -r * 0.78, r * 0.96, 0);
      ctx.quadraticCurveTo(0, r * 0.78, -r * 0.96, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'money': {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
      ctx.moveTo(0, -r * 0.55);
      ctx.lineTo(0, r * 0.55);
      ctx.moveTo(r * 0.28, -r * 0.28);
      ctx.bezierCurveTo(-r * 0.42, -r * 0.48, -r * 0.38, 0, 0, 0);
      ctx.bezierCurveTo(r * 0.42, 0, r * 0.42, r * 0.48, -r * 0.28, r * 0.28);
      ctx.stroke();
      break;
    }
    case 'home': {
      ctx.beginPath();
      ctx.moveTo(-r * 0.9, r * 0.05);
      ctx.lineTo(0, -r * 0.82);
      ctx.lineTo(r * 0.9, r * 0.05);
      ctx.moveTo(-r * 0.64, -r * 0.15);
      ctx.lineTo(-r * 0.64, r * 0.82);
      ctx.lineTo(r * 0.64, r * 0.82);
      ctx.lineTo(r * 0.64, -r * 0.15);
      ctx.stroke();
      break;
    }
    case 'plane':
    case 'rocket': {
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.95);
      ctx.lineTo(r * 0.78, r * 0.52);
      ctx.lineTo(0, r * 0.24);
      ctx.lineTo(-r * 0.78, r * 0.52);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'car':
    case 'train':
    case 'bike':
    case 'ship': {
      ctx.beginPath();
      ctx.roundRect?.(-r * 0.85, -r * 0.35, r * 1.7, r * 0.8, r * 0.25);
      if (!ctx.roundRect) ctx.rect(-r * 0.85, -r * 0.35, r * 1.7, r * 0.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-r * 0.45, r * 0.62, r * 0.22, 0, Math.PI * 2);
      ctx.arc(r * 0.45, r * 0.62, r * 0.22, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'phone': {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-r * 0.5, -r * 0.9, r, r * 1.8, r * 0.2);
      else ctx.rect(-r * 0.5, -r * 0.9, r, r * 1.8);
      ctx.moveTo(-r * 0.16, r * 0.64);
      ctx.lineTo(r * 0.16, r * 0.64);
      ctx.stroke();
      break;
    }
    case 'pin':
    case 'compass': {
      ctx.beginPath();
      ctx.arc(0, -r * 0.2, r * 0.55, Math.PI * 0.85, Math.PI * 2.15);
      ctx.lineTo(0, r * 0.92);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -r * 0.2, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'lock':
    case 'key': {
      ctx.beginPath();
      ctx.arc(0, -r * 0.32, r * 0.42, Math.PI, 0);
      ctx.stroke();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-r * 0.65, -r * 0.05, r * 1.3, r * 0.92, r * 0.2);
      else ctx.rect(-r * 0.65, -r * 0.05, r * 1.3, r * 0.92);
      ctx.stroke();
      break;
    }
    case 'world':
    case 'infinity': {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2);
      ctx.moveTo(-r * 0.86, 0);
      ctx.lineTo(r * 0.86, 0);
      ctx.moveTo(0, -r * 0.86);
      ctx.bezierCurveTo(-r * 0.48, -r * 0.3, -r * 0.48, r * 0.3, 0, r * 0.86);
      ctx.moveTo(0, -r * 0.86);
      ctx.bezierCurveTo(r * 0.48, -r * 0.3, r * 0.48, r * 0.3, 0, r * 0.86);
      ctx.stroke();
      break;
    }
    default: {
      // Crisp geometric badge for remaining semantic symbols
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
      ctx.moveTo(-r * 0.32, 0);
      ctx.lineTo(r * 0.32, 0);
      ctx.moveTo(0, -r * 0.32);
      ctx.lineTo(0, r * 0.32);
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}
