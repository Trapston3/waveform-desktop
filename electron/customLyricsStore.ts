import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface CustomLyricsIndexEntry {
  trackKey: string;
  fileName?: string;
  format?: 'lrc' | 'txt';
  offsetMs: number;
  updatedAt: number;
}

export interface CustomLyricsRecord {
  trackKey: string;
  rawText: string;
  format: 'lrc' | 'txt';
  offsetMs: number;
  updatedAt: number;
}

const LRC_TIMESTAMP_RE = /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/;

export function detectCustomLyricsFormat(rawText: string): 'lrc' | 'txt' {
  return LRC_TIMESTAMP_RE.test(rawText || '') ? 'lrc' : 'txt';
}

export function sanitizeLyricsTrackKey(trackKey: string): string {
  const trimmed = String(trackKey || '').trim() || 'unknown';
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 72);
  const hash = createHash('sha1').update(trimmed).digest('hex').slice(0, 10);
  return `${safe || 'track'}-${hash}`;
}

export class CustomLyricsStore {
  private readonly dirPath: string;
  private readonly indexPath: string;
  private index: Record<string, CustomLyricsIndexEntry> = {};

  constructor(userDataPath: string) {
    this.dirPath = path.join(userDataPath, 'custom-lyrics');
    this.indexPath = path.join(this.dirPath, 'index.json');
    this.loadIndex();
  }

  private loadIndex(): void {
    try {
      if (!fs.existsSync(this.indexPath)) {
        this.index = {};
        return;
      }
      const parsed = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        this.index = parsed as Record<string, CustomLyricsIndexEntry>;
      }
    } catch {
      this.index = {};
    }
  }

  private saveIndex(): void {
    try {
      fs.mkdirSync(this.dirPath, { recursive: true });
      const tmp = `${this.indexPath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.index, null, 2), 'utf8');
      fs.renameSync(tmp, this.indexPath);
    } catch {
      // Non-fatal index persistence error
    }
  }

  private resolveSafeFilePath(fileName: string): string {
    const base = path.basename(fileName);
    return path.join(this.dirPath, base);
  }

  public saveCustomLyrics(
    trackKey: string,
    rawText: string,
    offsetMs?: number
  ): CustomLyricsRecord {
    const key = String(trackKey || '').trim();
    if (!key) throw new Error('trackKey is required');
    const normalizedText = String(rawText || '').replace(/\r\n/g, '\n');
    const format = detectCustomLyricsFormat(normalizedText);
    const stem = sanitizeLyricsTrackKey(key);
    const fileName = `${stem}.${format}`;
    const prevEntry = this.index[key];

    fs.mkdirSync(this.dirPath, { recursive: true });
    if (prevEntry?.fileName && prevEntry.fileName !== fileName) {
      const oldPath = this.resolveSafeFilePath(prevEntry.fileName);
      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch {}
      }
    }

    const filePath = this.resolveSafeFilePath(fileName);
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, normalizedText, 'utf8');
    fs.renameSync(tmp, filePath);

    const nextOffset =
      typeof offsetMs === 'number' && Number.isFinite(offsetMs)
        ? Math.max(-5000, Math.min(5000, Math.round(offsetMs)))
        : prevEntry?.offsetMs ?? 0;

    const updatedAt = Date.now();
    this.index[key] = {
      trackKey: key,
      fileName,
      format,
      offsetMs: nextOffset,
      updatedAt,
    };
    this.saveIndex();

    return {
      trackKey: key,
      rawText: normalizedText,
      format,
      offsetMs: nextOffset,
      updatedAt,
    };
  }

  public getCustomLyrics(trackKey: string): CustomLyricsRecord | null {
    const key = String(trackKey || '').trim();
    if (!key) return null;
    const entry = this.index[key];
    if (!entry?.fileName) return null;
    const filePath = this.resolveSafeFilePath(entry.fileName);
    if (!fs.existsSync(filePath)) return null;
    try {
      const rawText = fs.readFileSync(filePath, 'utf8');
      return {
        trackKey: key,
        rawText,
        format: entry.format || detectCustomLyricsFormat(rawText),
        offsetMs: Number.isFinite(entry.offsetMs) ? entry.offsetMs : 0,
        updatedAt: entry.updatedAt || Date.now(),
      };
    } catch {
      return null;
    }
  }

  public setTrackOffsetMs(trackKey: string, offsetMs: number): number {
    const key = String(trackKey || '').trim();
    if (!key) return 0;
    const clamped = Number.isFinite(offsetMs)
      ? Math.max(-5000, Math.min(5000, Math.round(offsetMs)))
      : 0;
    const prev = this.index[key];
    this.index[key] = {
      trackKey: key,
      fileName: prev?.fileName,
      format: prev?.format,
      offsetMs: clamped,
      updatedAt: Date.now(),
    };
    this.saveIndex();
    return clamped;
  }

  public getTrackOffsetMs(trackKey: string): number {
    const key = String(trackKey || '').trim();
    if (!key) return 0;
    const v = this.index[key]?.offsetMs;
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }

  public deleteCustomLyrics(trackKey: string): boolean {
    const key = String(trackKey || '').trim();
    if (!key) return false;
    const entry = this.index[key];
    if (!entry) return false;
    if (entry.fileName) {
      const filePath = this.resolveSafeFilePath(entry.fileName);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {}
      }
    }
    delete this.index[key];
    this.saveIndex();
    return true;
  }
}
