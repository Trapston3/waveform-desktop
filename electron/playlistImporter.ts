// electron/playlistImporter.ts
// Zero-API-key public playlist & album fetcher for Spotify, Apple Music, and YouTube Music URLs

export type PlaylistSource = 'spotify' | 'apple' | 'youtube';

export interface DetectedPlaylistTarget {
  source: PlaylistSource;
  kind: 'playlist' | 'album';
  id: string;
  storefront?: string;
  url: string;
}

export interface ImportedTrackRaw {
  title: string;
  artist: string;
  album?: string;
  durationSec: number;
  artworkUrl?: string | null;
  isrc?: string | null;
  videoId?: string | null;
}

export interface ImportedPlaylistPreview {
  source: PlaylistSource;
  kind: 'playlist' | 'album';
  id: string;
  title: string;
  owner?: string;
  description?: string;
  thumbnailUrl?: string | null;
  sourceUrl: string;
  tracks: ImportedTrackRaw[];
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let cachedAppleToken: { token: string; fetchedAt: number } | null = null;

export function detectPlaylistUrl(rawUrl: string): DetectedPlaylistTarget | null {
  const input = String(rawUrl || '').trim();
  if (!input) return null;

  const spUri = /^spotify:(playlist|album):([A-Za-z0-9]+)$/i.exec(input);
  if (spUri) {
    const kind = spUri[1].toLowerCase() as 'playlist' | 'album';
    const id = spUri[2];
    return {
      source: 'spotify',
      kind,
      id,
      url: `https://open.spotify.com/${kind}/${id}`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (host.includes('spotify.com')) {
    const m = /\/(playlist|album)\/([A-Za-z0-9]+)/i.exec(parsed.pathname);
    if (m) {
      return {
        source: 'spotify',
        kind: m[1].toLowerCase() as 'playlist' | 'album',
        id: m[2],
        url: input,
      };
    }
  }

  if (host === 'music.apple.com' || host.endsWith('.music.apple.com')) {
    const m = /^\/([a-z]{2})\/(playlist|album)\/[^/]+\/([A-Za-z0-9._-]+)/i.exec(parsed.pathname);
    if (m) {
      return {
        source: 'apple',
        kind: m[2].toLowerCase() as 'playlist' | 'album',
        storefront: m[1].toLowerCase(),
        id: m[3],
        url: input,
      };
    }
    const shortM = /^\/([a-z]{2})\/(playlist|album)\/([A-Za-z0-9._-]+)/i.exec(parsed.pathname);
    if (shortM) {
      return {
        source: 'apple',
        kind: shortM[2].toLowerCase() as 'playlist' | 'album',
        storefront: shortM[1].toLowerCase(),
        id: shortM[3],
        url: input,
      };
    }
  }

  if (host.includes('youtube.com') || host === 'youtu.be') {
    const listId = parsed.searchParams.get('list');
    if (listId && listId.trim()) {
      return {
        source: 'youtube',
        kind: 'playlist',
        id: listId.trim(),
        url: input,
      };
    }
  }

  return null;
}

export function expandAppleArtworkUrl(rawUrl?: string | null, size = 600): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  return trimmed
    .replaceAll('{w}', String(size))
    .replaceAll('{h}', String(size))
    .replaceAll('{c}', 'bb')
    .replaceAll('{f}', 'jpg');
}

export function parseSpotifyEmbedHtml(
  html: string,
  meta: { id: string; kind: 'playlist' | 'album'; sourceUrl: string }
): ImportedPlaylistPreview | null {
  if (!html || typeof html !== 'string') return null;
  const match = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!match) return null;

  let json: any;
  try {
    json = JSON.parse(match[1]);
  } catch {
    return null;
  }

  const entity = json?.props?.pageProps?.state?.data?.entity;
  if (!entity || typeof entity !== 'object') return null;

  const title = String(entity.name || entity.title || 'Spotify Playlist').trim();
  const coverSources = Array.isArray(entity.coverArt?.sources) ? entity.coverArt.sources : [];
  const thumbnailUrl: string | null =
    coverSources[0]?.url ||
    entity.images?.[0]?.url ||
    null;
  const owner = typeof entity.subtitle === 'string' ? entity.subtitle.trim() : undefined;
  const rawList = Array.isArray(entity.trackList) ? entity.trackList : [];
  const albumTitle = meta.kind === 'album' ? title : undefined;

  const tracks: ImportedTrackRaw[] = [];
  for (const t of rawList) {
    const tTitle = String(t?.title || '').trim();
    if (!tTitle) continue;
    const tArtist =
      String(t?.subtitle || '').trim() ||
      (Array.isArray(t?.artists)
        ? t.artists.map((a: any) => a?.name).filter(Boolean).join(', ')
        : '') ||
      'Unknown Artist';
    const durMs = Number(t?.duration) || 0;
    tracks.push({
      title: tTitle,
      artist: tArtist.replace(/\u00A0/g, ' '),
      ...(albumTitle ? { album: albumTitle } : {}),
      durationSec: durMs > 0 ? Math.round(durMs / 1000) : 0,
      artworkUrl: thumbnailUrl,
    });
  }

  return {
    source: 'spotify',
    kind: meta.kind,
    id: meta.id,
    title,
    owner,
    thumbnailUrl,
    sourceUrl: meta.sourceUrl,
    tracks,
  };
}

export function parseAppleMusicCatalogResponse(
  json: any,
  meta: { id: string; kind: 'playlist' | 'album'; sourceUrl: string }
): { preview: ImportedPlaylistPreview; nextPath: string | null } | null {
  const root = Array.isArray(json?.data) ? json.data[0] : json?.data;
  if (!root || typeof root !== 'object') return null;

  const attrs = root.attributes || {};
  const title = String(attrs.name || 'Apple Music Playlist').trim();
  const owner =
    typeof attrs.curatorName === 'string'
      ? attrs.curatorName.trim()
      : typeof attrs.artistName === 'string'
      ? attrs.artistName.trim()
      : undefined;
  const description =
    typeof attrs.description?.standard === 'string'
      ? attrs.description.standard.trim()
      : typeof attrs.editorialNotes?.short === 'string'
      ? attrs.editorialNotes.short.trim()
      : undefined;
  const thumbnailUrl = expandAppleArtworkUrl(attrs.artwork?.url, 600);

  const trackRel = root.relationships?.tracks || {};
  const rawTracks: any[] = Array.isArray(trackRel.data) ? trackRel.data : [];
  const nextPath: string | null = typeof trackRel.next === 'string' ? trackRel.next : null;

  const tracks: ImportedTrackRaw[] = [];
  for (const item of rawTracks) {
    const ta = item?.attributes;
    if (!ta?.name) continue;
    const durMs = Number(ta.durationInMillis) || 0;
    tracks.push({
      title: String(ta.name).trim(),
      artist: String(ta.artistName || attrs.artistName || 'Unknown Artist').trim(),
      album: typeof ta.albumName === 'string' ? ta.albumName.trim() : meta.kind === 'album' ? title : undefined,
      durationSec: durMs > 0 ? Math.round(durMs / 1000) : 0,
      artworkUrl: expandAppleArtworkUrl(ta.artwork?.url, 400) || thumbnailUrl,
      isrc: typeof ta.isrc === 'string' && ta.isrc.trim() ? ta.isrc.trim() : null,
    });
  }

  return {
    preview: {
      source: 'apple',
      kind: meta.kind,
      id: meta.id,
      title,
      owner,
      description,
      thumbnailUrl,
      sourceUrl: meta.sourceUrl,
      tracks,
    },
    nextPath,
  };
}

export function parseAppleMusicHtmlFallback(
  html: string,
  meta: { id: string; kind: 'playlist' | 'album'; sourceUrl: string }
): ImportedPlaylistPreview | null {
  if (!html || typeof html !== 'string') return null;
  const match =
    /<script[^>]*id=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!match) return null;

  let json: any;
  try {
    json = JSON.parse(match[1]);
  } catch {
    return null;
  }

  let title = '';
  let thumbnailUrl: string | null = null;
  const tracks: ImportedTrackRaw[] = [];
  const seen = new Set<string>();

  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    if (!title && typeof node.title === 'string' && node.artwork) {
      title = node.title.trim();
      thumbnailUrl = expandAppleArtworkUrl(node.artwork?.dictionary?.url || node.artwork?.url, 600);
    }

    const itemTitle = typeof node.title === 'string' ? node.title.trim() : '';
    const artistSubtitle =
      typeof node.artistName === 'string'
        ? node.artistName.trim()
        : Array.isArray(node.subtitleLinks) && node.subtitleLinks[0]?.title
        ? String(node.subtitleLinks.map((l: any) => l?.title).filter(Boolean).join(', ')).trim()
        : '';
    const durMs = Number(node.duration) || Number(node.durationInMillis) || 0;
    const isTrackLike =
      itemTitle &&
      (durMs > 0 || node.trackNumber !== undefined || node.contentDescriptor?.kind === 'song');

    if (isTrackLike) {
      const key = `${itemTitle.toLowerCase()}::${artistSubtitle.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        tracks.push({
          title: itemTitle,
          artist: artistSubtitle || 'Unknown Artist',
          album: typeof node.albumName === 'string' ? node.albumName.trim() : undefined,
          durationSec: durMs > 0 ? Math.round(durMs / 1000) : 0,
          artworkUrl:
            expandAppleArtworkUrl(node.artwork?.dictionary?.url || node.artwork?.url, 400) ||
            thumbnailUrl,
        });
      }
    }

    for (const val of Object.values(node)) {
      if (val && typeof val === 'object') walk(val);
    }
  };

  walk(json);
  if (!title && tracks.length === 0) return null;

  return {
    source: 'apple',
    kind: meta.kind,
    id: meta.id,
    title: title || 'Apple Music Playlist',
    thumbnailUrl,
    sourceUrl: meta.sourceUrl,
    tracks,
  };
}

async function fetchAppleAnonymousToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedAppleToken && now - cachedAppleToken.fetchedAt < 30 * 60_000) {
    return cachedAppleToken.token;
  }

  try {
    const res = await fetch('https://am-mint.binimum.org/token', {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(7000),
    });
    if (res.ok) {
      const text = (await res.text()).trim();
      let token = text;
      if (text.startsWith('{')) {
        const parsed = JSON.parse(text);
        token = parsed.token || parsed.access_token || parsed.authorization || '';
      }
      if (token && token.split('.').length === 3) {
        cachedAppleToken = { token, fetchedAt: now };
        return token;
      }
    }
  } catch {
    // Fall back to Apple Music web bundle scrape
  }

  try {
    const home = await fetch('https://music.apple.com/us/browse', {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!home.ok) return null;
    const html = await home.text();
    const bundleMatch = /src=["'](\/assets\/index[^"']+\.js)["']/i.exec(html);
    if (!bundleMatch) return null;
    const bundleRes = await fetch(`https://music.apple.com${bundleMatch[1]}`, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!bundleRes.ok) return null;
    const js = await bundleRes.text();
    const jwtMatch = /eyJh[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.exec(js);
    if (jwtMatch) {
      cachedAppleToken = { token: jwtMatch[0], fetchedAt: now };
      return jwtMatch[0];
    }
  } catch {
    // Non-fatal; caller falls back to serialized-server-data HTML
  }
  return null;
}

async function fetchSpotifyWebPagination(
  kind: 'playlist' | 'album',
  id: string
): Promise<ImportedTrackRaw[] | null> {
  try {
    const tokRes = await fetch(
      'https://open.spotify.com/get_access_token?reason=transport&productType=web_player',
      {
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!tokRes.ok) return null;
    const tokData = (await tokRes.json()) as any;
    const token = tokData?.accessToken;
    if (!token || typeof token !== 'string') return null;

    const all: ImportedTrackRaw[] = [];
    let nextUrl: string | null =
      kind === 'playlist'
        ? `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100`
        : `https://api.spotify.com/v1/albums/${id}/tracks?limit=50`;

    let pages = 0;
    while (nextUrl && pages < 12) {
      pages += 1;
      const res = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': BROWSER_UA,
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) break;
      const page = (await res.json()) as any;
      for (const entry of page?.items || []) {
        const track = kind === 'playlist' ? entry?.track : entry;
        if (!track || !track.name) continue;
        const artists = Array.isArray(track.artists)
          ? track.artists.map((a: any) => a?.name).filter(Boolean).join(', ')
          : 'Unknown Artist';
        const durMs = Number(track.duration_ms) || 0;
        all.push({
          title: String(track.name).trim(),
          artist: artists || 'Unknown Artist',
          album: typeof track.album?.name === 'string' ? track.album.name.trim() : undefined,
          durationSec: durMs > 0 ? Math.round(durMs / 1000) : 0,
          artworkUrl: track.album?.images?.[0]?.url || null,
          isrc: typeof track.external_ids?.isrc === 'string' ? track.external_ids.isrc : null,
        });
      }
      nextUrl = typeof page?.next === 'string' ? page.next : null;
    }

    return all.length > 0 ? all : null;
  } catch {
    return null;
  }
}

export async function fetchPublicPlaylistByUrl(rawUrl: string): Promise<ImportedPlaylistPreview> {
  const target = detectPlaylistUrl(rawUrl);
  if (!target) {
    throw new Error('Unsupported or invalid playlist URL. Paste a Spotify, Apple Music, or YouTube Music URL.');
  }

  if (target.source === 'youtube') {
    return {
      source: 'youtube',
      kind: 'playlist',
      id: target.id,
      title: 'YouTube Music Playlist',
      sourceUrl: target.url,
      tracks: [],
    };
  }

  if (target.source === 'spotify') {
    const embedUrl = `https://open.spotify.com/embed/${target.kind}/${target.id}`;
    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      throw new Error(`Spotify returned HTTP ${res.status}. Make sure the playlist is public.`);
    }
    const html = await res.text();
    const parsed = parseSpotifyEmbedHtml(html, {
      id: target.id,
      kind: target.kind,
      sourceUrl: target.url,
    });
    if (!parsed) {
      throw new Error('Could not parse tracks from Spotify playlist page.');
    }
    if (parsed.tracks.length >= 100 || (target.kind === 'album' && parsed.tracks.length >= 50)) {
      const fullTracks = await fetchSpotifyWebPagination(target.kind, target.id);
      if (fullTracks && fullTracks.length > parsed.tracks.length) {
        parsed.tracks = fullTracks;
      }
    }
    return parsed;
  }

  // Apple Music
  const storefront = target.storefront || 'us';
  const token = await fetchAppleAnonymousToken();
  if (token) {
    try {
      const endpoint =
        target.kind === 'playlist'
          ? `https://amp-api.music.apple.com/v1/catalog/${storefront}/playlists/${encodeURIComponent(target.id)}?include=tracks`
          : `https://amp-api.music.apple.com/v1/catalog/${storefront}/albums/${encodeURIComponent(target.id)}?include=tracks`;
      const apiRes = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: 'https://music.apple.com',
          Referer: 'https://music.apple.com/',
          'User-Agent': BROWSER_UA,
        },
        signal: AbortSignal.timeout(12000),
      });
      if (apiRes.ok) {
        const json = await apiRes.json();
        const parsed = parseAppleMusicCatalogResponse(json, {
          id: target.id,
          kind: target.kind,
          sourceUrl: target.url,
        });
        if (parsed) {
          let nextPath = parsed.nextPath;
          let pages = 0;
          while (nextPath && pages < 10) {
            pages += 1;
            const nextUrl = nextPath.startsWith('http')
              ? nextPath
              : `https://amp-api.music.apple.com${nextPath}`;
            const pageRes = await fetch(nextUrl, {
              headers: {
                Authorization: `Bearer ${token}`,
                Origin: 'https://music.apple.com',
                'User-Agent': BROWSER_UA,
              },
              signal: AbortSignal.timeout(10000),
            });
            if (!pageRes.ok) break;
            const pageJson = (await pageRes.json()) as any;
            const pageData: any[] = Array.isArray(pageJson?.data) ? pageJson.data : [];
            for (const item of pageData) {
              const ta = item?.attributes;
              if (!ta?.name) continue;
              const durMs = Number(ta.durationInMillis) || 0;
              parsed.preview.tracks.push({
                title: String(ta.name).trim(),
                artist: String(ta.artistName || 'Unknown Artist').trim(),
                album: typeof ta.albumName === 'string' ? ta.albumName.trim() : undefined,
                durationSec: durMs > 0 ? Math.round(durMs / 1000) : 0,
                artworkUrl: expandAppleArtworkUrl(ta.artwork?.url, 400) || parsed.preview.thumbnailUrl,
                isrc: typeof ta.isrc === 'string' && ta.isrc.trim() ? ta.isrc.trim() : null,
              });
            }
            nextPath = typeof pageJson?.next === 'string' ? pageJson.next : null;
          }
          if (parsed.preview.tracks.length > 0) {
            return parsed.preview;
          }
        }
      }
    } catch {
      // Fall back to Apple Music HTML serialized-server-data
    }
  }

  const pageRes = await fetch(target.url, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!pageRes.ok) {
    throw new Error(`Apple Music returned HTTP ${pageRes.status}. Make sure the playlist is public.`);
  }
  const html = await pageRes.text();
  const fallback = parseAppleMusicHtmlFallback(html, {
    id: target.id,
    kind: target.kind,
    sourceUrl: target.url,
  });
  if (!fallback || fallback.tracks.length === 0) {
    throw new Error('Could not extract tracks from Apple Music playlist.');
  }
  return fallback;
}
