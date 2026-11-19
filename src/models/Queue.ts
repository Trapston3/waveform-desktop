// src/models/Queue.ts
// 3-Tier Queue Partitioning and Playback Context models

import type { Song } from './Song';
import { QueueTier } from './types';
import type { QueueTierType } from './types';

export { QueueTier };
export type { QueueTierType };

export interface QueueItem {
  id: string;
  song: Song;
  tier: QueueTier | QueueTierType;
  addedAtMs: number;
  requestedBy?: string;
}

export interface QueueTiersState {
  USER_QUEUE: Song[];
  CONTEXT: Song[];
  AUTOPLAY: Song[];
}

export interface PlaybackContext {
  id: string;
  browseId?: string | null;
  title: string;
  type: 'album' | 'playlist' | 'artist' | 'radio' | 'search';
  currentIndex: number;
  trackIds?: string[];
}

export interface QueueState {
  tiers: QueueTiersState;
  currentSong: Song | null;
  currentTier: QueueTier | QueueTierType | null;
  currentIndex: number;
  history: Song[];
  shuffleEnabled: boolean;
  repeatMode: 'off' | 'all' | 'one';
}
