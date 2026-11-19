// src/services/AppleArtistArtService.ts
// Apple Music artist hero art + custom artist logo (ported from AppleArtistArt.kt / artistPage.ts)
// plus a stylized signature SVG fallback (ArtistSignatures.kt).

import { universalFetch } from './InnerTubeClient';

export interface AppleArtistArt {
  heroUrl: string | null;
  heroAspect: number;
  logoUrl: string | null;
  logoAspect: number;
  signatureSvgUrl?: string | null;
  background: string;
  accent: string;
  keyColor: string | null;
}

function findHeader(node: any): any {
  if (!node || typeof node !== 'object') return null;
  if (node.artistLogo) return node;
  const kids = Array.isArray(node) ? node : Object.values(node);
  for (const k of kids) {
    const r = findHeader(k);
    if (r) return r;
  }
  return null;
}

function fillTemplate(dict: any, w: number, f: string, c = 'bb'): { url: string; aspect: number } | null {
  if (!dict?.url) return null;
  const dw = Number(dict.width) || 1;
  const dh = Number(dict.height) || 1;
  const h = Math.max(1, Math.round((w * dh) / dw));
  const url = String(dict.url)
    .replace('{w}', String(w))
    .replace('{h}', String(h))
    .replace('{c}', c)
    .replace('{f}', f);
  return { url, aspect: dw / dh };
}

const hex = (v: unknown, fb: string) => (typeof v === 'string' && v ? '#' + v.replace(/^#/, '') : fb);

export function parseAppleArtistPageHtml(html: string): AppleArtistArt | null {
  const m = html.match(/<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let json: any;
  try {
    json = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const header = findHeader(json);
  if (!header) return null;
  const logoDict = header.artistLogo?.dictionary;
  const heroDict = header.artwork?.dictionary || header.colorBackdropArtwork?.dictionary;
  const logo = fillTemplate(logoDict, 1000, 'png', 'Hbb') ?? null;
  const hero = fillTemplate(heroDict, 1200, 'jpg', 'Hbb') ?? null;
  // Template uses {w}x{h}{c}.{f}; ensure c/h substitution style
  return {
    heroUrl: hero?.url ?? null,
    heroAspect: hero?.aspect ?? 1,
    logoUrl: logo?.url ?? null,
    logoAspect: logo?.aspect ?? 3,
    signatureSvgUrl: null,
    background: hex(heroDict?.bgColor, '#141218'),
    accent: hex(heroDict?.textColor1 || heroDict?.bgColor, '#FA2D48'),
    keyColor: header.keyColor ? hex(header.keyColor, '#FA2D48') : null,
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const CACHE_MAX = 64;
const cache = new Map<string, AppleArtistArt | null>();

export async function fetchAppleArtistArt(artistName: string): Promise<AppleArtistArt | null> {
  const key = norm(artistName);
  if (!key) return null;
  if (cache.has(key)) {
    const v = cache.get(key)!;
    cache.delete(key);
    cache.set(key, v);
    return v;
  }
  let result: AppleArtistArt | null = null;
  try {
    const res = await universalFetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&entity=musicArtist&limit=5`,
    );
    if (res.ok) {
      const data = await res.json<any>();
      const hit = (data?.results || []).find((r: any) => norm(String(r.artistName || '')) === key);
      if (hit?.artistLinkUrl) {
        const page = await universalFetch(String(hit.artistLinkUrl));
        if (page.ok) result = parseAppleArtistPageHtml(await page.text());
      }
    }
  } catch {
    result = null;
  }
  cache.set(key, result);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return result;
}

export function generateStylizedArtistSignatureSvgDataUri(artistName: string): { dataUri: string; aspect: number } {
  const name = (artistName || 'Artist').trim();
  const esc = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const w = Math.min(900, Math.max(360, 70 + name.length * 44));
  const h = 160;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#FFD6DC"/></linearGradient></defs>` +
    `<text x="${w / 2}" y="100" text-anchor="middle" font-family="'Snell Roundhand','Segoe Script','Brush Script MT',cursive" font-style="italic" font-weight="700" font-size="84" fill="url(#g)" stroke="#FA2D48" stroke-width="0.6" transform="rotate(-4 ${w / 2} 100)">${esc}</text>` +
    `<path d="M${w * 0.1} 128 C ${w * 0.3} 150, ${w * 0.55} 112, ${w * 0.9} 132" fill="none" stroke="#FA2D48" stroke-width="4" stroke-linecap="round"/>` +
    `</svg>`;
  return { dataUri: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), aspect: w / h };
}
