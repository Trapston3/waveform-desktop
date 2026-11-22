// Registry for all 12 consolidated LyricVisualizer visual styles.

import type { VisualStyleId } from '../core/models';
import type { ILyricVisualStyle } from './styleInterface';
import {
  AppleMusicFlowStyle,
  BrutalistZineStyle,
  CRTScanlineStyle,
  GenerativeParticleInkStyle,
  IosTextingMotionStyle,
  KaraokeStageStyle,
  LiquidMetalStyle,
  MinimalSwissStyle,
  Spatial3DDepthStyle,
  StarfieldShip3DStyle,
  TypewriterEditorialStyle,
} from './styles';
import { CodeEditorKineticStyle } from './styles/codeEditorKinetic';

export const ALL_VISUAL_STYLE_IDS: readonly VisualStyleId[] = [
  'AppleMusicFlow',
  'TypewriterEditorial',
  'MinimalSwiss',
  'LiquidMetal',
  'KaraokeStage',
  'BrutalistZine',
  'GenerativeParticleInk',
  'Spatial3DDepth',
  'CRTScanline',
  'StarfieldShip3D',
  'IosTextingMotion',
  'CodeEditorKinetic',
] as const;

export function mapLegacyStyleId(id: VisualStyleId | string): VisualStyleId {
  if (id === 'NeonKinetic') return 'AppleMusicFlow';
  if (id === 'HoloVaporwave') return 'LiquidMetal';
  if (id === 'SpectrumRibbon') return 'GenerativeParticleInk';
  return id as VisualStyleId;
}

export class StyleRegistry {
  private readonly styles: Map<VisualStyleId, ILyricVisualStyle>;
  private readonly orderedList: ILyricVisualStyle[];

  constructor() {
    const instances: ILyricVisualStyle[] = [
      new AppleMusicFlowStyle(),
      new TypewriterEditorialStyle(),
      new MinimalSwissStyle(),
      new LiquidMetalStyle(),
      new KaraokeStageStyle(),
      new BrutalistZineStyle(),
      new GenerativeParticleInkStyle(),
      new Spatial3DDepthStyle(),
      new CRTScanlineStyle(),
      new StarfieldShip3DStyle(),
      new IosTextingMotionStyle(),
      new CodeEditorKineticStyle(),
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

  get(id: VisualStyleId | string): ILyricVisualStyle {
    const mapped = mapLegacyStyleId(id);
    return this.styles.get(mapped) ?? this.styles.get('AppleMusicFlow')!;
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
