// src/services/InnerTubeParser.ts
// AST parser for YouTube Music InnerTube responses (ported from WaveForm-Rebuild InnertubeParser.kt)

import type {
  Song,
  ArtistRef,
  BrowseItem,
  HomeShelf,
  ExploreData,
  DetailPage,
  ArtistPage,
  ArtistAlbumItem,
  MoodGenreSection,
} from '../models/index';

export class InnerTubeParser {
  public parseArtistsFromRuns(runs?: any[]): {
    artistText: string;
    artists: ArtistRef[];
    artistIds: string[];
  } {
    if (!Array.isArray(runs) || runs.length === 0) {
      return { artistText: 'Unknown Artist', artists: [], artistIds: [] };
    }

    const artists: ArtistRef[] = [];
    const names: string[] = [];

    const noiseTokens = new Set([
      'song',
      'video',
      'album',
      'ep',
      'single',
      'artist',
      'playlist',
      'community playlist',
    ]);

    for (const run of runs) {
      const text = run?.text?.trim();
      if (!text || text === '•' || text === '&' || text === ',' || text === '·') continue;

      const browseId = run?.navigationEndpoint?.browseEndpoint?.browseId;
      const pageType =
        run?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
          ?.browseEndpointContextMusicConfig?.pageType || '';

      if ((pageType.includes('ARTIST') || browseId?.startsWith('UC')) && browseId) {
        artists.push({ id: browseId, name: text });
        names.push(text);
      } else if (
        !noiseTokens.has(text.toLowerCase()) &&
        !text.match(/^\d+$/) &&
        !text.match(/^\d+:\d+(:\d+)?$/) &&
        !text.match(/^\d+(\.\d+)?[KMB]?\s*(views|plays|subscribers|monthly listeners|songs)/i) &&
        !pageType.includes('ALBUM') &&
        !browseId?.startsWith('MPREb')
      ) {
        names.push(text);
      }
    }

    const artistIds = artists.map((a) => a.id).filter((id): id is string => Boolean(id));

    return {
      artistText: names.join(', ') || 'Unknown Artist',
      artists: artists.length > 0 ? artists : [{ id: null, name: names[0] || 'Unknown Artist' }],
      artistIds,
    };
  }

  public extractThumbnails(thumbnails?: any[]): string | null {
    if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;
    const sorted = [...thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
    const rawUrl: string | null = sorted[0]?.url || null;
    if (!rawUrl) return null;
    // Upscale tiny 60x60 / 120x120 Googleusercontent thumbnails to crisp 544x544 artwork
    if (rawUrl.includes('googleusercontent.com') && /=w\d+-h\d+/.test(rawUrl)) {
      return rawUrl.replace(/=w\d+-h\d+[^&?]*/, '=w544-h544-l90-rj');
    }
    return rawUrl;
  }

  private parseDurationMs(text?: string | null): number {
    if (!text) return 210000;
    const parts = text
      .trim()
      .split(':')
      .map((n) => parseInt(n, 10));
    if (parts.some((n) => Number.isNaN(n))) return 210000;
    if (parts.length === 2) {
      return (parts[0] * 60 + parts[1]) * 1000;
    }
    if (parts.length === 3) {
      return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    }
    return 210000;
  }

  public parseResponsiveListItem(renderer: any, shelfTitle = ''): BrowseItem {
    const flexColumns = renderer?.flexColumns || [];
    const titleCol = flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
    const title = titleCol.map((r: any) => r?.text).join('') || 'Untitled';

    const overlayWatch =
      renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
        ?.playNavigationEndpoint?.watchEndpoint;
    const titleWatch = titleCol[0]?.navigationEndpoint?.watchEndpoint;
    const rowWatch = renderer?.navigationEndpoint?.watchEndpoint;

    const videoId =
      titleWatch?.videoId ||
      overlayWatch?.videoId ||
      rowWatch?.videoId ||
      renderer?.playlistItemData?.videoId ||
      '';

    const rowBrowse = renderer?.navigationEndpoint?.browseEndpoint;
    const titleBrowse = titleCol[0]?.navigationEndpoint?.browseEndpoint;
    const rawBrowseId: string | null = rowBrowse?.browseId || titleBrowse?.browseId || null;
    const pageType: string =
      rowBrowse?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ||
      titleBrowse?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ||
      '';

    const subtitleRuns: any[] = [];
    for (let i = 1; i < flexColumns.length; i++) {
      const runs = flexColumns[i]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
      if (Array.isArray(runs)) subtitleRuns.push(...runs);
    }
    const fixedCols = renderer?.fixedColumns || [];
    for (const fc of fixedCols) {
      const runs = fc?.musicResponsiveListItemFixedColumnRenderer?.text?.runs;
      if (Array.isArray(runs)) subtitleRuns.push(...runs);
    }

    const typeToken = subtitleRuns[0]?.text?.trim()?.toLowerCase() || '';
    const shelfLower = shelfTitle.toLowerCase();

    const isArtist =
      pageType.includes('ARTIST') ||
      Boolean(rawBrowseId?.startsWith('UC')) ||
      typeToken === 'artist' ||
      shelfLower.includes('artist');

    const isAlbum =
      !isArtist &&
      (pageType.includes('ALBUM') ||
        Boolean(rawBrowseId?.startsWith('MPREb')) ||
        Boolean(rawBrowseId?.startsWith('FEmusic_library_privately_owned_release')) ||
        typeToken === 'album' ||
        typeToken === 'ep' ||
        typeToken === 'single' ||
        shelfLower.includes('album'));

    const isPlaylist =
      !isArtist &&
      !isAlbum &&
      (pageType.includes('PLAYLIST') ||
        Boolean(rawBrowseId?.startsWith('VL')) ||
        Boolean(rawBrowseId?.startsWith('PL')) ||
        Boolean(rawBrowseId?.startsWith('RD')) ||
        typeToken.includes('playlist') ||
        shelfLower.includes('playlist'));

    const isVideo =
      !isArtist &&
      !isAlbum &&
      !isPlaylist &&
      Boolean(videoId) &&
      (typeToken === 'video' ||
        shelfLower.includes('video') ||
        (titleWatch?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ||
          overlayWatch?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ||
          '')
          .includes('OMV'));

    // Extract duration text if present (e.g. "3:45")
    const durationRun = subtitleRuns.find((r: any) => /^\d+:\d+(:\d+)?$/.test(r?.text?.trim() || ''));
    const durationText = durationRun?.text?.trim() || null;

    const { artistText, artistIds } = this.parseArtistsFromRuns(subtitleRuns);
    const cleanSubtitle =
      isArtist
        ? subtitleRuns
            .map((r: any) => r?.text)
            .filter(Boolean)
            .join('') || 'Artist'
        : artistText;

    const thumbnails = renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
    const thumbnailUrl = this.extractThumbnails(thumbnails);

    const isExplicit = Boolean(
      renderer?.badges?.some((b: any) =>
        b?.musicInlineBadgeRenderer?.accessibilityData?.accessibilityData?.label
          ?.toLowerCase()
          .includes('explicit')
      )
    );

    const id =
      videoId ||
      rawBrowseId ||
      renderer?.id ||
      `item_${Math.random().toString(36).slice(2, 8)}`;

    const endpoint = videoId
      ? `watch?v=${videoId}`
      : rawBrowseId
      ? `browse/${rawBrowseId}`
      : null;

    const badge = isArtist
      ? 'Artist'
      : isAlbum
      ? typeToken === 'single'
        ? 'Single'
        : typeToken === 'ep'
        ? 'EP'
        : 'Album'
      : isPlaylist
      ? 'Playlist'
      : isVideo
      ? 'Video'
      : 'Song';

    return {
      id,
      videoId: videoId || (id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : undefined),
      title,
      subtitle: cleanSubtitle,
      thumbnailUrl,
      secondaryText: durationText,
      explicit: isExplicit,
      endpoint,
      browseId: rawBrowseId,
      playlistId: isPlaylist ? rawBrowseId?.replace(/^VL/, '') || null : titleWatch?.playlistId || overlayWatch?.playlistId || null,
      channelId: isArtist ? rawBrowseId : artistIds[0] || null,
      radioId: videoId ? `RDAMVM${videoId}` : null,
      shuffleId: null,
      reloadParams: null,
      isArtist,
      isAlbum,
      isPlaylist,
      isSingle: typeToken === 'single',
      isVideo,
      badge,
    };
  }

  public parseCardShelfRenderer(card: any): BrowseItem[] {
    const results: BrowseItem[] = [];
    const titleRuns = card?.title?.runs || [];
    const title = titleRuns.map((r: any) => r?.text).join('') || '';
    if (title) {
      const subtitleRuns = card?.subtitle?.runs || [];
      const tapWatch =
        card?.onTap?.watchEndpoint ||
        titleRuns[0]?.navigationEndpoint?.watchEndpoint ||
        card?.buttons?.[0]?.buttonRenderer?.command?.watchEndpoint ||
        card?.buttons?.[0]?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint;
      const tapBrowse = card?.onTap?.browseEndpoint || titleRuns[0]?.navigationEndpoint?.browseEndpoint;
      const videoId: string = tapWatch?.videoId || '';
      const browseId: string | null = tapBrowse?.browseId || null;
      const pageType: string =
        tapBrowse?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '';

      const typeToken = subtitleRuns[0]?.text?.trim()?.toLowerCase() || '';
      const isArtist = pageType.includes('ARTIST') || Boolean(browseId?.startsWith('UC')) || typeToken === 'artist';
      const isAlbum =
        !isArtist &&
        (pageType.includes('ALBUM') || Boolean(browseId?.startsWith('MPREb')) || typeToken === 'album');
      const isPlaylist =
        !isArtist &&
        !isAlbum &&
        (pageType.includes('PLAYLIST') ||
          Boolean(browseId?.startsWith('VL')) ||
          Boolean(browseId?.startsWith('PL')) ||
          typeToken.includes('playlist'));
      const isVideo = !isArtist && !isAlbum && !isPlaylist && Boolean(videoId) && typeToken === 'video';

      const { artistText, artistIds } = this.parseArtistsFromRuns(subtitleRuns);
      const durationRun = subtitleRuns.find((r: any) => /^\d+:\d+(:\d+)?$/.test(r?.text?.trim() || ''));
      const thumbnails = card?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
      const thumbnailUrl = this.extractThumbnails(thumbnails);

      const id = videoId || browseId || `top_${Math.random().toString(36).slice(2, 8)}`;
      results.push({
        id,
        videoId: videoId || (id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : undefined),
        title,
        subtitle: isArtist ? 'Artist' : artistText,
        thumbnailUrl,
        secondaryText: durationRun?.text?.trim() || null,
        explicit: false,
        endpoint: videoId ? `watch?v=${videoId}` : browseId ? `browse/${browseId}` : null,
        browseId,
        playlistId: isPlaylist ? browseId?.replace(/^VL/, '') || null : null,
        channelId: isArtist ? browseId : artistIds[0] || null,
        radioId: videoId ? `RDAMVM${videoId}` : null,
        shuffleId: null,
        reloadParams: null,
        isArtist,
        isAlbum,
        isPlaylist,
        isSingle: false,
        isVideo,
        badge: isArtist ? 'Artist' : isAlbum ? 'Album' : isPlaylist ? 'Playlist' : isVideo ? 'Video' : 'Song',
      });
    }

    for (const sub of card?.contents || []) {
      if (sub?.musicResponsiveListItemRenderer) {
        results.push(this.parseResponsiveListItem(sub.musicResponsiveListItemRenderer));
      }
    }

    return results;
  }

  public parseTwoRowItem(renderer: any): BrowseItem {
    const titleRuns = renderer?.title?.runs || [];
    const title = titleRuns[0]?.text || 'Untitled';
    const subtitleRuns = renderer?.subtitle?.runs || [];
    const subtitle = subtitleRuns.map((r: any) => r?.text).filter(Boolean).join('');
    const thumbnails = renderer?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails;
    const thumbnailUrl = this.extractThumbnails(thumbnails);

    const navWatch =
      renderer?.navigationEndpoint?.watchEndpoint ||
      renderer?.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
        ?.playNavigationEndpoint?.watchEndpoint;
    const videoId: string | null = navWatch?.videoId || null;

    const browseId: string | null =
      renderer?.navigationEndpoint?.browseEndpoint?.browseId ||
      titleRuns[0]?.navigationEndpoint?.browseEndpoint?.browseId ||
      null;
    const pageType: string =
      renderer?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
        ?.browseEndpointContextMusicConfig?.pageType || '';

    const isArtist = pageType.includes('ARTIST') || (browseId?.startsWith('UC') ?? false);
    const isAlbum = pageType.includes('ALBUM') || (browseId?.startsWith('MPREb') ?? false);
    const isPlaylist =
      pageType.includes('PLAYLIST') ||
      browseId?.startsWith('VL') ||
      browseId?.startsWith('PL') ||
      browseId?.startsWith('RD') ||
      false;
    const isVideo = !isArtist && !isAlbum && !isPlaylist && Boolean(videoId);

    const id =
      videoId ||
      browseId ||
      renderer?.id ||
      `card_${Math.random().toString(36).slice(2, 8)}`;

    return {
      id,
      videoId: videoId || (id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : undefined),
      title,
      subtitle,
      thumbnailUrl,
      secondaryText: null,
      explicit: false,
      endpoint: videoId ? `watch?v=${videoId}` : browseId ? `browse/${browseId}` : null,
      browseId,
      playlistId: isPlaylist ? browseId?.replace(/^VL/, '') || null : navWatch?.playlistId || null,
      channelId: isArtist ? browseId : null,
      radioId: videoId ? `RDAMVM${videoId}` : null,
      shuffleId: null,
      reloadParams: null,
      isArtist,
      isAlbum,
      isPlaylist,
      isSingle: false,
      isVideo,
      badge: isAlbum ? 'Album' : isArtist ? 'Artist' : isPlaylist ? 'Playlist' : isVideo ? 'Song' : null,
    };
  }

  public parseHome(raw: any): HomeShelf[] {
    const shelves: HomeShelf[] = [];
    const sectionList =
      raw?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
        ?.sectionListRenderer?.contents || [];

    for (const section of sectionList) {
      const carousel = section?.musicCarouselShelfRenderer;
      const shelf = section?.musicShelfRenderer;
      const target = carousel || shelf;

      if (!target) continue;

      const title =
        target.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs?.[0]?.text ||
        target.header?.musicShelfBasicHeaderRenderer?.title?.runs?.[0]?.text ||
        target.title?.runs?.[0]?.text ||
        'Shelves';

      const subtitle =
        target.header?.musicCarouselShelfBasicHeaderRenderer?.strapline?.runs?.[0]?.text || null;

      const items: BrowseItem[] = [];
      const rawItems = target.contents || [];

      for (const item of rawItems) {
        if (item.musicTwoRowItemRenderer) {
          items.push(this.parseTwoRowItem(item.musicTwoRowItemRenderer));
        } else if (item.musicResponsiveListItemRenderer) {
          items.push(this.parseResponsiveListItem(item.musicResponsiveListItemRenderer, title));
        }
      }

      if (items.length > 0) {
        shelves.push({
          title,
          subtitle,
          layout: carousel ? 'ROW' : 'GRID',
          items,
        });
      }
    }

    return shelves;
  }

  public parseExplore(raw: any): ExploreData {
    const sectionList =
      raw?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
        ?.sectionListRenderer?.contents || [];

    const chips: string[] = ['Energize', 'Relax', 'Workout', 'Commute', 'Focus'];
    const trending: BrowseItem[] = [];
    const categories: MoodGenreSection[] = [];

    for (const section of sectionList) {
      const carousel = section?.musicCarouselShelfRenderer;
      if (carousel) {
        for (const item of carousel.contents || []) {
          if (item.musicTwoRowItemRenderer) {
            trending.push(this.parseTwoRowItem(item.musicTwoRowItemRenderer));
          } else if (item.musicResponsiveListItemRenderer) {
            trending.push(this.parseResponsiveListItem(item.musicResponsiveListItemRenderer));
          }
        }
      }
    }

    return {
      chips,
      trending,
      categories,
    };
  }

  public parseSearchResults(raw: any): BrowseItem[] {
    const items: BrowseItem[] = [];
    const seenIds = new Set<string>();

    const pushUnique = (item: BrowseItem) => {
      const key = `${item.id}_${item.title}`;
      if (!seenIds.has(key) && item.title && item.title !== 'Untitled') {
        seenIds.add(key);
        items.push(item);
      }
    };

    const tabs = raw?.contents?.tabbedSearchResultsRenderer?.tabs || [];
    const sectionList: any[] = [];
    for (const tab of tabs) {
      const contents = tab?.tabRenderer?.content?.sectionListRenderer?.contents;
      if (Array.isArray(contents)) sectionList.push(...contents);
    }
    if (sectionList.length === 0 && Array.isArray(raw?.contents?.sectionListRenderer?.contents)) {
      sectionList.push(...raw.contents.sectionListRenderer.contents);
    }

    const flattenedSections: any[] = [];
    for (const section of sectionList) {
      if (Array.isArray(section?.itemSectionRenderer?.contents)) {
        flattenedSections.push(...section.itemSectionRenderer.contents);
      } else {
        flattenedSections.push(section);
      }
    }

    for (const section of flattenedSections) {
      if (section?.musicCardShelfRenderer) {
        for (const parsed of this.parseCardShelfRenderer(section.musicCardShelfRenderer)) {
          pushUnique(parsed);
        }
      }

      const shelf = section?.musicShelfRenderer;
      if (shelf) {
        const shelfTitle =
          shelf?.title?.runs?.[0]?.text ||
          shelf?.header?.musicShelfBasicHeaderRenderer?.title?.runs?.[0]?.text ||
          '';
        for (const row of shelf.contents || []) {
          if (row.musicResponsiveListItemRenderer) {
            pushUnique(this.parseResponsiveListItem(row.musicResponsiveListItemRenderer, shelfTitle));
          } else if (row.musicTwoRowItemRenderer) {
            pushUnique(this.parseTwoRowItem(row.musicTwoRowItemRenderer));
          }
        }
      }

      if (section?.musicResponsiveListItemRenderer) {
        pushUnique(this.parseResponsiveListItem(section.musicResponsiveListItemRenderer));
      } else if (section?.musicTwoRowItemRenderer) {
        pushUnique(this.parseTwoRowItem(section.musicTwoRowItemRenderer));
      }
    }

    return items;
  }

  public parseSuggestions(raw: any): string[] {
    const suggestions: string[] = [];
    const seen = new Set<string>();

    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      const renderer = node.searchSuggestionRenderer || node.historySuggestionRenderer;
      if (renderer) {
        const query =
          renderer?.navigationEndpoint?.searchEndpoint?.query ||
          (Array.isArray(renderer?.suggestion?.runs)
            ? renderer.suggestion.runs.map((r: any) => r?.text).join('')
            : '');
        const clean = query?.trim();
        if (clean && !seen.has(clean.toLowerCase())) {
          seen.add(clean.toLowerCase());
          suggestions.push(clean);
        }
      }
      for (const val of Object.values(node)) {
        if (val && typeof val === 'object') walk(val);
      }
    };

    walk(raw);
    return suggestions;
  }

  public parseReleaseDetail(id: string, raw: any, type: 'album' | 'playlist' = 'album'): DetailPage {
    const twoCol = raw?.contents?.twoColumnBrowseResultsRenderer;
    const primaryContents =
      twoCol?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ||
      raw?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
        ?.sectionListRenderer?.contents ||
      [];

    let header =
      raw?.header?.musicVisualHeaderRenderer ||
      raw?.header?.musicDetailHeaderRenderer ||
      raw?.header?.musicResponsiveHeaderRenderer ||
      raw?.header?.musicEditablePlaylistDetailHeaderRenderer?.header?.musicResponsiveHeaderRenderer;

    if (!header) {
      for (const sec of primaryContents) {
        if (sec?.musicResponsiveHeaderRenderer || sec?.musicDetailHeaderRenderer) {
          header = sec.musicResponsiveHeaderRenderer || sec.musicDetailHeaderRenderer;
          break;
        }
      }
    }

    const title = header?.title?.runs?.map((r: any) => r?.text).join('') || 'Release';
    const subtitleRuns = [
      ...(header?.straplineTextOne?.runs || []),
      ...(header?.subtitle?.runs || []),
    ];
    const subtitle = subtitleRuns.map((r: any) => r?.text).join('') || null;
    const thumbnails =
      header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
      header?.foregroundThumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
    const thumbnailUrl = this.extractThumbnails(thumbnails);

    const songs: Song[] = [];
    const trackSections = [
      ...(twoCol?.secondaryContents?.sectionListRenderer?.contents || []),
      ...primaryContents,
    ];

    for (const section of trackSections) {
      const shelf = section?.musicShelfRenderer || section?.musicPlaylistShelfRenderer;
      if (!shelf) continue;

      for (const item of shelf.contents || []) {
        const renderer = item.musicResponsiveListItemRenderer;
        if (!renderer) continue;

        const parsedItem = this.parseResponsiveListItem(renderer, 'Songs');
        const flexCols = renderer.flexColumns || [];
        const { artistText, artists, artistIds } = this.parseArtistsFromRuns(
          flexCols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs
        );

        const effectiveArtist =
          artistText && artistText !== 'Unknown Artist'
            ? artistText
            : header?.straplineTextOne?.runs?.[0]?.text || subtitle || 'Unknown Artist';

        const durationMs = this.parseDurationMs(parsedItem.secondaryText);

        if (parsedItem.id) {
          songs.push({
            videoId: parsedItem.id,
            title: parsedItem.title,
            artist: effectiveArtist,
            artists,
            artistIds,
            albumName: title,
            albumId: id,
            thumbnailUrl: parsedItem.thumbnailUrl || thumbnailUrl || undefined,
            artworkUrl: parsedItem.thumbnailUrl || thumbnailUrl || undefined,
            durationText: parsedItem.secondaryText || '3:30',
            liked: false,
            totalPlayTimeMs: durationMs,
            playCount: 0,
            isExplicit: parsedItem.explicit,
            playbackSourceType: 'YOUTUBE',
          });
        }
      }
    }

    return {
      id,
      title,
      subtitle,
      description:
        header?.description?.musicDescriptionShelfRenderer?.description?.runs
          ?.map((r: any) => r?.text)
          .join('') || null,
      thumbnailUrl,
      songs,
      secondaryItems: [],
      isAlbum: type === 'album',
      isPlaylist: type === 'playlist',
      isArtist: false,
    };
  }

  public parseArtistDetail(id: string, raw: any): ArtistPage {
    const header =
      raw?.header?.musicImmersiveHeaderRenderer ||
      raw?.header?.musicVisualHeaderRenderer ||
      raw?.header?.musicResponsiveHeaderRenderer;
    const name = header?.title?.runs?.[0]?.text || 'Artist';
    const bio =
      header?.description?.runs?.map((r: any) => r?.text).join('') || null;
    const thumbnails = header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
    const avatarUrl = this.extractThumbnails(thumbnails);
    const subscribersText =
      header?.subscriptionButton?.subscribeButtonRenderer?.subscriberCountText?.runs
        ?.map((r: any) => r?.text)
        .join('') || undefined;

    const topSongs: Song[] = [];
    const albums: ArtistAlbumItem[] = [];
    const singlesAndEps: ArtistAlbumItem[] = [];

    const sectionList =
      raw?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
        ?.sectionListRenderer?.contents || [];

    for (const section of sectionList) {
      const shelf = section?.musicShelfRenderer;
      if (shelf) {
        for (const row of shelf.contents || []) {
          const renderer = row?.musicResponsiveListItemRenderer;
          if (!renderer) continue;
          const item = this.parseResponsiveListItem(renderer, 'Songs');
          if (item.id && !item.isArtist && !item.isAlbum) {
            topSongs.push({
              videoId: item.id,
              title: item.title,
              artist: item.subtitle && item.subtitle !== 'Unknown Artist' ? item.subtitle : name,
              artists: [{ id, name }],
              artistIds: [id],
              thumbnailUrl: item.thumbnailUrl || avatarUrl || undefined,
              artworkUrl: item.thumbnailUrl || avatarUrl || undefined,
              durationText: item.secondaryText || '3:30',
              totalPlayTimeMs: this.parseDurationMs(item.secondaryText),
              liked: false,
              playCount: 0,
              isExplicit: item.explicit,
              playbackSourceType: 'YOUTUBE',
            });
          }
        }
      }

      const carousel = section?.musicCarouselShelfRenderer;
      if (carousel) {
        const shelfTitle =
          (
            carousel?.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs?.[0]?.text || ''
          ).toLowerCase();
        const isSinglesShelf = shelfTitle.includes('single') || shelfTitle.includes('ep');
        const isAlbumsShelf = shelfTitle.includes('album') || isSinglesShelf;
        if (!isAlbumsShelf) continue;

        for (const entry of carousel.contents || []) {
          if (entry?.musicTwoRowItemRenderer) {
            const parsed = this.parseTwoRowItem(entry.musicTwoRowItemRenderer);
            if (parsed.browseId) {
              const yearMatch = parsed.subtitle?.match(/\b(19|20)\d{2}\b/);
              const albumItem: ArtistAlbumItem = {
                id: parsed.browseId,
                title: parsed.title,
                year: yearMatch ? yearMatch[0] : null,
                thumbnailUrl: parsed.thumbnailUrl,
              };
              if (isSinglesShelf) {
                singlesAndEps.push(albumItem);
              } else {
                albums.push(albumItem);
              }
            }
          }
        }
      }
    }

    return {
      id,
      name,
      bio,
      avatarUrl,
      thumbnailUrl: avatarUrl,
      subscribersText,
      topSongs,
      albums,
      singlesAndEps,
    };
  }

  public getFilterParam(filter: string): string | undefined {
    switch (filter?.toLowerCase()) {
      case 'songs':
        return 'EgWKAQIIAWoKEAkQBRAKEAMQBA==';
      case 'albums':
        return 'EgWKAQIYAWoQEAMQBBAJEAoQBRAREBAQFQ==';
      case 'artists':
        return 'EgWKAQIgAWoQEAMQBBAJEAoQBRAREBAQFQ==';
      case 'playlists':
        return 'EgWKAQIoAWoQEAMQBBAJEAoQBRAREBAQFQ==';
      case 'videos':
        return 'EgWKAQIQAWoQEAMQBBAJEAoQBRAREBAQFQ==';
      default:
        return undefined;
    }
  }
}
