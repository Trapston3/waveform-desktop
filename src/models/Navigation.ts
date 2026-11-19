// src/models/Navigation.ts
// Navigation, Browse, Shelf, Search, Detail, and Artist page models

import type { Song } from './Song';

export const ShelfLayout = {
  ROW: 'ROW',
  GRID: 'GRID',
  TWO_ROW_GRID: 'TWO_ROW_GRID',
  COMPACT_ROW: 'COMPACT_ROW',
  LIST: 'LIST',
} as const;
export type ShelfLayout = (typeof ShelfLayout)[keyof typeof ShelfLayout];

export interface BrowseItem {
  id: string;
  title: string;
  subtitle?: string | null;
  thumbnailUrl?: string | null;
  secondaryText?: string | null;
  explicit: boolean;
  endpoint?: string | null;
  browseId?: string | null;
  playlistId?: string | null;
  channelId?: string | null;
  radioId?: string | null;
  shuffleId?: string | null;
  reloadParams?: string | null;
  isArtist: boolean;
  isAlbum: boolean;
  isPlaylist: boolean;
  isSingle: boolean;
  isVideo: boolean;
  year?: string | null;
  badge?: string | null;
  [key: string]: unknown;
}

export type ReleaseCard = BrowseItem;

export interface HomeShelf {
  id?: string;
  title: string;
  subtitle?: string | null;
  items: (Song | BrowseItem)[];
  moreEndpoint?: string | null;
  moreBrowseId?: string | null;
  moreParams?: string | null;
  layout: ShelfLayout | string;
}

export interface HomeFeed {
  chips: string[];
  shelves: HomeShelf[];
  continuation?: string | null;
}

export interface MoodGenre {
  title: string;
  browseId: string;
  params?: string | null;
  stripeColor?: number | null;
}

export interface MoodGenreSection {
  title: string;
  items: MoodGenre[];
}

export interface ExploreData {
  chips: string[];
  trending: BrowseItem[];
  categories?: MoodGenreSection[];
}

export interface SearchResult {
  query: string;
  suggestions: string[];
  items: (BrowseItem | Song)[];
  continuation?: string | null;
}

export type DetailPageType = 'album' | 'playlist' | 'artist';

export const LikeStatus = {
  LIKE: 'LIKE',
  DISLIKE: 'DISLIKE',
  INDIFFERENT: 'INDIFFERENT',
} as const;
export type LikeStatus = (typeof LikeStatus)[keyof typeof LikeStatus];

export interface DetailPage {
  id: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  type?: DetailPageType;
  coverArt?: string | null;             // UI shorthand alias for thumbnailUrl
  thumbnailUrl?: string | null;
  songs: Song[];                        // Canonical tracklist
  tracks?: Song[];                      // Shorthand alias for songs
  secondaryItems?: BrowseItem[];
  totalDuration?: number;               // Total duration in seconds
  totalDurationText?: string | null;    // e.g. "52 minutes"
  durationText?: string | null;
  songCount?: number;
  songCountText?: string | null;        // e.g. "12 songs"
  releaseYear?: string | null;          // Shorthand alias for year
  year?: string | null;
  channelId?: string | null;
  playlistId?: string | null;
  radioId?: string | null;
  shuffleId?: string | null;
  isAlbum: boolean;
  isPlaylist: boolean;
  isArtist: boolean;
  isSubscribed?: boolean;
  likeStatus?: LikeStatus | 'LIKE' | 'DISLIKE' | 'INDIFFERENT';
}

export interface ArtistAlbumItem {
  id: string;
  title: string;
  subtitle?: string | null;
  thumbnailUrl?: string | null;
  year?: string | null;
}

export interface ArtistPage {
  id: string;
  name: string;
  bio?: string | null;
  avatarUrl?: string | null;
  thumbnailUrl?: string | null;
  subscribersText?: string | null;
  monthlyListeners?: number | null;
  topSongs: Song[];
  albums: ArtistAlbumItem[];
  singlesAndEps?: ArtistAlbumItem[];
  shelves?: HomeShelf[];
  radio?: { playlistId: string; videoId?: string; params?: string } | null;
  shuffle?: { playlistId: string; videoId?: string; params?: string } | null;
}
