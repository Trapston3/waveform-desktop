// Style: IosTextingMotion
// Verci-style dark iOS Messages bubbles, authentic iOS Tapback speech-bubble pills
// with two trailing anchor circles & full-color glossy Canvas2D vector art,
// precomputed kinetic "Magic Word" effects, deterministic contextual emojis,
// typing indicator, rich embed cards, and 4 variations.
// Strict 60fps with ZERO per-frame heap allocations inside render().

import type {
  LyricLine,
  Lyrics,
  LyricsLayout,
  LyricsScriptMode,
  MeasuredLineLayout,
  StyleFrameContext,
} from '../../core/models';
import { isBlankOrInstrumentalLineText } from '../../core/lrcParser';
import {
  clamp01,
  drawRoundedRectPath,
  easeOutBack,
  formatTimestamp,
  getFocalRect,
  isTransparentStage,
  isUnsyncedLyrics,
  resolveDisplayLine,
  type ILyricVisualStyle,
  type StyleMeasurementSpec,
} from '../styleInterface';
import { drawAppleEmoji, preloadAppleEmojis } from '../iosEmojiRenderer';
import { drawWordIcon, resolveWordIcon, type WordIconId } from '../wordIconDictionary';
import {
  chooseSmartTapback,
  detectLyricEmbedCard,
  detectMagicWordEffect,
  IOS18_TAPBACK_LIBRARY,
  resolveContextualEmoji,
  type LyricEmbedCard,
  type LyricEmbedCardKind,
  type MagicWordKind,
  type TapbackKind,
} from '../lyricSemantics';

export {
  chooseSmartTapback,
  detectLyricEmbedCard,
  detectMagicWordEffect,
  IOS18_TAPBACK_LIBRARY,
  resolveContextualEmoji,
  type LyricEmbedCard,
  type LyricEmbedCardKind,
  type MagicWordKind,
  type TapbackKind,
};

const IOS_FONT_STACK = "'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif";

type BubbleSide = 'left' | 'right';
type PresentationMode = 'embed' | 'tapback' | 'inlineEmoji';

const GROUP_CONTACTS = ['Maya', 'Jordan', 'Sam', 'Alex'] as const;
const WALLET_BADGE_COLORS = ['#0A84FF', '#30D158', '#FF9F0A', '#BF5AF2', '#FA2D48'] as const;
const WALLET_SUBTITLES = [
  'Apple Pay · Approved',
  'Express Transit · Tapped',
  'Instant Transfer · Verified',
  'Contactless · Approved',
] as const;
const MAP_DISTRICTS = ['SOHO', 'SHIBUYA', 'EMBARCADERO', 'SHOREDITCH', 'MIDTOWN', 'MARINA'] as const;

interface PrecomputedBubble {
  readonly lineIndex: number;
  readonly side: BubbleSide;
  readonly showTail: boolean;
  readonly senderName: string;
  readonly timestampLabel: string | null;
  readonly tapback: TapbackKind | null;
  readonly embedCard: LyricEmbedCard | null;
  readonly inlineEmoji: string | null;
  readonly emojiWordIndex: number;
  readonly presentationMode: PresentationMode;
  readonly wordEffects: readonly (MagicWordKind | null)[];
  readonly wordEmojis: readonly (string | null)[];
  readonly lineIconId: WordIconId;
  readonly secondaryText: string | null;
  readonly bubbleW: number;
  readonly bubbleH: number;
  readonly cardH: number;
  readonly topY: number;
  readonly centerY: number;
}

const IMSG_BLUE = '#0A84FF';
const IMSG_GREEN = '#30D158';
const IMSG_CHARCOAL = '#262629';
const CARD_BG = '#1c1c1f';
const CARD_BORDER = 'rgba(255, 255, 255, 0.14)';

const RAINBOW_STOPS: readonly string[] = [
  '#ff3b30',
  '#ff9500',
  '#ffcc00',
  '#34c759',
  '#5ac8fa',
  '#af52de',
  '#ff2d55',
];

function hashStringSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function isParentheticalLine(text: string): boolean {
  const t = text.trim();
  return (t.startsWith('(') && t.endsWith(')')) || /\([^)]{2,}\)/.test(t);
}

// Authentic iOS Tapback spring: scale 0 -> 1.32 -> 0.92 -> 1.0
function tapbackSpringScale(t: number): number {
  const p = clamp01(t);
  if (p >= 1) return 1.0;
  if (p < 0.34) {
    const u = p / 0.34;
    return 1.32 * (1 - (1 - u) * (1 - u) * (1 - u));
  }
  if (p < 0.68) {
    const u = (p - 0.34) / 0.34;
    return 1.32 - 0.4 * (0.5 - 0.5 * Math.cos(u * Math.PI));
  }
  const u = (p - 0.68) / 0.32;
  return 0.92 + 0.08 * (0.5 - 0.5 * Math.cos(u * Math.PI));
}

// Authentic iOS Tapback rotation: -16deg -> +6deg -> 0deg (radians)
function tapbackSpringRotRad(t: number): number {
  const p = clamp01(t);
  if (p >= 1) return 0;
  const deg =
    p < 0.55
      ? -16 + 22 * (0.5 - 0.5 * Math.cos((p / 0.55) * Math.PI))
      : 6 * (1 - (p - 0.55) / 0.45);
  return (deg * Math.PI) / 180;
}

function getCardHeight(card: LyricEmbedCard | null): number {
  if (!card || card.kind === 'voiceMemo') return 0;
  if (card.kind === 'maps') return 84;
  if (card.kind === 'missedCall') return 42;
  if (card.kind === 'linkPreview') return 66;
  return 48;
}

function drawBubbleWithTail(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  side: BubbleSide,
  showTail: boolean
): void {
  const rad = Math.max(4, Math.min(r, w * 0.45, h * 0.45));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);

  if (side === 'right' && showTail) {
    ctx.lineTo(x + w, y + h - 8);
    ctx.quadraticCurveTo(x + w + 1, y + h, x + w + 8, y + h);
    ctx.quadraticCurveTo(x + w - 4, y + h, x + w - 10, y + h - 2);
    ctx.quadraticCurveTo(x + w - 14, y + h, x + w - rad, y + h);
  } else {
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  }

  if (side === 'left' && showTail) {
    ctx.lineTo(x + 12, y + h);
    ctx.quadraticCurveTo(x + 4, y + h, x - 8, y + h);
    ctx.quadraticCurveTo(x, y + h - 4, x, y + h - 10);
  } else {
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  }

  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function drawFourPointStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerR);
  ctx.quadraticCurveTo(cx + innerR, cy - innerR, cx + outerR, cy);
  ctx.quadraticCurveTo(cx + innerR, cy + innerR, cx, cy + outerR);
  ctx.quadraticCurveTo(cx - innerR, cy + innerR, cx - outerR, cy);
  ctx.quadraticCurveTo(cx - innerR, cy - innerR, cx, cy - outerR);
  ctx.closePath();
}

export class IosTextingMotionStyle implements ILyricVisualStyle {
  readonly id = 'IosTextingMotion' as const;
  readonly name = 'iOS Messages';
  readonly webGlEffect = 'none' as const;

  private cachedLyrics: Lyrics | null = null;
  private cachedLayout: LyricsLayout | null = null;
  private cachedWidth = -1;
  private cachedTrackId = '';
  private cachedScriptMode: LyricsScriptMode = 'auto';
  private bubbles: PrecomputedBubble[] = [];
  private lineToBubbleIdx: Int32Array = new Int32Array(0);
  private totalThreadHeight = 0;

  // Preallocated zero-GC scratch buffers
  private readonly sparkleAngles = new Float32Array([0, 1.0472, 2.0944, 3.1416, 4.1888, 5.236]);
  private readonly electricPtsX = new Float32Array(7);
  private readonly electricPtsY = new Float32Array(7);
  private readonly wrapLinesScratch: string[] = [];

  private scrollY = 0;
  private scrollVel = 0;
  private mapCamX = 0;
  private mapCamY = 0;
  private mapCamInit = false;
  private lastKnownActiveIdx = -1;
  private gapShiftPx = 0;
  private gapSplitBubbleIdx = -1;
  private lastRenderTimeSec = 0;
  private initialized = false;

  getVariationIndex(variationId: string): number {
    if (variationId === 'liquid-glass') return 1;
    if (variationId === 'cinema-edit') return 2;
    if (variationId === 'classic-sms') return 3;
    if (variationId === 'ios-dark') return 4;
    if (variationId === 'wallet-payments') return 10;
    if (variationId === 'city-walk-map') return 11;
    if (variationId === 'lock-screen-alerts') return 12;
    if (variationId === 'group-chat') return 13;
    return 0; // 'kinetic-messages' (default)
  }

  getMeasurementSpec(frame?: StyleFrameContext): StyleMeasurementSpec {
    return {
      fontWeight: 500,
      fontSizeMultiplier: 0.72,
      fontFamilyOverride: IOS_FONT_STACK,
      maxLineWidthRatio: 0.56,
      scriptMode: frame?.scriptMode ?? 'auto',
      styleId: this.id,
    };
  }

  reset(): void {
    this.cachedLyrics = null;
    this.cachedLayout = null;
    this.cachedWidth = -1;
    this.cachedTrackId = '';
    this.cachedScriptMode = 'auto';
    this.bubbles = [];
    this.lineToBubbleIdx = new Int32Array(0);
    this.totalThreadHeight = 0;
    this.scrollY = 0;
    this.scrollVel = 0;
    this.mapCamX = 0;
    this.mapCamY = 0;
    this.mapCamInit = false;
    this.lastKnownActiveIdx = -1;
    this.gapShiftPx = 0;
    this.gapSplitBubbleIdx = -1;
    this.lastRenderTimeSec = 0;
    this.initialized = false;
  }

  private wrapTextIntoScratch(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number
  ): string[] {
    this.wrapLinesScratch.length = 0;
    const clean = text.trim();
    if (!clean) {
      this.wrapLinesScratch.push('');
      return this.wrapLinesScratch;
    }
    const words = clean.split(/\s+/);
    let current = '';
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const next = current ? `${current} ${w}` : w;
      if (ctx.measureText(next).width <= maxWidth || !current) {
        current = next;
      } else {
        this.wrapLinesScratch.push(current);
        current = w;
      }
    }
    if (current) this.wrapLinesScratch.push(current);
    return this.wrapLinesScratch;
  }

  private ensurePrecomputed(
    ctx: CanvasRenderingContext2D,
    lyrics: Lyrics,
    layout: LyricsLayout,
    width: number,
    trackId: string,
    scriptMode: LyricsScriptMode
  ): void {
    if (
      this.cachedLyrics === lyrics &&
      this.cachedLayout === layout &&
      this.cachedWidth === width &&
      this.cachedTrackId === trackId &&
      this.cachedScriptMode === scriptMode
    ) {
      return;
    }

    this.cachedLyrics = lyrics;
    this.cachedLayout = layout;
    this.cachedWidth = width;
    this.cachedTrackId = trackId;
    this.cachedScriptMode = scriptMode;
    this.lastKnownActiveIdx = -1;
    this.gapShiftPx = 0;
    this.gapSplitBubbleIdx = -1;
    preloadAppleEmojis(IOS18_TAPBACK_LIBRARY);

    const trackSeed = hashStringSeed(trackId || lyrics.providerName || 'waveform-ios');
    const count = Math.min(lyrics.lines.length, layout.lines.length);
    const lineToBubbleIdx = new Int32Array(count);
    lineToBubbleIdx.fill(-1);

    // Filter out blank/whitespace/instrumental lines so no empty bubbles are ever created
    const nonBlankIndices: number[] = [];
    for (let i = 0; i < count; i++) {
      const line = lyrics.lines[i];
      if (isBlankOrInstrumentalLineText(line.text)) continue;
      const resolved = resolveDisplayLine(line, scriptMode, this.id);
      if (isBlankOrInstrumentalLineText(resolved.primaryText)) continue;
      lineToBubbleIdx[i] = nonBlankIndices.length;
      nonBlankIndices.push(i);
    }

    const nbCount = nonBlankIndices.length;
    const result: PrecomputedBubble[] = new Array(nbCount);
    const padX = Math.max(16, Math.round(layout.fontSizePx * 0.72));
    const padY = Math.max(11, Math.round(layout.fontSizePx * 0.48));
    const minBubbleW = Math.max(76, Math.round(layout.fontSizePx * 3.2));
    const maxBubbleW = Math.max(160, Math.round(width * 0.66));

    let currentSide: BubbleSide = 'right';
    let consecutiveSameSide = 1;
    let cursorY = 0;

    // Pass 1: reliable 2-person alternation (#262629 left / #0A84FF right), embed cards, timestamps
    const sides: BubbleSide[] = new Array(nbCount);
    const cards: (LyricEmbedCard | null)[] = new Array(nbCount);
    const timestamps: (string | null)[] = new Array(nbCount);

    for (let bIdx = 0; bIdx < nbCount; bIdx++) {
      const lineIdx = nonBlankIndices[bIdx];
      const line = lyrics.lines[lineIdx];
      if (bIdx === 0) {
        currentSide = isParentheticalLine(line.text) ? 'left' : 'right';
        consecutiveSameSide = 1;
        timestamps[bIdx] = 'Today  9:41 PM';
      } else {
        const prev = lyrics.lines[nonBlankIndices[bIdx - 1]];
        const prevVocalEnd =
          prev.words.length > 0 ? Math.min(prev.endSeconds, prev.words[prev.words.length - 1].endSeconds) : prev.endSeconds;
        const gap = line.startSeconds - prevVocalEnd;
        const prevTrim = prev.text.trim();
        const prevEndedPrompt = prevTrim.endsWith('?') || prevTrim.endsWith('!');
        const curParen = isParentheticalLine(line.text);
        const prevParen = isParentheticalLine(prev.text);

        let nextSide: BubbleSide = currentSide;
        if (curParen !== prevParen) {
          nextSide = curParen ? 'left' : 'right';
        } else if (gap > 0.55 || prevEndedPrompt || consecutiveSameSide >= 3) {
          nextSide = currentSide === 'right' ? 'left' : 'right';
        }

        if (nextSide !== currentSide) {
          currentSide = nextSide;
          consecutiveSameSide = 1;
        } else {
          consecutiveSameSide++;
        }

        timestamps[bIdx] = gap > 1.8 || bIdx % 6 === 0 ? formatTimestamp(line.startSeconds) : null;
      }

      sides[bIdx] = currentSide;
      const detectedCard = detectLyricEmbedCard(line.text);
      if (detectedCard?.kind === 'voiceMemo') {
        cards[bIdx] = null;
      } else if (detectedCard && bIdx > 0 && cards[bIdx - 1]?.kind === detectedCard.kind) {
        cards[bIdx] = null;
      } else {
        cards[bIdx] = detectedCard;
      }
    }

    // Pass 2: compute bubble geometry, 15 Magic Word effects, weighted semantic emojis, and vertical layout
    for (let bIdx = 0; bIdx < nbCount; bIdx++) {
      const lineIdx = nonBlankIndices[bIdx];
      const line = lyrics.lines[lineIdx];
      const measured: MeasuredLineLayout = layout.lines[lineIdx];
      const resolved = resolveDisplayLine(line, scriptMode, this.id);
      const secondaryText = measured.secondaryText ?? resolved.secondaryText;
      const side = sides[bIdx];
      const nextLineStart =
        bIdx + 1 < nbCount ? lyrics.lines[nonBlankIndices[bIdx + 1]].startSeconds : Number.POSITIVE_INFINITY;
      const nextSameSpeaker =
        bIdx + 1 < nbCount &&
        sides[bIdx + 1] === side &&
        nextLineStart - line.endSeconds <= 0.55 &&
        !timestamps[bIdx + 1];
      const showTail = !nextSameSpeaker;

      const timestampPad = timestamps[bIdx] ? 26 : 0;
      cursorY += timestampPad;

      const wordCount = measured.words.length;
      const wordEffects: (MagicWordKind | null)[] = new Array(wordCount);
      const wordEmojis: (string | null)[] = new Array(wordCount);
      for (let w = 0; w < wordCount; w++) {
        const wText = measured.words[w].text;
        wordEffects[w] = detectMagicWordEffect(wText);
        wordEmojis[w] = resolveContextualEmoji(wText, trackSeed + bIdx * 31 + w * 17);
      }

      const semanticText = resolved.primaryText || line.text;
      const lineEmoji = resolveContextualEmoji(semanticText, trackSeed + bIdx * 37);
      let emojiWordIndex = -1;
      if (lineEmoji) {
        for (let w = 0; w < wordCount; w++) {
          if (wordEmojis[w] === lineEmoji) {
            emojiWordIndex = w;
            break;
          }
        }
        if (emojiWordIndex === -1) {
          for (let w = 0; w < wordCount; w++) {
            if (wordEmojis[w] !== null) {
              emojiWordIndex = w;
              break;
            }
          }
        }
      }
      let tapback = chooseSmartTapback(line, bIdx, side, trackSeed);
      const card = cards[bIdx];

      // Deterministically alternate presentation across lines: Embed Card, Tapback Reaction, Inline Suffix
      const modeSlot = (bIdx + (trackSeed % 3)) % 3;
      let presentationMode: PresentationMode = 'tapback';
      let inlineEmoji: string | null = null;
      if (card) {
        presentationMode = 'embed';
        if (lineEmoji && modeSlot === 2) {
          inlineEmoji = lineEmoji;
        }
      } else if (lineEmoji && modeSlot === 0) {
        presentationMode = 'inlineEmoji';
        inlineEmoji = lineEmoji;
      } else {
        presentationMode = 'tapback';
        if (lineEmoji) {
          tapback = lineEmoji;
        }
      }

      let secondaryW = 0;
      let secondaryExtraH = 0;
      if (secondaryText) {
        ctx.save();
        ctx.font = `400 ${Math.max(11, Math.round(layout.fontSizePx * 0.72))}px ${IOS_FONT_STACK}`;
        const rawSubW = ctx.measureText(secondaryText).width;
        ctx.restore();
        secondaryW = Number.isFinite(rawSubW) ? rawSubW : secondaryText.length * layout.fontSizePx * 0.42;
        secondaryExtraH = Math.round(layout.fontSizePx * 0.96);
      }

      const emojiSuffixSpace = inlineEmoji ? Math.round(layout.fontSizePx * 1.15) : 0;
      const bubbleW = Math.min(
        maxBubbleW,
        Math.max(minBubbleW, measured.width + padX * 2 + emojiSuffixSpace, secondaryW + padX * 2)
      );
      const bubbleH = Math.max(38, measured.height + padY * 2 + secondaryExtraH);
      const cardH = getCardHeight(card);
      const cardGap = cardH > 0 ? 6 : 0;
      const rowTotalH = bubbleH + cardGap + cardH;

      let lineIconId: WordIconId = 'music';
      const wordsSplit = line.text.split(/\s+/);
      for (let wi = 0; wi < wordsSplit.length; wi++) {
        const hit = resolveWordIcon(wordsSplit[wi], line.text);
        if (hit) {
          lineIconId = hit;
          break;
        }
      }
      const senderName =
        GROUP_CONTACTS[(bIdx + (trackSeed % GROUP_CONTACTS.length)) % GROUP_CONTACTS.length];

      result[bIdx] = {
        lineIndex: lineIdx,
        side,
        showTail,
        senderName,
        timestampLabel: timestamps[bIdx],
        tapback,
        embedCard: card,
        inlineEmoji,
        emojiWordIndex,
        presentationMode,
        wordEffects,
        wordEmojis,
        lineIconId,
        secondaryText,
        bubbleW,
        bubbleH,
        cardH,
        topY: cursorY,
        centerY: cursorY + rowTotalH * 0.5,
      };

      const nextSpacing = showTail ? 16 : 6;
      cursorY += rowTotalH + nextSpacing;
    }

    this.bubbles = result;
    this.lineToBubbleIdx = lineToBubbleIdx;
    this.totalThreadHeight = Math.max(1, cursorY);
  }

  private getMotionScale(frame: StyleFrameContext): number {
    if (frame.reduceMotion) return 0;
    if (frame.motionIntensity === 'subtle') return 0.45;
    if (frame.motionIntensity === 'vivid') return 1.5;
    return 1.0;
  }

  private drawTapbackBadge(
    ctx: CanvasRenderingContext2D,
    tapback: TapbackKind,
    side: BubbleSide,
    bx: number,
    by: number,
    bubbleW: number,
    rowAlpha: number,
    popProgress: number,
    variationIdx: number,
    motionScale: number
  ): void {
    // Authentic iOS Tapback Speech-Bubble Pill overlapping top corner of message bubble
    const pillW = 32;
    const pillH = 28;
    const tapX = side === 'right' ? bx - 10 : bx + bubbleW - 22;
    const tapY = by - 13;
    const cx = tapX + pillW * 0.5;
    const cy = tapY + pillH * 0.5;

    const animP = clamp01(popProgress);
    const pillP = animP < 1 ? clamp01((animP - 0.14) / 0.86) : 1.0;
    const scale = pillP < 1 ? Math.max(0.01, tapbackSpringScale(pillP)) : 1.0;
    const rotRad = pillP < 1 && motionScale > 0 ? tapbackSpringRotRad(pillP) : 0;

    const isHeart = tapback === '❤️' || tapback === '♥';
    const isBang = tapback === '‼️' || tapback === '!!';
    const isQuestion = tapback === '❓' || tapback === '?';

    const pillFill = isHeart
      ? '#2C2C2E'
      : side === 'right'
      ? '#2C2C2E'
      : variationIdx === 3
      ? IMSG_GREEN
      : IMSG_BLUE;
    const glassBorder = side === 'right' || isHeart ? 'rgba(255, 255, 255, 0.24)' : 'rgba(147, 197, 253, 0.45)';

    // Staggered trailing anchor dots (dot2 nearest bubble corner pops first, then dot1)
    const dot1X = side === 'right' ? tapX + pillW - 5 : tapX + 5;
    const dot1Y = tapY + pillH - 1;
    const dot2X = side === 'right' ? dot1X + 4.5 : dot1X - 4.5;
    const dot2Y = dot1Y + 4.2;

    const dot2Scale = animP < 1 ? tapbackSpringScale(clamp01(animP * 2.1)) : 1.0;
    const dot1Scale = animP < 1 ? tapbackSpringScale(clamp01((animP - 0.08) * 2.1)) : 1.0;

    ctx.save();
    ctx.globalAlpha = rowAlpha;
    ctx.fillStyle = pillFill;
    ctx.strokeStyle = '#09090d';
    ctx.lineWidth = 1.4;

    if (dot2Scale > 0.05) {
      ctx.beginPath();
      ctx.arc(dot2X, dot2Y, 2.2 * Math.min(1.25, dot2Scale), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (dot1Scale > 0.05) {
      ctx.beginPath();
      ctx.arc(dot1X, dot1Y, 3.7 * Math.min(1.25, dot1Scale), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (scale !== 1.0 || rotRad !== 0) {
      ctx.translate(cx, cy);
      if (rotRad !== 0) ctx.rotate(rotRad);
      if (scale !== 1.0) ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
    }

    // Subtle drop shadow + main Tapback speech-bubble pill
    ctx.shadowColor = 'rgba(0, 0, 0, 0.48)';
    ctx.shadowBlur = 10;
    drawRoundedRectPath(ctx, tapX, tapY, pillW, pillH, 14);
    ctx.fillStyle = pillFill;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Dark cutout rim + frosted glass inner rim
    ctx.strokeStyle = '#09090d';
    ctx.lineWidth = 2;
    ctx.stroke();

    drawRoundedRectPath(ctx, tapX + 1, tapY + 1, pillW - 2, pillH - 2, 13);
    ctx.strokeStyle = glassBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Crisp Apple glossy emoji or typography inside pill ('!!' & '?' stay crisp text)
    if (isBang) {
      const bangGrad = ctx.createLinearGradient(cx, tapY + 4, cx, tapY + pillH - 4);
      bangGrad.addColorStop(0, '#ffffff');
      bangGrad.addColorStop(1, '#fda4af');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 12px ${IOS_FONT_STACK}`;
      ctx.fillStyle = bangGrad;
      ctx.fillText('!!', cx, cy + 0.5);
    } else if (isQuestion) {
      const qGrad = ctx.createLinearGradient(cx, tapY + 4, cx, tapY + pillH - 4);
      qGrad.addColorStop(0, '#ffffff');
      qGrad.addColorStop(1, '#bae6fd');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 13px ${IOS_FONT_STACK}`;
      ctx.fillStyle = qGrad;
      ctx.fillText('?', cx, cy + 0.5);
    } else {
      drawAppleEmoji(ctx, tapback, cx, cy + 0.5, 17);
    }

    // Radial sparkle burst during active spring entrance (0 allocations)
    if (motionScale > 0 && animP > 0.16 && animP < 0.88) {
      const burstP = (animP - 0.16) / 0.72;
      const burstAlpha = rowAlpha * (1 - burstP) * 0.9;
      const radDist = 17 + burstP * 13;
      ctx.globalAlpha = burstAlpha;
      for (let s = 0; s < this.sparkleAngles.length; s++) {
        const ang = this.sparkleAngles[s];
        const sx = cx + Math.cos(ang) * radDist;
        const sy = cy + Math.sin(ang) * radDist;
        ctx.fillStyle = s % 2 === 0 ? '#fef08a' : '#7dd3fc';
        drawFourPointStar(ctx, sx, sy, 3.0 * (1 - burstP * 0.5), 1.0);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private drawMagicWord(
    ctx: CanvasRenderingContext2D,
    text: string,
    wx: number,
    wy: number,
    ww: number,
    wh: number,
    kind: MagicWordKind,
    frame: StyleFrameContext,
    motionScale: number,
    baseAlpha: number,
    wordIdx: number
  ): void {
    const t = frame.timeSeconds;
    const safeW = Math.max(12, ww);
    const safeH = Math.max(14, wh);

    ctx.save();
    ctx.globalAlpha = baseAlpha;

    if (kind === 'rainbow') {
      const grad = ctx.createLinearGradient(wx, wy, wx + safeW, wy + safeH * 0.4);
      const shift = motionScale > 0 ? Math.floor(t * 5 + wordIdx) : 0;
      const stopCount = RAINBOW_STOPS.length;
      for (let s = 0; s < stopCount; s++) {
        grad.addColorStop(s / (stopCount - 1), RAINBOW_STOPS[(s + shift) % stopCount]);
      }
      ctx.shadowColor = 'rgba(175, 82, 222, 0.72)';
      ctx.shadowBlur = 12;
      ctx.fillStyle = grad;
      ctx.fillText(text, wx, wy);
    } else if (kind === 'sparkle') {
      const grad = ctx.createLinearGradient(wx, wy, wx + safeW, wy + safeH);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.5, '#fef08a');
      grad.addColorStop(1, '#facc15');
      ctx.shadowColor = 'rgba(250, 204, 21, 0.75)';
      ctx.shadowBlur = 11;
      ctx.fillStyle = grad;
      ctx.fillText(text, wx, wy);
      ctx.shadowBlur = 0;

      for (let k = 0; k < 3; k++) {
        const pulse =
          motionScale === 0 ? 0.75 : 0.35 + 0.65 * Math.abs(Math.sin(t * 5.8 + k * 2.1 + wordIdx));
        const sx = k === 0 ? wx - 3 : k === 1 ? wx + safeW + 3 : wx + safeW * 0.52;
        const sy = k === 0 ? wy + safeH * 0.25 : k === 1 ? wy + safeH * 0.18 : wy - 2;
        const outerR = (3.4 + (k === 1 ? 1.0 : 0)) * pulse;
        ctx.fillStyle = k === 1 ? '#fef08a' : '#ffffff';
        drawFourPointStar(ctx, sx, sy, outerR, outerR * 0.32);
        ctx.fill();
      }
    } else if (kind === 'shiny') {
      const sweep =
        motionScale === 0 ? 0.5 : (t * 0.95 + wordIdx * 0.23) - Math.floor(t * 0.95 + wordIdx * 0.23);
      const bandCenter = Math.max(0.08, Math.min(0.92, sweep));
      const grad = ctx.createLinearGradient(wx, wy, wx + safeW, wy + safeH * 0.35);
      grad.addColorStop(0, '#fcd34d');
      grad.addColorStop(Math.max(0, bandCenter - 0.16), '#fbbf24');
      grad.addColorStop(bandCenter, '#ffffff');
      grad.addColorStop(Math.min(1, bandCenter + 0.16), '#fbbf24');
      grad.addColorStop(1, '#f59e0b');
      ctx.shadowColor = 'rgba(251, 191, 36, 0.65)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = grad;
      ctx.fillText(text, wx, wy);
    } else if (kind === 'fire') {
      const grad = ctx.createLinearGradient(wx, wy + safeH, wx, wy);
      grad.addColorStop(0, '#fef08a');
      grad.addColorStop(0.5, '#f97316');
      grad.addColorStop(1, '#ef4444');
      ctx.shadowColor = 'rgba(249, 115, 22, 0.8)';
      ctx.shadowBlur = 12;
      ctx.fillStyle = grad;
      ctx.fillText(text, wx, wy);
      ctx.shadowBlur = 0;

      for (let e = 0; e < 3; e++) {
        const cycle =
          motionScale === 0
            ? 0.4 * (e + 1) * 0.25
            : (t * (1.4 + e * 0.35) + e * 0.33 + wordIdx * 0.19) % 1.0;
        const ex = wx + safeW * (0.2 + e * 0.3) + Math.sin(t * 6 + e * 2) * 2.5 * motionScale;
        const ey = wy + 2 - cycle * 11;
        const er = Math.max(0.8, (1 - cycle) * 2.2);
        ctx.globalAlpha = baseAlpha * (1 - cycle * 0.85);
        ctx.fillStyle = e % 2 === 0 ? '#fde047' : '#fb923c';
        ctx.beginPath();
        ctx.arc(ex, ey, er, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (kind === 'ice') {
      const grad = ctx.createLinearGradient(wx, wy, wx, wy + safeH);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.5, '#bae6fd');
      grad.addColorStop(1, '#38bdf8');
      ctx.shadowColor = 'rgba(56, 189, 248, 0.78)';
      ctx.shadowBlur = 11;
      ctx.fillStyle = grad;
      ctx.fillText(text, wx, wy);
      ctx.shadowBlur = 0;

      for (let f = 0; f < 3; f++) {
        const drift = motionScale === 0 ? 0 : Math.sin(t * 3.2 + f * 2.1 + wordIdx) * 2.2;
        const fx = wx + safeW * (0.18 + f * 0.32) + drift;
        const fy = wy - 1 + (f % 2) * 3;
        ctx.fillStyle = '#e0f2fe';
        drawFourPointStar(ctx, fx, fy, 2.4, 0.8);
        ctx.fill();
      }
    } else if (kind === 'electric') {
      const grad = ctx.createLinearGradient(wx, wy, wx + safeW, wy + safeH);
      grad.addColorStop(0, '#fef08a');
      grad.addColorStop(0.5, '#7dd3fc');
      grad.addColorStop(1, '#38bdf8');
      ctx.shadowColor = 'rgba(56, 189, 248, 0.85)';
      ctx.shadowBlur = 14;
      ctx.fillStyle = grad;
      ctx.fillText(text, wx, wy);
      ctx.shadowBlur = 0;

      // Preallocated jagged lightning arc underneath word (0 allocations)
      const jitter = motionScale === 0 ? 0 : Math.sin(t * 28 + wordIdx * 2.1);
      for (let p = 0; p < 7; p++) {
        this.electricPtsX[p] = wx + (safeW * p) / 6;
        this.electricPtsY[p] =
          wy + safeH * 0.9 + (p % 2 === 0 ? -1.8 : 2.2) * (0.6 + 0.4 * jitter);
      }
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(this.electricPtsX[0], this.electricPtsY[0]);
      for (let p = 1; p < 7; p++) {
        ctx.lineTo(this.electricPtsX[p], this.electricPtsY[p]);
      }
      ctx.stroke();
    } else if (kind === 'heartbeat' || kind === 'love') {
      const phase = (t * 2.2 + wordIdx * 0.3) % 1.0;
      const lubDub =
        motionScale === 0
          ? 1.0
          : phase < 0.16
          ? 1 + 0.065 * Math.sin((phase / 0.16) * Math.PI)
          : phase < 0.34
          ? 1 + 0.042 * Math.sin(((phase - 0.16) / 0.18) * Math.PI)
          : 1.0;
      const cx = wx + safeW * 0.5;
      const cy = wy + safeH * 0.5;
      ctx.translate(cx, cy);
      ctx.scale(lubDub, lubDub);
      ctx.translate(-cx, -cy);

      const grad = ctx.createLinearGradient(wx, wy, wx + safeW, wy + safeH);
      grad.addColorStop(0, '#fecdd3');
      grad.addColorStop(0.5, '#fb7185');
      grad.addColorStop(1, '#ff2d55');
      ctx.shadowColor = 'rgba(255, 45, 85, 0.75)';
      ctx.shadowBlur = 12;
      ctx.fillStyle = grad;
      ctx.fillText(text, wx, wy);
      ctx.shadowBlur = 0;

      const lift = motionScale === 0 ? 3 : ((t * 1.3 + wordIdx * 0.4) % 1.0) * 9;
      drawAppleEmoji(ctx, '❤️', wx + safeW - 2, wy - 3 - lift, 9);
    } else if (kind === 'broken') {
      const gap = motionScale === 0 ? 1.2 : 1.5 + Math.sin(t * 7 + wordIdx) * 0.8;
      ctx.shadowColor = 'rgba(244, 63, 94, 0.7)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#fda4af';
      ctx.fillText(text, wx - gap * 0.45, wy + 0.6);
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = baseAlpha * 0.88;
      ctx.fillText(text, wx + gap * 0.45, wy - 0.6);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#fb7185';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(wx + safeW * 0.48, wy);
      ctx.lineTo(wx + safeW * 0.42, wy + safeH * 0.45);
      ctx.lineTo(wx + safeW * 0.56, wy + safeH * 0.62);
      ctx.lineTo(wx + safeW * 0.46, wy + safeH * 0.95);
      ctx.stroke();
    } else if (kind === 'glitch' || kind === 'impact') {
      const jitter = motionScale === 0 ? 1.4 : Math.sin(t * 36 + wordIdx * 3.1) * 2.2 * Math.min(1.3, motionScale);
      const jitterY = motionScale === 0 ? 0 : Math.cos(t * 29 + wordIdx * 2.3) * 1.1 * Math.min(1.3, motionScale);
      ctx.globalAlpha = baseAlpha * 0.65;
      ctx.fillStyle = '#00f0ff';
      ctx.fillText(text, wx - Math.abs(jitter), wy + jitterY);
      ctx.fillStyle = '#ff2d55';
      ctx.fillText(text, wx + Math.abs(jitter), wy - jitterY);
      ctx.globalAlpha = baseAlpha;
      ctx.shadowColor = 'rgba(255, 255, 255, 0.85)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, wx, wy);
    } else if (kind === 'float' || kind === 'water') {
      const waveY =
        motionScale === 0 ? -1.5 : Math.sin(t * 3.8 + wordIdx * 1.4) * 2.6 * Math.min(1.2, motionScale);
      const grad = ctx.createLinearGradient(wx, wy, wx + safeW, wy + safeH);
      grad.addColorStop(0, kind === 'water' ? '#e0f2fe' : '#f5f3ff');
      grad.addColorStop(0.55, kind === 'water' ? '#7dd3fc' : '#c4b5fd');
      grad.addColorStop(1, kind === 'water' ? '#38bdf8' : '#7dd3fc');
      ctx.shadowColor = kind === 'water' ? 'rgba(56, 189, 248, 0.68)' : 'rgba(167, 139, 250, 0.72)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = grad;
      ctx.fillText(text, wx, wy + waveY);
    } else if (kind === 'fall') {
      const cycle = motionScale === 0 ? 0.5 : (t * 1.4 + wordIdx * 0.25) % 1.0;
      const dropY = motionScale === 0 ? 2 : cycle * cycle * 4.5 * Math.min(1.2, motionScale);
      ctx.globalAlpha = baseAlpha * 0.32;
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(text, wx, wy - 3);
      ctx.globalAlpha = baseAlpha;
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(text, wx, wy + dropY);
    } else if (kind === 'spin') {
      const ang = motionScale === 0 ? 0.08 : Math.sin(t * 5.5 + wordIdx) * 0.14 * Math.min(1.2, motionScale);
      const cx = wx + safeW * 0.5;
      const cy = wy + safeH * 0.5;
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.translate(-cx, -cy);
      ctx.shadowColor = 'rgba(125, 211, 252, 0.75)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#e0f2fe';
      ctx.fillText(text, wx, wy);
    } else if (kind === 'neon') {
      const pulse = motionScale === 0 ? 0.85 : 0.65 + 0.35 * Math.sin(t * 7.2 + wordIdx);
      ctx.shadowColor = '#e879f9';
      ctx.shadowBlur = 16 * pulse;
      ctx.fillStyle = '#f0abfc';
      ctx.fillText(text, wx, wy);
      ctx.shadowColor = '#22d3ee';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, wx, wy);
    } else if (kind === 'time') {
      const sweep = motionScale === 0 ? 0.5 : (t * 0.8 + wordIdx * 0.2) % 1.0;
      const grad = ctx.createLinearGradient(wx, wy, wx + safeW, wy);
      grad.addColorStop(0, '#fffbeb');
      grad.addColorStop(Math.max(0.05, Math.min(0.95, sweep)), '#ffffff');
      grad.addColorStop(1, '#fef08a');
      ctx.shadowColor = 'rgba(0, 0, 0, 0.34)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 1;
      ctx.fillStyle = grad;
      ctx.fillText(text, wx, wy);
      ctx.shadowColor = 'rgba(250, 204, 21, 0.52)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = baseAlpha * 0.9;
      ctx.fillText(text, wx, wy);
    } else {
      // whisper / ghost: translucent ethereal alpha/glow shimmer
      const ghostAlpha =
        motionScale === 0 ? 0.72 : 0.52 + 0.36 * (0.5 + 0.5 * Math.sin(t * 3.4 + wordIdx * 1.5));
      const floatX = motionScale === 0 ? 0 : Math.sin(t * 2.2 + wordIdx) * 1.8;
      ctx.globalAlpha = baseAlpha * ghostAlpha;
      ctx.shadowColor = 'rgba(196, 181, 253, 0.85)';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#ede9fe';
      ctx.fillText(text, wx + floatX, wy);
    }

    ctx.restore();
  }

  private drawEmbedCard(
    ctx: CanvasRenderingContext2D,
    card: LyricEmbedCard,
    x: number,
    y: number,
    w: number,
    h: number,
    frame: StyleFrameContext,
    motionScale: number
  ): void {
    ctx.save();
    drawRoundedRectPath(ctx, x, y, w, h, 16);
    ctx.fillStyle = CARD_BG;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = CARD_BORDER;
    ctx.stroke();

    if (card.kind === 'maps') {
      const mapW = Math.min(92, Math.round(w * 0.34));
      const mapX = x + 6;
      const mapY = y + 6;
      const mapH = h - 12;

      ctx.save();
      drawRoundedRectPath(ctx, mapX, mapY, mapW, mapH, 11);
      ctx.fillStyle = '#121826';
      ctx.fill();
      if (typeof ctx.clip === 'function') ctx.clip();

      ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = 14; gx < mapW; gx += 18) {
        ctx.moveTo(mapX + gx, mapY);
        ctx.lineTo(mapX + gx - 6, mapY + mapH);
      }
      for (let gy = 14; gy < mapH; gy += 16) {
        ctx.moveTo(mapX, mapY + gy);
        ctx.lineTo(mapX + mapW, mapY + gy + 3);
      }
      ctx.stroke();

      ctx.strokeStyle = IMSG_BLUE;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(mapX + 10, mapY + mapH - 12);
      ctx.lineTo(mapX + mapW * 0.45, mapY + mapH * 0.52);
      ctx.lineTo(mapX + mapW * 0.62, mapY + mapH * 0.38);
      ctx.stroke();

      const pinX = mapX + mapW * 0.62;
      const pinY = mapY + mapH * 0.38;
      const pulseR = 9 + (motionScale > 0 ? (Math.sin(frame.timeSeconds * 4.5) * 0.5 + 0.5) * 4 : 0);
      ctx.fillStyle = 'rgba(10, 132, 255, 0.28)';
      ctx.beginPath();
      ctx.arc(pinX, pinY, pulseR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = IMSG_BLUE;
      ctx.beginPath();
      ctx.arc(pinX, pinY, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      const tx = mapX + mapW + 12;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `700 13px ${IOS_FONT_STACK}`;
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(card.title, tx, y + 16);
      ctx.font = `500 11px ${IOS_FONT_STACK}`;
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(card.subtitle, tx, y + 36);
      ctx.font = `600 10px ${IOS_FONT_STACK}`;
      ctx.fillStyle = IMSG_BLUE;
      ctx.fillText('OPEN IN MAPS', tx, y + 56);
    } else if (card.kind === 'voiceMemo') {
      const btnX = x + 22;
      const btnY = y + h * 0.5;
      ctx.fillStyle = IMSG_BLUE;
      ctx.beginPath();
      ctx.arc(btnX, btnY, 13, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(btnX - 3, btnY - 5);
      ctx.lineTo(btnX + 6, btnY);
      ctx.lineTo(btnX - 3, btnY + 5);
      ctx.closePath();
      ctx.fill();

      const barsStartX = x + 46;
      const barsEndX = x + w - 48;
      const barCount = 16;
      const step = Math.max(4, (barsEndX - barsStartX) / barCount);
      for (let b = 0; b < barCount; b++) {
        const band =
          b < 5 ? frame.audio.bassEnergy : b < 11 ? frame.audio.midEnergy : frame.audio.trebleEnergy;
        const wave =
          motionScale === 0
            ? 0.45
            : 0.25 + 0.75 * Math.abs(Math.sin(frame.timeSeconds * 6.5 + b * 0.65));
        const amp = Math.max(
          0.18,
          Math.min(1.0, wave * (0.45 + band * 0.9 + frame.audio.rmsLevel * 0.35))
        );
        const barH = Math.max(4, Math.round((h - 24) * amp));
        const bx = barsStartX + b * step;
        const by = btnY - barH * 0.5;
        ctx.fillStyle = b / barCount < 0.65 ? '#e2e8f0' : 'rgba(226, 232, 240, 0.42)';
        drawRoundedRectPath(ctx, bx, by, Math.max(2, step * 0.58), barH, 1.5);
        ctx.fill();
      }

      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = `600 11px ${IOS_FONT_STACK}`;
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(card.subtitle, x + w - 12, btnY);
    } else if (card.kind === 'missedCall') {
      const iconX = x + 20;
      const iconY = y + h * 0.5;
      ctx.fillStyle = 'rgba(255, 69, 58, 0.18)';
      ctx.beginPath();
      ctx.arc(iconX, iconY, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff453a';
      ctx.beginPath();
      ctx.arc(iconX, iconY, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `600 12px ${IOS_FONT_STACK}`;
      ctx.fillStyle = '#ff6961';
      ctx.fillText(card.title, x + 38, iconY);
    } else if (card.kind === 'linkPreview') {
      const thumbSize = h - 14;
      const tx = x + 7;
      const ty = y + 7;
      const thumbGrad = ctx.createLinearGradient(tx, ty, tx + thumbSize, ty + thumbSize);
      thumbGrad.addColorStop(0, frame.palette.accentPrimary);
      thumbGrad.addColorStop(1, frame.palette.accentSecondary);
      drawRoundedRectPath(ctx, tx, ty, thumbSize, thumbSize, 10);
      ctx.fillStyle = thumbGrad;
      ctx.fill();

      const textX = tx + thumbSize + 12;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `700 12px ${IOS_FONT_STACK}`;
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(card.title, textX, y + 12);

      ctx.font = `500 11px ${IOS_FONT_STACK}`;
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(card.subtitle, textX, y + 30);

      if (card.domain) {
        ctx.font = `600 10px ${IOS_FONT_STACK}`;
        ctx.fillStyle = '#60a5fa';
        ctx.fillText(card.domain, textX, y + 48);
      }
    } else {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `700 12px ${IOS_FONT_STACK}`;
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(card.title, x + 14, y + h * 0.38);
      ctx.font = `500 11px ${IOS_FONT_STACK}`;
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(card.subtitle, x + 14, y + h * 0.7);
    }

    ctx.restore();
  }

  private drawVoiceNoteGapBubble(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    frame: StyleFrameContext,
    motionScale: number,
    alpha: number
  ): void {
    const w = 198;
    const h = 44;
    const t = frame.timeSeconds || 0;
    const bass = frame.audio.bassEnergy ?? 0;
    const mid = frame.audio.midEnergy ?? 0;
    const treble = frame.audio.trebleEnergy ?? 0;
    const beatBoost =
      motionScale > 0 && frame.audio.isDownbeat
        ? 0.34
        : motionScale > 0 && frame.audio.beatDetected
        ? 0.2
        : 0;

    ctx.save();
    ctx.globalAlpha = alpha;
    drawBubbleWithTail(ctx, x, y, w, h, 18, 'left', true);
    ctx.fillStyle = IMSG_CHARCOAL;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Animated bobbing musical note badge on left
    const noteBob = motionScale === 0 ? 0 : Math.sin(t * 4.5) * 2.5 * Math.min(1.2, motionScale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 13px ${IOS_FONT_STACK}`;
    ctx.fillStyle = IMSG_BLUE;
    ctx.fillText('♪', x + 20, y + h * 0.5 + noteBob);

    // 14-bar iOS Voice Note FFT waveform lighting left-to-right dynamically
    const barsX = x + 36;
    const barCount = 14;
    const step = 8.4;
    const sweepProgress =
      typeof frame.gapProgress === 'number' && Number.isFinite(frame.gapProgress) && frame.gapProgress > 0
        ? clamp01(frame.gapProgress)
        : motionScale === 0
        ? 0.5
        : (t * 0.32) % 1.0;
    for (let b = 0; b < barCount; b++) {
      const band = b < 5 ? bass : b < 10 ? mid : treble;
      const wave =
        motionScale === 0
          ? 0.42
          : 0.28 + 0.72 * Math.abs(Math.sin(t * 6.8 + b * 0.72));
      const amp = clamp01(0.2 + wave * (0.4 + band * 0.85 + beatBoost));
      const bh = Math.max(4, Math.round(22 * amp));
      const bx = barsX + b * step;
      const by = y + h * 0.5 - bh * 0.5;
      ctx.fillStyle = (b + 0.5) / barCount <= sweepProgress ? '#e2e8f0' : 'rgba(226, 232, 240, 0.35)';
      drawRoundedRectPath(ctx, bx, by, 4, bh, 2);
      ctx.fill();
    }

    // Trailing note indicator
    const note2Bob = motionScale === 0 ? 0 : Math.cos(t * 4.5 + 1.2) * 2.2 * Math.min(1.2, motionScale);
    ctx.fillStyle = '#94a3b8';
    ctx.font = `600 11px ${IOS_FONT_STACK}`;
    ctx.fillText('♫', x + w - 18, y + h * 0.5 + note2Bob);
    ctx.restore();
  }

  private drawShortPauseNoteBubble(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    frame: StyleFrameContext,
    motionScale: number,
    alpha: number
  ): void {
    const w = 64;
    const h = 40;
    const t = frame.timeSeconds || 0;
    const bass = frame.audio.bassEnergy ?? 0;
    const beatBob =
      motionScale === 0
        ? 0
        : Math.sin(t * 4.5) * 2.2 * Math.min(1.2, motionScale) -
          (frame.audio.beatDetected ? 1.4 * Math.min(1.2, motionScale) : 0);
    const pulseScale =
      motionScale > 0 && frame.audio.isDownbeat
        ? 1.13
        : motionScale > 0 && frame.audio.beatDetected
        ? 1.08
        : 1.0 + bass * 0.06 * Math.min(1, motionScale);

    ctx.save();
    ctx.globalAlpha = alpha;
    drawBubbleWithTail(ctx, x, y, w, h, 18, 'left', true);
    ctx.fillStyle = IMSG_CHARCOAL;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const cx = x + w * 0.5;
    const cy = y + h * 0.5 + beatBob;
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 16);
    glow.addColorStop(0, 'rgba(10, 132, 255, 0.42)');
    glow.addColorStop(1, 'rgba(10, 132, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, 16, 0, Math.PI * 2);
    ctx.fill();

    drawAppleEmoji(ctx, '🎵', cx, cy, 20 * pulseScale);
    ctx.restore();
  }

  private drawTypingIndicator(
    ctx: CanvasRenderingContext2D,
    side: BubbleSide,
    x: number,
    y: number,
    frame: StyleFrameContext,
    motionScale: number,
    variationIdx: number,
    alpha = 1.0
  ): void {
    const w = 68;
    const h = 36;
    const beatScale =
      motionScale > 0 && frame.audio.beatDetected ? 1 + 0.08 * motionScale : 1.0;

    ctx.save();
    ctx.globalAlpha = alpha;
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    ctx.translate(cx, cy);
    ctx.scale(beatScale, beatScale);
    ctx.translate(-cx, -cy);

    drawBubbleWithTail(ctx, x, y, w, h, 18, side, true);
    ctx.fillStyle =
      side === 'right' ? (variationIdx === 3 ? IMSG_GREEN : IMSG_BLUE) : IMSG_CHARCOAL;
    ctx.fill();

    for (let d = 0; d < 3; d++) {
      const phase = motionScale === 0 ? 0.5 : Math.sin(frame.timeSeconds * 7.5 - d * 0.85);
      const dy = motionScale === 0 ? 0 : -2.6 * Math.max(0, phase) * Math.min(1.2, motionScale);
      const dotAlpha = motionScale === 0 ? 0.72 : 0.48 + 0.52 * Math.max(0, phase);
      ctx.globalAlpha = alpha * dotAlpha;
      ctx.fillStyle = '#e5e7eb';
      ctx.beginPath();
      ctx.arc(x + 20 + d * 14, y + h * 0.5 + dy, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  render(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    width: number,
    height: number
  ): void {
    const isTransparent = isTransparentStage(frame);
    const motionScale = this.getMotionScale(frame);
    const variationIdx = this.getVariationIndex(frame.variationId ?? 'ios-dark');
    const bgOpacity = clamp01(frame.backgroundOpacity ?? 1.0);
    const vignetteStrength = clamp01(frame.vignetteStrength ?? 0.5);

    if (!isTransparent) {
      ctx.save();
      ctx.globalAlpha = bgOpacity;
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      if (variationIdx === 1) {
        // liquid-glass ambient dark stage
        bg.addColorStop(0, '#070910');
        bg.addColorStop(0.5, '#0f1422');
        bg.addColorStop(1, '#06080d');
      } else if (variationIdx === 2) {
        // cinema-edit deep anamorphic dark
        bg.addColorStop(0, '#040407');
        bg.addColorStop(0.5, '#0c0d14');
        bg.addColorStop(1, '#040407');
      } else {
        bg.addColorStop(0, '#09090d');
        bg.addColorStop(0.55, '#111218');
        bg.addColorStop(1, '#08090d');
      }
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      if (variationIdx === 1) {
        // Ambient album glow behind liquid glass bubbles
        const glow = ctx.createRadialGradient(
          width * 0.52,
          height * 0.48,
          20,
          width * 0.52,
          height * 0.48,
          Math.max(width, height) * 0.55
        );
        glow.addColorStop(0, frame.palette.accentPrimary);
        glow.addColorStop(0.5, frame.palette.accentSecondary);
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.globalAlpha = bgOpacity * (0.16 + frame.audio.bassEnergy * 0.1);
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();
    }

    const focal = getFocalRect(frame, width);
    const focalWidth = focal.width;
    const lyrics = frame.lyrics;
    const layout = frame.layout;
    if (!lyrics || !layout || lyrics.lines.length === 0 || layout.lines.length === 0) {
      this.drawVoiceNoteGapBubble(ctx, focal.left + focalWidth * 0.5 - 99, height * 0.5 - 22, frame, motionScale, 1.0);
      return;
    }

    const trackId = frame.trackMetadata?.id ?? lyrics.providerName ?? '';
    const scriptMode: LyricsScriptMode = frame.scriptMode ?? 'auto';
    this.ensurePrecomputed(ctx, lyrics, layout, focalWidth, trackId, scriptMode);
    if (this.bubbles.length === 0) {
      this.drawVoiceNoteGapBubble(ctx, focal.left + focalWidth * 0.5 - 99, height * 0.5 - 22, frame, motionScale, 1.0);
      return;
    }

    // Map frame activeLineIndex / lastActiveLineIndex into non-blank bubble index
    let resolvedBubbleIdx = -1;
    if (frame.activeLineIndex >= 0 && frame.activeLineIndex < this.lineToBubbleIdx.length) {
      const mapped = this.lineToBubbleIdx[frame.activeLineIndex];
      if (mapped >= 0) {
        resolvedBubbleIdx = mapped;
        this.lastKnownActiveIdx = mapped;
      }
    }
    if (resolvedBubbleIdx < 0 && typeof frame.lastActiveLineIndex === 'number' && frame.lastActiveLineIndex >= 0) {
      for (let li = Math.min(this.lineToBubbleIdx.length - 1, frame.lastActiveLineIndex); li >= 0; li--) {
        if (this.lineToBubbleIdx[li] >= 0) {
          resolvedBubbleIdx = this.lineToBubbleIdx[li];
          break;
        }
      }
    }
    if (resolvedBubbleIdx < 0 && this.lastKnownActiveIdx >= 0) {
      resolvedBubbleIdx = this.lastKnownActiveIdx;
    }
    if (resolvedBubbleIdx < 0) {
      resolvedBubbleIdx = 0;
      for (let bIdx = 0; bIdx < this.bubbles.length; bIdx++) {
        if (lyrics.lines[this.bubbles[bIdx].lineIndex].startSeconds <= frame.timeSeconds) {
          resolvedBubbleIdx = bIdx;
        } else {
          break;
        }
      }
    }
    const activeIdx = Math.max(0, Math.min(this.bubbles.length - 1, resolvedBubbleIdx));
    const activeBubble = this.bubbles[activeIdx];
    const activeLineIsBlank =
      frame.activeLineIndex >= 0 &&
      (frame.activeLineIndex >= this.lineToBubbleIdx.length ||
        this.lineToBubbleIdx[frame.activeLineIndex] < 0);

    // Resolve next non-blank bubble & gap telemetry BEFORE computing scrollY & bubble positions
    let nextLineIdx =
      typeof frame.nextLineIndex === 'number' &&
      frame.nextLineIndex >= 0 &&
      frame.nextLineIndex < this.lineToBubbleIdx.length &&
      this.lineToBubbleIdx[frame.nextLineIndex] >= 0
        ? frame.nextLineIndex
        : -1;
    if (nextLineIdx < 0) {
      for (let bIdx = 0; bIdx < this.bubbles.length; bIdx++) {
        const li = this.bubbles[bIdx].lineIndex;
        if (lyrics.lines[li].startSeconds > frame.timeSeconds) {
          nextLineIdx = li;
          break;
        }
      }
    }
    const nextBubbleIdx = nextLineIdx >= 0 ? this.lineToBubbleIdx[nextLineIdx] : -1;
    const prevBubbleIdx =
      nextBubbleIdx > 0 ? nextBubbleIdx - 1 : nextBubbleIdx < 0 ? this.bubbles.length - 1 : -1;
    const nextLine = nextLineIdx >= 0 ? lyrics.lines[nextLineIdx] : null;
    const prevLineObj =
      prevBubbleIdx >= 0 ? lyrics.lines[this.bubbles[prevBubbleIdx].lineIndex] : null;
    const prevEnd = prevLineObj
      ? prevLineObj.words.length > 0
        ? Math.min(prevLineObj.endSeconds, prevLineObj.words[prevLineObj.words.length - 1].endSeconds)
        : prevLineObj.endSeconds
      : 0;
    const timeUntilNext =
      nextLine
        ? typeof frame.timeUntilNextLine === 'number' && Number.isFinite(frame.timeUntilNextLine)
          ? frame.timeUntilNextLine
          : Math.max(0, nextLine.startSeconds - frame.timeSeconds)
        : Number.POSITIVE_INFINITY;
    const gapDur = nextLine ? Math.max(0, nextLine.startSeconds - prevEnd) : Number.POSITIVE_INFINITY;

    const inGapWindow =
      frame.activeLineIndex < 0 ||
      activeLineIsBlank ||
      Boolean(frame.isInstrumentalGap) ||
      (nextBubbleIdx > 0 && frame.timeSeconds >= prevEnd) ||
      (nextBubbleIdx < 0 && frame.timeSeconds >= prevEnd);

    let gapMode: 'none' | 'voiceNote' | 'shortPause' | 'typing' = 'none';
    let gapAlpha = 1.0;

    if (inGapWindow) {
      if (nextBubbleIdx < 0) {
        gapMode = 'voiceNote';
        gapAlpha = 1.0;
      } else if (gapDur >= 4.0) {
        if (timeUntilNext > 1.5) {
          gapMode = 'voiceNote';
          gapAlpha = 1.0;
        } else if (timeUntilNext > 1.25) {
          gapMode = 'voiceNote';
          gapAlpha = clamp01((timeUntilNext - 1.25) / 0.25);
        } else if (timeUntilNext > 0) {
          gapMode = 'typing';
          gapAlpha = clamp01((1.25 - timeUntilNext) / 0.12);
        }
      } else if (gapDur > 1.5) {
        if (timeUntilNext > 1.5) {
          gapMode = 'shortPause';
          gapAlpha = 1.0;
        } else if (timeUntilNext > 1.25) {
          gapMode = 'shortPause';
          gapAlpha = clamp01((timeUntilNext - 1.25) / 0.25);
        } else if (timeUntilNext > 0) {
          gapMode = 'typing';
          gapAlpha = clamp01((1.25 - timeUntilNext) / 0.12);
        }
      } else if (gapDur >= 0.5) {
        if (timeUntilNext > 0 && timeUntilNext <= 1.5) {
          gapMode = 'typing';
          gapAlpha = 1.0;
        }
      } else if (frame.isInstrumentalGap) {
        gapMode = 'shortPause';
        gapAlpha = 1.0;
      }
    }

    const hasActiveGapSlot = gapMode !== 'none';
    const gapSlotH = 58;
    const targetGapShift = hasActiveGapSlot ? gapSlotH : 0;
    if (hasActiveGapSlot) {
      this.gapSplitBubbleIdx = nextBubbleIdx >= 0 ? nextBubbleIdx : this.bubbles.length;
    }

    let targetScrollY = activeBubble.centerY;
    if (hasActiveGapSlot) {
      if (nextBubbleIdx === 0) {
        targetScrollY = this.bubbles[0].topY - 10;
      } else if (prevBubbleIdx >= 0) {
        const prevB = this.bubbles[prevBubbleIdx];
        const prevBottom = prevB.topY + prevB.bubbleH + (prevB.cardH > 0 ? prevB.cardH + 6 : 0);
        targetScrollY = prevBottom + 34;
      }
    }

    const dt = Math.max(0.001, Math.min(0.05, frame.deltaSeconds));
    const isTimeJump =
      !this.initialized ||
      frame.didSeekThisFrame ||
      frame.reduceMotion ||
      Math.abs(frame.timeSeconds - this.lastRenderTimeSec) > 0.35;
    this.lastRenderTimeSec = frame.timeSeconds;

    if (!this.initialized || frame.didSeekThisFrame || frame.reduceMotion) {
      this.scrollY = targetScrollY;
      this.scrollVel = 0;
      this.gapShiftPx = targetGapShift;
      this.initialized = true;
    } else {
      const stiffness = 110 * (0.6 + motionScale * 0.4);
      const damping = 18;
      const force = (targetScrollY - this.scrollY) * stiffness;
      this.scrollVel += (force - this.scrollVel * damping) * dt;
      this.scrollY += this.scrollVel * dt;
      if (isTimeJump) {
        this.gapShiftPx = targetGapShift;
      } else {
        this.gapShiftPx += (targetGapShift - this.gapShiftPx) * (1 - Math.exp(-dt * 12));
      }
    }
    if (!hasActiveGapSlot && this.gapShiftPx < 0.4) {
      this.gapShiftPx = 0;
      this.gapSplitBubbleIdx = -1;
    }

    const manualOffset = Number.isFinite(frame.manualScrollY) ? (frame.manualScrollY ?? 0) : 0;
    const effectiveScrollY = Math.max(
      -height * 0.35,
      Math.min(this.totalThreadHeight + height * 0.35, this.scrollY + manualOffset)
    );

    const isKineticMode = variationIdx === 0;
    const isBrowsing = frame.isFollowingPlayback === false || Math.abs(manualOffset) > 3;
    const rawKineticZoom =
      typeof frame.iosKineticZoom === 'number' && Number.isFinite(frame.iosKineticZoom)
        ? Math.max(0.75, Math.min(1.85, frame.iosKineticZoom))
        : 1.45;
    const kineticZoom = isKineticMode ? rawKineticZoom : 1.0;

    const marginSide = Math.max(24, Math.round(focalWidth * 0.09));
    const padX = Math.max(16, Math.round(layout.fontSizePx * 0.72));
    const padY = Math.max(11, Math.round(layout.fontSizePx * 0.48));
    const anchorY = isKineticMode
      ? height * (isTransparent ? 0.56 : 0.62)
      : height * (isTransparent ? 0.52 : 0.5);
    const unsyncedOrLineLevel = isUnsyncedLyrics(frame) || frame.activeWordIndex < 0;

    if (variationIdx === 10) {
      this.renderWalletLedger(
        ctx,
        frame,
        lyrics,
        layout,
        focal.left,
        focalWidth,
        height,
        activeIdx,
        effectiveScrollY,
        motionScale
      );
      return;
    }
    if (variationIdx === 11) {
      this.renderCityWalkMap(
        ctx,
        frame,
        lyrics,
        layout,
        focal.left,
        focalWidth,
        height,
        activeIdx,
        motionScale
      );
      return;
    }
    if (variationIdx === 12) {
      this.renderLockScreenAlerts(
        ctx,
        frame,
        lyrics,
        layout,
        focal.left,
        focalWidth,
        height,
        activeIdx,
        effectiveScrollY,
        motionScale
      );
      return;
    }

    // Subtle 3D tilt/drift + Cinema-Edit focal zoom (disabled in reduceMotion)
    const tiltAngle =
      motionScale === 0 ? 0 : Math.sin(frame.timeSeconds * 0.45) * 0.008 * motionScale;
    const driftX =
      motionScale === 0 ? 0 : Math.cos(frame.timeSeconds * 0.35) * 4.0 * motionScale;
    const cinemaZoom =
      variationIdx === 2
        ? 1.05 + (motionScale > 0 ? frame.audio.bassEnergy * 0.042 : 0)
        : 1.0;

    ctx.save();
    // WS2: no hard focal.left clip; only translate content cleanly into focal area
    if (focal.left > 0) ctx.translate(focal.left, 0);

    // Minimal dark frosted Messages header bar (non-transparent full stage only; omitted in split view)
    const showHeader = !isTransparent && focal.left === 0;
    if (showHeader) {
      ctx.save();
      ctx.fillStyle = isKineticMode ? 'rgba(6, 7, 10, 0.88)' : 'rgba(18, 18, 22, 0.78)';
      ctx.fillRect(0, 0, focalWidth, 48);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 48);
      ctx.lineTo(focalWidth, 48);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 13px ${IOS_FONT_STACK}`;
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('Messages · Synced Thread', focalWidth * 0.5, 24);
      ctx.restore();
    }

    // Keep thread clear of header bar and top-right NowPlaying window controls
    const topClipY = showHeader ? 49 : isTransparent ? 0 : 62;
    const minY = isKineticMode ? -height : topClipY;
    const maxY = height + 60;
    const hoveredIdx = frame.hoveredLineIndex ?? -1;

    ctx.save();
    if (topClipY > 0) {
      ctx.beginPath();
      ctx.rect(0, topClipY, focalWidth, Math.max(1, height - topClipY));
      ctx.clip();
    }

    // Apply macro camera zoom (Kinetic Messages) or Cinema Edit / micro drift transform around focal bubble stage
    const combinedZoom = cinemaZoom * kineticZoom;
    if (tiltAngle !== 0 || driftX !== 0 || combinedZoom !== 1.0) {
      ctx.translate(focalWidth * 0.5 + driftX, anchorY);
      if (combinedZoom !== 1.0) ctx.scale(combinedZoom, combinedZoom);
      if (tiltAngle !== 0) ctx.rotate(tiltAngle);
      ctx.translate(-focalWidth * 0.5, -anchorY);
    }

    // Keep left/right bubble columns inside the zoomed viewport bounds when Kinetic Zoom > 1x
    const zoomedMaxHalf = (focalWidth * 0.5 - 18) / Math.max(1.0, combinedZoom);
    const zoomedLeftBound = focalWidth * 0.5 - zoomedMaxHalf;
    const zoomedRightBound = focalWidth * 0.5 + zoomedMaxHalf;
    const laneLeftX = Math.max(marginSide, zoomedLeftBound);
    const laneRightEdge = Math.min(focalWidth - marginSide, zoomedRightBound);

    for (let i = 0; i < this.bubbles.length; i++) {
      // Strict Zero Future Preview in Kinetic Messages (never render upcoming bubbles below active bubble)
      if (isKineticMode && !isBrowsing && i > activeIdx) {
        continue;
      }

      const b = this.bubbles[i];
      const lineIdx = b.lineIndex;
      const lineObj = lyrics.lines[lineIdx];
      const measured = layout.lines[lineIdx];
      const slotShift = this.gapSplitBubbleIdx >= 0 && i >= this.gapSplitBubbleIdx ? this.gapShiftPx : 0;
      const popInOffsetY =
        isKineticMode && i === activeIdx && motionScale > 0
          ? (1 - easeOutBack(clamp01((frame.timeSeconds - lineObj.startSeconds) / 0.28))) * 22
          : 0;
      const screenY = anchorY + (b.topY - effectiveScrollY) + slotShift + popInOffsetY;
      const totalH = b.bubbleH + (b.cardH > 0 ? b.cardH + 6 : 0);
      if (screenY + totalH < minY || screenY > maxY) continue;

      const isActive =
        !activeLineIsBlank && frame.activeLineIndex >= 0 && lineIdx === frame.activeLineIndex;
      const isHovered = lineIdx === hoveredIdx;
      const isPast =
        i < activeIdx ||
        ((frame.activeLineIndex < 0 || activeLineIsBlank) && lineObj.endSeconds < frame.timeSeconds);
      const dist = Math.abs(i - activeIdx);

      // In Kinetic Messages, snugly hug revealed words width & height so partial lines never leave an oversized empty bubble
      let drawBubbleW = b.bubbleW;
      let drawBubbleH = b.bubbleH;
      if (isKineticMode && isActive && !unsyncedOrLineLevel && measured.words.length > 0) {
        const clampedAw = Math.max(0, Math.min(measured.words.length - 1, frame.activeWordIndex));
        let revMaxRight = 0;
        let revMaxBottom = 0;
        for (let rw = 0; rw <= clampedAw; rw++) {
          const wObj = measured.words[rw];
          const rEdge = wObj.x + wObj.width;
          const bEdge = wObj.y + Math.max(layout.fontSizePx * 1.15, wObj.height);
          if (rEdge > revMaxRight) revMaxRight = rEdge;
          if (bEdge > revMaxBottom) revMaxBottom = bEdge;
        }
        const emojiPad = b.inlineEmoji && clampedAw >= measured.words.length - 1 ? layout.fontSizePx + 8 : 0;
        drawBubbleW = Math.min(
          b.bubbleW,
          Math.max(Math.round(revMaxRight + padX * 2 + emojiPad), 92)
        );
        const subH = b.secondaryText ? Math.round(layout.fontSizePx * 0.92) : 0;
        drawBubbleH = Math.min(
          b.bubbleH,
          Math.max(Math.round(revMaxBottom + padY * 2 + subH), Math.round(layout.fontSizePx * 1.2 + padY * 2))
        );
      }

      // Record hit rectangle in canvas coordinate space (spanning bubble row for responsive click-to-seek)
      frame.recordHitRect?.(
        lineIdx,
        focal.left + laneLeftX,
        screenY - 4,
        Math.max(drawBubbleW, laneRightEdge - laneLeftX),
        Math.max(drawBubbleH + (b.cardH > 0 ? b.cardH + 14 : 0), totalH) + 8
      );

      // Timestamp group header
      if (b.timestampLabel) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `600 11px ${IOS_FONT_STACK}`;
        ctx.fillStyle = '#94a3b8';
        ctx.globalAlpha = isActive || isPast ? 0.72 : 0.35;
        ctx.fillText(b.timestampLabel, focalWidth * 0.5, screenY - 14);
        ctx.restore();
      }

      const bx =
        variationIdx === 13
          ? b.side === 'right'
            ? laneRightEdge - drawBubbleW
            : laneLeftX + 14
          : b.side === 'right'
          ? laneRightEdge - drawBubbleW
          : laneLeftX;
      const by = screenY;

      if (variationIdx === 13 && b.side === 'left' && (isActive || isPast || dist <= 2)) {
        ctx.save();
        ctx.font = `600 10.5px ${IOS_FONT_STACK}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#9ca3af';
        ctx.globalAlpha = isActive ? 0.88 : 0.55;
        ctx.fillText(b.senderName, bx + 6, by - 9);
        ctx.restore();
      }
      const rowAlpha = isActive
        ? 1.0 * frame.lineFadeAlpha
        : isHovered
        ? 0.94
        : isPast
        ? Math.max(0.42, 0.82 - dist * 0.14)
        : Math.max(0.18, 0.34 - dist * 0.06);

      const lineElapsed = Math.max(0, frame.timeSeconds - lineObj.startSeconds);
      const emojiWord =
        b.emojiWordIndex >= 0 && b.emojiWordIndex < measured.words.length
          ? measured.words[b.emojiWordIndex]
          : null;
      const hasWordSyncEmoji = emojiWord !== null && !unsyncedOrLineLevel;
      const emojiWordHit =
        !isActive ||
        !hasWordSyncEmoji ||
        frame.activeWordIndex >= b.emojiWordIndex ||
        frame.timeSeconds >= emojiWord.startSeconds;
      let emojiPop = 1.0;
      if (isActive && motionScale > 0) {
        if (hasWordSyncEmoji && emojiWord) {
          const elapsed =
            frame.timeSeconds >= emojiWord.startSeconds
              ? frame.timeSeconds - emojiWord.startSeconds
              : frame.activeWordIndex > b.emojiWordIndex
              ? 0.52
              : Math.max(0, frame.wordProgress) * 0.52;
          emojiPop = clamp01(elapsed / 0.52);
        } else {
          emojiPop = clamp01(lineElapsed / 0.52);
        }
      }

      const isContextualTapback = b.presentationMode === 'tapback' && hasWordSyncEmoji;
      const showTapback = Boolean(b.tapback && (isPast || (isActive && (!isContextualTapback || emojiWordHit))));
      const tapPop = isContextualTapback
        ? isPast
          ? 1.0
          : emojiPop
        : isActive && motionScale > 0
        ? clamp01(lineElapsed / 0.52)
        : 1.0;

      // Pop-in scale + incoming rotational tilt (+/-3.5 deg -> 0) on active bubble entrance
      const enterScale =
        isActive && motionScale > 0 && lineElapsed < 0.35
          ? 0.94 + 0.06 * easeOutBack(lineElapsed / 0.35)
          : 1.0;
      const enterTiltRad =
        variationIdx === 0 && isActive && motionScale > 0 && lineElapsed < 0.38
          ? ((b.side === 'left' ? -3.5 : 3.5) * (Math.PI / 180)) *
            (1 - Math.min(1, lineElapsed / 0.38)) *
            motionScale
          : 0;
      const tapNudgeScale =
        isActive && showTapback && motionScale > 0 && tapPop > 0 && tapPop < 1
          ? 1.0 + 0.028 * Math.sin(tapPop * Math.PI)
          : 1.0;
      const popScale = enterScale * tapNudgeScale;

      ctx.save();
      ctx.globalAlpha = rowAlpha;
      if (popScale !== 1.0 || enterTiltRad !== 0) {
        const pivotX = b.side === 'right' ? bx + drawBubbleW : bx;
        const pivotY = by + drawBubbleH * 0.5;
        ctx.translate(pivotX, pivotY);
        if (popScale !== 1.0) ctx.scale(popScale, popScale);
        if (enterTiltRad !== 0) ctx.rotate(enterTiltRad);
        ctx.translate(-pivotX, -pivotY);
      }

      // Bubble fill per variation + subtle glow on active/hovered
      drawBubbleWithTail(ctx, bx, by, drawBubbleW, drawBubbleH, 18, b.side, b.showTail);
      const outgoingPrimary = variationIdx === 3 ? IMSG_GREEN : IMSG_BLUE;
      if (variationIdx === 1) {
        const glassGrad = ctx.createLinearGradient(bx, by, bx, by + b.bubbleH);
        if (b.side === 'right') {
          glassGrad.addColorStop(0, 'rgba(10, 132, 255, 0.52)');
          glassGrad.addColorStop(1, 'rgba(10, 132, 255, 0.28)');
        } else {
          glassGrad.addColorStop(0, 'rgba(52, 54, 66, 0.62)');
          glassGrad.addColorStop(1, 'rgba(32, 34, 42, 0.42)');
        }
        ctx.fillStyle = glassGrad;
      } else {
        ctx.fillStyle = b.side === 'right' ? outgoingPrimary : IMSG_CHARCOAL;
      }

      if (isActive || isHovered) {
        ctx.shadowColor =
          b.side === 'right'
            ? variationIdx === 3
              ? 'rgba(48, 209, 88, 0.45)'
              : 'rgba(10, 132, 255, 0.45)'
            : 'rgba(255, 255, 255, 0.16)';
        ctx.shadowBlur = isActive ? 18 : 12;
      }
      ctx.fill();
      ctx.shadowBlur = 0;

      if (variationIdx === 1 || isHovered || (variationIdx === 0 && isActive)) {
        ctx.strokeStyle = isHovered
          ? 'rgba(255, 255, 255, 0.48)'
          : variationIdx === 0 && isActive
          ? b.side === 'right'
            ? 'rgba(147, 197, 253, 0.85)'
            : 'rgba(226, 232, 240, 0.45)'
          : 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = variationIdx === 0 && isActive ? 1.5 : isHovered ? 1.5 : 1;
        ctx.stroke();
      }

      // Word-by-word illumination + Precomputed Magic Word effects inside bubble
      ctx.font = `${isKineticMode && isActive ? 600 : 500} ${layout.fontSizePx}px ${IOS_FONT_STACK}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const textOriginX = bx + padX;
      const textOriginY = by + padY;

      for (let w = 0; w < measured.words.length; w++) {
        const word = measured.words[w];
        const wx = textOriginX + word.x;
        const wy = textOriginY + word.y;
        const magicKind = b.wordEffects[w];

        if (!isActive || unsyncedOrLineLevel) {
          const wordAlpha = rowAlpha * (isActive ? 1.0 : 0.92);
          if (magicKind && (isActive || isPast)) {
            this.drawMagicWord(
              ctx,
              word.text,
              wx,
              wy,
              word.width,
              word.height,
              magicKind,
              frame,
              motionScale,
              wordAlpha,
              w
            );
          } else {
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = wordAlpha;
            ctx.fillText(word.text, wx, wy);
          }
        } else {
          const isWordCurrent = w === frame.activeWordIndex;
          const isWordPassed = w < frame.activeWordIndex;
          if (isWordCurrent) {
            const p = clamp01(frame.wordProgress);
            const revealT = isKineticMode ? clamp01(p / 0.36) : 1.0;
            const blurSpringY =
              isKineticMode && motionScale > 0
                ? (1 - easeOutBack(revealT)) * 9
                : motionScale > 0
                ? -1.8 * Math.sin(p * Math.PI) * Math.min(1.2, motionScale)
                : 0;
            const revealAlpha = 1.0;
            if (magicKind) {
              this.drawMagicWord(
                ctx,
                word.text,
                wx,
                wy + blurSpringY,
                word.width,
                word.height,
                magicKind,
                frame,
                motionScale,
                revealAlpha,
                w
              );
            } else {
              ctx.fillStyle = '#ffffff';
              ctx.globalAlpha = revealAlpha;
              ctx.shadowColor = isKineticMode ? 'rgba(0, 0, 0, 0.28)' : 'rgba(255, 255, 255, 0.65)';
              ctx.shadowBlur = isKineticMode ? 4 : 8;
              ctx.fillText(word.text, wx, wy + blurSpringY);
              ctx.shadowBlur = 0;
            }
          } else if (isWordPassed) {
            if (magicKind) {
              this.drawMagicWord(
                ctx,
                word.text,
                wx,
                wy,
                word.width,
                word.height,
                magicKind,
                frame,
                motionScale,
                0.98,
                w
              );
            } else {
              ctx.fillStyle = '#ffffff';
              ctx.globalAlpha = 0.98;
              ctx.fillText(word.text, wx, wy);
            }
          } else {
            // Kinetic Messages: ZERO future preview — never pre-render unsung words in grey
            if (isKineticMode) continue;
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = 0.64;
            ctx.fillText(word.text, wx, wy);
          }
        }
      }

      // Optional translation / romanization subtitle inside bubble
      if (b.secondaryText) {
        ctx.save();
        ctx.font = `400 ${Math.max(11, Math.round(layout.fontSizePx * 0.72))}px ${IOS_FONT_STACK}`;
        ctx.fillStyle = 'rgba(248, 250, 252, 0.78)';
        ctx.globalAlpha = rowAlpha * 0.85;
        ctx.fillText(b.secondaryText, textOriginX, textOriginY + measured.height + 2);
        ctx.restore();
      }

      // Inline contextual Apple emoji suffix badge with easeOutBack spring pop-in
      if (b.inlineEmoji && measured.words.length > 0 && (isPast || (isActive && emojiWordHit))) {
        const lastW = measured.words[measured.words.length - 1];
        const emojiSize = Math.round(layout.fontSizePx * 0.96);
        const emojiX = textOriginX + lastW.x + lastW.width + 6;
        const emojiY = textOriginY + lastW.y;
        const popScaleVal =
          isActive && motionScale > 0 && emojiPop < 1
            ? Math.max(0.01, easeOutBack(emojiPop))
            : 1.0;
        const ecx = emojiX + emojiSize * 0.5;
        const ecy = emojiY + emojiSize * 0.5;
        ctx.save();
        ctx.globalAlpha =
          isActive && motionScale > 0 && emojiPop < 1
            ? rowAlpha * clamp01(0.2 + emojiPop * 2.4)
            : rowAlpha;
        if (popScaleVal !== 1.0) {
          ctx.translate(ecx, ecy);
          ctx.scale(popScaleVal, popScaleVal);
          ctx.translate(-ecx, -ecy);
        }
        drawAppleEmoji(ctx, b.inlineEmoji, ecx, ecy, emojiSize);
        ctx.restore();
      }

      // Authentic iOS Tapback Speech-Bubble Pill anchored cleanly to top corner
      if (showTapback && b.tapback) {
        this.drawTapbackBadge(
          ctx,
          b.tapback,
          b.side,
          bx,
          by,
          drawBubbleW,
          rowAlpha,
          tapPop,
          variationIdx,
          motionScale
        );
      }

      // Contextual embed card attached below bubble (full-width card span in Kinetic Messages)
      if (b.embedCard && b.cardH > 0) {
        const cardW =
          isKineticMode && b.embedCard.kind === 'maps'
            ? Math.max(220, laneRightEdge - laneLeftX)
            : Math.min(Math.max(b.bubbleW, 230), Math.round((laneRightEdge - laneLeftX) * 0.85));
        const cardX =
          isKineticMode && b.embedCard.kind === 'maps'
            ? laneLeftX
            : b.side === 'right'
            ? laneRightEdge - cardW
            : laneLeftX;
        const cardY = by + drawBubbleH + (isKineticMode ? 14 : 6);
        ctx.globalAlpha = rowAlpha;
        this.drawEmbedCard(ctx, b.embedCard, cardX, cardY, cardW, b.cardH, frame, motionScale);
      }

      ctx.restore();

      // Subtle glowing active-playing dot next to active bubble while manually browsing
      if (isActive && frame.isFollowingPlayback === false) {
        const dotX = b.side === 'right' ? bx - 14 : bx + b.bubbleW + 14;
        const dotY = by + b.bubbleH * 0.5;
        const dotColor = variationIdx === 3 ? IMSG_GREEN : IMSG_BLUE;
        const pulse =
          motionScale > 0 ? 0.85 + 0.15 * Math.sin(frame.timeSeconds * 4.5) : 1.0;
        ctx.save();
        ctx.globalAlpha = 0.28 * rowAlpha * pulse;
        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(dotX, dotY, 7.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.95 * rowAlpha;
        ctx.shadowColor = dotColor;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(dotX, dotY, 3.6 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Unified non-overlapping gap / short-pause / typing slot rendering
    if (hasActiveGapSlot && gapAlpha > 0.01) {
      const gapY =
        nextBubbleIdx === 0
          ? anchorY + (this.bubbles[0].topY - 32 - effectiveScrollY)
          : (() => {
              const prevB = this.bubbles[prevBubbleIdx >= 0 ? prevBubbleIdx : activeIdx];
              const prevBottom = prevB.topY + prevB.bubbleH + (prevB.cardH > 0 ? prevB.cardH + 6 : 0);
              return anchorY + (prevBottom + 12 - effectiveScrollY);
            })();

      if (gapY + 44 > minY && gapY < maxY) {
        if (gapMode === 'voiceNote') {
          this.drawVoiceNoteGapBubble(ctx, laneLeftX, gapY, frame, motionScale, gapAlpha);
        } else if (gapMode === 'shortPause') {
          this.drawShortPauseNoteBubble(ctx, laneLeftX, gapY, frame, motionScale, gapAlpha);
        } else if (gapMode === 'typing') {
          const nextBubble =
            nextBubbleIdx >= 0 && nextBubbleIdx < this.bubbles.length
              ? this.bubbles[nextBubbleIdx]
              : null;
          const typingSide: BubbleSide = nextBubble ? nextBubble.side : 'left';
          const typingX = typingSide === 'right' ? laneRightEdge - 68 : laneLeftX;
          this.drawTypingIndicator(
            ctx,
            typingSide,
            typingX,
            gapY + 4,
            frame,
            motionScale,
            variationIdx,
            gapAlpha
          );
        }
      }
    }

    ctx.restore(); // end topClipY + kineticZoom region

    // Smooth seamless top vignette fade over older bubbles drifting upward in Kinetic Messages (starts cleanly at y=0 to avoid any seam)
    if (isKineticMode && !isTransparent) {
      const fadeEndY = height * 0.29;
      const topFade = ctx.createLinearGradient(0, 0, 0, fadeEndY);
      topFade.addColorStop(0, 'rgba(6, 7, 11, 0.88)');
      topFade.addColorStop(0.38, 'rgba(6, 7, 11, 0.52)');
      topFade.addColorStop(0.75, 'rgba(6, 7, 11, 0.14)');
      topFade.addColorStop(1, 'rgba(6, 7, 11, 0)');
      ctx.fillStyle = topFade;
      ctx.fillRect(0, 0, focalWidth, fadeEndY);
    }

    ctx.restore();
    if (!isTransparent) {
      if (variationIdx === 2) {
        const barH = Math.round(height * 0.058);
        ctx.save();
        ctx.fillStyle = '#030305';
        ctx.fillRect(0, 0, width, barH);
        ctx.fillRect(0, height - barH, width, barH);
        ctx.restore();
      }

      if (vignetteStrength > 0.02) {
        ctx.save();
        const vig = ctx.createRadialGradient(
          width * 0.5,
          height * 0.5,
          Math.min(width, height) * 0.28,
          width * 0.5,
          height * 0.5,
          Math.max(width, height) * 0.78
        );
        vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vig.addColorStop(1, 'rgba(0, 0, 0, 0.72)');
        ctx.globalAlpha = vignetteStrength * bgOpacity;
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }
    }
  }

  private renderWalletLedger(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    lyrics: Lyrics,
    layout: LyricsLayout,
    focalLeft: number,
    focalWidth: number,
    height: number,
    activeIdx: number,
    _effectiveScrollY: number,
    motionScale: number
  ): void {
    const cx = focalLeft + focalWidth * 0.5;
    const bass = frame.audio.bassEnergy || 0;
    const beatPulse = frame.audio.beatDetected && motionScale > 0 ? 1.0 : bass * 0.65;
    const manualOffset = Number.isFinite(frame.manualScrollY) ? (frame.manualScrollY ?? 0) : 0;
    const isBrowsing = frame.isFollowingPlayback === false || Math.abs(manualOffset) > 3;

    // 1. Sleek dark metallic / album-tinted Apple Card pass anchored cleanly at top (ZERO "Apple Wallet · Live Ledger" header)
    const walletCardW = Math.min(430, Math.max(250, focalWidth * 0.78));
    const walletCardH = Math.min(168, Math.max(120, Math.round(height * 0.225)));
    const walletCardX = cx - walletCardW * 0.5;
    const walletCardY = Math.max(26, Math.round(height * 0.055));

    ctx.save();
    ctx.beginPath();
    ctx.rect(focalLeft, 0, focalWidth, height);
    ctx.clip();

    ctx.save();
    drawRoundedRectPath(ctx, walletCardX, walletCardY, walletCardW, walletCardH, 20);
    const cardGrad = ctx.createLinearGradient(
      walletCardX,
      walletCardY,
      walletCardX + walletCardW,
      walletCardY + walletCardH
    );
    cardGrad.addColorStop(0, '#1e2028');
    cardGrad.addColorStop(0.5, '#14151b');
    cardGrad.addColorStop(1, '#252732');
    ctx.fillStyle = cardGrad;
    ctx.fill();

    // Subtle album-art radial glow inside Apple Card + beat-reactive specular shimmer
    ctx.save();
    ctx.clip();
    const aura = ctx.createRadialGradient(
      walletCardX + walletCardW * 0.82,
      walletCardY + walletCardH * 0.18,
      10,
      walletCardX + walletCardW * 0.75,
      walletCardY + walletCardH * 0.35,
      walletCardW * 0.75
    );
    aura.addColorStop(0, frame.palette.accentPrimary);
    aura.addColorStop(0.55, frame.palette.accentSecondary);
    aura.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.22 + beatPulse * 0.14;
    ctx.fillStyle = aura;
    ctx.fillRect(walletCardX, walletCardY, walletCardW, walletCardH);

    // Brushed metallic diagonal shimmer
    const sweepT = motionScale > 0 ? ((frame.timeSeconds * 0.32) % 1.4) - 0.2 : 0.4;
    const sx = walletCardX + walletCardW * sweepT;
    const shimmer = ctx.createLinearGradient(sx - 60, walletCardY, sx + 60, walletCardY + walletCardH);
    shimmer.addColorStop(0, 'rgba(255,255,255,0)');
    shimmer.addColorStop(0.5, `rgba(255,255,255,${(0.08 + beatPulse * 0.08).toFixed(3)})`);
    shimmer.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = shimmer;
    ctx.fillRect(walletCardX, walletCardY, walletCardW, walletCardH);
    ctx.restore();

    // Metallic rim highlight on Apple Card
    drawRoundedRectPath(ctx, walletCardX, walletCardY, walletCardW, walletCardH, 20);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1.25;
    ctx.stroke();

    // Titanium EMV Chip
    const chipX = walletCardX + 24;
    const chipY = walletCardY + Math.round(walletCardH * 0.42);
    drawRoundedRectPath(ctx, chipX, chipY, 34, 25, 5);
    const chipGrad = ctx.createLinearGradient(chipX, chipY, chipX + 34, chipY + 25);
    chipGrad.addColorStop(0, '#cbd5e1');
    chipGrad.addColorStop(0.5, '#94a3b8');
    chipGrad.addColorStop(1, '#e2e8f0');
    ctx.fillStyle = chipGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(chipX + 12, chipY);
    ctx.lineTo(chipX + 12, chipY + 25);
    ctx.moveTo(chipX + 22, chipY);
    ctx.lineTo(chipX + 22, chipY + 25);
    ctx.moveTo(chipX, chipY + 12.5);
    ctx.lineTo(chipX + 34, chipY + 12.5);
    ctx.stroke();

    // Top-right contactless icon & card brand label
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `700 15px ${IOS_FONT_STACK}`;
    ctx.fillStyle = '#f8fafc';
    ctx.fillText('WaveForm Card', walletCardX + 24, walletCardY + 26);

    const nfcCx = walletCardX + walletCardW - 32;
    const nfcCy = walletCardY + 26;
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.78)';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    for (let ring = 0; ring < 3; ring++) {
      ctx.beginPath();
      ctx.arc(nfcCx - 4, nfcCy, 4 + ring * 4, -0.65, 0.65);
      ctx.stroke();
    }

    // Track title & artist embossed at bottom of card
    const trackTitle = frame.trackMetadata?.title || 'Now Playing';
    const trackArtist = frame.trackMetadata?.artist || 'Apple Pay Cash';
    ctx.font = `600 13px ${IOS_FONT_STACK}`;
    ctx.fillStyle = 'rgba(248, 250, 252, 0.92)';
    ctx.fillText(trackTitle, walletCardX + 24, walletCardY + walletCardH - 36, walletCardW * 0.56);
    ctx.font = `500 11px ${IOS_FONT_STACK}`;
    ctx.fillStyle = 'rgba(203, 213, 225, 0.68)';
    ctx.fillText(trackArtist, walletCardX + 24, walletCardY + walletCardH - 19, walletCardW * 0.56);

    // Beat-reactive card balance display
    const cardTotalDollars = (128.4 + activeIdx * 14.35 + bass * 4.2).toFixed(2);
    ctx.textAlign = 'right';
    ctx.font = `700 16px ${IOS_FONT_STACK}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`$${cardTotalDollars}`, walletCardX + walletCardW - 22, walletCardY + walletCardH - 28);
    ctx.restore();

    // 2. Arrived Transaction Ledger strictly BELOW Apple Card (ZERO future transactions, ZERO truncation)
    const ledgerTop = walletCardY + walletCardH + 22;
    const ledgerBottom = height - 18;
    const ledgerCardW = Math.min(540, Math.max(260, focalWidth - 48));
    const ledgerCardX = cx - ledgerCardW * 0.5;
    const maxEndIdx = isBrowsing ? this.bubbles.length - 1 : activeIdx;

    ctx.save();
    ctx.beginPath();
    ctx.rect(focalLeft, ledgerTop - 4, focalWidth, Math.max(1, ledgerBottom - ledgerTop + 4));
    ctx.clip();

    const lyricFontPx = Math.max(15, Math.min(18, Math.round(layout.fontSizePx * 0.92)));
    const lineStepPx = Math.round(lyricFontPx * 1.26);
    let cursorY = ledgerTop;
    if (isBrowsing) {
      cursorY -= manualOffset * 0.45;
    }

    // Active line pops in at top of ledger; prior arrived lines cascade smoothly downward
    for (let offset = 0; offset < 6; offset++) {
      const i = maxEndIdx - offset;
      if (i < 0) break;
      const b = this.bubbles[i];
      const lineObj = lyrics.lines[b.lineIndex];
      const measured = layout.lines[b.lineIndex];
      const isActive = i === activeIdx && frame.activeLineIndex >= 0;

      const textMaxW = Math.max(120, ledgerCardW - 156);
      ctx.font = `${isActive ? 700 : 600} ${lyricFontPx}px ${IOS_FONT_STACK}`;
      const wrapped = this.wrapTextIntoScratch(ctx, measured.text, textMaxW);
      const wrappedCount = Math.max(1, wrapped.length);
      const rowH = Math.max(68, wrappedCount * lineStepPx + 36);

      const entryAge = Math.max(0, frame.timeSeconds - lineObj.startSeconds);
      const slideOffset =
        offset === 0 && isActive && motionScale > 0 && entryAge < 0.34
          ? (1 - easeOutBack(clamp01(entryAge / 0.34))) * 24
          : 0;
      const y = cursorY + slideOffset;
      cursorY += rowH + 10;

      if (y + rowH < ledgerTop - 10 || y > ledgerBottom + 10) continue;

      const bottomFade = y + rowH > ledgerBottom - 56 ? clamp01((ledgerBottom - y) / 68) : 1.0;
      const alpha = (isActive ? 1.0 * frame.lineFadeAlpha : Math.max(0.28, 0.88 - offset * 0.16)) * bottomFade;

      const amountCents =
        240 + Math.round(((lineObj.text.length * 137 + i * 313) % 9500) * (1 + (isActive ? bass * 0.32 : 0)));
      const amountText = `$${(amountCents / 100).toFixed(2)}`;
      const badgeColor = WALLET_BADGE_COLORS[i % WALLET_BADGE_COLORS.length];
      const subtitle = WALLET_SUBTITLES[i % WALLET_SUBTITLES.length];

      frame.recordHitRect?.(b.lineIndex, ledgerCardX, y, ledgerCardW, rowH);

      ctx.save();
      ctx.globalAlpha = alpha;
      drawRoundedRectPath(ctx, ledgerCardX, y, ledgerCardW, rowH, 16);
      ctx.fillStyle = isActive ? '#1f222b' : '#161820';
      ctx.fill();
      ctx.strokeStyle = isActive ? 'rgba(10, 132, 255, 0.65)' : 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = isActive ? 1.5 : 1;
      ctx.stroke();

      // Merchant rounded icon badge
      const iconBox = 38;
      const iconX = ledgerCardX + 14;
      const iconY = y + (rowH - iconBox) * 0.5;
      drawRoundedRectPath(ctx, iconX, iconY, iconBox, iconBox, 10);
      ctx.fillStyle = badgeColor;
      ctx.fill();
      drawWordIcon(ctx, b.lineIconId, iconX + iconBox * 0.5, iconY + iconBox * 0.5, 20, '#ffffff', 1.0);

      // Full-wrap lyric text (ZERO truncation) + varied subtitle
      const textLeft = iconX + iconBox + 14;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `${isActive ? 700 : 600} ${lyricFontPx}px ${IOS_FONT_STACK}`;
      ctx.fillStyle = '#ffffff';
      let lineY = y + 12;
      for (let li = 0; li < wrappedCount; li++) {
        ctx.fillText(wrapped[li], textLeft, lineY, textMaxW);
        lineY += lineStepPx;
      }

      ctx.font = `500 11.5px ${IOS_FONT_STACK}`;
      ctx.fillStyle = isActive ? '#93c5fd' : '#9ca3af';
      ctx.fillText(subtitle, textLeft, y + rowH - 22, textMaxW);

      // Beat-reactive dollar amount + animated circular Apple Pay checkmark
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = `700 15.5px ${IOS_FONT_STACK}`;
      ctx.fillStyle = isActive ? '#ffffff' : '#d1d5db';
      ctx.fillText(amountText, ledgerCardX + ledgerCardW - (isActive ? 44 : 16), y + rowH * 0.44);

      if (isActive) {
        const ringCx = ledgerCardX + ledgerCardW - 24;
        const ringCy = y + rowH * 0.5;
        const p = clamp01(0.62 + entryAge * 2.2);
        ctx.strokeStyle = IMSG_BLUE;
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(ringCx, ringCy, 11, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * p);
        ctx.stroke();

        const checkP = clamp01((p - 0.3) / 0.7);
        if (checkP > 0.05) {
          ctx.beginPath();
          ctx.moveTo(ringCx - 4.5, ringCy + 0.5);
          ctx.lineTo(ringCx - 1.2, ringCy + 3.8);
          const seg2 = Math.min(1, Math.max(0.18, (checkP - 0.3) / 0.7));
          ctx.lineTo((ringCx - 1.2) + 6.2 * seg2, (ringCy + 3.8) - 7.3 * seg2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    ctx.restore(); // end ledger clip
    ctx.restore(); // end focal clip
  }

  private getMapWaypointX(idx: number): number {
    return idx * 250 + Math.sin(idx * 1.15) * 68;
  }

  private getMapWaypointY(idx: number): number {
    return Math.sin(idx * 0.85) * 155 + Math.cos(idx * 0.42) * 52;
  }

  private renderCityWalkMap(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    lyrics: Lyrics,
    layout: LyricsLayout,
    focalLeft: number,
    focalWidth: number,
    height: number,
    activeIdx: number,
    motionScale: number
  ): void {
    const cx = focalLeft + focalWidth * 0.5;
    const cy = height * 0.56;
    const t = frame.timeSeconds || 0;
    const bass = frame.audio.bassEnergy || 0;
    const activeWpX = this.getMapWaypointX(activeIdx);
    const activeWpY = this.getMapWaypointY(activeIdx);
    const walkSlide = motionScale > 0 ? clamp01(frame.wordProgress || 0) * 14 : 0;
    const targetCamX = activeWpX + walkSlide;
    const targetCamY = activeWpY;

    if (!this.mapCamInit || frame.didSeekThisFrame || frame.reduceMotion) {
      this.mapCamX = targetCamX;
      this.mapCamY = targetCamY;
      this.mapCamInit = true;
    } else {
      const rate = 1 - Math.exp(-Math.max(0.001, frame.deltaSeconds) * 4.5);
      this.mapCamX += (targetCamX - this.mapCamX) * rate;
      this.mapCamY += (targetCamY - this.mapCamY) * rate;
    }

    // Determine city metadata from lyrics/track seed
    let cityLabel = 'San Francisco';
    let streetA = 'Market St';
    const sampleText = lyrics.lines[Math.min(lyrics.lines.length - 1, Math.max(0, activeIdx))]?.text ?? '';
    if (/\btokyo|shibuya|harajuku\b/i.test(sampleText)) {
      cityLabel = 'Tokyo';
      streetA = 'Shibuya';
    } else if (/\bnew york|nyc|brooklyn|manhattan|broadway\b/i.test(sampleText)) {
      cityLabel = 'New York';
      streetA = 'Broadway';
    } else if (/\blondon|soho|thames\b/i.test(sampleText)) {
      cityLabel = 'London';
      streetA = 'Oxford St';
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(focalLeft, 0, focalWidth, height);
    ctx.clip();

    // 1. Procedural Dark-Mode Apple Maps City Canvas
    ctx.fillStyle = '#0b101a';
    ctx.fillRect(focalLeft, 0, focalWidth, height);

    const camX = this.mapCamX;
    const camY = this.mapCamY;

    ctx.save();
    // Varied city parks & organic urban block shapes
    const blockStep = 170;
    const startCellX = Math.floor((camX - focalWidth * 0.65) / blockStep) - 1;
    const endCellX = Math.ceil((camX + focalWidth * 0.65) / blockStep) + 1;
    const startCellY = Math.floor((camY - height * 0.65) / blockStep) - 1;
    const endCellY = Math.ceil((camY + height * 0.65) / blockStep) + 1;

    for (let gx = startCellX; gx <= endCellX; gx++) {
      for (let gy = startCellY; gy <= endCellY; gy++) {
        const sx = cx + gx * blockStep - camX;
        const sy = cy + gy * blockStep - camY;
        const cellHash = Math.abs((gx * 73856093) ^ (gy * 19349663));
        const isPark = cellHash % 6 === 0;

        if (isPark) {
          drawRoundedRectPath(ctx, sx + 12, sy + 12, blockStep - 24, blockStep - 24, 18);
          ctx.fillStyle = '#102921';
          ctx.fill();
          ctx.strokeStyle = '#183d30';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          // Varied city block base + irregular architectural building footprints
          const splitH = (cellHash & 1) === 1;
          drawRoundedRectPath(ctx, sx + 10, sy + 10, blockStep - 20, blockStep - 20, 8);
          ctx.fillStyle = '#131a26';
          ctx.fill();

          ctx.fillStyle = '#1a2436';
          if (splitH) {
            ctx.fillRect(sx + 22, sy + 20, blockStep - 44, 48);
            ctx.fillRect(sx + 24, sy + 82, (blockStep - 56) * 0.55, 58);
            ctx.fillRect(sx + 24 + (blockStep - 56) * 0.55 + 10, sy + 86, (blockStep - 56) * 0.4, 50);
          } else {
            ctx.fillRect(sx + 22, sy + 22, 54, blockStep - 44);
            ctx.fillRect(sx + 88, sy + 22, 58, 66);
            ctx.fillRect(sx + 92, sy + 98, 52, 46);
          }
        }
      }
    }

    // Secondary street grid & primary avenues
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.2;
    for (let gx = startCellX; gx <= endCellX + 1; gx++) {
      const sx = cx + gx * blockStep - camX;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, height);
      ctx.stroke();
    }
    for (let gy = startCellY; gy <= endCellY + 1; gy++) {
      const sy = cy + gy * blockStep - camY;
      ctx.beginPath();
      ctx.moveTo(focalLeft, sy);
      ctx.lineTo(focalLeft + focalWidth, sy);
      ctx.stroke();
    }

    // Winding visible bay/river coastline drawn cleanly over northern grid/blocks (zero streets in water)
    const bayOffsetY = -camY * 0.18 + height * 0.17;
    ctx.fillStyle = '#0e2238';
    ctx.strokeStyle = '#1d3c5e';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(focalLeft - 20, -20);
    for (let sx = focalLeft - 20; sx <= focalLeft + focalWidth + 40; sx += 48) {
      const wx = sx - cx + camX;
      const wy = Math.sin(wx * 0.0036) * 58 + Math.cos(wx * 0.0017) * 34 + bayOffsetY;
      ctx.lineTo(sx, wy);
    }
    ctx.lineTo(focalLeft + focalWidth + 40, -20);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Curved golden-amber Apple Maps expressway highway
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let sx = focalLeft - 40; sx <= focalLeft + focalWidth + 40; sx += 48) {
      const wx = sx - cx + camX;
      const hwY = cy + (Math.sin(wx * 0.0024) * 140 + 185 - (camY % 340));
      if (sx === focalLeft - 40) ctx.moveTo(sx, hwY);
      else ctx.lineTo(sx, hwY);
    }
    ctx.strokeStyle = '#6b4e23';
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = '#b58432';
    ctx.lineWidth = 4.2;
    ctx.stroke();

    // Non-duplicate district labels cleanly clear of stage edges
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 11px ${IOS_FONT_STACK}`;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.36)';
    let labelSlotIdx = 0;
    for (let gx = startCellX; gx <= endCellX; gx += 2) {
      const gy = ((gx % 2 === 0 ? 1 : -1) + Math.round(camY / blockStep));
      const sx = cx + gx * blockStep + blockStep * 0.5 - camX;
      const sy = cy + gy * blockStep + blockStep * 0.5 - camY;
      if (sx < focalLeft + 76 || sx > focalLeft + focalWidth - 76 || sy < 72 || sy > height - 48) {
        continue;
      }
      const dLabel = MAP_DISTRICTS[(Math.abs(gx) + labelSlotIdx++) % MAP_DISTRICTS.length];
      ctx.fillText(dLabel, sx, sy);
    }
    ctx.restore();

    // Clean Apple Maps district badge in top-left corner
    const hudPillX = focalLeft + 20;
    const hudPillY = 20;
    drawRoundedRectPath(ctx, hudPillX, hudPillY, 210, 30, 15);
    ctx.fillStyle = 'rgba(17, 22, 34, 0.86)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `600 11.5px ${IOS_FONT_STACK}`;
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(`Apple Maps · ${cityLabel} · ${streetA}`, hudPillX + 12, hudPillY + 15, 186);

    // 2. Walking Route Polyline connecting ONLY visited pins (0..activeIdx — ZERO future pins!)
    const routeStart = Math.max(0, activeIdx - 5);
    ctx.save();
    ctx.strokeStyle = IMSG_BLUE;
    ctx.lineWidth = 5.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = IMSG_BLUE;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    for (let i = routeStart; i <= activeIdx; i++) {
      const sx = cx + (this.getMapWaypointX(i) - camX);
      const sy = cy + (this.getMapWaypointY(i) - camY);
      if (i === routeStart) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.restore();

    // 3. Trail of max 2-3 recent visited pins behind the active GPS beacon (well separated in world space)
    const trailStart = Math.max(0, activeIdx - 3);
    for (let i = trailStart; i < activeIdx; i++) {
      const b = this.bubbles[i];
      const px = cx + (this.getMapWaypointX(i) - camX);
      const py = cy + (this.getMapWaypointY(i) - camY);
      if (px < focalLeft - 40 || px > focalLeft + focalWidth + 40) continue;

      ctx.save();
      ctx.fillStyle = '#0A84FF';
      ctx.beginPath();
      ctx.arc(px, py, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      const tag = layout.lines[b.lineIndex].text.split(/\s+/).slice(0, 3).join(' ');
      ctx.font = `600 11px ${IOS_FONT_STACK}`;
      const tagW = Math.min(150, ctx.measureText(tag).width + 18);
      drawRoundedRectPath(ctx, px - tagW * 0.5, py + 12, tagW, 22, 11);
      ctx.fillStyle = 'rgba(16, 20, 30, 0.82)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(226, 232, 240, 0.78)';
      ctx.fillText(tag, px, py + 23, tagW - 10);
      ctx.restore();
    }

    // 4. Active Pulsing Blue Apple Maps GPS Beacon + Full-Wrap Non-Colliding Lyric Callout
    const actBubble = this.bubbles[activeIdx];
    if (actBubble) {
      const measured = layout.lines[actBubble.lineIndex];
      const lineObj = lyrics.lines[actBubble.lineIndex];
      const px = cx + (activeWpX - camX);
      const py = cy + (activeWpY - camY);

      // Pulsing GPS radar ring
      const radarPhase = motionScale > 0 ? (t * 1.45) % 1 : 0.35;
      const radarR = 14 + radarPhase * 26 + bass * 8;
      ctx.save();
      ctx.globalAlpha = (1 - radarPhase) * 0.52;
      ctx.fillStyle = IMSG_BLUE;
      ctx.beginPath();
      ctx.arc(px, py, radarR, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0A84FF';
      ctx.beginPath();
      ctx.arc(px, py, 10.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();

      // Generous non-colliding Apple Maps callout card above beacon
      const calloutW = Math.min(460, Math.max(240, focalWidth * 0.72));
      const calloutFontPx = Math.max(17, Math.min(22, Math.round(layout.fontSizePx * 1.05)));
      const calloutStep = Math.round(calloutFontPx * 1.28);
      ctx.font = `700 ${calloutFontPx}px ${IOS_FONT_STACK}`;
      const wrapped = this.wrapTextIntoScratch(ctx, measured.text, calloutW - 36);
      const calloutH = Math.max(76, wrapped.length * calloutStep + 46);

      const boxX = Math.max(focalLeft + 16, Math.min(focalLeft + focalWidth - calloutW - 16, px - calloutW * 0.5));
      const boxY = Math.max(60, py - calloutH - 22);

      frame.recordHitRect?.(actBubble.lineIndex, boxX, boxY, calloutW, calloutH);

      const entryAge = Math.max(0, frame.timeSeconds - lineObj.startSeconds);
      const popScale =
        motionScale > 0 && entryAge < 0.32 ? 0.92 + 0.08 * easeOutBack(clamp01(entryAge / 0.32)) : 1.0;

      ctx.save();
      ctx.globalAlpha = frame.lineFadeAlpha;
      if (popScale !== 1.0) {
        ctx.translate(boxX + calloutW * 0.5, py);
        ctx.scale(popScale, popScale);
        ctx.translate(-(boxX + calloutW * 0.5), -py);
      }

      drawRoundedRectPath(ctx, boxX, boxY, calloutW, calloutH, 18);
      ctx.fillStyle = 'rgba(20, 24, 34, 0.94)';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 22;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(10, 132, 255, 0.72)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Callout ETA sub-row
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `700 11px ${IOS_FONT_STACK}`;
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('1 min walk · Live Route', boxX + 18, boxY + 18);

      // Multi-line bold lyric inside callout
      ctx.font = `700 ${calloutFontPx}px ${IOS_FONT_STACK}`;
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'top';
      let lineY = boxY + 34;
      for (let li = 0; li < wrapped.length; li++) {
        ctx.fillText(wrapped[li], boxX + 18, lineY, calloutW - 36);
        lineY += calloutStep;
      }
      ctx.restore();
    }

    ctx.restore();
  }

  private renderLockScreenAlerts(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    lyrics: Lyrics,
    layout: LyricsLayout,
    focalLeft: number,
    focalWidth: number,
    height: number,
    activeIdx: number,
    _effectiveScrollY: number,
    motionScale: number
  ): void {
    const cx = focalLeft + focalWidth * 0.5;
    const bass = frame.audio.bassEnergy || 0;
    const manualOffset = Number.isFinite(frame.manualScrollY) ? (frame.manualScrollY ?? 0) : 0;
    const isBrowsing = frame.isFollowingPlayback === false || Math.abs(manualOffset) > 3;

    ctx.save();
    ctx.beginPath();
    ctx.rect(focalLeft, 0, focalWidth, height);
    ctx.clip();

    // Subtle Lock Screen ambient wallpaper aura (tinted by album artwork)
    if (!isTransparentStage(frame)) {
      const aura = ctx.createRadialGradient(cx, height * 0.25, 24, cx, height * 0.45, Math.max(focalWidth, height) * 0.65);
      aura.addColorStop(0, frame.palette.accentPrimary);
      aura.addColorStop(0.5, frame.palette.bgMid);
      aura.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.globalAlpha = 0.22 + bass * 0.08;
      ctx.fillStyle = aura;
      ctx.fillRect(focalLeft, 0, focalWidth, height);
      ctx.restore();
    }

    // 1. Crisp large SF Pro Display clock & date strictly inside top 22% (ZERO card overlap)
    const topMargin = Math.max(18, Math.round(height * 0.04));
    const clockFontPx = Math.max(48, Math.min(82, Math.round(height * 0.115)));
    const dateY = topMargin + 10;
    const clockY = dateY + Math.round(clockFontPx * 0.68);
    const totalSec = Math.max(0, Math.floor(frame.timeSeconds || 0));
    const clockMins = Math.floor(totalSec / 60);
    const clockSecs = totalSec % 60;
    const clockText = `${9 + (clockMins % 3)}:${String((41 + clockMins) % 60).padStart(2, '0')}`;
    const subDateLabel = frame.trackMetadata?.artist
      ? `Thursday, Nov 26 · ${frame.trackMetadata.artist} · ${clockMins}:${String(clockSecs).padStart(2, '0')}`
      : 'Thursday, November 26';

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 14.5px ${IOS_FONT_STACK}`;
    ctx.fillStyle = 'rgba(241, 245, 249, 0.82)';
    ctx.fillText(subDateLabel, cx, dateY, focalWidth - 40);

    ctx.font = `700 ${clockFontPx}px ${IOS_FONT_STACK}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 18;
    ctx.fillText(clockText, cx, clockY);
    ctx.shadowBlur = 0;

    // 2. Depth-Stacked Arrived Notification Deck (strictly below top 22% clock area, ZERO future notifications)
    const deckTop = Math.max(Math.round(height * 0.275), clockY + Math.round(clockFontPx * 0.65) + 18);
    const deckBottom = height - 74;
    const baseBannerW = Math.min(540, Math.max(250, focalWidth * 0.84));
    const trackTitle = frame.trackMetadata?.title || 'WaveForm';
    const maxEndIdx = isBrowsing ? Math.min(this.bubbles.length - 1, activeIdx + 2) : activeIdx;

    // Pre-calculate active front card height so back stack cards peek neatly underneath
    const activeBubble = this.bubbles[maxEndIdx];
    const lyricFontPx = Math.max(16, Math.min(19, Math.round(layout.fontSizePx * 0.95)));
    const lineStepPx = Math.round(lyricFontPx * 1.26);
    ctx.font = `600 ${lyricFontPx}px ${IOS_FONT_STACK}`;
    const frontWrappedCount = activeBubble
      ? Math.max(1, this.wrapTextIntoScratch(ctx, layout.lines[activeBubble.lineIndex].text, baseBannerW - 84).length)
      : 1;
    const frontCardH = Math.max(78, frontWrappedCount * lineStepPx + 46);

    // Draw back-to-front depth layers (depth 3 -> depth 0 active card)
    const maxDepth = Math.min(3, maxEndIdx);
    for (let depth = maxDepth; depth >= 0; depth--) {
      const i = maxEndIdx - depth;
      const b = this.bubbles[i];
      const lineObj = lyrics.lines[b.lineIndex];
      const measured = layout.lines[b.lineIndex];
      const isFront = depth === 0;
      const depthScale = isFront ? 1.0 : Math.max(0.8, 1.0 - depth * 0.06);
      const cardW = baseBannerW * depthScale;
      const cardX = cx - cardW * 0.5;

      const entryAge = Math.max(0, frame.timeSeconds - lineObj.startSeconds);
      const popLift =
        isFront && motionScale > 0 && entryAge < 0.34
          ? (1 - easeOutBack(clamp01(entryAge / 0.34))) * 20
          : 0;

      const rowH = isFront ? frontCardH : 74;
      const y = isFront
        ? deckTop + popLift
        : deckTop + frontCardH + 14 + (depth - 1) * 20;

      if (y + rowH > deckBottom + 24) continue;

      const alpha = isFront
        ? 1.0 * frame.lineFadeAlpha
        : depth === 1
        ? 0.68
        : depth === 2
        ? 0.42
        : 0.22;

      if (isFront) {
        frame.recordHitRect?.(b.lineIndex, cardX, y, cardW, rowH);
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      drawRoundedRectPath(ctx, cardX, y, cardW, rowH, 20);
      ctx.fillStyle = isFront ? 'rgba(30, 32, 42, 0.86)' : 'rgba(24, 26, 34, 0.8)';
      ctx.fill();

      // Frosted specular top rim
      ctx.strokeStyle = isFront ? 'rgba(255, 255, 255, 0.28)' : 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = isFront ? 1.25 : 1;
      ctx.stroke();

      if (isFront) {
        // App / artwork rounded icon badge
        const iconBox = 38;
        drawRoundedRectPath(ctx, cardX + 14, y + 16, iconBox, iconBox, 10);
        const badgeGrad = ctx.createLinearGradient(cardX + 14, y + 16, cardX + 52, y + 54);
        badgeGrad.addColorStop(0, frame.palette.accentPrimary || '#FA2D48');
        badgeGrad.addColorStop(1, frame.palette.accentSecondary || '#818CF8');
        ctx.fillStyle = badgeGrad;
        ctx.fill();
        drawWordIcon(ctx, b.lineIconId, cardX + 33, y + 35, 20, '#ffffff', 1.0);

        // Bold title + "now" badge
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = `700 13px ${IOS_FONT_STACK}`;
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(trackTitle, cardX + 62, y + 23, cardW - 130);

        ctx.textAlign = 'right';
        ctx.font = `500 11.5px ${IOS_FONT_STACK}`;
        ctx.fillStyle = 'rgba(226, 232, 240, 0.65)';
        ctx.fillText('now', cardX + cardW - 16, y + 23);

        // Word-by-word glowing full-wrap lyric body inside active alert
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = `600 ${lyricFontPx}px ${IOS_FONT_STACK}`;
        const bodyLines = this.wrapTextIntoScratch(ctx, measured.text, cardW - 84);
        let ly = y + 38;
        for (let li = 0; li < bodyLines.length; li++) {
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = 'rgba(255, 255, 255, 0.25)';
          ctx.shadowBlur = 6;
          ctx.fillText(bodyLines[li], cardX + 62, ly, cardW - 80);
          ctx.shadowBlur = 0;
          ly += lineStepPx;
        }
      } else {
        // Subtle peek title & line preview on stacked cards beneath
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = `500 13px ${IOS_FONT_STACK}`;
        ctx.fillStyle = 'rgba(226, 232, 240, 0.78)';
        ctx.fillText(measured.text, cardX + 18, y + rowH - 18, cardW - 36);
      }

      ctx.restore();
    }

    // 3. Dynamic Island / Live Activity audio waveform pill at bottom
    const liveW = Math.min(290, baseBannerW * 0.76);
    const liveH = 38;
    const liveX = cx - liveW * 0.5;
    const liveY = height - 56;
    drawRoundedRectPath(ctx, liveX, liveY, liveW, liveH, 19);
    ctx.fillStyle = 'rgba(14, 16, 22, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Mini artwork glowing dot + title + 8-bar audio-reactive waveform
    ctx.fillStyle = frame.palette.accentPrimary || '#FA2D48';
    ctx.beginPath();
    ctx.arc(liveX + 20, liveY + liveH * 0.5, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `600 12px ${IOS_FONT_STACK}`;
    ctx.fillStyle = 'rgba(248, 250, 252, 0.86)';
    ctx.fillText(trackTitle, liveX + 36, liveY + liveH * 0.5, liveW - 115);

    const barCount = 8;
    const barStartX = liveX + liveW - 64;
    for (let k = 0; k < barCount; k++) {
      const wave = 0.25 + 0.75 * Math.abs(Math.sin((frame.timeSeconds || 0) * 5.4 + k * 0.75));
      const amp = wave * (0.45 + bass * 0.85) * Math.max(0.25, motionScale);
      const bh = Math.max(4, Math.min(20, Math.round(18 * amp)));
      ctx.fillStyle = k % 2 === 0 ? frame.palette.accentPrimary : frame.palette.accentSecondary;
      drawRoundedRectPath(ctx, barStartX + k * 6.5, liveY + liveH * 0.5 - bh * 0.5, 3.5, bh, 1.5);
      ctx.fill();
    }

    ctx.restore();
  }
}
