// electron/youtubeSabrStream.ts
// Pure-Node YouTube SABR progressive audio downloader + HTTP Range protocol responder
// Uses googlevideo SabrStream (ANDROID_VR / IOS / VISIONOS) with seamless yt-dlp continuation/fallback

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { SabrStream } from 'googlevideo/sabr-stream';
import { buildSabrFormat, EnabledTrackTypes } from 'googlevideo/utils';
import type { ClientInfo } from 'googlevideo/protos';
import type { FormatStream, SabrFormat } from 'googlevideo/shared-types';

export interface ResolvedYoutubeStreamResult {
  streamUrl: string;
  mimeType: string;
  durationSec: number;
  sourceClient: string;
  cached: boolean;
}

export interface CachedYoutubeStreamMeta {
  videoId: string;
  mimeType: string;
  contentLength: number;
  durationSec: number;
  itag: number;
  ext?: string;
  sourceClient?: string;
}

interface PlayerClientProfile {
  name: string;
  clientNameNum: number;
  clientVersion: string;
  userAgent: string;
  osName: string;
  osVersion: string;
  deviceMake: string;
  deviceModel: string;
  androidSdkVersion?: number;
}

interface PlayerMetadata {
  serverAbrStreamingUrl: string;
  videoPlaybackUstreamerConfig: string;
  adaptiveFormats: FormatStream[];
  durationSec: number;
  clientProfile: PlayerClientProfile;
}

interface ActiveStreamJob {
  videoId: string;
  cacheDir: string;
  partPath: string;
  finalPath: string;
  metaPath: string;
  ext: string;
  mimeType: string;
  itag: number;
  durationSec: number;
  sourceClient: string;
  estimatedSize: number;
  bytesWritten: number;
  finalSize: number;
  done: boolean;
  error: Error | null;
  sabrStream: SabrStream | null;
  childProcess: ChildProcess | null;
  fileHandle: fsp.FileHandle | null;
  aborted: boolean;
  waiters: Set<() => void>;
  completionPromise: Promise<void>;
}

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const MAX_CACHE_BYTES = 512 * 1024 * 1024; // 512 MB
const PRIME_MIN_BYTES = 32 * 1024; // 32 KB
const VISITOR_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_OPEN_RANGE_CHUNK = 512 * 1024; // 512 KB chunk when streaming an active download
const SABR_STALL_HANDOFF_MS = 4500; // Fast handoff when ANDROID_VR hits YouTube's 60s SABR prefix cap
const RANGE_WAIT_TIMEOUT_MS = 60_000;

const PLAYER_CLIENTS: PlayerClientProfile[] = [
  {
    name: 'ANDROID_VR',
    clientNameNum: 28,
    clientVersion: '1.65.10',
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    osName: 'Android',
    osVersion: '12L',
    deviceMake: 'Oculus',
    deviceModel: 'Quest 3',
    androidSdkVersion: 32,
  },
  {
    name: 'ANDROID_VR',
    clientNameNum: 28,
    clientVersion: '1.61.48',
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12; en_US; Oculus Quest 3; Build/SQ3A.220605.009.A1; Cronet/132.0.6808.3)',
    osName: 'Android',
    osVersion: '12',
    deviceMake: 'Oculus',
    deviceModel: 'Quest 3',
    androidSdkVersion: 32,
  },
  {
    name: 'IOS',
    clientNameNum: 5,
    clientVersion: '20.10.4',
    userAgent:
      'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    osName: 'iPhone',
    osVersion: '18.3.2.22D82',
    deviceMake: 'Apple',
    deviceModel: 'iPhone16,2',
  },
  {
    name: 'VISIONOS',
    clientNameNum: 101,
    clientVersion: '0.1',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    osName: 'visionOS',
    osVersion: '1.3.21O771',
    deviceMake: 'Apple',
    deviceModel: 'RealityDevice14,1',
  },
];

let cachedVisitorData: { value: string; fetchedAt: number } | null = null;
const activeJobs = new Map<string, ActiveStreamJob>();

function getDefaultCacheDir(): string {
  return path.join(os.tmpdir(), 'waveform-yt-cache');
}

function getJobKey(cacheDir: string, videoId: string): string {
  return `${path.resolve(cacheDir)}::${videoId}`;
}

function notifyWaiters(job: ActiveStreamJob): void {
  for (const resolve of job.waiters) {
    resolve();
  }
  job.waiters.clear();
}

function waitForJobProgress(job: ActiveStreamJob, timeoutMs = RANGE_WAIT_TIMEOUT_MS): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (job.done || job.error || job.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      job.waiters.delete(onProgress);
      reject(new Error(`Timed out waiting for SABR audio stream data for ${job.videoId}`));
    }, timeoutMs);

    const onProgress = () => {
      clearTimeout(timer);
      resolve();
    };
    job.waiters.add(onProgress);
  });
}

function normalizeAudioMimeAndExt(rawMimeType?: string): { mimeType: string; ext: string } {
  const base = (rawMimeType || 'audio/webm').split(';')[0].trim().toLowerCase();
  if (base.includes('mp4') || base.includes('m4a') || base.includes('aac')) {
    return { mimeType: 'audio/mp4', ext: 'm4a' };
  }
  if (base.includes('webm') || base.includes('opus')) {
    return { mimeType: 'audio/webm', ext: 'webm' };
  }
  if (base.includes('mpeg') || base.includes('mp3')) {
    return { mimeType: 'audio/mpeg', ext: 'mp3' };
  }
  if (base.includes('ogg')) {
    return { mimeType: 'audio/ogg', ext: 'ogg' };
  }
  return { mimeType: base || 'audio/webm', ext: 'webm' };
}

function selectBestAudioFormat(formats: SabrFormat[]): SabrFormat | undefined {
  const audioOnly = formats.filter((f) => f.hasAudio && !f.hasVideo);
  if (audioOnly.length === 0) return undefined;

  const itagPriority: Record<number, number> = {
    251: 120, // Opus 160kbps
    140: 110, // AAC 128kbps
    250: 80,  // Opus 70kbps
    249: 60,  // Opus 50kbps
    139: 40,  // AAC 48kbps
  };

  return [...audioOnly].sort((a, b) => {
    const origA = (a.isOriginal ? 30 : 0) - (a.isDubbed ? 50 : 0) - (a.isDescriptive ? 50 : 0);
    const origB = (b.isOriginal ? 30 : 0) - (b.isDubbed ? 50 : 0) - (b.isDescriptive ? 50 : 0);
    const scoreA = origA + (itagPriority[a.itag] || 0) + (a.averageBitrate || a.bitrate || 0) / 1000;
    const scoreB = origB + (itagPriority[b.itag] || 0) + (b.averageBitrate || b.bitrate || 0) / 1000;
    return scoreB - scoreA;
  })[0];
}

export async function fetchFreshVisitorData(forceRefresh = false): Promise<string | undefined> {
  if (
    !forceRefresh &&
    cachedVisitorData &&
    Date.now() - cachedVisitorData.fetchedAt < VISITOR_TTL_MS
  ) {
    return cachedVisitorData.value;
  }

  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/visitor_id?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
        Origin: 'https://www.youtube.com',
        Referer: 'https://www.youtube.com/',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20250523.01.00',
            hl: 'en',
            gl: 'US',
          },
        },
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as any;
      const visitorData = data?.responseContext?.visitorData;
      if (typeof visitorData === 'string' && visitorData.length > 0) {
        cachedVisitorData = { value: visitorData, fetchedAt: Date.now() };
        return visitorData;
      }
    }
  } catch {
    // Ignore visitor_id errors and fall back to existing or none
  }

  return cachedVisitorData?.value;
}

async function fetchPlayerMetadata(
  videoId: string,
  visitorData?: string
): Promise<PlayerMetadata> {
  let lastError = 'No player client returned SABR streaming metadata';

  for (const profile of PLAYER_CLIENTS) {
    try {
      const clientContext: Record<string, unknown> = {
        clientName: profile.name,
        clientVersion: profile.clientVersion,
        hl: 'en',
        gl: 'US',
        osName: profile.osName,
        osVersion: profile.osVersion,
        deviceMake: profile.deviceMake,
        deviceModel: profile.deviceModel,
      };
      if (profile.androidSdkVersion) {
        clientContext.androidSdkVersion = profile.androidSdkVersion;
      }
      if (visitorData) {
        clientContext.visitorData = visitorData;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': profile.userAgent,
        'X-YouTube-Client-Name': String(profile.clientNameNum),
        'X-YouTube-Client-Version': profile.clientVersion,
        Origin: 'https://www.youtube.com',
        Referer: 'https://www.youtube.com/',
      };
      if (visitorData) {
        headers['X-Goog-Visitor-Id'] = visitorData;
      }

      const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          context: {
            client: clientContext,
            user: { lockedSafetyMode: false },
            request: { useSsl: true },
          },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });

      if (!res.ok) {
        lastError = `${profile.name} (${profile.clientVersion}) HTTP ${res.status}`;
        continue;
      }

      const data = (await res.json()) as any;
      if (data?.playabilityStatus?.status !== 'OK') {
        lastError = `${profile.name} playabilityStatus=${data?.playabilityStatus?.status || 'UNKNOWN'}: ${data?.playabilityStatus?.reason || ''}`;
        continue;
      }

      const serverAbrStreamingUrl = data?.streamingData?.serverAbrStreamingUrl;
      const videoPlaybackUstreamerConfig =
        data?.playerConfig?.mediaCommonConfig?.mediaUstreamerRequestConfig
          ?.videoPlaybackUstreamerConfig;
      const adaptiveFormats = Array.isArray(data?.streamingData?.adaptiveFormats)
        ? (data.streamingData.adaptiveFormats as FormatStream[])
        : [];
      const durationSec = Number(data?.videoDetails?.lengthSeconds) || 0;

      if (serverAbrStreamingUrl && videoPlaybackUstreamerConfig && adaptiveFormats.length > 0) {
        return {
          serverAbrStreamingUrl,
          videoPlaybackUstreamerConfig,
          adaptiveFormats,
          durationSec,
          clientProfile: profile,
        };
      }

      lastError = `${profile.name} response missing serverAbrStreamingUrl or ustreamerConfig`;
    } catch (err) {
      lastError = `${profile.name} error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  throw new Error(`Failed to resolve SABR player metadata for ${videoId}: ${lastError}`);
}

async function readCachedMeta(
  cacheDir: string,
  videoId: string
): Promise<{ meta: CachedYoutubeStreamMeta; filePath: string } | null> {
  const metaPath = path.join(cacheDir, `${videoId}.json`);
  try {
    const raw = await fsp.readFile(metaPath, 'utf8');
    const meta = JSON.parse(raw) as CachedYoutubeStreamMeta;
    const { ext } = normalizeAudioMimeAndExt(meta.mimeType);
    const candidateExts = [meta.ext, ext, 'webm', 'm4a', 'mp3', 'ogg'].filter(
      (v, i, arr): v is string => Boolean(v) && arr.indexOf(v) === i
    );

    for (const candidateExt of candidateExts) {
      const filePath = path.join(cacheDir, `${videoId}.${candidateExt}`);
      try {
        const stat = await fsp.stat(filePath);
        if (stat.isFile() && stat.size > 0) {
          return {
            meta: {
              ...meta,
              contentLength: stat.size,
              ext: candidateExt,
            },
            filePath,
          };
        }
      } catch {
        // Try next extension
      }
    }
  } catch {
    // Cache miss
  }
  return null;
}

async function pruneCache(cacheDir: string, maxBytes = MAX_CACHE_BYTES): Promise<void> {
  try {
    const entries = await fsp.readdir(cacheDir, { withFileTypes: true });
    const files: { name: string; fullPath: string; size: number; mtimeMs: number }[] = [];
    let totalSize = 0;

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.part')) continue;
      const fullPath = path.join(cacheDir, entry.name);
      try {
        const st = await fsp.stat(fullPath);
        totalSize += st.size;
        files.push({
          name: entry.name,
          fullPath,
          size: st.size,
          mtimeMs: st.mtimeMs,
        });
      } catch {
        // Ignore racing deletes
      }
    }

    if (totalSize <= maxBytes) return;

    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    const activeVideoIds = new Set(Array.from(activeJobs.values()).map((j) => j.videoId));

    for (const file of files) {
      if (totalSize <= maxBytes * 0.85) break;
      const baseId = file.name.split('.')[0];
      if (activeVideoIds.has(baseId)) continue;
      if (file.name.endsWith('.json')) continue;

      try {
        await fsp.unlink(file.fullPath);
        totalSize -= file.size;
      } catch {
        // Ignore unlink errors
      }
      try {
        const jsonPath = path.join(cacheDir, `${baseId}.json`);
        const jsonStat = await fsp.stat(jsonPath);
        await fsp.unlink(jsonPath);
        totalSize -= jsonStat.size;
      } catch {
        // Ignore missing metadata json
      }
    }
  } catch {
    // Ignore prune errors
  }
}

async function finalizePartFile(partPath: string, finalPath: string): Promise<void> {
  try {
    await fsp.rename(partPath, finalPath);
  } catch {
    await fsp.copyFile(partPath, finalPath);
    await fsp.unlink(partPath).catch(() => {});
  }
}

function findYtDlpBinary(): string {
  const candidates = [
    'C:\\Users\\traps\\scoop\\shims\\yt-dlp.exe',
    'C:\\Users\\traps\\scoop\\shims\\yt-dlp',
    'yt-dlp',
  ];
  for (const candidate of candidates) {
    if (candidate === 'yt-dlp') return candidate;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // Try next
    }
  }
  return 'yt-dlp';
}

function sniffAudioMimeFromHeader(chunk: Buffer, fallbackMime: string): string {
  if (chunk.length >= 4 && chunk[0] === 0x1a && chunk[1] === 0x45 && chunk[2] === 0xdf && chunk[3] === 0xa3) {
    return 'audio/webm';
  }
  if (chunk.length >= 8 && chunk.subarray(4, 8).toString('ascii') === 'ftyp') {
    return 'audio/mp4';
  }
  return fallbackMime;
}

/**
 * Downloads the full audio track via yt-dlp (--js-runtimes node with tv_downgraded,web_embedded)
 * into a temporary part file and atomically promotes it to job.finalPath.
 * Can be used either as a direct fallback or as a seamless continuation when YouTube's
 * 60-second SABR prefix cap stalls a SabrStream mid-track.
 */
async function downloadWithYtDlpIntoJob(job: ActiveStreamJob, streamDirectlyToPart: boolean): Promise<void> {
  const binary = findYtDlpBinary();
  const targetPartPath = streamDirectlyToPart
    ? job.partPath
    : path.join(job.cacheDir, `${job.videoId}.${job.ext}.ytdlp.part`);

  const preferredAudioOnlySelector =
    job.ext === 'm4a'
      ? 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio'
      : 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio';

  const clientAttempts: Array<{ extractorArgs: string | null; formatSelector: string }> = [
    { extractorArgs: 'youtube:player_client=web_embedded,tv_downgraded', formatSelector: preferredAudioOnlySelector },
    { extractorArgs: 'youtube:player_client=web_embedded,tv_downgraded', formatSelector: `${preferredAudioOnlySelector}/18/best` },
    { extractorArgs: 'youtube:player_client=tv,web_embedded', formatSelector: `${preferredAudioOnlySelector}/18/best` },
    { extractorArgs: null, formatSelector: `${preferredAudioOnlySelector}/18/best` },
  ];

  const attemptErrors: string[] = [];

  for (const { extractorArgs, formatSelector } of clientAttempts) {
    if (job.aborted) {
      throw new Error('yt-dlp download aborted');
    }

    const args = [
      '--js-runtimes',
      'node',
      '--no-warnings',
      '--no-cache-dir',
      '--retries',
      '4',
      '--fragment-retries',
      '4',
      '--socket-timeout',
      '15',
    ];
    if (extractorArgs) {
      args.push('--extractor-args', extractorArgs);
    }
    args.push(
      '-f',
      formatSelector,
      '--no-playlist',
      '--no-part',
      '-o',
      '-',
      `https://www.youtube.com/watch?v=${job.videoId}`
    );

    let fh: fsp.FileHandle | null = null;
    let ytdlpBytes = 0;
    let sniffedMime = job.mimeType || 'audio/webm';

    try {
      fh = await fsp.open(targetPartPath, 'w');
      if (streamDirectlyToPart) {
        job.fileHandle = fh;
      }

      const child = spawn(binary, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      job.childProcess = child;

      let stderrText = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrText += chunk.toString('utf8');
        if (stderrText.length > 4096) stderrText = stderrText.slice(-4096);
      });

      let writeChain = Promise.resolve();
      child.stdout?.on('data', (chunk: Buffer) => {
        if (job.aborted || !fh) return;
        const copy = Buffer.from(chunk);
        writeChain = writeChain.then(async () => {
          if (job.aborted || !fh) return;
          if (ytdlpBytes === 0) {
            sniffedMime = sniffAudioMimeFromHeader(copy, sniffedMime);
            if (streamDirectlyToPart) {
              job.mimeType = sniffedMime;
            }
          }
          await fh.write(copy, 0, copy.length, ytdlpBytes);
          ytdlpBytes += copy.length;
          if (streamDirectlyToPart) {
            job.bytesWritten = ytdlpBytes;
            notifyWaiters(job);
          }
        });
      });

      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
      });

      await writeChain;

      if (job.aborted) {
        throw new Error('yt-dlp download aborted');
      }
      if (exitCode !== 0 || ytdlpBytes === 0) {
        throw new Error(`yt-dlp exited with code ${exitCode}: ${stderrText.trim()}`);
      }

      await fh.close();
      fh = null;
      if (streamDirectlyToPart) {
        job.fileHandle = null;
      }

      await finalizePartFile(targetPartPath, job.finalPath);
      if (!streamDirectlyToPart) {
        await fsp.unlink(job.partPath).catch(() => {});
      }

      job.mimeType = sniffedMime;
      job.bytesWritten = ytdlpBytes;
      job.finalSize = ytdlpBytes;
      job.sourceClient = streamDirectlyToPart ? 'yt-dlp' : `${job.sourceClient}+yt-dlp`;

      const meta: CachedYoutubeStreamMeta = {
        videoId: job.videoId,
        mimeType: job.mimeType,
        contentLength: job.finalSize,
        durationSec: job.durationSec,
        itag: job.itag,
        ext: job.ext,
        sourceClient: job.sourceClient,
      };
      await fsp.writeFile(job.metaPath, JSON.stringify(meta, null, 2), 'utf8');

      job.done = true;
      notifyWaiters(job);
      void pruneCache(job.cacheDir);
      return;
    } catch (err) {
      if (fh) {
        await fh.close().catch(() => {});
        if (streamDirectlyToPart) job.fileHandle = null;
      }
      await fsp.unlink(targetPartPath).catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      attemptErrors.push(`[${extractorArgs || 'default'} | ${formatSelector}] ${msg.replace(/\s+/g, ' ').slice(-220)}`);
    } finally {
      job.childProcess = null;
    }
  }

  throw new Error(
    attemptErrors.length > 0
      ? `yt-dlp failed for ${job.videoId}: ${attemptErrors.join(' ; ')}`
      : `yt-dlp failed for ${job.videoId}`
  );
}

async function startYtDlpFallbackJob(
  videoId: string,
  cacheDir: string
): Promise<ActiveStreamJob> {
  await fsp.mkdir(cacheDir, { recursive: true });
  const ext = 'webm';
  const partPath = path.join(cacheDir, `${videoId}.${ext}.part`);
  const finalPath = path.join(cacheDir, `${videoId}.${ext}`);
  const metaPath = path.join(cacheDir, `${videoId}.json`);

  const job: ActiveStreamJob = {
    videoId,
    cacheDir,
    partPath,
    finalPath,
    metaPath,
    ext,
    mimeType: 'audio/webm',
    itag: 251,
    durationSec: 0,
    sourceClient: 'yt-dlp',
    estimatedSize: 0,
    bytesWritten: 0,
    finalSize: 0,
    done: false,
    error: null,
    sabrStream: null,
    childProcess: null,
    fileHandle: null,
    aborted: false,
    waiters: new Set(),
    completionPromise: Promise.resolve(),
  };

  const jobKey = getJobKey(cacheDir, videoId);
  activeJobs.set(jobKey, job);

  job.completionPromise = (async () => {
    try {
      await downloadWithYtDlpIntoJob(job, true);
    } catch (err) {
      job.error = err instanceof Error ? err : new Error(String(err));
      notifyWaiters(job);
    } finally {
      if (activeJobs.get(jobKey) === job) {
        activeJobs.delete(jobKey);
      }
    }
  })();

  return job;
}

async function startSabrJob(videoId: string, cacheDir: string): Promise<ActiveStreamJob> {
  await fsp.mkdir(cacheDir, { recursive: true });
  const visitorData = await fetchFreshVisitorData();
  const metadata = await fetchPlayerMetadata(videoId, visitorData);

  const sabrFormats = metadata.adaptiveFormats.map((f) => buildSabrFormat(f));
  const chosenFormat = selectBestAudioFormat(sabrFormats);
  if (!chosenFormat) {
    throw new Error(`No audio-only SABR format available for ${videoId}`);
  }

  const { mimeType, ext } = normalizeAudioMimeAndExt(chosenFormat.mimeType);
  const partPath = path.join(cacheDir, `${videoId}.${ext}.part`);
  const finalPath = path.join(cacheDir, `${videoId}.${ext}`);
  const metaPath = path.join(cacheDir, `${videoId}.json`);

  const clientInfo: ClientInfo = {
    clientName: metadata.clientProfile.clientNameNum,
    clientVersion: metadata.clientProfile.clientVersion,
    osName: metadata.clientProfile.osName,
    osVersion: metadata.clientProfile.osVersion,
    deviceMake: metadata.clientProfile.deviceMake,
    deviceModel: metadata.clientProfile.deviceModel,
    hl: 'en',
  };

  const sabrStream = new SabrStream({
    videoId,
    serverAbrStreamingUrl: metadata.serverAbrStreamingUrl,
    videoPlaybackUstreamerConfig: metadata.videoPlaybackUstreamerConfig,
    clientInfo,
    formats: sabrFormats,
    callbacks: {
      onReloadPlayerResponse: async () => {
        const refreshedVisitor = await fetchFreshVisitorData();
        const refreshed = await fetchPlayerMetadata(videoId, refreshedVisitor);
        return {
          serverAbrStreamingUrl: refreshed.serverAbrStreamingUrl,
          videoPlaybackUstreamerConfig: refreshed.videoPlaybackUstreamerConfig,
        };
      },
    },
  });

  const { audioStream, selectedFormats } = sabrStream.start({
    enabledTrackTypes: EnabledTrackTypes.AUDIO_ONLY,
    isPostLiveDvr: false,
    audioFormat: chosenFormat,
    maxRetries: 4,
    stallDetectionMs: 12_000,
  });

  const actualFormat = selectedFormats.audioFormat || chosenFormat;
  const durationSec =
    metadata.durationSec ||
    (actualFormat.approxDurationMs ? Math.round(actualFormat.approxDurationMs / 1000) : 0);

  const job: ActiveStreamJob = {
    videoId,
    cacheDir,
    partPath,
    finalPath,
    metaPath,
    ext,
    mimeType,
    itag: actualFormat.itag,
    durationSec,
    sourceClient: metadata.clientProfile.name,
    estimatedSize: actualFormat.contentLength || 0,
    bytesWritten: 0,
    finalSize: 0,
    done: false,
    error: null,
    sabrStream,
    childProcess: null,
    fileHandle: null,
    aborted: false,
    waiters: new Set(),
    completionPromise: Promise.resolve(),
  };

  const jobKey = getJobKey(cacheDir, videoId);
  activeJobs.set(jobKey, job);

  let sabrErrored: Error | null = null;
  sabrStream.on('error', (err) => {
    sabrErrored = err instanceof Error ? err : new Error(String(err));
  });

  job.completionPromise = (async () => {
    let fh: fsp.FileHandle | null = null;
    const reader = audioStream.getReader();
    let needsYtDlpContinuation = false;

    try {
      fh = await fsp.open(partPath, 'w');
      job.fileHandle = fh;

      while (true) {
        if (job.aborted) break;

        // Race reader.read() against a short stall timer once we've already primed initial bytes
        // so YouTube's 60s ANDROID_VR SABR prefix cap is detected in ~3.5s instead of 90s.
        const stallTimeoutMs = job.bytesWritten >= PRIME_MIN_BYTES ? SABR_STALL_HANDOFF_MS : 15_000;
        let stallTimer: ReturnType<typeof setTimeout> | undefined;
        const readResult = await Promise.race([
          reader.read().then((res) => ({ timedOut: false as const, res })),
          new Promise<{ timedOut: true }>((resolve) => {
            stallTimer = setTimeout(() => resolve({ timedOut: true }), stallTimeoutMs);
          }),
        ]);
        if (stallTimer) clearTimeout(stallTimer);

        if (readResult.timedOut) {
          needsYtDlpContinuation = true;
          break;
        }

        const { done, value } = readResult.res;
        if (done) break;
        if (!value || value.byteLength === 0) continue;

        const buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        await fh.write(buf, 0, buf.length, job.bytesWritten);
        job.bytesWritten += buf.length;
        notifyWaiters(job);
      }

      if (job.aborted) {
        throw new Error('SABR stream aborted');
      }

      // Close SABR reader/file handle before either finalizing or handing off to yt-dlp
      if (needsYtDlpContinuation || sabrErrored) {
        await reader.cancel().catch(() => {});
        await sabrStream.abort().catch(() => {});
      }

      await fh.close();
      fh = null;
      job.fileHandle = null;

      // If SABR stalled before reaching the end of the track (e.g., 60s prefix cap), seamlessly
      // complete the full file with yt-dlp while keeping partPath readable for active playback.
      const appearsTruncated =
        job.estimatedSize > 0 && job.bytesWritten < job.estimatedSize - 64 * 1024;

      if (needsYtDlpContinuation || sabrErrored || (job.bytesWritten === 0) || appearsTruncated) {
        if (job.bytesWritten === 0) {
          throw sabrErrored || new Error(`SABR stream produced 0 bytes for ${videoId}`);
        }
        job.sabrStream = null;
        await downloadWithYtDlpIntoJob(job, false);
        return;
      }

      await finalizePartFile(partPath, finalPath);
      job.finalSize = job.bytesWritten;

      const meta: CachedYoutubeStreamMeta = {
        videoId,
        mimeType: job.mimeType,
        contentLength: job.finalSize,
        durationSec: job.durationSec,
        itag: job.itag,
        ext: job.ext,
        sourceClient: job.sourceClient,
      };
      await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');

      job.done = true;
      notifyWaiters(job);
      void pruneCache(cacheDir);
    } catch (err) {
      try {
        await reader.cancel();
      } catch {
        // Ignore cancel errors
      }
      if (fh) {
        await fh.close().catch(() => {});
        job.fileHandle = null;
      }
      await fsp.unlink(partPath).catch(() => {});
      job.error = err instanceof Error ? err : new Error(String(err));
      notifyWaiters(job);
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Ignore release errors
      }
      job.sabrStream = null;
      if (activeJobs.get(jobKey) === job) {
        activeJobs.delete(jobKey);
      }
    }
  })();

  return job;
}

async function primeJob(job: ActiveStreamJob): Promise<void> {
  while (!job.done && !job.error && !job.aborted && job.bytesWritten < PRIME_MIN_BYTES) {
    await waitForJobProgress(job, 25_000);
  }
  if (job.error && job.bytesWritten < PRIME_MIN_BYTES) {
    throw job.error;
  }
  if (job.aborted) {
    throw new Error(`Stream priming aborted for ${job.videoId}`);
  }
}

async function ensureActiveOrCached(
  videoId: string,
  cacheDir: string
): Promise<
  | { type: 'cached'; meta: CachedYoutubeStreamMeta; filePath: string }
  | { type: 'active'; job: ActiveStreamJob }
> {
  const existingCache = await readCachedMeta(cacheDir, videoId);
  if (existingCache) {
    return { type: 'cached', ...existingCache };
  }

  const jobKey = getJobKey(cacheDir, videoId);
  const existingJob = activeJobs.get(jobKey);
  if (existingJob && !existingJob.error && !existingJob.aborted) {
    return { type: 'active', job: existingJob };
  }

  try {
    const sabrJob = await startSabrJob(videoId, cacheDir);
    await primeJob(sabrJob);
    return { type: 'active', job: sabrJob };
  } catch (sabrErr) {
    const failedJob = activeJobs.get(jobKey);
    if (failedJob) {
      failedJob.aborted = true;
      await failedJob.sabrStream?.abort().catch(() => {});
      activeJobs.delete(jobKey);
    }

    try {
      const ytdlpJob = await startYtDlpFallbackJob(videoId, cacheDir);
      await primeJob(ytdlpJob);
      return { type: 'active', job: ytdlpJob };
    } catch (ytdlpErr) {
      const sMsg = sabrErr instanceof Error ? sabrErr.message : String(sabrErr);
      const yMsg = ytdlpErr instanceof Error ? ytdlpErr.message : String(ytdlpErr);
      throw new Error(`Both SABR (${sMsg}) and yt-dlp (${yMsg}) failed for ${videoId}`);
    }
  }
}

export async function resolveYoutubeStreamForIpc(
  videoId: string,
  cacheDir: string = getDefaultCacheDir()
): Promise<ResolvedYoutubeStreamResult> {
  if (!videoId || !VIDEO_ID_REGEX.test(videoId)) {
    throw new Error(`Invalid YouTube videoId: "${videoId}"`);
  }

  const streamUrl = `waveform-stream://yt?v=${encodeURIComponent(videoId)}`;
  const state = await ensureActiveOrCached(videoId, cacheDir);

  if (state.type === 'cached') {
    return {
      streamUrl,
      mimeType: state.meta.mimeType || 'audio/webm',
      durationSec: state.meta.durationSec || 0,
      sourceClient: state.meta.sourceClient || 'cache',
      cached: true,
    };
  }

  return {
    streamUrl,
    mimeType: state.job.mimeType,
    durationSec: state.job.durationSec,
    sourceClient: state.job.sourceClient,
    cached: false,
  };
}

interface ParsedRange {
  start: number;
  end: number | null;
}

function parseRangeHeader(rangeHeader: string | null): ParsedRange | null {
  if (!rangeHeader) return null;
  const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) return null;

  const [, startStr, endStr] = match;
  if (startStr === '' && endStr === '') return null;

  if (startStr === '') {
    return { start: -parseInt(endStr, 10), end: null };
  }

  const start = parseInt(startStr, 10);
  const end = endStr !== '' ? parseInt(endStr, 10) : null;
  if (Number.isNaN(start) || (end !== null && (Number.isNaN(end) || end < start))) {
    return null;
  }
  return { start, end };
}

async function readFileSlice(filePath: string, start: number, end: number): Promise<Uint8Array> {
  const length = end - start + 1;
  const buffer = Buffer.alloc(length);
  const fh = await fsp.open(filePath, 'r');
  try {
    let totalRead = 0;
    while (totalRead < length) {
      const { bytesRead } = await fh.read(
        buffer,
        totalRead,
        length - totalRead,
        start + totalRead
      );
      if (bytesRead === 0) break;
      totalRead += bytesRead;
    }
    return totalRead === length ? buffer : buffer.subarray(0, totalRead);
  } finally {
    await fh.close();
  }
}

function createCorsHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Accept-Ranges': 'bytes',
    ...extra,
  });
}

export async function resolveYoutubeStreamProtocolRequest(
  request: Request,
  cacheDir: string = getDefaultCacheDir()
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: createCorsHeaders() });
  }

  let videoId: string | null = null;
  try {
    const parsedUrl = new URL(request.url);
    videoId = parsedUrl.searchParams.get('v');
  } catch {
    return new Response('Invalid stream URL', {
      status: 400,
      headers: createCorsHeaders({ 'Content-Type': 'text/plain' }),
    });
  }

  if (!videoId || !VIDEO_ID_REGEX.test(videoId)) {
    return new Response('Invalid or missing YouTube video ID', {
      status: 400,
      headers: createCorsHeaders({ 'Content-Type': 'text/plain' }),
    });
  }

  let state:
    | { type: 'cached'; meta: CachedYoutubeStreamMeta; filePath: string }
    | { type: 'active'; job: ActiveStreamJob };

  try {
    state = await ensureActiveOrCached(videoId, cacheDir);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : 'Stream not found', {
      status: 404,
      headers: createCorsHeaders({ 'Content-Type': 'text/plain' }),
    });
  }

  const rangeHeader = request.headers.get('range') || request.headers.get('Range');
  const parsedRange = parseRangeHeader(rangeHeader);

  // Case 1: Fully cached file on disk
  if (state.type === 'cached') {
    const { meta, filePath } = state;
    const totalSize = meta.contentLength;
    const contentType = meta.mimeType || 'audio/webm';

    if (!parsedRange) {
      if (request.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: createCorsHeaders({
            'Content-Type': contentType,
            'Content-Length': String(totalSize),
          }),
        });
      }
      const data = await fsp.readFile(filePath);
      return new Response(data, {
        status: 200,
        headers: createCorsHeaders({
          'Content-Type': contentType,
          'Content-Length': String(totalSize),
        }),
      });
    }

    let start = parsedRange.start;
    let end = parsedRange.end;

    if (start < 0) {
      const suffixLen = -start;
      start = Math.max(0, totalSize - suffixLen);
      end = totalSize - 1;
    } else if (end === null || end >= totalSize) {
      end = totalSize - 1;
    }

    if (start >= totalSize || start > end) {
      return new Response('Requested Range Not Satisfiable', {
        status: 416,
        headers: createCorsHeaders({
          'Content-Range': `bytes */${totalSize}`,
        }),
      });
    }

    const sliceLength = end - start + 1;
    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 206,
        headers: createCorsHeaders({
          'Content-Type': contentType,
          'Content-Length': String(sliceLength),
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        }),
      });
    }

    const slice = await readFileSlice(filePath, start, end);
    return new Response(slice, {
      status: 206,
      headers: createCorsHeaders({
        'Content-Type': contentType,
        'Content-Length': String(slice.byteLength),
        'Content-Range': `bytes ${start}-${start + slice.byteLength - 1}/${totalSize}`,
      }),
    });
  }

  // Case 2: Active progressive SABR / yt-dlp download
  const { job } = state;

  if (!parsedRange) {
    await job.completionPromise;
    if (job.error || !job.done) {
      return new Response(job.error?.message || 'Stream failed', {
        status: 500,
        headers: createCorsHeaders({ 'Content-Type': 'text/plain' }),
      });
    }
    const contentType = job.mimeType || 'audio/webm';
    const data = await fsp.readFile(job.finalPath);
    return new Response(data, {
      status: 200,
      headers: createCorsHeaders({
        'Content-Type': contentType,
        'Content-Length': String(data.byteLength),
      }),
    });
  }

  if (parsedRange.start < 0) {
    await job.completionPromise;
    if (job.error || !job.done) {
      return new Response(job.error?.message || 'Stream failed', {
        status: 500,
        headers: createCorsHeaders({ 'Content-Type': 'text/plain' }),
      });
    }
    const contentType = job.mimeType || 'audio/webm';
    const totalSize = job.finalSize;
    const start = Math.max(0, totalSize + parsedRange.start);
    const end = totalSize - 1;
    const slice = await readFileSlice(job.finalPath, start, end);
    return new Response(slice, {
      status: 206,
      headers: createCorsHeaders({
        'Content-Type': contentType,
        'Content-Length': String(slice.byteLength),
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
      }),
    });
  }

  const start = parsedRange.start;
  const requestedEnd = parsedRange.end;
  const targetEnd =
    requestedEnd !== null ? requestedEnd : start + DEFAULT_OPEN_RANGE_CHUNK - 1;

  while (!job.done && !job.error && !job.aborted && job.bytesWritten <= targetEnd) {
    if (requestedEnd === null && job.bytesWritten >= start + 64 * 1024) {
      break;
    }
    try {
      await waitForJobProgress(job, RANGE_WAIT_TIMEOUT_MS);
    } catch {
      break;
    }
  }

  const contentType = job.mimeType || 'audio/webm';

  if (job.error && job.bytesWritten <= start) {
    return new Response(job.error.message, {
      status: 502,
      headers: createCorsHeaders({ 'Content-Type': 'text/plain' }),
    });
  }

  const availableBytes = job.done ? job.finalSize : job.bytesWritten;
  if (start >= availableBytes) {
    return new Response('Requested Range Not Satisfiable', {
      status: 416,
      headers: createCorsHeaders({
        'Content-Range': `bytes */${availableBytes}`,
      }),
    });
  }

  const actualEnd = Math.min(targetEnd, availableBytes - 1);
  const reportedTotal = job.done
    ? job.finalSize
    : Math.max(job.estimatedSize, availableBytes, actualEnd + 1);

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 206,
      headers: createCorsHeaders({
        'Content-Type': contentType,
        'Content-Length': String(actualEnd - start + 1),
        'Content-Range': `bytes ${start}-${actualEnd}/${reportedTotal}`,
      }),
    });
  }

  let slice: Uint8Array;
  try {
    const readPath = job.done ? job.finalPath : job.partPath;
    slice = await readFileSlice(readPath, start, actualEnd);
  } catch {
    slice = await readFileSlice(job.finalPath, start, actualEnd);
  }

  return new Response(slice, {
    status: 206,
    headers: createCorsHeaders({
      'Content-Type': contentType,
      'Content-Length': String(slice.byteLength),
      'Content-Range': `bytes ${start}-${start + slice.byteLength - 1}/${reportedTotal}`,
    }),
  });
}

export async function destroyAllSabrStreams(): Promise<void> {
  const jobs = Array.from(activeJobs.values());
  activeJobs.clear();

  await Promise.all(
    jobs.map(async (job) => {
      job.aborted = true;
      notifyWaiters(job);
      if (job.sabrStream) {
        await job.sabrStream.abort().catch(() => {});
      }
      if (job.childProcess) {
        try {
          job.childProcess.kill('SIGTERM');
        } catch {
          // Ignore kill errors
        }
      }
      if (job.fileHandle) {
        await job.fileHandle.close().catch(() => {});
        job.fileHandle = null;
      }
      await fsp.unlink(job.partPath).catch(() => {});
    })
  );
}
