// src/ui/layout/LeftSidebar.tsx
// Zone 2: Collapsible macOS Apple Music Translucent Vibrancy Sidebar
// Supports compact icon rail (64px) with smooth hover-to-expand, collapsible Library/Playlists accordions,
// and unified top-left Search input with Liquid Glass autocomplete popover.

import React, { useState, useRef, useEffect } from 'react';
import {
  Home,
  Compass,
  Radio,
  Clock,
  Users2,
  Disc3,
  Music2,
  HardDrive,
  Heart,
  ListMusic,
  Plus,
  Sliders,
  Settings,
  Search,
  X,
  Sparkles,
  Play,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
} from 'lucide-react';
import { useLibraryStore } from '../../state/libraryStore';
import { useNavigationStore, PrimaryTab } from '../../state/navigationStore';
import { usePlayerStore } from '../../state/playerStore';
import { MusicService } from '../../services/MusicService';
import { WaveFormLogoIcon } from '../common/WaveFormIcons';
// Inline vector WaveFormLogoIcon replaces LogoTransparent.svg img to eliminate broken image flash

function isValidImageUrl(url: unknown): url is string {
  return Boolean(
    url &&
      typeof url === 'string' &&
      url.trim() &&
      url !== 'undefined' &&
      url !== 'null'
  );
}

export type NavTab = PrimaryTab | 'settings';

const SIDEBAR_COLLAPSED_KEY = 'waveform_sidebar_collapsed';

interface LeftSidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab, subView?: string) => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({ currentTab, onSelectTab }) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [isHoverExpanded, setIsHoverExpanded] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(true);
  const [isPlaylistsOpen, setIsPlaylistsOpen] = useState(true);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const [brokenThumbs, setBrokenThumbs] = useState<Record<string, boolean>>({});

  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  const playlists = useLibraryStore((s) => s.playlists);
  const isNowPlayingModalOpen = usePlayerStore((s) => s.isNowPlayingModalOpen);
  const {
    current,
    navigateToTab,
    navigateToRelease,
    setCreatePlaylistOpen,
    setReplayOpen,
    searchQuery,
    setSearchQuery,
    searchFocusCounter,
    requestSearchFocus,
  } = useNavigationStore();

  useEffect(() => {
    return () => {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
      if (suggestionTimerRef.current) clearTimeout(suggestionTimerRef.current);
    };
  }, []);

  // Close autocomplete popover on outside click
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleDocMouseDown = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsSuggestionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleDocMouseDown);
    return () => document.removeEventListener('mousedown', handleDocMouseDown);
  }, []);

  // Focus top-left search input when Ctrl+K or collapsed search icon triggers requestSearchFocus()
  useEffect(() => {
    if (searchFocusCounter > 0) {
      if (isCollapsed) {
        setIsHoverExpanded(true);
      }
      setIsSearchFocused(true);
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select?.();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [searchFocusCounter, isCollapsed]);

  useEffect(() => {
    if (isNowPlayingModalOpen) {
      setIsHoverExpanded(false);
      setIsSuggestionsOpen(false);
    }
  }, [isNowPlayingModalOpen]);

  const isExpanded = !isCollapsed || (!isNowPlayingModalOpen && (isHoverExpanded || isSearchFocused));

  const handleMouseEnter = () => {
    if (isNowPlayingModalOpen) return;
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    if (isCollapsed) {
      setIsHoverExpanded(true);
    }
  };

  const handleMouseLeave = () => {
    if (isCollapsed) {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = setTimeout(() => {
        setIsHoverExpanded(false);
        leaveTimerRef.current = null;
      }, 120);
    }
  };

  const toggleCollapse = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // Ignore storage errors
      }
      setIsHoverExpanded(false);
      if (next) {
        setIsSearchFocused(false);
        setIsSuggestionsOpen(false);
      }
      return next;
    });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSuggestionsOpen(false);
    if (searchQuery.trim()) {
      navigateToTab('search');
    }
  };

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (suggestionTimerRef.current) {
      clearTimeout(suggestionTimerRef.current);
      suggestionTimerRef.current = null;
    }

    const trimmed = val.trim();
    if (!trimmed) {
      setSuggestions([]);
      setIsSuggestionsOpen(false);
      return;
    }

    if (current.type !== 'tab' || current.tab !== 'search') {
      navigateToTab('search');
    }

    suggestionTimerRef.current = setTimeout(async () => {
      try {
        const sugRes = await new MusicService().getSearchSuggestions(trimmed);
        setSuggestions(sugRes);
        setIsSuggestionsOpen(sugRes.length > 0);
      } catch {
        setSuggestions([]);
        setIsSuggestionsOpen(false);
      }
    }, 200);
  };

  const handleSelectSuggestion = (sug: string) => {
    setSearchQuery(sug);
    setIsSuggestionsOpen(false);
    if (current.type !== 'tab' || current.tab !== 'search') {
      navigateToTab('search');
    }
  };

  const activeLibrarySubView =
    current.type === 'tab' && current.tab === 'library'
      ? current.subView || 'Recently Added'
      : null;

  const isHomeActive = current.type === 'tab' && current.tab === 'home';
  const isExploreActive = current.type === 'tab' && current.tab === 'explore';
  const isRadioActive = activeLibrarySubView === 'Radio';
  const isRecentlyAddedActive = activeLibrarySubView === 'Recently Added';
  const isArtistsActive = activeLibrarySubView === 'Artists';
  const isAlbumsActive = activeLibrarySubView === 'CoverFlow' || activeLibrarySubView === 'Albums';
  const isSongsActive = activeLibrarySubView === 'Songs';
  const isLocalMediaActive = activeLibrarySubView === 'Local Media';
  const isFavoritesActive = activeLibrarySubView === 'Favorites';
  const isEqualizerActive = currentTab === 'equalizer';

  const isAnyLibraryActive =
    isRecentlyAddedActive ||
    isArtistsActive ||
    isAlbumsActive ||
    isSongsActive ||
    isLocalMediaActive;

  const isAnyPlaylistActive =
    isFavoritesActive ||
    activeLibrarySubView === 'Playlists' ||
    (current.type === 'release' && current.releaseType === 'playlist');

  const navItemClass = (active: boolean, textSize: 'text-[13px]' | 'text-xs' = 'text-xs') =>
    `relative group w-full flex items-center ${
      isExpanded ? 'gap-2.5 px-2.5' : 'justify-center px-0'
    } py-1.5 rounded-lg ${textSize} font-medium transition-all cursor-pointer ${
      active
        ? 'dark:bg-white/12 bg-black/[0.07] border dark:border-white/20 border-black/10 dark:text-white text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]'
        : 'text-[var(--color-on-surface-variant)] dark:hover:text-white hover:text-black dark:hover:bg-white/[0.06] hover:bg-black/[0.04]'
    }`;

  return (
    <aside
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      data-collapsed={isCollapsed ? 'true' : 'false'}
      data-expanded={isExpanded ? 'true' : 'false'}
      className={`${
        isExpanded ? 'w-60 w-[256px]' : 'w-[64px]'
      } shrink-0 h-full flex flex-col overflow-hidden liquid-glass-sidebar border-r border-[rgba(255,255,255,0.07)] text-[var(--color-primary)] select-none z-20 transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width]`}
    >
      {/* 1. Sole Top-Left Search Input + Autocomplete Popover & Collapse/Pin Toggle */}
      <div
        ref={searchContainerRef}
        className={`relative shrink-0 p-3 pb-2 flex items-center ${isExpanded ? 'gap-1.5' : 'justify-center'}`}
      >
        {isExpanded ? (
          <>
            <form onSubmit={handleSearchSubmit} className="relative flex-1 min-w-0">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-on-surface-variant)]"
              />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search"
                aria-label="Search"
                value={searchQuery}
                onFocus={() => {
                  setIsSearchFocused(true);
                  if (suggestions.length > 0 && searchQuery.trim()) {
                    setIsSuggestionsOpen(true);
                  }
                }}
                onBlur={() => {
                  setIsSearchFocused(false);
                }}
                onChange={(e) => handleSearchChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setIsSuggestionsOpen(false);
                    searchInputRef.current?.blur();
                  }
                }}
                className="w-full h-8 pl-8 pr-12 rounded-lg dark:bg-white/[0.06] bg-black/[0.04] dark:hover:bg-white/[0.09] hover:bg-black/[0.07] dark:focus:bg-white/[0.12] focus:bg-black/[0.09] border dark:border-white/10 border-black/10 dark:focus:border-white/25 focus:border-black/20 text-xs text-[var(--color-primary)] placeholder-[var(--color-on-surface-variant)] outline-none transition-all"
              />
              {searchQuery ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => handleSearchChange('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-on-surface-variant)] dark:hover:text-white hover:text-black cursor-pointer"
                >
                  <X size={12} />
                </button>
              ) : (
                <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-mono dark:bg-black/30 bg-black/[0.08] rounded text-[var(--color-on-surface-variant)] border dark:border-white/10 border-black/10">
                  Ctrl+K
                </kbd>
              )}

              {/* Liquid Glass Autocomplete Dropdown Popover */}
              {isSuggestionsOpen && suggestions.length > 0 && (
                <div className="liquid-glass absolute left-0 right-0 top-full mt-1.5 rounded-xl p-1.5 z-50 shadow-2xl border border-white/20 space-y-0.5">
                  {suggestions.map((sug, idx) => (
                    <button
                      key={`${sug}-${idx}`}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectSuggestion(sug);
                      }}
                      onClick={() => handleSelectSuggestion(sug)}
                      className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-left dark:hover:bg-white/10 hover:bg-black/[0.06] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
                    >
                      <Search size={12} className="text-[var(--color-on-surface-variant)] shrink-0" />
                      <span className="font-medium text-[var(--color-primary)] truncate">{sug}</span>
                    </button>
                  ))}
                </div>
              )}
            </form>

            {/* Show Collapse/Pin toggle button ONLY when expanded */}
            <button
              type="button"
              onClick={toggleCollapse}
              title={isCollapsed ? 'Pin Sidebar Open' : 'Collapse Sidebar'}
              aria-label={isCollapsed ? 'Pin Sidebar Open' : 'Collapse Sidebar'}
              className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg dark:bg-white/[0.05] bg-black/[0.04] dark:hover:bg-white/10 hover:bg-black/[0.08] border dark:border-white/10 border-black/10 text-[var(--color-on-surface-variant)] dark:hover:text-white hover:text-black transition-colors cursor-pointer"
            >
              {isCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => requestSearchFocus()}
            title="Search (Ctrl+K)"
            aria-label="Search"
            className="w-9 h-8 flex items-center justify-center rounded-lg dark:bg-white/[0.06] bg-black/[0.04] dark:hover:bg-white/10 hover:bg-black/[0.08] border dark:border-white/10 border-black/10 text-[var(--color-on-surface-variant)] dark:hover:text-white hover:text-black transition-colors cursor-pointer"
          >
            <Search size={15} />
          </button>
        )}
      </div>

      {/* Scrollable middle nav + library + playlists region */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {/* 2. WaveForm Music Section */}
        <div className="px-3 py-1.5 space-y-0.5">
          <div className={`flex items-center ${isExpanded ? 'gap-2 px-2.5' : 'justify-center px-0'} py-1 mb-0.5`}>
            <WaveFormLogoIcon
              size={18}
              className="w-4.5 h-3.5 text-[var(--color-accent)] shrink-0"
            />
            {isExpanded && (
              <span className="text-[13px] font-bold tracking-tight dark:text-white/95 text-black/90 whitespace-nowrap">
                Music
              </span>
            )}
          </div>

          {/* Home */}
          <button
            onClick={() => onSelectTab('home')}
            title="Home"
            className={navItemClass(isHomeActive, 'text-[13px]')}
          >
            {isHomeActive && (
              <span className="absolute left-1.5 w-[2.5px] h-4 rounded-full bg-[#FA2D48]" />
            )}
            <Home size={17} className={`shrink-0 ${isHomeActive ? `dark:text-white text-black ${isExpanded ? 'ml-1.5' : ''}` : 'dark:group-hover:text-white group-hover:text-black'}`} />
            {isExpanded && (
              <span className={`whitespace-nowrap ${isHomeActive ? 'font-semibold dark:text-white text-black' : ''}`}>Home</span>
            )}
          </button>

          {/* Browse / Explore */}
          <button
            onClick={() => onSelectTab('explore')}
            title="Explore"
            className={navItemClass(isExploreActive, 'text-[13px]')}
          >
            {isExploreActive && (
              <span className="absolute left-1.5 w-[2.5px] h-4 rounded-full bg-[#FA2D48]" />
            )}
            <Compass size={17} className={`shrink-0 ${isExploreActive ? `dark:text-white text-black ${isExpanded ? 'ml-1.5' : ''}` : 'dark:group-hover:text-white group-hover:text-black'}`} />
            {isExpanded && (
              <span className={`whitespace-nowrap ${isExploreActive ? 'font-semibold dark:text-white text-black' : ''}`}>Explore</span>
            )}
          </button>

          {/* Radio & Listen Together */}
          <button
            onClick={() => onSelectTab('library', 'Radio')}
            title="Radio & Party"
            className={navItemClass(isRadioActive, 'text-[13px]')}
          >
            {isRadioActive && (
              <span className="absolute left-1.5 w-[2.5px] h-4 rounded-full bg-[#FA2D48]" />
            )}
            <Radio size={17} className={`shrink-0 ${isRadioActive ? `dark:text-white text-black ${isExpanded ? 'ml-1.5' : ''}` : 'dark:group-hover:text-white group-hover:text-black'}`} />
            {isExpanded && (
              <span className={`whitespace-nowrap ${isRadioActive ? 'font-semibold dark:text-white text-black' : ''}`}>Radio & Party</span>
            )}
          </button>
        </div>

        {/* 3. Library Section (Collapsible Accordion when expanded; single Library icon when collapsed) */}
        <div className="px-3 py-1.5 space-y-0.5 border-t border-[var(--glass-border-subtle)]">
          {isExpanded ? (
            <>
              <button
                type="button"
                onClick={() => setIsLibraryOpen((prev) => !prev)}
                aria-expanded={isLibraryOpen}
                className="w-full flex items-center justify-between px-2.5 py-1 rounded-md text-[var(--color-on-surface-variant)] dark:hover:text-white hover:text-black transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
                  <ChevronDown
                    size={12}
                    className={`transition-transform duration-200 ${isLibraryOpen ? 'rotate-0' : '-rotate-90'}`}
                  />
                  <span>Library</span>
                </span>
              </button>

              <div
                className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  isLibraryOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                }`}
              >
                <div className="overflow-hidden space-y-0.5">
                  <button
                    onClick={() => onSelectTab('library', 'Recently Added')}
                    title="Recently Added"
                    className={navItemClass(isRecentlyAddedActive)}
                  >
                    {isRecentlyAddedActive && (
                      <span className="absolute left-1.5 w-[2.5px] h-4 rounded-full bg-[#FA2D48]" />
                    )}
                    <Clock size={16} className={`shrink-0 ${isRecentlyAddedActive ? 'ml-1.5' : ''}`} />
                    <span className={`whitespace-nowrap ${isRecentlyAddedActive ? 'font-semibold dark:text-white text-black' : ''}`}>
                      Recently Added
                    </span>
                  </button>

                  <button
                    onClick={() => onSelectTab('library', 'Artists')}
                    title="Artists"
                    className={navItemClass(isArtistsActive)}
                  >
                    {isArtistsActive && (
                      <span className="absolute left-1.5 w-[2.5px] h-4 rounded-full bg-[#FA2D48]" />
                    )}
                    <Users2 size={16} className={`shrink-0 ${isArtistsActive ? 'ml-1.5' : ''}`} />
                    <span className={`whitespace-nowrap ${isArtistsActive ? 'font-semibold dark:text-white text-black' : ''}`}>
                      Artists
                    </span>
                  </button>

                  <button
                    onClick={() => onSelectTab('library', 'CoverFlow')}
                    title="Albums (3D Flow)"
                    className={navItemClass(isAlbumsActive)}
                  >
                    {isAlbumsActive && (
                      <span className="absolute left-1.5 w-[2.5px] h-4 rounded-full bg-[#FA2D48]" />
                    )}
                    <Disc3 size={16} className={`shrink-0 ${isAlbumsActive ? 'ml-1.5' : ''}`} />
                    <span className={`whitespace-nowrap ${isAlbumsActive ? 'font-semibold dark:text-white text-black' : ''}`}>
                      Albums (3D Flow)
                    </span>
                  </button>

                  <button
                    onClick={() => onSelectTab('library', 'Songs')}
                    title="Songs"
                    className={navItemClass(isSongsActive)}
                  >
                    {isSongsActive && (
                      <span className="absolute left-1.5 w-[2.5px] h-4 rounded-full bg-[#FA2D48]" />
                    )}
                    <Music2 size={16} className={`shrink-0 ${isSongsActive ? 'ml-1.5' : ''}`} />
                    <span className={`whitespace-nowrap ${isSongsActive ? 'font-semibold dark:text-white text-black' : ''}`}>
                      Songs
                    </span>
                  </button>

                  <button
                    onClick={() => onSelectTab('library', 'Local Media')}
                    title="Local Media"
                    className={navItemClass(isLocalMediaActive)}
                  >
                    {isLocalMediaActive && (
                      <span className="absolute left-1.5 w-[2.5px] h-4 rounded-full bg-[#FA2D48]" />
                    )}
                    <HardDrive size={16} className={`shrink-0 ${isLocalMediaActive ? 'ml-1.5' : ''}`} />
                    <span className={`whitespace-nowrap ${isLocalMediaActive ? 'font-semibold dark:text-white text-black' : ''}`}>
                      Local Media
                    </span>
                  </button>

                  <button
                    onClick={() => setReplayOpen(true)}
                    title="2026 Replay"
                    className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#FA2D48] dark:hover:text-white hover:text-black dark:hover:bg-white/[0.06] hover:bg-black/[0.04] transition-all cursor-pointer"
                  >
                    <Sparkles size={16} className="shrink-0 text-[#FA2D48]" />
                    <span className="whitespace-nowrap">2026 Replay</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* Clean collapsed rail: Library + 2026 Replay icons */
            <div className="space-y-0.5">
              <button
                onClick={() => {
                  setIsLibraryOpen(true);
                  onSelectTab('library', 'Recently Added');
                }}
                title="Library"
                aria-label="Library"
                className={navItemClass(isAnyLibraryActive)}
              >
                {isAnyLibraryActive && (
                  <span className="absolute left-1.5 w-[2.5px] h-4 rounded-full bg-[#FA2D48]" />
                )}
                <Clock size={16} className="shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => setReplayOpen(true)}
                title="2026 Replay"
                aria-label="2026 Replay"
                className="relative group w-full flex items-center justify-center px-0 py-1.5 rounded-lg text-xs font-semibold text-[#FA2D48] dark:hover:text-white hover:text-black dark:hover:bg-white/[0.06] hover:bg-black/[0.04] transition-all cursor-pointer"
              >
                <Sparkles size={16} className="shrink-0 text-[#FA2D48]" />
              </button>
            </div>
          )}
        </div>

        {/* 4. Playlists Section (Collapsible Accordion when expanded; single Playlists icon when collapsed) */}
        <div className="px-3 py-1.5 space-y-0.5 border-t border-[var(--glass-border-subtle)]">
          {isExpanded ? (
            <>
              <div className="flex items-center justify-between px-2.5 py-1">
                <button
                  type="button"
                  onClick={() => setIsPlaylistsOpen((prev) => !prev)}
                  aria-expanded={isPlaylistsOpen}
                  className="flex items-center gap-1.5 text-[10px] font-bold text-[var(--color-on-surface-variant)] dark:hover:text-white hover:text-black uppercase tracking-wider transition-colors cursor-pointer"
                >
                  <ChevronDown
                    size={12}
                    className={`transition-transform duration-200 ${isPlaylistsOpen ? 'rotate-0' : '-rotate-90'}`}
                  />
                  <span>Playlists</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCreatePlaylistOpen(true)}
                  title="New Playlist"
                  className="p-0.5 rounded dark:hover:bg-white/10 hover:bg-black/[0.06] text-[var(--color-on-surface-variant)] dark:hover:text-white hover:text-black transition-colors cursor-pointer"
                >
                  <Plus size={13} />
                </button>
              </div>

              <div
                className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  isPlaylistsOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                }`}
              >
                <div className="overflow-hidden space-y-0.5">
                  {/* Favorites Link */}
                  <button
                    onClick={() => onSelectTab('library', 'Favorites')}
                    title="Favorites"
                    className={navItemClass(isFavoritesActive)}
                  >
                    {isFavoritesActive && (
                      <span className="absolute left-1.5 w-[2.5px] h-4 rounded-full bg-[#FA2D48]" />
                    )}
                    <Heart size={14} className={`text-[#FA2D48] fill-current shrink-0 ${isFavoritesActive ? 'ml-1.5' : ''}`} />
                    <span className={`truncate ${isFavoritesActive ? 'font-semibold dark:text-white text-black' : ''}`}>
                      Favorites
                    </span>
                  </button>

                  {/* User Playlists */}
                  {playlists.map((pl) => {
                    const trackCount = (pl as any).trackCount ?? pl.songCount ?? pl.songIds?.length;
                    const isSelected = current.type === 'release' && current.id === pl.id;
                    return (
                      <button
                        key={pl.id}
                        onClick={() => navigateToRelease(pl.id, 'playlist')}
                        title={pl.title}
                        className={`relative group w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all truncate cursor-pointer ${
                          isSelected
                            ? 'dark:bg-white/12 bg-black/[0.07] border dark:border-white/20 border-black/10 text-[var(--color-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]'
                            : 'text-[var(--color-on-surface-variant)] dark:hover:text-white hover:text-black dark:hover:bg-white/[0.06] hover:bg-black/[0.04]'
                        }`}
                      >
                        {isSelected && (
                          <span className="absolute left-1.5 w-[2.5px] h-4 rounded-full bg-[#FA2D48]" />
                        )}
                        <div className={`flex items-center gap-2 min-w-0 ${isSelected ? 'ml-1.5' : ''}`}>
                          <div className="relative w-[22px] h-[22px] rounded-[2px] overflow-hidden bg-white/10 shrink-0 flex items-center justify-center">
                            {isValidImageUrl(pl.thumbnailUrl) && !brokenThumbs[pl.id] ? (
                              <img
                                src={pl.thumbnailUrl}
                                alt={pl.title}
                                onError={() =>
                                  setBrokenThumbs((prev) => ({ ...prev, [pl.id]: true }))
                                }
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <ListMusic size={12} className="dark:text-white/60 text-black/50" />
                            )}
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                navigateToRelease(pl.id, 'playlist');
                              }}
                              className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                              title={`Play ${pl.title}`}
                            >
                              <div className="w-4 h-4 rounded-full bg-[#FA2D48] flex items-center justify-center">
                                <Play size={8} className="text-white fill-white ml-0.5" />
                              </div>
                            </div>
                          </div>
                          <span className={`truncate ${isSelected ? 'font-semibold text-[var(--color-primary)]' : ''}`}>
                            {pl.title}
                          </span>
                        </div>
                        {trackCount !== undefined && (
                          <span className="text-[10px] font-mono text-[var(--color-on-surface-variant)] opacity-60 shrink-0">
                            {trackCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            /* Clean collapsed rail: single Playlists icon */
            <button
              onClick={() => {
                setIsPlaylistsOpen(true);
                onSelectTab('library', 'Playlists');
              }}
              title="Playlists"
              aria-label="Playlists"
              className={navItemClass(isAnyPlaylistActive)}
            >
              {isAnyPlaylistActive && (
                <span className="absolute left-1.5 w-[2.5px] h-4 rounded-full bg-[#FA2D48]" />
              )}
              <ListMusic size={16} className="shrink-0" />
            </button>
          )}
        </div>
      </div>

      {/* 5. Footer Workstation Utilities */}
      <div className="shrink-0 px-3 pt-2.5 pb-[100px] border-t border-[var(--glass-border-subtle)] space-y-1 dark:bg-black/15 bg-black/[0.03]">
        <button
          onClick={() => onSelectTab('equalizer')}
          title="Equalizer & DSP"
          className={`w-full flex items-center ${isExpanded ? 'gap-2.5 px-2.5' : 'justify-center px-0'} py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            isEqualizerActive
              ? 'dark:bg-white/12 bg-black/[0.07] border dark:border-white/20 border-black/10 text-[var(--color-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]'
              : 'text-[var(--color-on-surface-variant)] dark:hover:text-white hover:text-black dark:hover:bg-white/[0.06] hover:bg-black/[0.04]'
          }`}
        >
          <Sliders size={15} className="shrink-0" />
          {isExpanded && <span className="whitespace-nowrap">Equalizer & DSP</span>}
        </button>

        <button
          onClick={() => onSelectTab('settings')}
          title="Settings"
          className={`w-full flex items-center ${isExpanded ? 'gap-2.5 px-2.5' : 'justify-center px-0'} py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            currentTab === 'settings'
              ? 'dark:bg-white/12 bg-black/[0.07] border dark:border-white/20 border-black/10 text-[var(--color-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]'
              : 'text-[var(--color-on-surface-variant)] dark:hover:text-white hover:text-black dark:hover:bg-white/[0.06] hover:bg-black/[0.04]'
          }`}
        >
          <Settings size={15} className="shrink-0" />
          {isExpanded && <span className="whitespace-nowrap">Settings</span>}
        </button>
      </div>
    </aside>
  );
};
