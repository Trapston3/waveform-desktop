// src/models/types.ts
// Common identifiers, enumerations, and result types for WaveForm Desktop

export const AudioQuality = {
  LOW: 'LOW',
  STANDARD: 'STANDARD',
  HIGH: 'HIGH',
  LOSSLESS: 'LOSSLESS',
} as const;
export type AudioQuality = (typeof AudioQuality)[keyof typeof AudioQuality];

export const PlaybackState = {
  IDLE: 'IDLE',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  BUFFERING: 'BUFFERING',
  CROSSFADING: 'CROSSFADING',
} as const;
export type PlaybackState = (typeof PlaybackState)[keyof typeof PlaybackState];

export const QueueTier = {
  USER_QUEUE: 'USER_QUEUE',
  CONTEXT: 'CONTEXT',
  AUTOPLAY: 'AUTOPLAY',
} as const;
export type QueueTier = (typeof QueueTier)[keyof typeof QueueTier];
export type QueueTierType = QueueTier;

export const FilterType = {
  ALL: 'all',
  SONGS: 'songs',
  ALBUMS: 'albums',
  ARTISTS: 'artists',
  PLAYLISTS: 'playlists',
  VIDEOS: 'videos',
} as const;
export type FilterType = (typeof FilterType)[keyof typeof FilterType];

export type SearchFilterType = 'all' | 'songs' | 'albums' | 'artists' | 'playlists' | 'videos';

export interface ResultSuccess<T> {
  success: true;
  data: T;
  error?: undefined;
}

export interface ResultFailure<E = Error> {
  success: false;
  data?: undefined;
  error: E;
}

export type Result<T, E = Error> = ResultSuccess<T> | ResultFailure<E>;

export interface PaginatedResult<T> {
  items: T[];
  total?: number;
  continuationToken?: string | null;
  hasMore: boolean;
}
