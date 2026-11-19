// src/audio/WaveformExtractor.ts
// 200-bucket amplitude envelope extractor, 68-bar resampler, and procedural fallback
// Conforming to Feature 10 (PROJECT.md) and Survey 2 §4.7

const getNodeBuiltin = (id: string): any => {
  try {
    const proc = (globalThis as any).process;
    if (proc && typeof proc.getBuiltinModule === 'function') {
      return proc.getBuiltinModule(id);
    }
  } catch {
    // Ignore in browser/sandboxed renderer
  }
  return null;
};

const path = getNodeBuiltin('node:path');
const fs = getNodeBuiltin('node:fs');

export class WaveformExtractor {
  public static readonly BUCKET_COUNT = 200;
  public static readonly BAR_COUNT = 68;

  private memoryCache = new Map<string, Float32Array>();
  private cacheDir: string | null = null;

  constructor(cacheDir?: string) {
    if (cacheDir) {
      this.cacheDir = cacheDir;
    } else {
      try {
        const proc = (globalThis as any).process;
        if (proc && proc.env && path) {
          const appData =
            proc.env.APPDATA ||
            proc.env.LOCALAPPDATA ||
            path.join(proc.env.USERPROFILE || '', 'AppData/Roaming');
          this.cacheDir = path.join(appData, 'WaveForm/waveforms');
        }
      } catch {
        this.cacheDir = null;
      }
    }
  }

  /**
   * Generates a 32-bit FNV-1a hash of a seed string.
   */
  private static fnv1a(str: string): number {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  /**
   * Extracts a 200-bucket normalized linear RMS amplitude envelope from a Float32Array PCM buffer.
   * Conforms to F10-T01, B10-T01, B10-T02.
   */
  public static extract200BucketEnvelope(buffer: Float32Array): Float32Array {
    const buckets = new Float32Array(WaveformExtractor.BUCKET_COUNT);
    const len = buffer.length;

    if (len === 0) return buckets;

    const bucketSize = Math.floor(len / WaveformExtractor.BUCKET_COUNT);

    if (bucketSize === 0) {
      // Buffer has fewer than 200 samples (B10-T02)
      for (let i = 0; i < len; i++) {
        const val = buffer[i];
        const s = Number.isFinite(val) ? Math.abs(val) : 0.0;
        const targetBucket = Math.floor((i / len) * WaveformExtractor.BUCKET_COUNT);
        if (s > buckets[targetBucket]) {
          buckets[targetBucket] = s;
        }
      }
    } else {
      for (let b = 0; b < WaveformExtractor.BUCKET_COUNT; b++) {
        const start = b * bucketSize;
        const end = Math.min(start + bucketSize, len);
        let sumSq = 0;
        let count = 0;

        for (let i = start; i < end; i++) {
          const val = buffer[i];
          const s = Number.isFinite(val) ? val : 0.0;
          sumSq += s * s;
          count++;
        }

        buckets[b] = count > 0 ? Math.sqrt(sumSq / count) : 0;
      }
    }

    // Normalize peak bucket to 1.0 if not completely silent
    let maxPeak = 0;
    for (let b = 0; b < WaveformExtractor.BUCKET_COUNT; b++) {
      if (buckets[b] > maxPeak) maxPeak = buckets[b];
    }

    if (maxPeak > 0) {
      const invPeak = 1.0 / maxPeak;
      for (let b = 0; b < WaveformExtractor.BUCKET_COUNT; b++) {
        buckets[b] *= invPeak;
      }
    }

    return buckets;
  }

  /**
   * Resamples 200 amplitude buckets to 68 waveform seekbar bars.
   * Conforms to F10-T02, B10-T05.
   */
  public static resampleTo68Bars(buckets200: Float32Array): Float32Array {
    const bars68 = new Float32Array(WaveformExtractor.BAR_COUNT);
    if (!buckets200 || buckets200.length === 0) return bars68;

    const ratio = buckets200.length / WaveformExtractor.BAR_COUNT;
    for (let i = 0; i < WaveformExtractor.BAR_COUNT; i++) {
      const srcIdx = Math.min(Math.floor(i * ratio), buckets200.length - 1);
      const val = buckets200[srcIdx];
      bars68[i] = Number.isFinite(val) ? Math.max(0.0, Math.min(1.0, val)) : 0.0;
    }

    return bars68;
  }

  /**
   * Procedural song-structured fallback waveform envelope matching musical macro-structure:
   * Intro -> Verse 1 -> Chorus 1 -> Verse 2 -> Chorus 2 -> Bridge -> Climax -> Outro.
   * Conforms to Survey 2 §4.7.
   */
  public static deterministicWaveformFallback(
    seedKey: string,
    bucketCount = WaveformExtractor.BUCKET_COUNT
  ): Float32Array {
    const buckets = new Float32Array(bucketCount);
    const hash = WaveformExtractor.fnv1a(seedKey || 'waveform_fallback');

    let lcg = hash;
    const nextRandom = () => {
      lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0;
      return lcg / 4294967296;
    };

    const phase1 = nextRandom() * Math.PI * 2;
    const phase2 = nextRandom() * Math.PI * 2;
    const phase3 = nextRandom() * Math.PI * 2;

    for (let i = 0; i < bucketCount; i++) {
      const p = i / (bucketCount - 1);

      // Macro-envelope structure
      let macro = 0.5;
      if (p < 0.08) {
        // Intro build ramp
        macro = 0.25 + (p / 0.08) * 0.35;
      } else if (p < 0.28) {
        // Verse 1
        macro = 0.45 + 0.1 * Math.sin(p * 20);
      } else if (p < 0.48) {
        // Chorus 1
        macro = 0.75 + 0.15 * Math.sin(p * 30);
      } else if (p < 0.62) {
        // Verse 2
        macro = 0.5 + 0.1 * Math.cos(p * 25);
      } else if (p < 0.8) {
        // Chorus 2
        macro = 0.82 + 0.12 * Math.sin(p * 35);
      } else if (p < 0.9) {
        // Climax / Solo
        macro = 0.92 + 0.08 * Math.sin(p * 40);
      } else {
        // Outro decay
        macro = 0.92 * (1.0 - (p - 0.9) / 0.1);
      }

      // 3 Harmonic sinusoidal waves
      const wave =
        0.18 * Math.sin(p * 18 * Math.PI + phase1) +
        0.12 * Math.sin(p * 38 * Math.PI + phase2) +
        0.06 * Math.sin(p * 74 * Math.PI + phase3);

      // Micro-variation noise
      const micro = (nextRandom() - 0.5) * 0.08;

      let amp = macro + wave + micro;
      amp = Math.max(0.12, Math.min(1.0, amp));
      buckets[i] = amp;
    }

    // Normalize peak to 1.0
    let peak = 0;
    for (let i = 0; i < bucketCount; i++) {
      if (buckets[i] > peak) peak = buckets[i];
    }
    if (peak > 0) {
      for (let i = 0; i < bucketCount; i++) {
        buckets[i] /= peak;
      }
    }

    return buckets;
  }

  /**
   * Retrieves or extracts the 200-bucket waveform envelope.
   * L1: Memory Cache -> L2: Local Disk Cache -> L3: AudioBuffer extraction -> L4: Deterministic Fallback.
   */
  public async getOrExtractWaveform(songId: string, pcmBuffer?: Float32Array): Promise<Float32Array> {
    if (!songId) throw new Error('Song ID required');

    // 1. L1 Memory cache
    if (this.memoryCache.has(songId)) {
      return this.memoryCache.get(songId)!;
    }

    // 2. L2 Disk cache
    if (this.cacheDir && fs && path) {
      try {
        const filePath = path.join(this.cacheDir, `${songId}.json`);
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, 'utf8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length === WaveformExtractor.BUCKET_COUNT) {
            const envelope = new Float32Array(parsed);
            this.memoryCache.set(songId, envelope);
            return envelope;
          }
        }
      } catch {
        // Disk read error ignored
      }
    }

    // 3. PCM Buffer extraction
    if (pcmBuffer && pcmBuffer.length > 0) {
      const envelope = WaveformExtractor.extract200BucketEnvelope(pcmBuffer);
      this.memoryCache.set(songId, envelope);
      this.persistToDisk(songId, envelope);
      return envelope;
    }

    // 4. Procedural fallback
    const fallback = WaveformExtractor.deterministicWaveformFallback(songId);
    this.memoryCache.set(songId, fallback);
    return fallback;
  }

  private persistToDisk(songId: string, envelope: Float32Array): void {
    if (!this.cacheDir || !fs || !path) return;
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      const filePath = path.join(this.cacheDir, `${songId}.json`);
      fs.writeFileSync(filePath, JSON.stringify(Array.from(envelope)), 'utf8');
    } catch {
      // Ignore disk caching errors
    }
  }

  public clearMemoryCache(): void {
    this.memoryCache.clear();
  }
}
