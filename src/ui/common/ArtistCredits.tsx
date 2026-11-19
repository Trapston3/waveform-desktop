// Clickable singer / producer credits (each credit navigates to its artist page)
import React from 'react';
import { parseArtistCredits } from '../../utils/artistCredits';

export interface ArtistCreditsProps {
  artist?: string | null;
  artists?: { id: string | null; name: string }[];
  artistIds?: string[];
  fallback?: string;
  onNavigate: (targetId: string) => void;
  className?: string;
}

export const ArtistCredits: React.FC<ArtistCreditsProps> = ({
  artist, artists, artistIds, fallback, onNavigate, className,
}) => {
  const credits = parseArtistCredits(artist, artists, artistIds);
  if (credits.length === 0) return <span className={className}>{fallback ?? ''}</span>;
  return (
    <span className={className}>
      {credits.map((c, i) => (
        <React.Fragment key={i + c.name}>
          <span
            role="link"
            data-testid="artist-credit-link"
            onClick={(e) => { e.stopPropagation(); onNavigate(c.targetId); }}
            className="hover:text-[#FA2D48] hover:underline cursor-pointer transition-colors"
          >
            {c.name}
          </span>
          {c.separator}
        </React.Fragment>
      ))}
    </span>
  );
};
