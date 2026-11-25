import fs from 'node:fs';
import path from 'node:path';

export interface ReplayDiskEntry {
  sessionId?: string;
  videoId: string;
  title: string;
  artist: string;
  albumName?: string;
  artworkUrl?: string;
  qualityLabel?: string;
  timestamp: number;
  startedAt?: number;
  durationSec: number;
  listenedSeconds?: number;
  trackDurationSec?: number;
  countedPlay?: boolean;
}

const MAX_REPLAY_ENTRIES = 50_000;

export function getReplayEntryKey(entry: Partial<ReplayDiskEntry>): string {
  if (entry.sessionId && typeof entry.sessionId === 'string' && entry.sessionId.trim()) {
    return `sid:${entry.sessionId.trim()}`;
  }
  const vid = String(entry.videoId || '').trim();
  const ts = typeof entry.startedAt === 'number' && Number.isFinite(entry.startedAt)
    ? Math.round(entry.startedAt)
    : typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp)
    ? Math.round(entry.timestamp)
    : 0;
  return `vt:${vid}|${ts}`;
}

export function mergeReplayEntries(
  existing: ReplayDiskEntry[],
  incoming: ReplayDiskEntry[]
): ReplayDiskEntry[] {
  const byKey = new Map<string, ReplayDiskEntry>();
  const ingest = (raw: ReplayDiskEntry) => {
    if (!raw || typeof raw.videoId !== 'string' || !raw.videoId.trim()) return;
    const key = getReplayEntryKey(raw);
    const listened = Math.max(
      0,
      Math.round(
        Number.isFinite(raw.listenedSeconds as number)
          ? Number(raw.listenedSeconds)
          : Number.isFinite(raw.durationSec)
          ? Number(raw.durationSec)
          : 0
      )
    );
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        ...raw,
        timestamp: typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp) ? raw.timestamp : Date.now(),
        durationSec: listened,
        listenedSeconds: listened,
      });
      return;
    }
    const prevListened = Math.max(0, Math.round(prev.listenedSeconds ?? prev.durationSec ?? 0));
    const maxListened = Math.max(prevListened, listened);
    byKey.set(key, {
      ...prev,
      ...raw,
      albumName: raw.albumName || prev.albumName,
      artworkUrl: raw.artworkUrl || prev.artworkUrl,
      qualityLabel: raw.qualityLabel || prev.qualityLabel,
      startedAt: prev.startedAt ?? raw.startedAt,
      timestamp: Math.max(prev.timestamp || 0, raw.timestamp || 0),
      durationSec: maxListened,
      listenedSeconds: maxListened,
      countedPlay: Boolean(prev.countedPlay || raw.countedPlay),
    });
  };

  for (const e of Array.isArray(existing) ? existing : []) ingest(e);
  for (const e of Array.isArray(incoming) ? incoming : []) ingest(e);

  const merged = Array.from(byKey.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  if (merged.length > MAX_REPLAY_ENTRIES) {
    return merged.slice(merged.length - MAX_REPLAY_ENTRIES);
  }
  return merged;
}

export function readReplayHistorySync(filePath: string): ReplayDiskEntry[] {
  const bakPath = `${filePath}.bak`;
  for (const candidate of [filePath, bakPath]) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const raw = fs.readFileSync(candidate, 'utf-8');
      if (!raw || !raw.trim()) continue;
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.entries)
        ? parsed.entries
        : null;
      if (entries) {
        return entries.filter((e: any) => e && typeof e.videoId === 'string');
      }
    } catch {
      // Try .bak fallback next
    }
  }
  return [];
}

export function writeReplayHistoryAtomicSync(filePath: string, entries: ReplayDiskEntry[]): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const bakPath = `${filePath}.bak`;
  const payload = JSON.stringify({ version: 1, updatedAt: Date.now(), entries });

  fs.writeFileSync(tmpPath, payload, 'utf-8');
  if (fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, bakPath);
    } catch {
      // Non-fatal backup write failure
    }
  }
  fs.renameSync(tmpPath, filePath);
}
