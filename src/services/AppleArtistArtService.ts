// src/services/AppleArtistArtService.ts
// Multi-source artist hero art + transparent custom artist logo waterfall:
// 1) Apple Music artist page (serialized-server-data)
// 2) MusicBrainz MBID -> Fanart.tv (hdmusiclogo / musiclogo transparent PNG, artistbackground)
// 3) TheAudioDB (strArtistLogo transparent PNG, strArtistFanart / strArtistBanner)

import { universalFetch } from './InnerTubeClient';

export interface AppleArtistArt {
  heroUrl: string | null;
  heroAspect: number;
  logoUrl: string | null;
  logoAspect: number;
  background: string;
  accent: string;
  keyColor: string | null;
}

const DEFAULT_FANART_API_KEY = '639191cb0774661597f28a47e7e2bad5';

function unwrapArtworkDict(node: any): any {
  if (!node || typeof node !== 'object') return null;
  if (typeof node.url === 'string' && node.url.trim()) return node;
  if (node.dictionary && typeof node.dictionary.url === 'string' && node.dictionary.url.trim()) {
    return node.dictionary;
  }
  return null;
}

export function fillTemplate(
  dict: any,
  w: number,
  f: string,
  c = 'bb',
): { url: string; aspect: number } | null {
  const target = unwrapArtworkDict(dict);
  if (!target?.url) return null;
  const safeCrop = c && c !== 'Hbb' ? c : 'bb';
  const dw = Number(target.width) || 1;
  const dh = Number(target.height) || 1;
  const h = Math.max(1, Math.round((w * dh) / dw));
  const url = String(target.url)
    .replaceAll('{w}', String(w))
    .replaceAll('{h}', String(h))
    .replaceAll('{c}', safeCrop)
    .replaceAll('{f}', f);
  if (url.includes('{') || url.includes('}')) return null;
  return { url, aspect: dw / dh };
}

export function toProxiedArtistImageUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.includes('{') || trimmed.includes('}')) return null;
  if (
    trimmed.startsWith('waveform-local://') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('file:')
  ) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    if (typeof window !== 'undefined' && Boolean((window as any).electronAPI)) {
      return `waveform-local://artist-art?url=${encodeURIComponent(trimmed)}`;
    }
    return trimmed;
  }
  return trimmed;
}

const hex = (v: unknown, fb: string) =>
  typeof v === 'string' && v.trim() ? '#' + v.trim().replace(/^#/, '') : fb;

interface ExtractedAppleNodes {
  logoDict: any;
  editorialHeroDict: any;
  headerArtworkDict: any;
  colorBackdropDict: any;
  fallbackArtworkDict: any;
  keyColor: string | null;
}

function collectAppleArtNodes(node: any, acc: ExtractedAppleNodes): void {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) {
      collectAppleArtNodes(item, acc);
    }
    return;
  }

  const ed = node.editorialArtwork && typeof node.editorialArtwork === 'object' ? node.editorialArtwork : null;

  // 1. Artist logo candidates
  if (!acc.logoDict) {
    acc.logoDict =
      unwrapArtworkDict(node.artistLogo) ||
      unwrapArtworkDict(ed?.artistLogo) ||
      unwrapArtworkDict(ed?.brandLogo) ||
      null;
  }

  // 2. High-priority editorial / fullscreen / banner hero candidates
  if (!acc.editorialHeroDict) {
    acc.editorialHeroDict =
      unwrapArtworkDict(node.centeredFullscreenBackgroundImage) ||
      unwrapArtworkDict(ed?.centeredFullscreenBackgroundImage) ||
      unwrapArtworkDict(node.bannerUber) ||
      unwrapArtworkDict(ed?.bannerUber) ||
      unwrapArtworkDict(ed?.subscriptionHero) ||
      unwrapArtworkDict(ed?.storeFlowcase) ||
      unwrapArtworkDict(ed?.fullscreenBackground) ||
      null;
  }

  // 3. Color backdrop artwork
  if (!acc.colorBackdropDict) {
    acc.colorBackdropDict =
      unwrapArtworkDict(node.colorBackdropArtwork) ||
      unwrapArtworkDict(ed?.colorBackdropArtwork) ||
      null;
  }

  // 4. Header-scoped artwork (on a node that also carries artist header markers)
  const isHeaderLike = Boolean(
    node.artistLogo ||
      node.editorialArtwork ||
      node.centeredFullscreenBackgroundImage ||
      node.bannerUber ||
      node.colorBackdropArtwork ||
      node.keyColor,
  );
  if (!acc.headerArtworkDict && isHeaderLike) {
    acc.headerArtworkDict =
      unwrapArtworkDict(node.artwork) ||
      unwrapArtworkDict(ed?.artwork) ||
      null;
  }

  if (!acc.fallbackArtworkDict && node.artwork) {
    acc.fallbackArtworkDict = unwrapArtworkDict(node.artwork);
  }

  if (!acc.keyColor && typeof node.keyColor === 'string' && node.keyColor.trim()) {
    acc.keyColor = node.keyColor.trim();
  }

  for (const child of Object.values(node)) {
    collectAppleArtNodes(child, acc);
  }
}

export function parseAppleArtistPageHtml(html: string): AppleArtistArt | null {
  if (!html || typeof html !== 'string') return null;
  const m = html.match(/<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let json: any;
  try {
    json = JSON.parse(m[1]);
  } catch {
    return null;
  }

  const acc: ExtractedAppleNodes = {
    logoDict: null,
    editorialHeroDict: null,
    headerArtworkDict: null,
    colorBackdropDict: null,
    fallbackArtworkDict: null,
    keyColor: null,
  };
  collectAppleArtNodes(json, acc);

  const heroDict =
    acc.editorialHeroDict ||
    acc.headerArtworkDict ||
    acc.colorBackdropDict ||
    acc.fallbackArtworkDict;

  if (!acc.logoDict && !heroDict) return null;

  const logo = fillTemplate(acc.logoDict, 1000, 'png', 'bb') ?? null;
  const hero = fillTemplate(heroDict, 1200, 'jpg', 'bb') ?? null;

  if (!logo && !hero) return null;

  const colorDict = heroDict || acc.colorBackdropDict || acc.headerArtworkDict || acc.logoDict;

  return {
    heroUrl: hero?.url ?? null,
    heroAspect: hero?.aspect ?? 1,
    logoUrl: logo?.url ?? null,
    logoAspect: logo?.aspect ?? 3,
    background: hex(colorDict?.bgColor, '#141218'),
    accent: hex(colorDict?.textColor1 || colorDict?.bgColor, '#FA2D48'),
    keyColor: acc.keyColor ? hex(acc.keyColor, '#FA2D48') : null,
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const CACHE_MAX = 64;
const cache = new Map<string, AppleArtistArt | null>();

export function clearAppleArtistArtCache(): void {
  cache.clear();
}

function pickFanartUrl(list: any): string | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const valid = list.filter(
    (item) => item && typeof item.url === 'string' && /^https?:\/\//i.test(item.url.trim()),
  );
  if (valid.length === 0) return null;
  const en = valid.find((item) => item.lang === 'en' || item.lang === '' || !item.lang);
  return (en || valid[0]).url.trim();
}

async function fetchFromAppleMusic(
  artistName: string,
  key: string,
  fetcher: typeof universalFetch,
): Promise<AppleArtistArt | null> {
  try {
    const res = await fetcher(
      `https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&entity=musicArtist&limit=5`,
    );
    if (!res.ok) return null;
    const data = await res.json<any>();
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    const hit =
      results.find((r: any) => norm(String(r?.artistName || '')) === key) ||
      results.find((r: any) => {
        const rn = norm(String(r?.artistName || ''));
        return Boolean(rn) && (rn.includes(key) || key.includes(rn));
      });
    if (!hit?.artistLinkUrl) return null;
    const page = await fetcher(String(hit.artistLinkUrl));
    if (!page.ok) return null;
    return parseAppleArtistPageHtml(await page.text());
  } catch {
    return null;
  }
}

async function fetchFromMusicBrainzAndFanart(
  artistName: string,
  key: string,
  fetcher: typeof universalFetch,
): Promise<{ logoUrl: string | null; logoAspect: number; heroUrl: string | null; heroAspect: number } | null> {
  try {
    const mbRes = await fetcher(
      `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(artistName)}&fmt=json&limit=5`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'WaveFormDesktop/1.0 (https://waveform.app)',
        },
      },
    );
    if (!mbRes.ok) return null;
    const mbData = await mbRes.json<any>();
    const artists: any[] = Array.isArray(mbData?.artists) ? mbData.artists : [];
    const mbHit =
      artists.find((a: any) => norm(String(a?.name || '')) === key) ||
      artists.find((a: any) => {
        const an = norm(String(a?.name || ''));
        return Boolean(an) && (an.includes(key) || key.includes(an));
      });
    const mbid = typeof mbHit?.id === 'string' ? mbHit.id.trim() : '';
    if (!mbid) return null;

    let apiKey = DEFAULT_FANART_API_KEY;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const customKey = window.localStorage.getItem('waveform.fanartApiKey');
        if (customKey && customKey.trim()) apiKey = customKey.trim();
      }
    } catch {
      // Ignore storage access errors in Node / restricted contexts
    }

    const fanartRes = await fetcher(
      `https://webservice.fanart.tv/v3/music/${encodeURIComponent(mbid)}?api_key=${encodeURIComponent(apiKey)}`,
    );
    if (!fanartRes.ok) return null;
    const fanartData = await fanartRes.json<any>();

    const hdLogo = pickFanartUrl(fanartData?.hdmusiclogo);
    const stdLogo = pickFanartUrl(fanartData?.musiclogo);
    const logoUrl = hdLogo || stdLogo || null;
    const logoAspect = hdLogo ? 800 / 310 : 400 / 155;

    const bgHero =
      pickFanartUrl(fanartData?.artistbackground) ||
      pickFanartUrl(fanartData?.musicbanner) ||
      null;

    if (!logoUrl && !bgHero) return null;
    return {
      logoUrl,
      logoAspect,
      heroUrl: bgHero,
      heroAspect: 16 / 9,
    };
  } catch {
    return null;
  }
}

async function fetchFromTheAudioDb(
  artistName: string,
  key: string,
  fetcher: typeof universalFetch,
): Promise<{ logoUrl: string | null; logoAspect: number; heroUrl: string | null; heroAspect: number } | null> {
  try {
    const res = await fetcher(
      `https://www.theaudiodb.com/api/v1/json/2/search.php?s=${encodeURIComponent(artistName)}`,
    );
    if (!res.ok) return null;
    const data = await res.json<any>();
    const artists: any[] = Array.isArray(data?.artists) ? data.artists : [];
    const hit =
      artists.find((a: any) => norm(String(a?.strArtist || '')) === key) ||
      artists.find((a: any) => {
        const an = norm(String(a?.strArtist || ''));
        return Boolean(an) && (an.includes(key) || key.includes(an));
      });
    if (!hit) return null;

    const cleanUrl = (v: unknown): string | null =>
      typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : null;

    const logoUrl = cleanUrl(hit.strArtistLogo) || cleanUrl(hit.strArtistClearart);
    const heroUrl =
      cleanUrl(hit.strArtistFanart) ||
      cleanUrl(hit.strArtistFanart2) ||
      cleanUrl(hit.strArtistBanner) ||
      cleanUrl(hit.strArtistWideThumb);

    if (!logoUrl && !heroUrl) return null;
    return {
      logoUrl,
      logoAspect: 3,
      heroUrl,
      heroAspect: 16 / 9,
    };
  } catch {
    return null;
  }
}

export async function fetchAppleArtistArt(
  artistName: string,
  fetcher: typeof universalFetch = universalFetch,
): Promise<AppleArtistArt | null> {
  const key = norm(artistName || '');
  if (!key) return null;
  const useDefaultCache = fetcher === universalFetch;
  if (useDefaultCache && cache.has(key)) {
    const v = cache.get(key)!;
    cache.delete(key);
    cache.set(key, v);
    return v;
  }

  // Stage 1: Apple Music artist page
  let result: AppleArtistArt | null = await fetchFromAppleMusic(artistName, key, fetcher);

  const ensureBaseResult = (): AppleArtistArt => {
    if (!result) {
      result = {
        heroUrl: null,
        heroAspect: 16 / 9,
        logoUrl: null,
        logoAspect: 3,
        background: '#141218',
        accent: '#FA2D48',
        keyColor: null,
      };
    }
    return result;
  };

  // Stage 2: MusicBrainz MBID -> Fanart.tv transparent PNG logo & artistbackground
  if (!result?.logoUrl || !result?.heroUrl) {
    const fanart = await fetchFromMusicBrainzAndFanart(artistName, key, fetcher);
    if (fanart) {
      const base = ensureBaseResult();
      if (!base.logoUrl && fanart.logoUrl) {
        base.logoUrl = fanart.logoUrl;
        base.logoAspect = fanart.logoAspect;
      }
      if (!base.heroUrl && fanart.heroUrl) {
        base.heroUrl = fanart.heroUrl;
        base.heroAspect = fanart.heroAspect;
      }
    }
  }

  // Stage 3: TheAudioDB transparent PNG logo & fanart/banner
  if (!result?.logoUrl || !result?.heroUrl) {
    const audioDb = await fetchFromTheAudioDb(artistName, key, fetcher);
    if (audioDb) {
      const base = ensureBaseResult();
      if (!base.logoUrl && audioDb.logoUrl) {
        base.logoUrl = audioDb.logoUrl;
        base.logoAspect = audioDb.logoAspect;
      }
      if (!base.heroUrl && audioDb.heroUrl) {
        base.heroUrl = audioDb.heroUrl;
        base.heroAspect = audioDb.heroAspect;
      }
    }
  }

  if (result && !result.logoUrl && !result.heroUrl) {
    result = null;
  }

  if (result) {
    result = {
      ...result,
      heroUrl: toProxiedArtistImageUrl(result.heroUrl),
      logoUrl: toProxiedArtistImageUrl(result.logoUrl),
    };
  }

  if (useDefaultCache) {
    cache.set(key, result);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  }
  return result;
}
