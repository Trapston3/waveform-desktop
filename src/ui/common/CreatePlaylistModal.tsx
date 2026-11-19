// src/ui/common/CreatePlaylistModal.tsx
// Dialog for creating custom playlists with 100-character title clamping (B18-T04)

import React, { useState } from 'react';
import { X, ListPlus } from 'lucide-react';
import { useLibraryStore } from '../../state/libraryStore';

export interface CreatePlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (playlistId: string) => void;
}

export const CreatePlaylistModal: React.FC<CreatePlaylistModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { createPlaylist } = useLibraryStore();

  if (!isOpen) return null;

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // 100-character clamp per B18-T04
    const clamped = e.target.value.slice(0, 100);
    setTitle(clamped);
    if (error) setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sanitizedTitle = title.trim();
    if (!sanitizedTitle) {
      setError('Playlist title is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createPlaylist(sanitizedTitle, description.trim());
      setTitle('');
      setDescription('');
      onClose();
      if (onCreated) {
        onCreated(created.id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create playlist');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-150">
      <div
        onClick={(e) => e.stopPropagation()}
        className="liquid-glass-capsule w-full max-w-md rounded-3xl p-6 text-[var(--color-primary)] space-y-5 animate-in zoom-in-95 duration-150"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
              <ListPlus size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold">New Playlist</h2>
              <p className="text-xs text-[var(--color-on-surface-variant)]">
                Create a custom playlist in your library
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="liquid-glass-pill p-1.5 rounded-full text-[var(--color-on-surface-variant)] hover:text-[var(--color-primary)] transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-[var(--color-on-surface-variant)]">
                Playlist Name
              </label>
              <span className="text-[10px] text-[var(--color-on-surface-variant)]">
                {title.length}/100
              </span>
            </div>
            <input
              type="text"
              value={title}
              onChange={handleTitleChange}
              placeholder="e.g. Late Night Synthwave"
              maxLength={100}
              autoFocus
              className="liquid-glass w-full px-3.5 py-2.5 rounded-xl text-sm text-[var(--color-primary)] placeholder-[var(--color-on-surface-variant)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
            />
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--color-on-surface-variant)] mb-1.5">
              Description (Optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Give your playlist a description..."
              rows={3}
              className="liquid-glass w-full px-3.5 py-2.5 rounded-xl text-sm text-[var(--color-primary)] placeholder-[var(--color-on-surface-variant)] focus:outline-none focus:border-[var(--color-accent)] transition-colors resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="spring-press liquid-glass-pill px-4 py-2 rounded-full text-xs font-medium transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              className="spring-press liquid-glass-pill-active px-5 py-2 rounded-full text-xs font-semibold disabled:opacity-50 text-white transition-all cursor-pointer"
            >
              {isSubmitting ? 'Creating...' : 'Create Playlist'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
