// src/ui/views/ArtistDetailView.tsx
// 1:1 macOS Apple Music Desktop Artist Profile Experience:
// Panoramic Liquid Glass hero banner with verified hero art & transparent custom logo (or editorial display title),
// full Top Songs table with toggle, discography shelves (1:1 square artwork),
// empty state 'No releases available for this artist.', and 50k character safe biography expander (B20-T05).
// Strict tracklist-row virtualization containment and 0Hz playback re-render isolation.

import React, { useState, useEffect, memo } from 'react';
import { Radio, Check, Sparkles, ChevronDown, ChevronUp, Shuffle, Star, MoreHorizontal } from 'lucide-react';
import { fetchAppleArtistArt, toProxiedArtistImageUrl } from '../../services/AppleArtistArtService';
import type { AppleArtistArt } from '../../services/AppleArtistArtService';
import { MusicService } from '../../services/MusicService';
import type { ArtistPage } from '../../models/Navigation';
import type { Song } from '../../models/Song';
import { usePlayerStore } from '../../state/playerStore';
import { useQueueStore } from '../../state/queueStore';
import { useNavigationStore } from '../../state/navigationStore';
import { PlayerPlayIcon } from '../common/WaveFormIcons';
import { DesktopTrackTable } from '../components/DesktopTrackTable';
import { ArtistCredits } from '../common/ArtistCredits';

export interface ArtistDetailViewProps {
  artistId: string;
  onOpenContextMenu?: (e: React.MouseEvent, song: Song) => void;
}

export function formatArtistStats(
  artist?: Pick<ArtistPage, 'monthlyListeners' | 'subscribersText'> | null,
): string[] {
  if (!artist) return [];
  const stats: string[] = [];

  const listeners = artist.monthlyListeners;
  if (typeof listeners === 'number' && Number.isFinite(listeners) && listeners > 0) {
    stats.push(`${Math.round(listeners).toLocaleString('en-US')} monthly listeners`);
  }

  if (typeof artist.subscribersText === 'string') {
    const cleaned = artist.subscribersText.replace(/^[•·\-–—\s]+/, '').trim();
    if (cleaned) {
      if (/subscriber|listener|follower/i.test(cleaned)) {
        stats.push(cleaned);
      } else {
        stats.push(`${cleaned} subscribers`);
      }
    }
  }

  return stats;
}

function preloadAndVerifyImage(url: string | null): Promise<string | null> {
  if (!url || typeof url !== 'string' || url.includes('{') || url.includes('}')) {
    return Promise.resolve(null);
  }
  if (typeof Image === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok ? url : null);
    };
    img.onload = () => {
      if (typeof img.decode === 'function') {
        img
          .decode()
          .then(() => finish(img.naturalWidth > 0))
          .catch(() => finish(img.naturalWidth > 0));
      } else {
        finish(img.naturalWidth > 0);
      }
    };
    img.onerror = () => finish(false);
    img.src = url;
  });
}

const StatChip: React.FC<{ label: string }> = ({ label }) => (
  <span className="px-3 py-1 rounded-full text-[11px] font-semibold bg-white/10 border border-white/10 text-white/90">{label}</span>
);

export const ArtistDetailView: React.FC<ArtistDetailViewProps> = memo(({ artistId, onOpenContextMenu }) => {
  const [artist, setArtist] = useState<ArtistPage | null>(null);
  const [isFollowed, setIsFollowed] = useState(false);
  const [isBioExpanded, setIsBioExpanded] = useState(false);
  const [showAllTopSongs, setShowAllTopSongs] = useState(false);
  const [discographyTab, setDiscographyTab] = useState<'all' | 'albums' | 'singles'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [appleArt, setAppleArt] = useState<AppleArtistArt | null>(null);
  const [verifiedHeroUrl, setVerifiedHeroUrl] = useState<string | null>(null);
  const [heroFailed, setHeroFailed] = useState(false);
  const [verifiedLogoUrl, setVerifiedLogoUrl] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const [topSongsMode, setTopSongsMode] = useState<'grid' | 'table'>('grid');

  // Exact 0Hz selectors conforming to adversarial_m4_state_ticker.mjs
  const loadTrack = usePlayerStore((s) => s.loadTrack);
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.videoId);

  const { setContextQueue } = useQueueStore();
  const { navigateToRelease, navigateToArtist } = useNavigationStore();

  useEffect(() => {
    let isMounted = true;
    setArtist(null);
    setAppleArt(null);
    setVerifiedHeroUrl(null);
    setHeroFailed(false);
    setVerifiedLogoUrl(null);
    setLogoFailed(false);
    setIsBioExpanded(false);

    async function loadArtist() {
      setIsLoading(true);
      try {
        const musicService = new MusicService();
        const data = await musicService.getArtistDetails(artistId);
        if (isMounted && data) {
          setArtist(data);
        }
      } catch (err) {
        console.warn('[ArtistDetailView] Load failed:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    loadArtist();
    return () => {
      isMounted = false;
    };
  }, [artistId]);

  const topSongs = artist?.topSongs || [];
  const albums = artist?.albums || [];
  const singles = artist?.singlesAndEps || [];

  useEffect(() => {
    let alive = true;
    setAppleArt(null);
    if (!artist?.name) return;
    fetchAppleArtistArt(artist.name)
      .then((a) => {
        if (alive) setAppleArt(a);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [artistId, artist?.name]);

  // Preload & verify hero image candidates (resetting cleanly on artistId change)
  useEffect(() => {
    let cancelled = false;
    setVerifiedHeroUrl(null);
    setHeroFailed(false);

    const primaryHero = toProxiedArtistImageUrl(appleArt?.heroUrl);
    const fallbackHero = toProxiedArtistImageUrl(artist?.avatarUrl || artist?.thumbnailUrl);
    const candidates = [primaryHero, fallbackHero].filter(
      (u, idx, arr): u is string => Boolean(u) && arr.indexOf(u) === idx,
    );

    if (candidates.length === 0) return;

    (async () => {
      for (const candidate of candidates) {
        const verified = await preloadAndVerifyImage(candidate);
        if (cancelled) return;
        if (verified) {
          setVerifiedHeroUrl(verified);
          return;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [artistId, appleArt?.heroUrl, artist?.avatarUrl, artist?.thumbnailUrl]);

  // Preload & verify transparent custom artist logo (resetting cleanly on artistId change)
  useEffect(() => {
    let cancelled = false;
    setVerifiedLogoUrl(null);
    setLogoFailed(false);

    const candidateLogo = toProxiedArtistImageUrl(appleArt?.logoUrl);
    if (!candidateLogo) return;

    preloadAndVerifyImage(candidateLogo).then((verified) => {
      if (!cancelled && verified) {
        setVerifiedLogoUrl(verified);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [artistId, appleArt?.logoUrl]);

  const handlePlayTopSongs = () => {
    if (topSongs.length === 0) return;
    setContextQueue(topSongs, 0, {
      id: artistId,
      browseId: artistId,
      title: `${artist?.name || 'Artist'} - Top Songs`,
      type: 'artist',
      currentIndex: 0,
    });
    loadTrack(topSongs[0], 'active', true);
  };

  const handleShuffleTopSongs = () => {
    if (topSongs.length === 0) return;
    const shuffled = [...topSongs].sort(() => Math.random() - 0.5);
    setContextQueue(shuffled, 0, {
      id: artistId,
      browseId: artistId,
      title: `${artist?.name || 'Artist'} - Top Songs`,
      type: 'artist',
      currentIndex: 0,
    });
    loadTrack(shuffled[0], 'active', true);
  };

  const artistStats = formatArtistStats(artist);
  const latestRelease = singles[0] || albums[0] || null;
  // Safe biography truncation handling up to 50,000 characters per B20-T05
  const rawBio = artist?.bio || '';
  const isBioLong = rawBio.length > 320;
  const displayBio = isBioLong && !isBioExpanded ? rawBio.slice(0, 320) + '...' : rawBio;

  const displayedReleases =
    discographyTab === 'albums'
      ? albums
      : discographyTab === 'singles'
      ? singles
      : [...albums, ...singles];

  const displayedTopSongs = showAllTopSongs ? topSongs : topSongs.slice(0, 5);
  const heroBgColor = appleArt?.background || '#141218';
  const heroAccentColor = appleArt?.keyColor || appleArt?.accent || '#FA2D48';

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-16 select-none animate-in fade-in duration-200">
      {/* 1. Full-bleed iOS Apple Music artist hero */}
      <div
        data-testid="artist-hero"
        className="relative min-h-[380px] md:min-h-[440px] rounded-3xl overflow-hidden flex flex-col justify-end"
        style={{
          background: `radial-gradient(120% 90% at 50% 0%, ${heroAccentColor}33 0%, ${heroBgColor} 58%, #0A0A0E 100%)`,
        }}
      >
        {verifiedHeroUrl && !heroFailed && (
          <img
            src={verifiedHeroUrl}
            alt=""
            onError={() => {
              setHeroFailed(true);
              setVerifiedHeroUrl(null);
            }}
            className="absolute inset-0 w-full h-full object-cover scale-105"
          />
        )}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.38) 48%, ${heroBgColor}e6 84%, ${heroBgColor} 100%)`,
          }}
        />
        <div
          className="absolute -bottom-24 left-1/2 -translate-x-1/2 w-[480px] h-[220px] rounded-full blur-3xl opacity-35 pointer-events-none"
          style={{ background: heroAccentColor }}
        />
        <div className="relative z-10 p-6 md:p-8 space-y-3 text-center">
          {verifiedLogoUrl && !logoFailed ? (
            <>
              <img
                data-testid="artist-custom-logo"
                src={verifiedLogoUrl}
                alt=""
                onError={() => {
                  setLogoFailed(true);
                  setVerifiedLogoUrl(null);
                }}
                className="h-16 md:h-24 max-w-[80%] object-contain mx-auto"
                style={{ filter: 'drop-shadow(0 4px 20px rgba(0,0,0,0.75))' }}
              />
              <h1 className="sr-only">
                {artist?.name || (isLoading ? 'Loading...' : 'Artist Profile')}
              </h1>
            </>
          ) : (
            <h1
              data-testid="artist-editorial-title"
              className="text-3xl md:text-5xl font-black tracking-tight text-white truncate px-4"
              style={{
                fontFamily: "'SF Pro Display', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                letterSpacing: '-0.03em',
                textShadow: '0 4px 24px rgba(0,0,0,0.65)',
              }}
            >
              {artist?.name || (isLoading ? 'Loading...' : 'Artist Profile')}
            </h1>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-medium text-[#D1D1D6]">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white/10 border border-white/15 text-white/90">
              <Sparkles size={12} className="text-yellow-400" />
              Verified Artist
            </span>
            {artistStats.map((stat, idx) => (
              <React.Fragment key={stat}>
                {idx > 0 && <span aria-hidden="true">•</span>}
                <span>{stat}</span>
              </React.Fragment>
            ))}
          </div>

          {/* iOS Apple Music action row */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              onClick={handlePlayTopSongs}
              disabled={topSongs.length === 0}
              style={appleArt?.keyColor ? { background: appleArt.keyColor } : undefined}
              className="spring-press flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#FA2D48] hover:brightness-110 disabled:opacity-50 text-white font-bold text-xs cursor-pointer shadow-lg shadow-[#FA2D48]/25 transition-all"
            >
              <PlayerPlayIcon size={15} />
              <span>Play Top Songs</span>
            </button>
            <button
              onClick={handleShuffleTopSongs}
              disabled={topSongs.length === 0}
              title="Shuffle"
              className="spring-press flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold bg-white/15 hover:bg-white/25 backdrop-blur text-white border border-white/15 cursor-pointer transition-all disabled:opacity-50"
            >
              <Shuffle size={14} />
              <span>Shuffle</span>
            </button>
            <button
              onClick={() => setIsFollowed(!isFollowed)}
              className={`spring-press flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold backdrop-blur transition-all cursor-pointer border ${
                isFollowed ? 'bg-white/30 text-white border-white/30' : 'bg-white/15 hover:bg-white/25 text-white border-white/15'
              }`}
            >
              {isFollowed ? <Check size={14} /> : <Star size={14} />}
              <span>{isFollowed ? 'Following' : 'Follow'}</span>
            </button>
            <button
              onClick={handlePlayTopSongs}
              title="Artist Radio"
              className="spring-press flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold bg-white/15 hover:bg-white/25 backdrop-blur text-white border border-white/15 transition-all cursor-pointer"
            >
              <Radio size={14} />
              <span>Artist Radio</span>
            </button>
          </div>
        </div>
      </div>

      {/* Latest Release spotlight */}
      {latestRelease && (
        <section className="space-y-2" data-testid="latest-release">
          <h2 className="text-xl font-bold tracking-tight text-white">Latest Release</h2>
          <div
            onClick={() => navigateToRelease(latestRelease.id, 'album')}
            className="acrylic-tile flex items-center gap-4 p-3 rounded-2xl cursor-pointer hover:border-white/20 transition-all"
          >
            <img
              src={latestRelease.thumbnailUrl || 'https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg'}
              alt={latestRelease.title}
              className="w-20 h-20 rounded-lg object-cover shadow-md"
            />
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#FA2D48]">Featured Release</div>
              <div className="text-sm font-bold text-white truncate">{latestRelease.title}</div>
              <div className="text-[11px] text-[#8E8E93] truncate">{latestRelease.year || ''} {latestRelease.subtitle || ''}</div>
            </div>
          </div>
        </section>
      )}
      {/* 2. Top Songs Section with DesktopTrackTable & tracklist-row Virtualization */}
      <section className="space-y-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight text-white">Top Songs</h2>
          <div className="flex items-center gap-1 p-1 rounded-full bg-white/[0.06] border border-white/[0.08]">
            <button onClick={() => setTopSongsMode('grid')} className={`px-3 py-1 rounded-full text-xs font-semibold cursor-pointer ${topSongsMode === 'grid' ? 'bg-white/20 text-white' : 'text-[#8E8E93]'}`}>iOS Grid</button>
            <button onClick={() => setTopSongsMode('table')} className={`px-3 py-1 rounded-full text-xs font-semibold cursor-pointer ${topSongsMode === 'table' ? 'bg-white/20 text-white' : 'text-[#8E8E93]'}`}>Table</button>
          </div>
          {topSongs.length > 5 && (
            <button
              onClick={() => setShowAllTopSongs(!showAllTopSongs)}
              className="text-xs font-bold text-[#FA2D48] hover:underline cursor-pointer"
            >
              {showAllTopSongs ? 'Show top 5' : `Show all ${topSongs.length} tracks`}
            </button>
          )}
        </div>

        {topSongsMode === 'grid' && displayedTopSongs.length > 0 ? (
          <div data-testid="ios-top-songs-grid" className="tracklist-row grid grid-rows-4 grid-flow-col auto-cols-[minmax(260px,1fr)] gap-x-4 gap-y-1 overflow-x-auto pb-2">
            {displayedTopSongs.map((s) => (
              <div
                key={s.videoId}
                onClick={() => { setContextQueue(topSongs, topSongs.indexOf(s), { id: artistId, browseId: artistId, title: `${artist?.name || 'Artist'} - Top Songs`, type: 'artist', currentIndex: topSongs.indexOf(s) }); loadTrack(s, 'active', true); }}
                onContextMenu={(e) => onOpenContextMenu?.(e, s)}
                className="group flex items-center gap-3 p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
              >
                <img src={s.thumbnailUrl || s.artworkUrl || 'https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg'} alt={s.title} className="w-11 h-11 rounded object-cover" />
                <div className="min-w-0 flex-1">
                  <div className={`text-xs font-semibold truncate ${currentTrackId === s.videoId ? 'text-[#FA2D48]' : 'text-white'}`}>{s.title}</div>
                  <div className="text-[11px] text-[#8E8E93] truncate">
                    <ArtistCredits artist={s.artist} artists={s.artists} artistIds={s.artistIds} onNavigate={navigateToArtist} />
                  </div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); onOpenContextMenu?.(e, s); }} className="opacity-0 group-hover:opacity-100 text-[#8E8E93] hover:text-white cursor-pointer" title="More"><MoreHorizontal size={16} /></button>
              </div>
            ))}
          </div>
        ) : (
        <div className="acrylic-tile rounded-3xl p-4 overflow-hidden tracklist-row">
          <DesktopTrackTable
            songs={displayedTopSongs}
            showCover={true}
            showArtist={false}
            showAlbum={true}
            showTrackNumber={true}
            density="standard"
            releaseContext={{
              id: artistId,
              browseId: artistId,
              title: `${artist?.name || 'Artist'} - Top Songs`,
              type: 'artist',
            }}
            onOpenContextMenu={onOpenContextMenu}
            emptyMessage="No top songs found for this artist"
          />
        </div>
        )}
      </section>

      {/* 3. Discography Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight text-white">Discography</h2>

          {/* Discography Filter Pills */}
          <div className="flex items-center gap-1 p-1 rounded-full bg-white/[0.06] border border-white/[0.08]">
            <button
              onClick={() => setDiscographyTab('all')}
              className={`spring-press px-3.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                discographyTab === 'all'
                  ? 'bg-white/20 text-white shadow-sm'
                  : 'text-[#8E8E93] hover:text-white'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setDiscographyTab('albums')}
              className={`spring-press px-3.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                discographyTab === 'albums'
                  ? 'bg-white/20 text-white shadow-sm'
                  : 'text-[#8E8E93] hover:text-white'
              }`}
            >
              Albums
            </button>
            <button
              onClick={() => setDiscographyTab('singles')}
              className={`spring-press px-3.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                discographyTab === 'singles'
                  ? 'bg-white/20 text-white shadow-sm'
                  : 'text-[#8E8E93] hover:text-white'
              }`}
            >
              Singles & EPs
            </button>
          </div>
        </div>

        {displayedReleases.length === 0 ? (
          /* Empty Discography Message Conforming to B20-T03 */
          <div className="acrylic-tile rounded-2xl py-12 text-center text-xs text-[#8E8E93]">
            No releases available for this artist.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {displayedReleases.map((rel) => (
              <div
                key={rel.id}
                onClick={() => navigateToRelease(rel.id, 'album')}
                className="acrylic-tile group p-3.5 rounded-lg transition-all cursor-pointer hover:border-white/20"
              >
                <div className="artwork-lockup relative aspect-square rounded-lg overflow-hidden mb-3 bg-neutral-900 shadow-md">
                  <img
                    src={
                      rel.thumbnailUrl ||
                      'https://i.ytimg.com/vi/5dNP-a-XXx0/hqdefault.jpg'
                    }
                    alt={rel.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <button
                    title="More"
                    onClick={(e) => { e.stopPropagation(); onOpenContextMenu?.(e, { videoId: rel.id, title: rel.title, artist: artist?.name || rel.subtitle || '', albumId: rel.id, albumName: rel.title, thumbnailUrl: rel.thumbnailUrl } as unknown as Song); }}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/55 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    <MoreHorizontal size={14} />
                  </button>
                  {/* Hover Quick-Play Overlay */}
                  <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="w-8 h-8 rounded-full bg-[#FA2D48] text-white flex items-center justify-center shadow-lg hover:scale-105 transition-transform">
                      <PlayerPlayIcon size={14} className="ml-0.5" />
                    </div>
                  </div>
                </div>
                <div className="text-xs font-bold truncate text-white group-hover:text-[#FA2D48] transition-colors">
                  {rel.title}
                </div>
                <div className="text-[11px] text-[#8E8E93] truncate mt-0.5">
                  {rel.year || '2026'} • Album
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. About Artist */}
      <section className="space-y-3">
        <h2 className="text-xl font-bold tracking-tight text-white">About {artist?.name}</h2>
        <div className="acrylic-tile p-6 rounded-3xl space-y-3">
          <div className="flex flex-wrap gap-2">
            {artistStats.map((stat) => (
              <StatChip key={stat} label={stat} />
            ))}
            {topSongs.length > 0 && <StatChip label={`${topSongs.length} top songs`} />}
          </div>
          {rawBio && (
            <>
              <p className="text-xs text-[#A1A1A6] leading-relaxed whitespace-pre-line">{displayBio}</p>
              {isBioLong && (
                <button
                  onClick={() => setIsBioExpanded(!isBioExpanded)}
                  className="flex items-center gap-1 text-xs font-bold text-[#FA2D48] hover:underline pt-1 cursor-pointer"
                >
                  <span>{isBioExpanded ? 'Show less' : 'Read more'}</span>
                  {isBioExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
});

ArtistDetailView.displayName = 'ArtistDetailView';
