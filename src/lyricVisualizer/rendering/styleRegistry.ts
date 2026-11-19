// Registry for all 13 LyricVisualizer visual styles.

import type { VisualStyleId } from '../core/models';
import type { ILyricVisualStyle } from './styleInterface';
import {
  AppleMusicFlowStyle,
  BrutalistZineStyle,
  CRTScanlineStyle,
  GenerativeParticleInkStyle,
  HoloVaporwaveStyle,
  KaraokeStageStyle,
  LiquidMetalStyle,
  MinimalSwissStyle,
  NeonKineticStyle,
  Spatial3DDepthStyle,
  SpectrumRibbonStyle,
  StarfieldShip3DStyle,
  TypewriterEditorialStyle,
} from './styles';

export const ALL_VISUAL_STYLE_IDS: readonly VisualStyleId[] = [
  'AppleMusicFlow',
  'NeonKinetic',
  'TypewriterEditorial',
  'MinimalSwiss',
  'LiquidMetal',
  'HoloVaporwave',
  'KaraokeStage',
  'BrutalistZine',
  'GenerativeParticleInk',
  'SpectrumRibbon',
  'Spatial3DDepth',
  'CRTScanline',
  'StarfieldShip3D',
] as const;

export class StyleRegistry {
  private readonly styles: Map<VisualStyleId, ILyricVisualStyle>;
  private readonly orderedList: ILyricVisualStyle[];

  constructor() {
    const instances: ILyricVisualStyle[] = [
      new AppleMusicFlowStyle(),
      new NeonKineticStyle(),
      new TypewriterEditorialStyle(),
      new MinimalSwissStyle(),
      new LiquidMetalStyle(),
      new HoloVaporwaveStyle(),
      new KaraokeStageStyle(),
      new BrutalistZineStyle(),
      new GenerativeParticleInkStyle(),
      new SpectrumRibbonStyle(),
      new Spatial3DDepthStyle(),
      new CRTScanlineStyle(),
      new StarfieldShip3DStyle(),
    ];

    this.styles = new Map<VisualStyleId, ILyricVisualStyle>();
    this.orderedList = instances;
    for (const style of instances) {
      this.styles.set(style.id, style);
    }
  }

  has(id: string): id is VisualStyleId {
    return this.styles.has(id as VisualStyleId);
  }

  get(id: VisualStyleId): ILyricVisualStyle {
    return this.styles.get(id) ?? this.styles.get('AppleMusicFlow')!;
  }

  listIds(): readonly VisualStyleId[] {
    return ALL_VISUAL_STYLE_IDS;
  }

  listStyles(): readonly ILyricVisualStyle[] {
    return this.orderedList;
  }

  resetAll(): void {
    for (const style of this.orderedList) {
      style.reset?.();
    }
  }

  disposeAll(): void {
    for (const style of this.orderedList) {
      style.dispose?.();
    }
  }
}

export function createStyleRegistry(): StyleRegistry {
  return new StyleRegistry();
}
