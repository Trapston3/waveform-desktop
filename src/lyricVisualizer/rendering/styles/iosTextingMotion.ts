// Style: IosTextingMotion
// Authentic dark-mode iOS Native Design featuring 3 flagship variations:
// 1. messages (unified kinetic popup + classic scrollable dark iMessage thread)
// 2. group-chat (multi-speaker iMessage with circular iOS-gradient user avatar PFPs)
// 3. navigation-map (2.5D Three.js Apple Maps driving engine + CarPlay Turn-by-Turn HUD)
// Strict 60fps with ZERO per-frame heap allocations inside render().

import type {
  Lyrics,
  LyricsLayout,
  LyricsScriptMode,
  MapBiomeKind,
  MapTimeOfDay,
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
import { Maps3DScene } from '../maps3dScene';
import { parseColorToRgbInto } from '../webGlEffectLayer';
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

interface GroupParticipant {
  readonly name: string;
  readonly monogram: string;
  readonly gradStart: string;
  readonly gradEnd: string;
  readonly labelColor: string;
}

const GROUP_PARTICIPANTS: readonly GroupParticipant[] = [
  { name: 'Maya', monogram: 'M', gradStart: '#6366F1', gradEnd: '#818CF8', labelColor: '#818CF8' },
  { name: 'Jordan', monogram: 'J', gradStart: '#FB7185', gradEnd: '#F43F5E', labelColor: '#FB7185' },
  { name: 'Sam', monogram: 'S', gradStart: '#34D399', gradEnd: '#10B981', labelColor: '#34D399' },
  { name: 'Alex', monogram: 'A', gradStart: '#FBBF24', gradEnd: '#F59E0B', labelColor: '#FBBF24' },
] as const;

const GROUP_AVATAR_GUTTER_PX = 38;
const MAX_HERO_WORDS = 48;

interface PrecomputedBubble {
  readonly lineIndex: number;
  readonly side: BubbleSide;
  readonly showTail: boolean;
  readonly senderIdx: number;
  readonly senderName: string;
  readonly isGroupClusterStart: boolean;
  readonly timestampLabel: string | null;
  readonly tapback: TapbackKind | null;
  readonly embedCard: LyricEmbedCard | null;
  readonly inlineEmoji: string | null;
  readonly emojiWordIndex: number;
  readonly presentationMode: PresentationMode;
  readonly wordEffects: readonly (MagicWordKind | null)[];
  readonly wordEmojis: readonly (string | null)[];
  readonly wordIcons: readonly (WordIconId | null)[];
  readonly lineIconId: WordIconId;
  readonly secondaryText: string | null;
  readonly bubbleW: number;
  readonly bubbleH: number;
  readonly cardH: number;
  readonly topY: number;
  readonly centerY: number;
}

const IMSG_BLUE = '#0A84FF';
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

function formatBiomeLabel(biome: MapBiomeKind): string {
  if (biome === 'cityscape') return 'Cityscape';
  if (biome === 'countryside') return 'Countryside';
  return 'Highway';
}

function formatTimeOfDayLabel(tod: MapTimeOfDay): string {
  if (tod === 'day') return 'Day';
  if (tod === 'sunset') return 'Sunset';
  return 'Night';
}

function getBiomeSpeedLimit(biome: MapBiomeKind): string {
  if (biome === 'cityscape') return '35';
  if (biome === 'countryside') return '45';
  return '65';
}

function formatRemainingEta(seconds: number): string {
  const safe = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
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

  // Lazy-initialized 2.5D Three.js Apple Maps engine (disposed cleanly in dispose())
  private mapsScene: Maps3DScene | null = null;

  // Preallocated zero-GC scratch buffers
  private readonly sparkleAngles = new Float32Array([0, 1.0472, 2.0944, 3.1416, 4.1888, 5.236]);
  private readonly electricPtsX = new Float32Array(7);
  private readonly electricPtsY = new Float32Array(7);
  private readonly heroWordX = new Float32Array(MAX_HERO_WORDS);
  private readonly heroWordY = new Float32Array(MAX_HERO_WORDS);
  private readonly heroWordW = new Float32Array(MAX_HERO_WORDS);
  private readonly heroWordHasIcon = new Uint8Array(MAX_HERO_WORDS);
  private readonly tmpRgbA = new Float32Array(3);
  private readonly tmpRgbB = new Float32Array(3);

  private scrollY = 0;
  private scrollVel = 0;
  private lastKnownActiveIdx = -1;
  private gapShiftPx = 0;
  private gapSplitBubbleIdx = -1;
  private lastRenderTimeSec = 0;
  private initialized = false;

  /**
   * Maps 4 flagship variations, safely migrating all legacy variation IDs:
   * - 0: 'messages' (default — migrates kinetic-messages, cinema-edit, ios-dark, classic-sms, wallet, lock-screen)
   * - 1: 'liquid-glass'
   * - 2: 'group-chat'
   * - 3: 'navigation-map' (also accepts legacy 'city-walk-map')
   */
  getVariationIndex(variationId: string): number {
    if (variationId === 'liquid-glass') return 1;
    if (variationId === 'group-chat') return 2;
    if (variationId === 'navigation-map' || variationId === 'city-walk-map') return 3;
    return 0; // 'messages' (and legacy migrations)
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
    this.lastKnownActiveIdx = -1;
    this.gapShiftPx = 0;
    this.gapSplitBubbleIdx = -1;
    this.lastRenderTimeSec = 0;
    this.initialized = false;
    this.mapsScene?.reset();
  }

  dispose(): void {
    if (this.mapsScene) {
      this.mapsScene.dispose();
      this.mapsScene = null;
    }
    this.reset();
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

    // Pass 1: reliable alternation (#262629 left / #0A84FF right), embed cards, timestamps
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
          prev.words.length > 0
            ? Math.min(prev.endSeconds, prev.words[prev.words.length - 1].endSeconds)
            : prev.endSeconds;
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

    // Pass 2: compute bubble geometry, Magic Word effects, semantic emojis, word icons, and Group Chat participants
    let currentLeftSenderIdx = trackSeed % GROUP_PARTICIPANTS.length;

    for (let bIdx = 0; bIdx < nbCount; bIdx++) {
      const lineIdx = nonBlankIndices[bIdx];
      const line = lyrics.lines[lineIdx];
      const measured: MeasuredLineLayout = layout.lines[lineIdx];
      const resolved = resolveDisplayLine(line, scriptMode, this.id);
      const secondaryText = measured.secondaryText ?? resolved.secondaryText;
      const side = sides[bIdx];

      const prevLineEnd = bIdx > 0 ? lyrics.lines[nonBlankIndices[bIdx - 1]].endSeconds : -99;
      const prevSameSpeaker =
        bIdx > 0 &&
        sides[bIdx - 1] === side &&
        line.startSeconds - prevLineEnd <= 0.55 &&
        !timestamps[bIdx];
      const isGroupClusterStart = side === 'left' && !prevSameSpeaker;
      if (isGroupClusterStart && bIdx > 0) {
        currentLeftSenderIdx = (currentLeftSenderIdx + 1) % GROUP_PARTICIPANTS.length;
      }
      const senderIdx = currentLeftSenderIdx;
      const senderName = GROUP_PARTICIPANTS[senderIdx].name;

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
      const wordIcons: (WordIconId | null)[] = new Array(wordCount);
      let lineIconId: WordIconId = 'music';
      let iconCountInLine = 0;

      for (let w = 0; w < wordCount; w++) {
        const wText = measured.words[w].text;
        wordEffects[w] = detectMagicWordEffect(wText);
        wordEmojis[w] = resolveContextualEmoji(wText, trackSeed + bIdx * 31 + w * 17);
        const iconHit = resolveWordIcon(wText, line.text);
        if (iconHit && iconCountInLine < 2) {
          wordIcons[w] = iconHit;
          if (lineIconId === 'music') lineIconId = iconHit;
          iconCountInLine++;
        } else {
          wordIcons[w] = null;
        }
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

      result[bIdx] = {
        lineIndex: lineIdx,
        side,
        showTail,
        senderIdx,
        senderName,
        isGroupClusterStart,
        timestampLabel: timestamps[bIdx],
        tapback,
        embedCard: card,
        inlineEmoji,
        emojiWordIndex,
        presentationMode,
        wordEffects,
        wordEmojis,
        wordIcons,
        lineIconId,
        secondaryText,
        bubbleW,
        bubbleH,
        cardH,
        topY: cursorY,
        centerY: cursorY + rowTotalH * 0.5,
      };

      const nextSpacing = showTail ? 18 : 6;
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

  /**
   * Draws a circular iOS-gradient user avatar PFP beside left-side bubbles in Group Chat.
   */
  private drawGroupAvatarPfp(
    ctx: CanvasRenderingContext2D,
    participant: GroupParticipant,
    cx: number,
    cy: number,
    radius: number,
    alpha: number,
    isActive: boolean
  ): void {
    ctx.save();
    ctx.globalAlpha = alpha;

    // Circular iOS gradient fill
    const grad = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    grad.addColorStop(0, participant.gradStart);
    grad.addColorStop(1, participant.gradEnd);

    if (isActive) {
      ctx.shadowColor = participant.gradStart;
      ctx.shadowBlur = 10;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Crisp iOS glossy specular rim
    ctx.strokeStyle = isActive ? 'rgba(255, 255, 255, 0.52)' : 'rgba(255, 255, 255, 0.24)';
    ctx.lineWidth = isActive ? 1.5 : 1;
    ctx.stroke();

    // Subtle minimalist user silhouette backdrop clipped inside avatar circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 0.6, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.beginPath();
    ctx.arc(cx, cy - radius * 0.2, radius * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy + radius * 0.85, radius * 0.68, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Crisp white SF Pro Display monogram glyph
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(radius * 0.98)}px ${IOS_FONT_STACK}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(participant.monogram, cx, cy + 0.5);

    ctx.restore();
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
    motionScale: number
  ): void {
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

    const pillFill = isHeart || side === 'right' ? '#2C2C2E' : IMSG_BLUE;
    const glassBorder =
      side === 'right' || isHeart ? 'rgba(255, 255, 255, 0.24)' : 'rgba(147, 197, 253, 0.45)';

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

    ctx.shadowColor = 'rgba(0, 0, 0, 0.48)';
    ctx.shadowBlur = 10;
    drawRoundedRectPath(ctx, tapX, tapY, pillW, pillH, 14);
    ctx.fillStyle = pillFill;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = '#09090d';
    ctx.lineWidth = 2;
    ctx.stroke();

    drawRoundedRectPath(ctx, tapX + 1, tapY + 1, pillW - 2, pillH - 2, 13);
    ctx.strokeStyle = glassBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

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
        motionScale === 0 ? 0.5 : t * 0.95 + wordIdx * 0.23 - Math.floor(t * 0.95 + wordIdx * 0.23);
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
      const jitter =
        motionScale === 0 ? 1.4 : Math.sin(t * 36 + wordIdx * 3.1) * 2.2 * Math.min(1.3, motionScale);
      const jitterY =
        motionScale === 0 ? 0 : Math.cos(t * 29 + wordIdx * 2.3) * 1.1 * Math.min(1.3, motionScale);
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
      const ang =
        motionScale === 0 ? 0.08 : Math.sin(t * 5.5 + wordIdx) * 0.14 * Math.min(1.2, motionScale);
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

    const noteBob = motionScale === 0 ? 0 : Math.sin(t * 4.5) * 2.5 * Math.min(1.2, motionScale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 13px ${IOS_FONT_STACK}`;
    ctx.fillStyle = IMSG_BLUE;
    ctx.fillText('♪', x + 20, y + h * 0.5 + noteBob);

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
    ctx.fillStyle = side === 'right' ? IMSG_BLUE : IMSG_CHARCOAL;
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

  // -------------------------------------------------------------------------
  // Variation 3: 2.5D Apple Maps Driving Mode + CarPlay Turn-by-Turn HUD
  // -------------------------------------------------------------------------

  private renderNavigationMap(
    ctx: CanvasRenderingContext2D,
    frame: StyleFrameContext,
    lyrics: Lyrics | null,
    layout: LyricsLayout | null,
    width: number,
    height: number,
    focalLeft: number,
    focalWidth: number,
    activeIdx: number,
    motionScale: number
  ): void {
    if (!this.mapsScene) {
      this.mapsScene = new Maps3DScene();
    }

    const scenePref = frame.mapScene ?? 'auto';
    const timePref = frame.mapTimeOfDay ?? 'auto';
    const env = this.mapsScene.render(
      ctx,
      width,
      height,
      focalLeft,
      focalWidth,
      frame.timeSeconds,
      frame.deltaSeconds,
      frame.audio,
      frame.palette,
      frame.trackMetadata,
      lyrics,
      scenePref,
      timePref,
      frame.reduceMotion,
      frame.didSeekThisFrame
    );

    const isDay = env.timeOfDay === 'day';
    const bpmVal =
      typeof frame.audio.estimatedBpm === 'number' &&
      Number.isFinite(frame.audio.estimatedBpm) &&
      frame.audio.estimatedBpm > 40
        ? Math.round(frame.audio.estimatedBpm)
        : typeof frame.trackMetadata?.bpm === 'number' &&
          Number.isFinite(frame.trackMetadata.bpm) &&
          frame.trackMetadata.bpm > 40
        ? Math.round(frame.trackMetadata.bpm)
        : 118;

    const beatLift =
      motionScale > 0 && frame.audio.isDownbeat
        ? 1.0
        : motionScale > 0 && frame.audio.beatDetected
        ? 0.65
        : 0.0;

    // 1. Top-Right Speed Limit Sign — strictly clear of top-right window controls (top >= 72px)
    const signW = 58;
    const signH = 74;
    const signX = focalLeft + focalWidth - signW - 20;
    const signY = 74;

    ctx.save();
    drawRoundedRectPath(ctx, signX, signY, signW, signH, 9);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.36)';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    drawRoundedRectPath(ctx, signX + 3, signY + 3, signW - 6, signH - 6, 6);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0f172a';
    ctx.font = `800 9.5px ${IOS_FONT_STACK}`;
    ctx.fillText('SPEED', signX + signW * 0.5, signY + 15);
    ctx.fillText('LIMIT', signX + signW * 0.5, signY + 26);
    ctx.font = `800 28px ${IOS_FONT_STACK}`;
    ctx.fillText(getBiomeSpeedLimit(env.biome), signX + signW * 0.5, signY + 52);
    ctx.restore();

    // 2. Single-Source Apple Maps / CarPlay Turn-by-Turn Hero Card (upper-left / upper-center of focal rect)
    const maxCardW = Math.max(240, focalWidth - signW - 56);
    const cardW = Math.min(548, maxCardW);
    const cardX =
      focalLeft +
      Math.max(20, Math.min(36, Math.round((focalWidth - signW - 24 - cardW) * 0.34)));
    const cardY = 22;

    const stripH = 34;
    const subBarH = 28;
    const bodyPadX = 20;
    const bodyPadY = 14;
    const bodyInnerW = Math.max(180, cardW - bodyPadX * 2);

    const hasBubbles = this.bubbles.length > 0 && lyrics !== null && layout !== null;
    const clampedIdx = hasBubbles ? Math.max(0, Math.min(this.bubbles.length - 1, activeIdx)) : -1;
    const activeBubble = clampedIdx >= 0 ? this.bubbles[clampedIdx] : null;
    const activeMeasured =
      activeBubble && layout ? layout.lines[activeBubble.lineIndex] : null;
    const activeLineObj =
      activeBubble && lyrics ? lyrics.lines[activeBubble.lineIndex] : null;
    const nextBubble =
      clampedIdx >= 0 && clampedIdx + 1 < this.bubbles.length ? this.bubbles[clampedIdx + 1] : null;
    const nextLineText =
      nextBubble && layout ? layout.lines[nextBubble.lineIndex].text : null;

    const wordIconsEnabled = frame.wordIconsEnabled !== false;
    const heroFontPx = Math.max(
      18,
      Math.min(26, Math.round((layout?.fontSizePx ?? 24) * 1.12))
    );
    const heroLineStep = Math.round(heroFontPx * 1.32);
    const spaceW = Math.round(heroFontPx * 0.32);
    const iconSlotW = Math.round(heroFontPx * 1.05);

    // Pre-layout hero words into pre-allocated scratch buffers (ZERO per-frame heap allocations)
    ctx.font = `700 ${heroFontPx}px ${IOS_FONT_STACK}`;
    let wordCount = 0;
    let totalHeroLines = 1;

    if (activeBubble && activeMeasured && activeMeasured.words.length > 0) {
      wordCount = Math.min(MAX_HERO_WORDS, activeMeasured.words.length);
      let curX = 0;
      let curLine = 0;
      for (let w = 0; w < wordCount; w++) {
        const wText = activeMeasured.words[w].text;
        const measuredW = ctx.measureText(wText).width;
        const safeW = Number.isFinite(measuredW) ? measuredW : wText.length * heroFontPx * 0.55;
        const hasIcon =
          wordIconsEnabled && w < activeBubble.wordIcons.length && activeBubble.wordIcons[w] !== null
            ? 1
            : 0;
        const totalItemW = safeW + (hasIcon ? iconSlotW : 0);

        if (curX > 0 && curX + totalItemW > bodyInnerW) {
          curLine++;
          curX = 0;
        }
        this.heroWordX[w] = curX;
        this.heroWordY[w] = curLine * heroLineStep;
        this.heroWordW[w] = safeW;
        this.heroWordHasIcon[w] = hasIcon;
        curX += totalItemW + spaceW;
      }
      totalHeroLines = Math.max(1, curLine + 1);
    }

    const bodyH = Math.max(58, totalHeroLines * heroLineStep + bodyPadY * 2 - 4);
    const totalCardH = stripH + bodyH + subBarH;

    if (activeBubble) {
      frame.recordHitRect?.(activeBubble.lineIndex, cardX, cardY, cardW, totalCardH);
    }

    ctx.save();
    // Outer card shadow + glass container
    drawRoundedRectPath(ctx, cardX, cardY, cardW, totalCardH, 20);
    ctx.fillStyle = isDay ? 'rgba(18, 26, 38, 0.90)' : 'rgba(14, 19, 30, 0.90)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.48)';
    ctx.shadowBlur = 24;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Clip interior sections neatly to rounded card
    ctx.save();
    drawRoundedRectPath(ctx, cardX, cardY, cardW, totalCardH, 20);
    ctx.clip();

    // 2a. Top Lane-Guidance Strip (Authentic Apple Maps Emerald Green Header)
    const stripGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + stripH);
    if (isDay) {
      stripGrad.addColorStop(0, '#15803d');
      stripGrad.addColorStop(1, '#166534');
    } else {
      stripGrad.addColorStop(0, '#0f5132');
      stripGrad.addColorStop(1, '#114232');
    }
    ctx.fillStyle = stripGrad;
    ctx.fillRect(cardX, cardY, cardW, stripH);

    // Beat-pulsing lane arrows: ↑  ↑  ↑  ↱
    const laneCy = cardY + stripH * 0.5;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const baseLaneAlpha = 0.46 + beatLift * 0.16;
    ctx.font = `700 15px ${IOS_FONT_STACK}`;
    ctx.fillStyle = `rgba(255, 255, 255, ${baseLaneAlpha.toFixed(2)})`;
    ctx.fillText('↑', cardX + 26, laneCy);
    ctx.fillText('↑', cardX + 46, laneCy);
    ctx.fillText('↑', cardX + 66, laneCy);

    // Active turn arrow pulsing on downbeat / beat
    const turnScale = 1.0 + beatLift * 0.16;
    ctx.save();
    ctx.translate(cardX + 90, laneCy);
    ctx.scale(turnScale, turnScale);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(255, 255, 255, 0.72)';
    ctx.shadowBlur = 6 + beatLift * 8;
    ctx.font = `800 17px ${IOS_FONT_STACK}`;
    ctx.fillText('↱', 0, 0);
    ctx.restore();

    // Right route / BPM badge inside top lane strip
    const exitNumber = 41 + Math.max(0, clampedIdx) * 2;
    const badgeLabel = `EXIT ${exitNumber} · ${bpmVal} BPM`;
    ctx.font = `700 11px ${IOS_FONT_STACK}`;
    const badgeW = Math.min(168, Math.max(114, ctx.measureText(badgeLabel).width + 20));
    const badgeX = cardX + cardW - badgeW - 12;
    const badgeY = cardY + 6;
    drawRoundedRectPath(ctx, badgeX, badgeY, badgeW, stripH - 12, 11);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ecfdf5';
    ctx.fillText(badgeLabel, badgeX + badgeW * 0.5, laneCy + 0.5, badgeW - 10);

    // 2b. Hero Body: Word-by-word bold SF Pro Display active lyric reveal (+ optional wordIconDictionary pop)
    const bodyTopY = cardY + stripH;
    const unsynced = isUnsyncedLyrics(frame) || frame.activeWordIndex < 0;
    const inGap =
      !activeBubble ||
      !activeMeasured ||
      !activeLineObj ||
      frame.activeLineIndex < 0 ||
      Boolean(frame.isInstrumentalGap);

    if (inGap || wordCount === 0) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `700 19px ${IOS_FONT_STACK}`;
      ctx.fillStyle = 'rgba(241, 245, 249, 0.85)';
      const cruiseTitle = frame.trackMetadata?.title
        ? `Cruising · ${frame.trackMetadata.title}`
        : 'Cruising · Following Route';
      ctx.fillText(cruiseTitle, cardX + bodyPadX, bodyTopY + bodyH * 0.5, bodyInnerW);
    } else if (activeBubble && activeMeasured) {
      const textStartX = cardX + bodyPadX;
      const textStartY = bodyTopY + bodyPadY;
      ctx.font = `700 ${heroFontPx}px ${IOS_FONT_STACK}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      for (let w = 0; w < wordCount; w++) {
        const wObj = activeMeasured.words[w];
        const wx = textStartX + this.heroWordX[w];
        const wy = textStartY + this.heroWordY[w];
        const isCurrent = !unsynced && w === frame.activeWordIndex;
        const isPassed = unsynced || w < frame.activeWordIndex;

        if (isCurrent) {
          const p = clamp01(frame.wordProgress);
          const liftY = motionScale > 0 ? -2.4 * Math.sin(p * Math.PI) * Math.min(1.2, motionScale) : 0;
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = 'rgba(56, 189, 248, 0.68)';
          ctx.shadowBlur = 10;
          ctx.fillText(wObj.text, wx, wy + liftY);
          ctx.shadowBlur = 0;
        } else if (isPassed) {
          ctx.fillStyle = '#ffffff';
          ctx.fillText(wObj.text, wx, wy);
        } else {
          ctx.fillStyle = 'rgba(226, 232, 240, 0.34)';
          ctx.fillText(wObj.text, wx, wy);
        }

        // Subtle wordIconDictionary icon pop beside semantic words when enabled
        if (this.heroWordHasIcon[w] === 1 && (isCurrent || isPassed)) {
          const iconId = activeBubble.wordIcons[w];
          if (iconId) {
            const icx = wx + this.heroWordW[w] + iconSlotW * 0.48;
            const icy = wy + heroFontPx * 0.54;
            const popS =
              isCurrent && motionScale > 0
                ? Math.max(0.5, easeOutBack(clamp01(frame.wordProgress * 2.4)))
                : 1.0;
            ctx.save();
            ctx.translate(icx, icy);
            ctx.scale(popS, popS);
            drawWordIcon(
              ctx,
              iconId,
              0,
              0,
              Math.round(heroFontPx * 0.72),
              isCurrent ? '#38bdf8' : '#93c5fd',
              isCurrent ? 0.96 : 0.78
            );
            ctx.restore();
          }
        }
      }
    }

    // 2c. Slim Bottom Sub-Bar (↳ Next: <upcoming line>)
    const subY = bodyTopY + bodyH;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.30)';
    ctx.fillRect(cardX, subY, cardW, subBarH);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX, subY);
    ctx.lineTo(cardX + cardW, subY);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `600 12px ${IOS_FONT_STACK}`;
    ctx.fillStyle = 'rgba(203, 213, 225, 0.84)';
    const nextLabel = nextLineText
      ? `↳ Next: ${nextLineText}`
      : '↳ Arriving at Destination';
    ctx.fillText(nextLabel, cardX + bodyPadX, subY + subBarH * 0.5 + 0.5, cardW - bodyPadX * 2);

    ctx.restore(); // end interior card clip

    // Specular outer rim on CarPlay Hero Card
    drawRoundedRectPath(ctx, cardX, cardY, cardW, totalCardH, 20);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    // 3. Bottom CarPlay ETA Telemetry Pill inside focal rect
    const lastLineEnd =
      lyrics && lyrics.lines.length > 0 ? lyrics.lines[lyrics.lines.length - 1].endSeconds : 180;
    const totalDurSec = Math.max(frame.timeSeconds, lastLineEnd, 45);
    const remainingSec = Math.max(0, totalDurSec - frame.timeSeconds);
    const routeProgress = clamp01(frame.timeSeconds / Math.max(1, totalDurSec));

    const telemetryText = `${formatRemainingEta(remainingSec)} left · ${bpmVal} BPM · ${formatBiomeLabel(
      env.biome
    )} · ${formatTimeOfDayLabel(env.timeOfDay)}`;

    ctx.save();
    ctx.font = `600 13px ${IOS_FONT_STACK}`;
    const textW = ctx.measureText(telemetryText).width;
    const pillW = Math.min(focalWidth - 36, Math.max(250, Math.round(textW + 52)));
    const pillH = 38;
    const pillX = focalLeft + (focalWidth - pillW) * 0.5;
    const pillY = height - 56;

    drawRoundedRectPath(ctx, pillX, pillY, pillW, pillH, 19);
    ctx.fillStyle = 'rgba(14, 19, 30, 0.88)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
    ctx.shadowBlur = 16;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Live emerald GPS status dot
    ctx.fillStyle = '#30D158';
    ctx.beginPath();
    ctx.arc(pillX + 18, pillY + pillH * 0.5, 4.5 + beatLift * 1.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(telemetryText, pillX + 30, pillY + pillH * 0.5 - 0.5, pillW - 44);

    // Slim Apple-blue route progress hairline inside bottom of pill
    const barW = pillW - 36;
    const barX = pillX + 18;
    const barY = pillY + pillH - 5;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    drawRoundedRectPath(ctx, barX, barY, barW, 2.2, 1.1);
    ctx.fill();
    ctx.fillStyle = IMSG_BLUE;
    drawRoundedRectPath(ctx, barX, barY, Math.max(4, barW * routeProgress), 2.2, 1.1);
    ctx.fill();

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
    const variationIdx = this.getVariationIndex(frame.variationId ?? 'messages');
    const bgOpacity = clamp01(frame.backgroundOpacity ?? 1.0);
    const vignetteStrength = clamp01(frame.vignetteStrength ?? 0.5);

    const focal = getFocalRect(frame, width);
    const focalWidth = focal.width;
    const lyrics = frame.lyrics;
    const layout = frame.layout;

    // Precompute bubble metadata when lyrics & layout exist
    if (lyrics && layout && lyrics.lines.length > 0 && layout.lines.length > 0) {
      const trackId = frame.trackMetadata?.id ?? lyrics.providerName ?? '';
      const scriptMode: LyricsScriptMode = frame.scriptMode ?? 'auto';
      this.ensurePrecomputed(ctx, lyrics, layout, focalWidth, trackId, scriptMode);
    }

    // Resolve active bubble index (used by all 3 variations)
    let resolvedBubbleIdx = -1;
    if (frame.activeLineIndex >= 0 && frame.activeLineIndex < this.lineToBubbleIdx.length) {
      const mapped = this.lineToBubbleIdx[frame.activeLineIndex];
      if (mapped >= 0) {
        resolvedBubbleIdx = mapped;
        this.lastKnownActiveIdx = mapped;
      }
    }
    if (
      resolvedBubbleIdx < 0 &&
      typeof frame.lastActiveLineIndex === 'number' &&
      frame.lastActiveLineIndex >= 0
    ) {
      for (
        let li = Math.min(this.lineToBubbleIdx.length - 1, frame.lastActiveLineIndex);
        li >= 0;
        li--
      ) {
        if (this.lineToBubbleIdx[li] >= 0) {
          resolvedBubbleIdx = this.lineToBubbleIdx[li];
          break;
        }
      }
    }
    if (resolvedBubbleIdx < 0 && this.lastKnownActiveIdx >= 0) {
      resolvedBubbleIdx = this.lastKnownActiveIdx;
    }
    if (resolvedBubbleIdx < 0 && lyrics && this.bubbles.length > 0) {
      resolvedBubbleIdx = 0;
      for (let bIdx = 0; bIdx < this.bubbles.length; bIdx++) {
        if (lyrics.lines[this.bubbles[bIdx].lineIndex].startSeconds <= frame.timeSeconds) {
          resolvedBubbleIdx = bIdx;
        } else {
          break;
        }
      }
    }

    // Variation 3: 2.5D Apple Maps Navigation Mode
    if (variationIdx === 3) {
      this.renderNavigationMap(
        ctx,
        frame,
        lyrics,
        layout,
        width,
        height,
        focal.left,
        focalWidth,
        resolvedBubbleIdx,
        motionScale
      );
      return;
    }

    const isLiquidGlass = variationIdx === 1;
    const isGroupChat = variationIdx === 2;

    // Backdrop for Messages, Liquid Glass & Group Chat
    if (!isTransparent) {
      ctx.save();
      ctx.globalAlpha = bgOpacity;
      if (isLiquidGlass) {
        parseColorToRgbInto(frame.palette.accentPrimary || '#38bdf8', this.tmpRgbA);
        parseColorToRgbInto(frame.palette.accentSecondary || '#a855f7', this.tmpRgbB);
        const rA = Math.round(this.tmpRgbA[0] * 255);
        const gA = Math.round(this.tmpRgbA[1] * 255);
        const bA = Math.round(this.tmpRgbA[2] * 255);
        const rB = Math.round(this.tmpRgbB[0] * 255);
        const gB = Math.round(this.tmpRgbB[1] * 255);
        const bB = Math.round(this.tmpRgbB[2] * 255);

        const baseGrad = ctx.createLinearGradient(0, 0, 0, height);
        baseGrad.addColorStop(0, frame.palette.bgDeep || '#060913');
        baseGrad.addColorStop(0.55, frame.palette.bgMid || '#0f1628');
        baseGrad.addColorStop(1, '#05070e');
        ctx.fillStyle = baseGrad;
        ctx.fillRect(0, 0, width, height);

        const glowA = ctx.createRadialGradient(
          focal.left + focalWidth * 0.28,
          height * 0.34,
          12,
          focal.left + focalWidth * 0.28,
          height * 0.34,
          Math.max(focalWidth, height) * 0.65
        );
        glowA.addColorStop(0, `rgba(${rA}, ${gA}, ${bA}, 0.26)`);
        glowA.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glowA;
        ctx.fillRect(0, 0, width, height);

        const glowB = ctx.createRadialGradient(
          focal.left + focalWidth * 0.74,
          height * 0.68,
          12,
          focal.left + focalWidth * 0.74,
          height * 0.68,
          Math.max(focalWidth, height) * 0.62
        );
        glowB.addColorStop(0, `rgba(${rB}, ${gB}, ${bB}, 0.22)`);
        glowB.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glowB;
        ctx.fillRect(0, 0, width, height);
      } else {
        const bg = ctx.createLinearGradient(0, 0, 0, height);
        bg.addColorStop(0, '#09090d');
        bg.addColorStop(0.55, '#111218');
        bg.addColorStop(1, '#08090d');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();
    }

    if (!lyrics || !layout || lyrics.lines.length === 0 || layout.lines.length === 0 || this.bubbles.length === 0) {
      this.drawVoiceNoteGapBubble(
        ctx,
        focal.left + focalWidth * 0.5 - 99,
        height * 0.5 - 22,
        frame,
        motionScale,
        1.0
      );
      return;
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
    const timeUntilNext = nextLine
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

    const isKineticPopup =
      typeof frame.iosKineticPopup === 'boolean' ? frame.iosKineticPopup : !isGroupChat;
    const isBrowsing = frame.isFollowingPlayback === false || Math.abs(manualOffset) > 3;
    const rawKineticZoom =
      typeof frame.iosKineticZoom === 'number' && Number.isFinite(frame.iosKineticZoom)
        ? Math.max(0.75, Math.min(1.85, frame.iosKineticZoom))
        : 1.45;
    const kineticZoom = isKineticPopup ? rawKineticZoom : 1.0;

    const marginSide = Math.max(24, Math.round(focalWidth * 0.09));
    const padX = Math.max(16, Math.round(layout.fontSizePx * 0.72));
    const padY = Math.max(11, Math.round(layout.fontSizePx * 0.48));
    const anchorY = isKineticPopup
      ? height * (isTransparent ? 0.56 : 0.62)
      : height * (isTransparent ? 0.52 : 0.5);
    const unsyncedOrLineLevel = isUnsyncedLyrics(frame) || frame.activeWordIndex < 0;

    const tiltAngle =
      motionScale === 0 ? 0 : Math.sin(frame.timeSeconds * 0.45) * 0.008 * motionScale;
    const driftX =
      motionScale === 0 ? 0 : Math.cos(frame.timeSeconds * 0.35) * 4.0 * motionScale;

    ctx.save();
    if (focal.left > 0) ctx.translate(focal.left, 0);

    // Minimal dark frosted Messages header bar (non-transparent full stage only; omitted in split view)
    const showHeader = !isTransparent && focal.left === 0;
    if (showHeader) {
      ctx.save();
      ctx.fillStyle = isKineticPopup ? 'rgba(6, 7, 10, 0.88)' : 'rgba(18, 18, 22, 0.78)';
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
      ctx.fillText(
        isGroupChat
          ? 'Group Chat · 4 People'
          : isLiquidGlass
          ? 'Messages · Liquid Glass'
          : 'Messages · Synced Thread',
        focalWidth * 0.5,
        24
      );
      ctx.restore();
    }

    const topClipY = showHeader ? 49 : isTransparent ? 0 : 62;
    const minY = isKineticPopup ? -height : topClipY;
    const maxY = height + 60;
    const hoveredIdx = frame.hoveredLineIndex ?? -1;

    ctx.save();
    if (topClipY > 0) {
      ctx.beginPath();
      ctx.rect(0, topClipY, focalWidth, Math.max(1, height - topClipY));
      ctx.clip();
    }

    if (tiltAngle !== 0 || driftX !== 0 || kineticZoom !== 1.0) {
      ctx.translate(focalWidth * 0.5 + driftX, anchorY);
      if (kineticZoom !== 1.0) ctx.scale(kineticZoom, kineticZoom);
      if (tiltAngle !== 0) ctx.rotate(tiltAngle);
      ctx.translate(-focalWidth * 0.5, -anchorY);
    }

    const zoomedMaxHalf = (focalWidth * 0.5 - 18) / Math.max(1.0, kineticZoom);
    const zoomedLeftBound = focalWidth * 0.5 - zoomedMaxHalf;
    const zoomedRightBound = focalWidth * 0.5 + zoomedMaxHalf;
    const laneLeftX = Math.max(marginSide, zoomedLeftBound);
    const laneRightEdge = Math.min(focalWidth - marginSide, zoomedRightBound);

    for (let i = 0; i < this.bubbles.length; i++) {
      // Strict Zero Future Preview when iosKineticPopup is ON
      if (isKineticPopup && !isBrowsing && i > activeIdx) {
        continue;
      }

      const b = this.bubbles[i];
      const lineIdx = b.lineIndex;
      const lineObj = lyrics.lines[lineIdx];
      const measured = layout.lines[lineIdx];
      const slotShift =
        this.gapSplitBubbleIdx >= 0 && i >= this.gapSplitBubbleIdx ? this.gapShiftPx : 0;
      const popInOffsetY =
        isKineticPopup && i === activeIdx && motionScale > 0
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

      // In Kinetic Popup mode, snugly hug revealed words width & height
      let drawBubbleW = b.bubbleW;
      let drawBubbleH = b.bubbleH;
      if (isKineticPopup && isActive && !unsyncedOrLineLevel && measured.words.length > 0) {
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
        const emojiPad =
          b.inlineEmoji && clampedAw >= measured.words.length - 1 ? layout.fontSizePx + 8 : 0;
        drawBubbleW = Math.min(
          b.bubbleW,
          Math.max(Math.round(revMaxRight + padX * 2 + emojiPad), 92)
        );
        const subH = b.secondaryText ? Math.round(layout.fontSizePx * 0.92) : 0;
        drawBubbleH = Math.min(
          b.bubbleH,
          Math.max(
            Math.round(revMaxBottom + padY * 2 + subH),
            Math.round(layout.fontSizePx * 1.2 + padY * 2)
          )
        );
      }

      frame.recordHitRect?.(
        lineIdx,
        focal.left + laneLeftX,
        screenY - 4,
        Math.max(drawBubbleW, laneRightEdge - laneLeftX),
        Math.max(drawBubbleH + (b.cardH > 0 ? b.cardH + 14 : 0), totalH) + 8
      );

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
        isGroupChat
          ? b.side === 'right'
            ? laneRightEdge - drawBubbleW
            : laneLeftX + GROUP_AVATAR_GUTTER_PX
          : b.side === 'right'
          ? laneRightEdge - drawBubbleW
          : laneLeftX;
      const by = screenY;

      const rowAlpha = isActive
        ? 1.0 * frame.lineFadeAlpha
        : isHovered
        ? 0.94
        : isPast
        ? isKineticPopup
          ? Math.max(0.32, 0.64 - dist * 0.14)
          : Math.max(0.42, 0.82 - dist * 0.14)
        : Math.max(0.18, 0.34 - dist * 0.06);

      // Group Chat: Colored contact name above cluster + unique circular iOS-gradient user avatar PFP beside left bubbles
      if (isGroupChat && b.side === 'left') {
        const participant = GROUP_PARTICIPANTS[b.senderIdx];
        if (b.isGroupClusterStart) {
          ctx.save();
          ctx.font = `600 11px ${IOS_FONT_STACK}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = participant.labelColor;
          ctx.globalAlpha = isActive ? 0.96 : rowAlpha * 0.85;
          ctx.fillText(participant.name, bx + 8, by - 9);
          ctx.restore();
        }
        if (b.showTail || b.isGroupClusterStart) {
          const avatarR = 14;
          const avatarCx = laneLeftX + avatarR;
          const avatarCy = by + drawBubbleH - avatarR;
          this.drawGroupAvatarPfp(
            ctx,
            participant,
            avatarCx,
            avatarCy,
            avatarR,
            rowAlpha,
            isActive
          );
        }
      }

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
      const showTapback = Boolean(
        b.tapback && (isPast || (isActive && (!isContextualTapback || emojiWordHit)))
      );
      const tapPop = isContextualTapback
        ? isPast
          ? 1.0
          : emojiPop
        : isActive && motionScale > 0
        ? clamp01(lineElapsed / 0.52)
        : 1.0;

      const enterScale =
        isActive && motionScale > 0 && lineElapsed < 0.35
          ? 0.94 + 0.06 * easeOutBack(lineElapsed / 0.35)
          : 1.0;
      const enterTiltRad =
        isKineticPopup && isActive && motionScale > 0 && lineElapsed < 0.38
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

      drawBubbleWithTail(ctx, bx, by, drawBubbleW, drawBubbleH, 18, b.side, b.showTail);
      if (isLiquidGlass) {
        parseColorToRgbInto(frame.palette.accentPrimary || '#38bdf8', this.tmpRgbA);
        const ar = Math.round(this.tmpRgbA[0] * 255);
        const ag = Math.round(this.tmpRgbA[1] * 255);
        const ab = Math.round(this.tmpRgbA[2] * 255);
        const glassFill = ctx.createLinearGradient(bx, by, bx, by + drawBubbleH);
        if (b.side === 'right') {
          glassFill.addColorStop(0, `rgba(${ar}, ${ag}, ${ab}, ${isActive ? 0.52 : 0.34})`);
          glassFill.addColorStop(1, `rgba(${ar}, ${ag}, ${ab}, ${isActive ? 0.24 : 0.14})`);
        } else {
          glassFill.addColorStop(0, isActive ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.13)');
          glassFill.addColorStop(1, isActive ? 'rgba(255, 255, 255, 0.09)' : 'rgba(255, 255, 255, 0.04)');
        }
        ctx.fillStyle = glassFill;
      } else {
        ctx.fillStyle = b.side === 'right' ? IMSG_BLUE : IMSG_CHARCOAL;
      }

      if (isActive || isHovered) {
        ctx.shadowColor = isLiquidGlass
          ? b.side === 'right'
            ? frame.palette.accentPrimary || 'rgba(56, 189, 248, 0.72)'
            : 'rgba(255, 255, 255, 0.42)'
          : b.side === 'right'
          ? 'rgba(56, 189, 248, 0.72)'
          : 'rgba(255, 255, 255, 0.34)';
        ctx.shadowBlur = isActive ? (isKineticPopup ? 28 : 20) : 12;
      }
      ctx.fill();
      ctx.shadowBlur = 0;

      // Liquid Glass internal top specular refraction sheen
      if (isLiquidGlass) {
        ctx.save();
        ctx.clip();
        const specGrad = ctx.createLinearGradient(bx, by, bx, by + drawBubbleH * 0.42);
        specGrad.addColorStop(0, isActive ? 'rgba(255, 255, 255, 0.36)' : 'rgba(255, 255, 255, 0.20)');
        specGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
        ctx.fillStyle = specGrad;
        ctx.fillRect(bx - 12, by, drawBubbleW + 24, drawBubbleH * 0.42);
        ctx.restore();
        // Rebuild bubble path for specular rim stroke
        drawBubbleWithTail(ctx, bx, by, drawBubbleW, drawBubbleH, 18, b.side, b.showTail);
      }

      if (isLiquidGlass || isHovered || isActive) {
        ctx.strokeStyle = isHovered
          ? 'rgba(255, 255, 255, 0.62)'
          : isLiquidGlass
          ? isActive
            ? 'rgba(255, 255, 255, 0.84)'
            : 'rgba(255, 255, 255, 0.28)'
          : isActive && isKineticPopup
          ? b.side === 'right'
            ? 'rgba(186, 230, 253, 0.94)'
            : 'rgba(255, 255, 255, 0.56)'
          : isActive
          ? b.side === 'right'
            ? 'rgba(147, 197, 253, 0.58)'
            : 'rgba(255, 255, 255, 0.24)'
          : 'rgba(255, 255, 255, 0.14)';
        ctx.lineWidth = isActive ? 1.75 : 1.05;
        ctx.stroke();
      }

      ctx.font = `${isKineticPopup && isActive ? 600 : 500} ${layout.fontSizePx}px ${IOS_FONT_STACK}`;
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
            const revealT = isKineticPopup ? clamp01(p / 0.36) : 1.0;
            const blurSpringY =
              isKineticPopup && motionScale > 0
                ? (1 - easeOutBack(revealT)) * 9
                : motionScale > 0
                ? -1.8 * Math.sin(p * Math.PI) * Math.min(1.2, motionScale)
                : 0;
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
                1.0,
                w
              );
            } else {
              ctx.fillStyle = '#ffffff';
              ctx.globalAlpha = 1.0;
              ctx.shadowColor = isKineticPopup
                ? 'rgba(255, 255, 255, 0.85)'
                : 'rgba(255, 255, 255, 0.65)';
              ctx.shadowBlur = isKineticPopup ? 12 : 8;
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
            // Kinetic Popup ON: ZERO future preview — never pre-render unsung words
            if (isKineticPopup) continue;
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = 0.64;
            ctx.fillText(word.text, wx, wy);
          }
        }
      }

      if (b.secondaryText) {
        ctx.save();
        ctx.font = `400 ${Math.max(11, Math.round(layout.fontSizePx * 0.72))}px ${IOS_FONT_STACK}`;
        ctx.fillStyle = 'rgba(248, 250, 252, 0.78)';
        ctx.globalAlpha = rowAlpha * 0.85;
        ctx.fillText(b.secondaryText, textOriginX, textOriginY + measured.height + 2);
        ctx.restore();
      }

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
          motionScale
        );
      }

      if (b.embedCard && b.cardH > 0) {
        const cardW =
          isKineticPopup && b.embedCard.kind === 'maps'
            ? Math.max(220, laneRightEdge - laneLeftX)
            : Math.min(Math.max(b.bubbleW, 230), Math.round((laneRightEdge - laneLeftX) * 0.85));
        const cardX =
          isKineticPopup && b.embedCard.kind === 'maps'
            ? laneLeftX
            : b.side === 'right'
            ? laneRightEdge - cardW
            : isGroupChat
            ? laneLeftX + GROUP_AVATAR_GUTTER_PX
            : laneLeftX;
        const cardY = by + drawBubbleH + (isKineticPopup ? 14 : 6);
        ctx.globalAlpha = rowAlpha;
        this.drawEmbedCard(ctx, b.embedCard, cardX, cardY, cardW, b.cardH, frame, motionScale);
      }

      ctx.restore();

      if (isActive && frame.isFollowingPlayback === false) {
        const dotX = b.side === 'right' ? bx - 14 : bx + b.bubbleW + 14;
        const dotY = by + b.bubbleH * 0.5;
        const pulse =
          motionScale > 0 ? 0.85 + 0.15 * Math.sin(frame.timeSeconds * 4.5) : 1.0;
        ctx.save();
        ctx.globalAlpha = 0.28 * rowAlpha * pulse;
        ctx.fillStyle = IMSG_BLUE;
        ctx.beginPath();
        ctx.arc(dotX, dotY, 7.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.95 * rowAlpha;
        ctx.shadowColor = IMSG_BLUE;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(dotX, dotY, 3.6 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Unified non-overlapping gap / short-pause / typing slot rendering (ZERO closure allocation)
    if (hasActiveGapSlot && gapAlpha > 0.01) {
      let gapY: number;
      if (nextBubbleIdx === 0) {
        gapY = anchorY + (this.bubbles[0].topY - 32 - effectiveScrollY);
      } else {
        const prevB = this.bubbles[prevBubbleIdx >= 0 ? prevBubbleIdx : activeIdx];
        const prevBottom = prevB.topY + prevB.bubbleH + (prevB.cardH > 0 ? prevB.cardH + 6 : 0);
        gapY = anchorY + (prevBottom + 12 - effectiveScrollY);
      }

      if (gapY + 44 > minY && gapY < maxY) {
        const leftSlotX = isGroupChat ? laneLeftX + GROUP_AVATAR_GUTTER_PX : laneLeftX;
        if (gapMode === 'voiceNote') {
          this.drawVoiceNoteGapBubble(ctx, leftSlotX, gapY, frame, motionScale, gapAlpha);
        } else if (gapMode === 'shortPause') {
          this.drawShortPauseNoteBubble(ctx, leftSlotX, gapY, frame, motionScale, gapAlpha);
        } else if (gapMode === 'typing') {
          const nextBubble =
            nextBubbleIdx >= 0 && nextBubbleIdx < this.bubbles.length
              ? this.bubbles[nextBubbleIdx]
              : null;
          const typingSide: BubbleSide = nextBubble ? nextBubble.side : 'left';
          const typingX = typingSide === 'right' ? laneRightEdge - 68 : leftSlotX;
          this.drawTypingIndicator(
            ctx,
            typingSide,
            typingX,
            gapY + 4,
            frame,
            motionScale,
            gapAlpha
          );
        }
      }
    }

    ctx.restore(); // end topClipY + kineticZoom region

    // Smooth seamless top vignette fade over older bubbles drifting upward in Kinetic Popup mode
    if (isKineticPopup && !isTransparent) {
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

    if (!isTransparent && vignetteStrength > 0.02) {
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
