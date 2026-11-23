// electron/youtubeSabrStream.ts
// Pure-Node YouTube SABR progressive audio downloader + HTTP Range protocol responder
// Uses googlevideo SabrStream (ANDROID_VR / IOS / VISIONOS) with seamless yt-dlp continuation/fallback

import crypto from 'node:crypto';
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
  startMs: number;
  actualStartMs: number | null;
  reportedTotal: number;
  knownTotalSize: number | null;
  isSeekJob: boolean;
  abortController: AbortController | null;
  containerGen?: number;
}

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const MAX_CACHE_BYTES = 512 * 1024 * 1024; // 512 MB
const PRIME_MIN_BYTES = 32 * 1024; // 32 KB
const VISITOR_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_OPEN_RANGE_CHUNK = 256 * 1024; // 256 KB chunk size for live open-ended stream reads
export const SABR_STALL_HANDOFF_MS = 22_000; // Exceeds googlevideo stallDetectionMs (18_000ms) so built-in recovery runs first
const RANGE_WAIT_TIMEOUT_MS = 60_000;
const MAX_SABR_PUMP_ATTEMPTS = 3;
const MAX_EMPTY_CHUNKS_BEFORE_RETRY = 8;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as any)?.unref?.();
  });
}

export interface SabrStreamAuthOptions {
  cookie?: string;
  poToken?: string;
  reloadPlaybackParams?: unknown;
}

const PLAYER_CLIENTS: PlayerClientProfile[] = [
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
];

let cachedVisitorData: { value: string; fetchedAt: number } | null = null;
const activeJobs = new Map<string, ActiveStreamJob>();
const activeSeekJobs = new Map<string, ActiveStreamJob>();
const activeProxyJobs = new Map<string, ActiveStreamJob>();
const activeSeekSeq = new Map<string, number>();
const completedProxyMimes = new Map<string, string>();
let seekFileCounter = 0;

const WEBM_CLUSTER_ID = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);

function readEbmlVint(
  buf: Uint8Array,
  offset: number
): { value: number; length: number; isUnknown: boolean } | null {
  if (offset >= buf.length) return null;
  const first = buf[offset];
  if (first === 0) return null;

  let len = 1;
  while (len <= 8 && (first & (0x80 >> (len - 1))) === 0) {
    len++;
  }
  if (len > 8 || offset + len > buf.length) return null;

  const mask = (1 << (8 - len)) - 1;
  let value = first & mask;
  let allOnes = value === mask;

  for (let i = 1; i < len; i++) {
    const b = buf[offset + i];
    value = value * 256 + b;
    if (b !== 0xff) allOnes = false;
  }

  return { value, length: len, isUnknown: allOnes };
}

function tryReadClusterTimecodeAt(buf: Uint8Array, clusterPos: number): number | null {
  if (clusterPos + 5 > buf.length) return null;
  const clusterSize = readEbmlVint(buf, clusterPos + 4);
  if (!clusterSize) return null;

  let cursor = clusterPos + 4 + clusterSize.length;
  const maxScanEnd = clusterSize.isUnknown
    ? Math.min(buf.length, cursor + 128)
    : Math.min(buf.length, cursor + Math.min(clusterSize.value, 128));

  for (let elem = 0; elem < 8 && cursor < maxScanEnd; elem++) {
    const b0 = buf[cursor];
    let idLen = 1;
    while (idLen <= 4 && (b0 & (0x80 >> (idLen - 1))) === 0) {
      idLen++;
    }
    if (idLen > 4 || cursor + idLen >= maxScanEnd) break;

    const elemSize = readEbmlVint(buf, cursor + idLen);
    if (!elemSize || elemSize.isUnknown) break;

    const dataStart = cursor + idLen + elemSize.length;
    if (idLen === 1 && b0 === 0xe7) {
      if (elemSize.value > 8 || dataStart + elemSize.value > buf.length) return null;
      let timecodeMs = 0;
      for (let i = 0; i < elemSize.value; i++) {
        timecodeMs = timecodeMs * 256 + buf[dataStart + i];
      }
      return timecodeMs;
    }

    // SimpleBlock (0xA3) / BlockGroup (0xA0) follow Timecode in Matroska Clusters
    if (idLen === 1 && (b0 === 0xa3 || b0 === 0xa0)) break;
    cursor = dataStart + elemSize.value;
  }

  return null;
}

export function parseFirstWebmClusterTimecodeMs(buf: Uint8Array): number | null {
  if (!buf || buf.byteLength < 8) return null;
  const view = Buffer.isBuffer(buf)
    ? buf
    : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);

  let pos = view.indexOf(WEBM_CLUSTER_ID, 0);
  while (pos !== -1) {
    const tc = tryReadClusterTimecodeAt(view, pos);
    if (tc !== null) return tc;
    pos = view.indexOf(WEBM_CLUSTER_ID, pos + 1);
  }
  return null;
}

function getLastWebmClusterTimecodeMs(buf: Uint8Array): number | null {
  if (!buf || buf.byteLength < 8) return null;
  const view = Buffer.isBuffer(buf)
    ? buf
    : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);

  let lastTc: number | null = null;
  let pos = view.indexOf(WEBM_CLUSTER_ID, 0);
  while (pos !== -1) {
    const tc = tryReadClusterTimecodeAt(view, pos);
    if (tc !== null) lastTc = tc;
    pos = view.indexOf(WEBM_CLUSTER_ID, pos + 1);
  }
  return lastTc;
}

function stripWebmPrefixUpToTimecode(
  chunk: Buffer,
  minTimecodeExclusiveMs: number
): Buffer | null {
  if (!chunk || chunk.length === 0) return null;
  let pos = chunk.indexOf(WEBM_CLUSTER_ID, 0);
  while (pos !== -1) {
    const tc = tryReadClusterTimecodeAt(chunk, pos);
    if (tc !== null && tc > minTimecodeExclusiveMs) {
      return pos === 0 ? chunk : chunk.subarray(pos);
    }
    pos = chunk.indexOf(WEBM_CLUSTER_ID, pos + 1);
  }
  return null;
}

export async function findWebmClusterSeekSlice(
  filePath: string,
  targetMs: number
): Promise<{
  initBytes: Uint8Array;
  clusterOffset: number;
  actualStartMs: number;
  totalLength: number;
} | null> {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile() || stat.size < 8) return null;

    const CHUNK_SIZE = 256 * 1024;
    const OVERLAP = 64;
    const fh = await fsp.open(filePath, 'r');

    let firstClusterOffset: number | null = null;
    let chosen: { offset: number; timecodeMs: number } | null = null;

    try {
      const readBuf = Buffer.alloc(CHUNK_SIZE);
      let carry: Buffer = Buffer.alloc(0);
      let fileOffset = 0;
      let nextFileSearchOffset = 0;

      while (fileOffset < stat.size) {
        const { bytesRead } = await fh.read(readBuf, 0, CHUNK_SIZE, fileOffset);
        if (bytesRead === 0) break;

        const isLastChunk = fileOffset + bytesRead >= stat.size;
        const chunk = readBuf.subarray(0, bytesRead);
        const windowBuf = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
        const windowStartOffset = fileOffset - carry.length;

        let localSearchStart = Math.max(0, nextFileSearchOffset - windowStartOffset);
        while (localSearchStart < windowBuf.length) {
          const pos = windowBuf.indexOf(WEBM_CLUSTER_ID, localSearchStart);
          if (pos === -1) break;

          // Defer Cluster headers near the end of a non-final chunk until the next chunk supplies full Timecode bytes
          if (!isLastChunk && pos > windowBuf.length - OVERLAP) {
            nextFileSearchOffset = windowStartOffset + pos;
            break;
          }

          const tc = tryReadClusterTimecodeAt(windowBuf, pos);
          const absOffset = windowStartOffset + pos;
          if (tc !== null) {
            if (firstClusterOffset === null) {
              firstClusterOffset = absOffset;
              chosen = { offset: absOffset, timecodeMs: tc };
            } else if (tc <= targetMs) {
              chosen = { offset: absOffset, timecodeMs: tc };
            }
            nextFileSearchOffset = absOffset + 4;
            localSearchStart = pos + 4;
          } else {
            nextFileSearchOffset = absOffset + 1;
            localSearchStart = pos + 1;
          }
        }

        const windowEndOffset = fileOffset + bytesRead;
        if (windowEndOffset > nextFileSearchOffset && localSearchStart >= windowBuf.length) {
          nextFileSearchOffset = Math.max(nextFileSearchOffset, windowEndOffset - 3);
        }

        const carryLen = Math.min(OVERLAP, windowBuf.length);
        carry = Buffer.from(windowBuf.subarray(windowBuf.length - carryLen));
        fileOffset += bytesRead;
      }
    } finally {
      await fh.close();
    }

    if (firstClusterOffset === null || !chosen) {
      return null;
    }

    const initBytes =
      firstClusterOffset > 0
        ? await readFileSlice(filePath, 0, firstClusterOffset - 1)
        : new Uint8Array(0);
    const totalLength = initBytes.byteLength + (stat.size - chosen.offset);

    return {
      initBytes,
      clusterOffset: chosen.offset,
      actualStartMs: chosen.timecodeMs,
      totalLength,
    };
  } catch {
    return null;
  }
}

async function readVirtualSeekSlice(
  filePath: string,
  sliceInfo: { initBytes: Uint8Array; clusterOffset: number },
  start: number,
  end: number
): Promise<Uint8Array> {
  const initLen = sliceInfo.initBytes.byteLength;
  if (end < initLen) {
    return sliceInfo.initBytes.subarray(start, end + 1);
  }
  if (start >= initLen) {
    return readFileSlice(
      filePath,
      sliceInfo.clusterOffset + (start - initLen),
      sliceInfo.clusterOffset + (end - initLen)
    );
  }
  const part1 = sliceInfo.initBytes.subarray(start);
  const part2 = await readFileSlice(
    filePath,
    sliceInfo.clusterOffset,
    sliceInfo.clusterOffset + (end - initLen)
  );
  return Buffer.concat([part1, part2]);
}

async function abortAndCleanupJob(job: ActiveStreamJob): Promise<void> {
  job.aborted = true;
  notifyWaiters(job);
  if (job.abortController) {
    try {
      job.abortController.abort();
    } catch {
      // Ignore abort errors
    }
    job.abortController = null;
  }
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
}

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
    timer.unref?.();

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
  visitorData?: string,
  startIndex = 0,
  options?: SabrStreamAuthOptions
): Promise<PlayerMetadata> {
  let lastError = 'No player client returned SABR streaming metadata';
  let activeVisitorData = visitorData;
  const count = PLAYER_CLIENTS.length;
  const maxPasses = 2;

  for (let pass = 0; pass < maxPasses; pass++) {
    let sawTransientHttpOrNet = false;

    for (let i = 0; i < count; i++) {
      const profile = PLAYER_CLIENTS[(startIndex + i) % count];
      for (let retry = 0; retry < 2; retry++) {
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
          if (activeVisitorData) {
            clientContext.visitorData = activeVisitorData;
          }

          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'User-Agent': profile.userAgent,
            'X-YouTube-Client-Name': String(profile.clientNameNum),
            'X-YouTube-Client-Version': profile.clientVersion,
            Origin: 'https://www.youtube.com',
            Referer: 'https://www.youtube.com/',
          };
          if (activeVisitorData) {
            headers['X-Goog-Visitor-Id'] = activeVisitorData;
          }
          if (options?.cookie) {
            headers['Cookie'] = options.cookie;
          }

          const payload: Record<string, unknown> = {
            context: {
              client: clientContext,
              user: { lockedSafetyMode: false },
              request: { useSsl: true },
            },
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
          };
          if (options?.reloadPlaybackParams) {
            payload.playbackContext = {
              reloadPlaybackContext: {
                reloadPlaybackParams: options.reloadPlaybackParams,
              },
            };
          }
          if (options?.poToken) {
            payload.serviceIntegrityDimensions = {
              poToken: options.poToken,
            };
          }

          const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          });

          if (res.status === 403 || res.status === 429) {
            sawTransientHttpOrNet = true;
            lastError = `${profile.name} (${profile.clientVersion}) HTTP ${res.status}`;
            if (retry === 0) {
              await sleepMs(res.status === 429 ? 1200 : 400);
              if (res.status === 403) {
                activeVisitorData = (await fetchFreshVisitorData(true)) || activeVisitorData;
              }
              continue;
            }
            break;
          }

          if (!res.ok) {
            lastError = `${profile.name} (${profile.clientVersion}) HTTP ${res.status}`;
            break;
          }

          const data = (await res.json()) as any;
          if (data?.playabilityStatus?.status !== 'OK') {
            lastError = `${profile.name} playabilityStatus=${data?.playabilityStatus?.status || 'UNKNOWN'}: ${data?.playabilityStatus?.reason || ''}`;
            break;
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
          break;
        } catch (err) {
          sawTransientHttpOrNet = true;
          lastError = `${profile.name} error: ${err instanceof Error ? err.message : String(err)}`;
          if (retry === 0) {
            await sleepMs(400);
            continue;
          }
          break;
        }
      }
    }

    if (!sawTransientHttpOrNet || pass + 1 >= maxPasses) {
      break;
    }
    await sleepMs(500 * (pass + 1));
    activeVisitorData = (await fetchFreshVisitorData(true)) || activeVisitorData;
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
 * Only used when bytesWritten === 0 (direct fallback) or for standalone full-file cache rebuilds;
 * NEVER swaps job.partPath while an active live cursor is reading WebM bytes.
 */
async function downloadWithYtDlpIntoJob(job: ActiveStreamJob, streamDirectlyToPart: boolean): Promise<void> {
  if (streamDirectlyToPart && job.bytesWritten > 0) {
    throw new Error(`Refusing unsafe mid-stream yt-dlp container splice for ${job.videoId}`);
  }
  const binary = findYtDlpBinary();
  const targetPartPath = streamDirectlyToPart
    ? job.partPath
    : path.join(job.cacheDir, `${job.videoId}.${job.ext}.ytdlp.part`);

  const preferredAudioOnlySelector =
    job.ext === 'm4a'
      ? 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio'
      : 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio';

  const clientAttempts: Array<{ extractorArgs: string | null; formatSelector: string }> = [
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
        // Bump containerGen so any active live cursor that already read SABR bytes from job.partPath
        // fails with controller.error instead of splicing rebuilt yt-dlp container bytes mid-stream.
        job.containerGen = (job.containerGen ?? 0) + 1;
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
    estimatedSize: 5 * 1024 * 1024,
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
    startMs: 0,
    actualStartMs: 0,
    reportedTotal: 5 * 1024 * 1024,
    knownTotalSize: null,
    isSeekJob: false,
    abortController: null,
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

async function startSabrJob(
  videoId: string,
  cacheDir: string,
  options?: SabrStreamAuthOptions,
  startMs = 0
): Promise<ActiveStreamJob> {
  await fsp.mkdir(cacheDir, { recursive: true });
  const visitorData = await fetchFreshVisitorData();
  const initialMetadata = await fetchPlayerMetadata(videoId, visitorData, 0, options);

  const initialSabrFormats = initialMetadata.adaptiveFormats.map((f) => buildSabrFormat(f));
  const chosenFormat = selectBestAudioFormat(initialSabrFormats);
  if (!chosenFormat) {
    throw new Error(`No audio-only SABR format available for ${videoId}`);
  }

  const isSeekJob = startMs > 0;
  const { mimeType, ext } = normalizeAudioMimeAndExt(chosenFormat.mimeType);
  const partPath = isSeekJob
    ? path.join(cacheDir, `${videoId}.seek-${startMs}-${++seekFileCounter}.${ext}.part`)
    : path.join(cacheDir, `${videoId}.${ext}.part`);
  const finalPath = isSeekJob ? partPath : path.join(cacheDir, `${videoId}.${ext}`);
  const metaPath = path.join(cacheDir, `${videoId}.json`);
  const resolvedPoToken = options?.poToken || process.env.WAVEFORM_YOUTUBE_POTOKEN || undefined;

  const durationSec =
    initialMetadata.durationSec ||
    (chosenFormat.approxDurationMs ? Math.round(chosenFormat.approxDurationMs / 1000) : 0);
  const bitrateBps = chosenFormat.averageBitrate || chosenFormat.bitrate || 160_000;
  const computedEstimatedSize =
    durationSec > 0 ? Math.round((bitrateBps / 8) * durationSec * 1.04) : 4 * 1024 * 1024;
  const baseEstimatedSize =
    chosenFormat.contentLength && chosenFormat.contentLength > 0
      ? chosenFormat.contentLength
      : computedEstimatedSize;
  const estimatedSize =
    isSeekJob && durationSec > 0
      ? Math.max(
          256 * 1024,
          Math.round(baseEstimatedSize * Math.max(0.08, (durationSec - startMs / 1000) / durationSec))
        )
      : baseEstimatedSize;

  const job: ActiveStreamJob = {
    videoId,
    cacheDir,
    partPath,
    finalPath,
    metaPath,
    ext,
    mimeType,
    itag: chosenFormat.itag,
    durationSec,
    sourceClient: initialMetadata.clientProfile.name,
    estimatedSize,
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
    startMs,
    actualStartMs: isSeekJob ? null : 0,
    reportedTotal: estimatedSize,
    knownTotalSize: null,
    isSeekJob,
    abortController: null,
  };

  const jobKey = getJobKey(cacheDir, videoId);
  const jobMap = isSeekJob ? activeSeekJobs : activeJobs;
  jobMap.set(jobKey, job);

  const openSabrAttempt = (
    meta: PlayerMetadata,
    formats: SabrFormat[],
    targetFormat: SabrFormat,
    resumeTimeMs: number,
    clientIndexOffset: number
  ) => {
    const clientInfo: ClientInfo = {
      clientName: meta.clientProfile.clientNameNum,
      clientVersion: meta.clientProfile.clientVersion,
      osName: meta.clientProfile.osName,
      osVersion: meta.clientProfile.osVersion,
      deviceMake: meta.clientProfile.deviceMake,
      deviceModel: meta.clientProfile.deviceModel,
      hl: 'en',
    };

    let reloadAttempt = clientIndexOffset;
    const stream = new SabrStream({
      videoId,
      serverAbrStreamingUrl: meta.serverAbrStreamingUrl,
      videoPlaybackUstreamerConfig: meta.videoPlaybackUstreamerConfig,
      clientInfo,
      ...(resolvedPoToken ? { poToken: resolvedPoToken } : {}),
      formats,
      callbacks: {
        onReloadPlayerResponse: async (reloadContext) => {
          reloadAttempt += 1;
          const refreshedVisitor = await fetchFreshVisitorData(true);
          const refreshed = await fetchPlayerMetadata(videoId, refreshedVisitor, reloadAttempt, {
            ...options,
            poToken: resolvedPoToken,
            reloadPlaybackParams: reloadContext?.reloadPlaybackParams,
          });
          return {
            serverAbrStreamingUrl: refreshed.serverAbrStreamingUrl,
            videoPlaybackUstreamerConfig: refreshed.videoPlaybackUstreamerConfig,
          };
        },
      },
    });

    if (resumeTimeMs > 0) {
      // googlevideo's setupStreaming calls seekTo(trackCollection.buffered, 'client') after the init-only
      // first response, which resets playerTimeMs back to 0 before the first media segment arrives.
      const sabrAny = stream as any;
      const origSeekTo = typeof sabrAny.seekTo === 'function' ? sabrAny.seekTo.bind(stream) : null;
      if (origSeekTo) {
        sabrAny.seekTo = (timeMs: number, source: string) => {
          if (
            timeMs === 0 &&
            source === 'client' &&
            (!sabrAny.trackCollection?.bufferedRanges || sabrAny.trackCollection.bufferedRanges.length === 0)
          ) {
            return;
          }
          return origSeekTo(timeMs, source);
        };
      }
    }

    const started = stream.start({
      enabledTrackTypes: EnabledTrackTypes.AUDIO_ONLY,
      isPostLiveDvr: false,
      audioFormat: targetFormat,
      ...(resumeTimeMs > 0 ? { startTimeMs: resumeTimeMs } : {}),
      maxRetries: 6,
      stallDetectionMs: 18_000,
    });

    return { stream, audioStream: started.audioStream, selectedFormats: started.selectedFormats };
  };

  job.completionPromise = (async () => {
    let fh: fsp.FileHandle | null = null;
    let lastError: Error | null = null;
    let maxWrittenClusterTcMs = -1;
    let sabrBufferedEndMs = startMs;
    let streamReachedInfinity = false;
    let sabrSucceeded = false;
    let sabrCanPersistCache = false;
    let currentMeta = initialMetadata;
    let currentFormats = initialSabrFormats;
    let currentTargetFormat = chosenFormat;

    try {
      fh = await fsp.open(partPath, 'w');
      job.fileHandle = fh;

      for (let attempt = 1; attempt <= MAX_SABR_PUMP_ATTEMPTS; attempt++) {
        if (job.aborted) {
          throw new Error('SABR stream aborted');
        }

        if (attempt > 1) {
          const prevErrMsg = lastError?.message || '';
          const backoffMs = prevErrMsg.includes('429') ? 1200 : 400 * (attempt - 1);
          await sleepMs(backoffMs);
          if (job.aborted) {
            throw new Error('SABR stream aborted');
          }

          const refreshedVisitor = await fetchFreshVisitorData(true);
          const clientIdx = (attempt - 1) % PLAYER_CLIENTS.length;
          currentMeta = await fetchPlayerMetadata(videoId, refreshedVisitor, clientIdx, options);
          currentFormats = currentMeta.adaptiveFormats.map((f) => buildSabrFormat(f));
          const sameItagFormat = currentFormats.find((f) => f.itag === job.itag);
          if (job.bytesWritten > 0 && !sameItagFormat) {
            lastError = new Error(
              `Rotated client ${currentMeta.clientProfile.name} lacks matching itag=${job.itag} for mid-stream resume`
            );
            continue;
          }
          currentTargetFormat = sameItagFormat || selectBestAudioFormat(currentFormats) || currentTargetFormat;
          job.sourceClient = currentMeta.clientProfile.name;
        }

        const resumeTimeMs =
          job.bytesWritten > 0
            ? maxWrittenClusterTcMs >= 0
              ? maxWrittenClusterTcMs + 5_000
              : Math.max(startMs, Math.floor(sabrBufferedEndMs))
            : startMs;
        const { stream: activeSabrStream, audioStream, selectedFormats } = openSabrAttempt(
          currentMeta,
          currentFormats,
          currentTargetFormat,
          resumeTimeMs,
          attempt - 1
        );
        job.sabrStream = activeSabrStream;

        const actualFormat = selectedFormats.audioFormat || currentTargetFormat;
        if (attempt === 1) {
          job.itag = actualFormat.itag;
          if (actualFormat.contentLength && actualFormat.contentLength > 0 && !isSeekJob) {
            job.estimatedSize = actualFormat.contentLength;
            job.reportedTotal = Math.max(job.reportedTotal, actualFormat.contentLength);
          }
        }

        let sabrErrored: Error | null = null;
        activeSabrStream.on('error', (err) => {
          sabrErrored = err instanceof Error ? err : new Error(String(err));
        });

        const reader = audioStream.getReader();
        let attemptTimedOut = false;
        let emptyChunkError: Error | null = null;
        let consecutiveEmptyChunks = 0;
        let strippedInitThisAttempt = job.bytesWritten === 0 || attempt === 1;

        try {
          while (true) {
            if (job.aborted) break;

            const stallTimeoutMs =
              job.bytesWritten >= PRIME_MIN_BYTES
                ? SABR_STALL_HANDOFF_MS
                : isSeekJob
                ? 8_000
                : 18_000;
            let stallTimer: ReturnType<typeof setTimeout> | undefined;
            const readResult = await Promise.race([
              reader.read().then((res) => ({ timedOut: false as const, res })),
              new Promise<{ timedOut: true }>((resolve) => {
                stallTimer = setTimeout(() => resolve({ timedOut: true }), stallTimeoutMs);
              }),
            ]);
            if (stallTimer) clearTimeout(stallTimer);

            if (readResult.timedOut) {
              attemptTimedOut = true;
              break;
            }

            const { done, value } = readResult.res;
            if (done) break;
            if (!value || value.byteLength === 0) {
              consecutiveEmptyChunks += 1;
              if (consecutiveEmptyChunks >= MAX_EMPTY_CHUNKS_BEFORE_RETRY) {
                emptyChunkError = new Error(
                  `SABR stream produced ${consecutiveEmptyChunks} consecutive empty chunks for ${videoId}`
                );
                break;
              }
              continue;
            }

            consecutiveEmptyChunks = 0;
            const bufferedRaw = Number((activeSabrStream as any)?.trackCollection?.buffered);
            if (bufferedRaw === Infinity) {
              streamReachedInfinity = true;
            } else if (Number.isFinite(bufferedRaw) && bufferedRaw > sabrBufferedEndMs) {
              sabrBufferedEndMs = bufferedRaw;
            }

            let writeBuf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
            if (!strippedInitThisAttempt) {
              if (job.ext === 'webm') {
                const stripped = stripWebmPrefixUpToTimecode(writeBuf, maxWrittenClusterTcMs);
                if (!stripped || stripped.byteLength === 0) {
                  continue;
                }
                writeBuf = stripped;
                strippedInitThisAttempt = true;
              } else {
                // Non-WebM mid-stream cannot safely strip init headers without muxed offset rewrite
                emptyChunkError = new Error(`Non-WebM mid-stream resume unsupported for ${videoId}`);
                break;
              }
            }

            if (job.ext === 'webm') {
              const lastTc = getLastWebmClusterTimecodeMs(writeBuf);
              if (lastTc !== null && lastTc > maxWrittenClusterTcMs) {
                maxWrittenClusterTcMs = lastTc;
              }
            }

            await fh.write(writeBuf, 0, writeBuf.length, job.bytesWritten);
            job.bytesWritten += writeBuf.length;
            notifyWaiters(job);
          }
        } catch (readErr) {
          sabrErrored = readErr instanceof Error ? readErr : new Error(String(readErr));
        } finally {
          const finalBufferedRaw = Number((activeSabrStream as any)?.trackCollection?.buffered);
          if (finalBufferedRaw === Infinity) {
            streamReachedInfinity = true;
          } else if (Number.isFinite(finalBufferedRaw) && finalBufferedRaw > sabrBufferedEndMs) {
            sabrBufferedEndMs = finalBufferedRaw;
          }
          await reader.cancel().catch(() => {});
          try {
            reader.releaseLock();
          } catch {
            // Ignore release lock errors
          }
          await activeSabrStream.abort().catch(() => {});
          if (job.sabrStream === activeSabrStream) {
            job.sabrStream = null;
          }
        }

        if (job.aborted) {
          throw new Error('SABR stream aborted');
        }

        const actualWrittenSec =
          maxWrittenClusterTcMs >= 0
            ? (maxWrittenClusterTcMs + 10_000) / 1000
            : sabrBufferedEndMs / 1000;
        const hasExactContentLength = Boolean(actualFormat.contentLength && actualFormat.contentLength > 0);
        const durationReachedEof =
          streamReachedInfinity ||
          (job.durationSec > 0 && actualWrittenSec >= job.durationSec - 8);
        const sizeReachedEof = job.estimatedSize <= 0 || job.bytesWritten >= job.estimatedSize * 0.92;
        const cacheRatioOk = hasExactContentLength
          ? job.bytesWritten >= job.estimatedSize * 0.9
          : durationReachedEof || job.estimatedSize <= 0 || job.bytesWritten >= job.estimatedSize * 0.9;
        const reachedTrueEof =
          !attemptTimedOut &&
          !emptyChunkError &&
          !sabrErrored &&
          job.bytesWritten > 0 &&
          (durationReachedEof || sizeReachedEof) &&
          (isSeekJob || cacheRatioOk);

        if (reachedTrueEof) {
          sabrSucceeded = true;
          sabrCanPersistCache = cacheRatioOk;
          break;
        }

        lastError =
          sabrErrored ||
          emptyChunkError ||
          (attemptTimedOut
            ? new Error(`SABR segment fetch timed out for ${videoId} at ${job.bytesWritten} bytes`)
            : new Error(
                `SABR stream ended prematurely for ${videoId} at ${job.bytesWritten}/${job.estimatedSize} bytes`
              ));
      }

      if (!sabrSucceeded) {
        if (!isSeekJob && !job.aborted) {
          await fh.close().catch(() => {});
          fh = null;
          job.fileHandle = null;
          await downloadWithYtDlpIntoJob(job, job.bytesWritten === 0);
          return;
        }
        throw (
          lastError ||
          new Error(`SABR stream failed after ${MAX_SABR_PUMP_ATTEMPTS} attempts for ${videoId}`)
        );
      }

      await fh.close();
      fh = null;
      job.fileHandle = null;

      if (isSeekJob) {
        // Seek sessions stay in their own temp file and never overwrite 0..EOF cache
        job.finalPath = partPath;
        job.finalSize = job.bytesWritten;
        job.done = true;
        notifyWaiters(job);
        return;
      }

      // Never persist truncated < 90% .webm files to permanent cache
      if (!sabrCanPersistCache) {
        throw new Error(
          `Refusing to cache truncated SABR stream for ${videoId}: ${job.bytesWritten} < 90% of ${job.estimatedSize}`
        );
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
      if (fh) {
        await fh.close().catch(() => {});
        job.fileHandle = null;
      }
      await fsp.unlink(partPath).catch(() => {});
      job.error = err instanceof Error ? err : new Error(String(err));
      if (isSeekJob && activeSeekJobs.get(jobKey) === job) {
        activeSeekJobs.delete(jobKey);
      }
      notifyWaiters(job);
    } finally {
      job.sabrStream = null;
      if (!isSeekJob && activeJobs.get(jobKey) === job) {
        activeJobs.delete(jobKey);
      }
    }
  })();

  return job;
}

async function primeJob(job: ActiveStreamJob): Promise<void> {
  const waitMs = job.isSeekJob ? 5_500 : 25_000;
  while (!job.done && !job.error && !job.aborted && job.bytesWritten < PRIME_MIN_BYTES) {
    await waitForJobProgress(job, waitMs);
  }
  if (job.error && job.bytesWritten < PRIME_MIN_BYTES) {
    throw job.error;
  }
  if (job.aborted) {
    throw new Error(`Stream priming aborted for ${job.videoId}`);
  }
  if (job.startMs > 0 && job.actualStartMs === null) {
    try {
      const avail = job.done ? job.finalSize : job.bytesWritten;
      if (avail > 0) {
        const readPath = job.done ? job.finalPath : job.partPath;
        const head = await readFileSlice(readPath, 0, Math.min(avail - 1, 65535));
        const parsedTc = parseFirstWebmClusterTimecodeMs(head);
        job.actualStartMs = parsedTc !== null ? parsedTc : job.startMs;
      } else {
        job.actualStartMs = job.startMs;
      }
    } catch {
      job.actualStartMs = job.startMs;
    }
  }
}

async function ensureSeekJob(
  videoId: string,
  cacheDir: string,
  startMs: number
): Promise<ActiveStreamJob> {
  const jobKey = getJobKey(cacheDir, videoId);
  const existing = activeSeekJobs.get(jobKey);
  if (existing && !existing.error && !existing.aborted && existing.startMs === startMs) {
    await primeJob(existing);
    if (!existing.error && !existing.aborted) {
      return existing;
    }
  }

  const seq = (activeSeekSeq.get(jobKey) || 0) + 1;
  activeSeekSeq.set(jobKey, seq);

  if (existing) {
    activeSeekJobs.delete(jobKey);
    await abortAndCleanupJob(existing);
  }

  const seekJob = await startSabrJob(videoId, cacheDir, undefined, startMs);
  if (activeSeekSeq.get(jobKey) !== seq) {
    if (activeSeekJobs.get(jobKey) === seekJob) {
      activeSeekJobs.delete(jobKey);
    }
    await abortAndCleanupJob(seekJob);
    const latest = activeSeekJobs.get(jobKey);
    if (latest && !latest.error && !latest.aborted) {
      await primeJob(latest);
      return latest;
    }
    throw new Error(`Seek request superseded for ${videoId}`);
  }

  await primeJob(seekJob);
  return seekJob;
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
    'Access-Control-Expose-Headers':
      'Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Waveform-Start-Ms',
    'Accept-Ranges': 'bytes',
    ...extra,
  });
}

function createStaticSliceStream(
  start: number,
  end: number,
  readSlice: (s: number, e: number) => Promise<Uint8Array>,
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  let cursor = start;
  let closed = Boolean(signal?.aborted);
  if (signal && !closed) {
    signal.addEventListener(
      'abort',
      () => {
        closed = true;
      },
      { once: true }
    );
  }
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (closed || cursor > end) {
        controller.close();
        return;
      }
      const chunkEnd = Math.min(end, cursor + DEFAULT_OPEN_RANGE_CHUNK - 1);
      const chunk = await readSlice(cursor, chunkEnd);
      if (closed) {
        controller.close();
        return;
      }
      if (chunk.byteLength === 0) {
        controller.close();
        return;
      }
      cursor += chunk.byteLength;
      controller.enqueue(chunk);
      if (cursor > end) {
        controller.close();
      }
    },
    cancel() {
      closed = true;
    },
  });
}

async function serveStaticRange(
  request: Request,
  totalSize: number,
  contentType: string,
  parsedRange: ParsedRange | null,
  readSlice: (start: number, end: number) => Promise<Uint8Array>,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  if (!parsedRange) {
    if (request.method === 'HEAD' || totalSize === 0) {
      return new Response(totalSize === 0 && request.method !== 'HEAD' ? new Uint8Array(0) : null, {
        status: 200,
        headers: createCorsHeaders({
          'Content-Type': contentType,
          'Content-Length': String(totalSize),
          ...extraHeaders,
        }),
      });
    }
    const body =
      totalSize <= 2 * 1024 * 1024
        ? await readSlice(0, totalSize - 1)
        : createStaticSliceStream(0, totalSize - 1, readSlice, request.signal);
    return new Response(body, {
      status: 200,
      headers: createCorsHeaders({
        'Content-Type': contentType,
        'Content-Length': String(totalSize),
        ...extraHeaders,
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
        ...extraHeaders,
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
        ...extraHeaders,
      }),
    });
  }

  if (sliceLength <= 2 * 1024 * 1024) {
    const slice = await readSlice(start, end);
    return new Response(slice, {
      status: 206,
      headers: createCorsHeaders({
        'Content-Type': contentType,
        'Content-Length': String(slice.byteLength),
        'Content-Range': `bytes ${start}-${start + slice.byteLength - 1}/${totalSize}`,
        ...extraHeaders,
      }),
    });
  }

  return new Response(createStaticSliceStream(start, end, readSlice, request.signal), {
    status: 206,
    headers: createCorsHeaders({
      'Content-Type': contentType,
      'Content-Length': String(sliceLength),
      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
      ...extraHeaders,
    }),
  });
}

function resolveJobReportedTotal(job: ActiveStreamJob, availableBytes: number): number {
  if (job.done) {
    return job.finalSize;
  }
  if (job.knownTotalSize !== null && job.knownTotalSize >= availableBytes) {
    return job.knownTotalSize;
  }
  job.reportedTotal = Math.max(
    job.reportedTotal || job.estimatedSize,
    availableBytes + 262144
  );
  return job.reportedTotal;
}

async function serveActiveJobRangeResponse(
  request: Request,
  job: ActiveStreamJob,
  parsedRange: ParsedRange | null,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  const contentType = job.mimeType || 'audio/webm';

  if (!parsedRange) {
    if (job.done) {
      return serveStaticRange(
        request,
        job.finalSize,
        contentType,
        null,
        (s, e) => readFileSlice(job.finalPath, s, e),
        extraHeaders
      );
    }
    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: createCorsHeaders({
          'Content-Type': contentType,
          ...(job.knownTotalSize !== null ? { 'Content-Length': String(job.knownTotalSize) } : {}),
          ...extraHeaders,
        }),
      });
    }
    return new Response(createLiveJobStream(job, 0, request.signal), {
      status: 200,
      headers: createCorsHeaders({
        'Content-Type': contentType,
        ...extraHeaders,
      }),
    });
  }

  if (parsedRange.start < 0) {
    await job.completionPromise;
    if (job.error || !job.done) {
      return new Response(job.error?.message || 'Stream failed', {
        status: 500,
        headers: createCorsHeaders({ 'Content-Type': 'text/plain', ...extraHeaders }),
      });
    }
    return serveStaticRange(
      request,
      job.finalSize,
      contentType,
      parsedRange,
      (s, e) => readFileSlice(job.finalPath, s, e),
      extraHeaders
    );
  }

  const start = parsedRange.start;
  const requestedEnd = parsedRange.end;

  // Open-ended range (e.g., Range: bytes=0- or Range: bytes=N-)
  if (requestedEnd === null) {
    while (!job.done && !job.error && !job.aborted && job.bytesWritten <= start) {
      try {
        await waitForJobProgress(job, RANGE_WAIT_TIMEOUT_MS);
      } catch {
        break;
      }
    }

    if (job.error && job.bytesWritten <= start) {
      return new Response(job.error.message, {
        status: 502,
        headers: createCorsHeaders({ 'Content-Type': 'text/plain', ...extraHeaders }),
      });
    }

    if (job.done) {
      return serveStaticRange(
        request,
        job.finalSize,
        contentType,
        parsedRange,
        (s, e) => readFileSlice(job.finalPath, s, e),
        extraHeaders
      );
    }

    const availableBytes = job.bytesWritten;
    const reportedTotal = resolveJobReportedTotal(job, availableBytes);
    if (job.knownTotalSize !== null && start >= reportedTotal) {
      return new Response('Requested Range Not Satisfiable', {
        status: 416,
        headers: createCorsHeaders({
          'Content-Range': `bytes */${reportedTotal}`,
          ...extraHeaders,
        }),
      });
    }

    const openRangeHeaders: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Range': `bytes ${start}-${reportedTotal - 1}/${reportedTotal}`,
      ...extraHeaders,
    };
    if (job.knownTotalSize !== null) {
      openRangeHeaders['Content-Length'] = String(Math.max(0, reportedTotal - start));
    }

    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 206,
        headers: createCorsHeaders(openRangeHeaders),
      });
    }

    return new Response(createLiveJobStream(job, start, request.signal), {
      status: 206,
      headers: createCorsHeaders(openRangeHeaders),
    });
  }

  // Bounded range (requestedEnd !== null)
  const targetEnd = requestedEnd;

  while (!job.done && !job.error && !job.aborted && job.bytesWritten <= targetEnd) {
    try {
      await waitForJobProgress(job, RANGE_WAIT_TIMEOUT_MS);
    } catch {
      break;
    }
  }

  if (job.error && job.bytesWritten <= start) {
    return new Response(job.error.message, {
      status: 502,
      headers: createCorsHeaders({ 'Content-Type': 'text/plain', ...extraHeaders }),
    });
  }

  const availableBytes = job.done ? job.finalSize : job.bytesWritten;
  if (start >= availableBytes) {
    return new Response('Requested Range Not Satisfiable', {
      status: 416,
      headers: createCorsHeaders({
        'Content-Range': `bytes */${availableBytes}`,
        ...extraHeaders,
      }),
    });
  }

  const actualEnd = Math.min(targetEnd, availableBytes - 1);
  const reportedTotal = resolveJobReportedTotal(job, availableBytes);

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 206,
      headers: createCorsHeaders({
        'Content-Type': contentType,
        'Content-Length': String(actualEnd - start + 1),
        'Content-Range': `bytes ${start}-${actualEnd}/${reportedTotal}`,
        ...extraHeaders,
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
      ...extraHeaders,
    }),
  });
}

export function createLiveJobStream(
  job: ActiveStreamJob,
  startOffset: number,
  signal?: AbortSignal,
  waitTimeoutMs = RANGE_WAIT_TIMEOUT_MS
): ReadableStream<Uint8Array> {
  let cursor = startOffset;
  let closed = false;
  let consecutiveTimeouts = 0;
  let activeWaiter: (() => void) | null = null;
  const initialContainerGen = job.containerGen ?? 0;
  let readFromPart = false;

  const cleanup = () => {
    closed = true;
    if (activeWaiter) {
      job.waiters.delete(activeWaiter);
      const w = activeWaiter;
      activeWaiter = null;
      w();
    }
  };

  if (signal) {
    if (signal.aborted) {
      closed = true;
    } else {
      signal.addEventListener('abort', cleanup, { once: true });
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (!closed) {
        if ((job.containerGen ?? 0) !== initialContainerGen && (readFromPart || startOffset > 0)) {
          cleanup();
          controller.error(
            new Error(`SABR stream container invalidated for ${job.videoId} after cache rebuild`)
          );
          return;
        }

        const available = job.done ? job.finalSize : job.bytesWritten;
        if (cursor < available) {
          const readEnd = Math.min(available - 1, cursor + DEFAULT_OPEN_RANGE_CHUNK - 1);
          const wasDone = job.done;
          if (!wasDone) readFromPart = true;
          let slice: Uint8Array;
          try {
            const readPath = wasDone ? job.finalPath : job.partPath;
            slice = await readFileSlice(readPath, cursor, readEnd);
          } catch {
            if ((job.containerGen ?? 0) !== initialContainerGen && (readFromPart || startOffset > 0)) {
              cleanup();
              controller.error(
                new Error(`SABR stream container invalidated for ${job.videoId} after cache rebuild`)
              );
              return;
            }
            slice = await readFileSlice(job.finalPath, cursor, readEnd);
          }
          if (closed) return;
          if (slice.byteLength > 0) {
            consecutiveTimeouts = 0;
            cursor += slice.byteLength;
            controller.enqueue(slice);
            if (job.done && cursor >= job.finalSize) {
              cleanup();
              controller.close();
            }
            return;
          }
        }

        if (job.done && cursor >= job.finalSize) {
          cleanup();
          controller.close();
          return;
        }

        const preWaitErr: unknown = job.error;
        if (preWaitErr || job.aborted) {
          cleanup();
          controller.error(
            preWaitErr instanceof Error
              ? preWaitErr
              : new Error(String(preWaitErr || 'SABR stream interrupted'))
          );
          return;
        }

        const waitTimedOut = await new Promise<boolean>((resolve) => {
          if (closed || job.done || job.error || job.aborted || job.bytesWritten > cursor) {
            resolve(false);
            return;
          }
          const timer = setTimeout(() => {
            if (activeWaiter === onProgress) {
              job.waiters.delete(onProgress);
              activeWaiter = null;
            }
            resolve(true);
          }, waitTimeoutMs);
          timer.unref?.();

          const onProgress = () => {
            clearTimeout(timer);
            if (activeWaiter === onProgress) {
              job.waiters.delete(onProgress);
              activeWaiter = null;
            }
            resolve(false);
          };
          activeWaiter = onProgress;
          job.waiters.add(onProgress);
        });

        if (closed) return;

        const postWaitErr: unknown = job.error;
        if (postWaitErr || job.aborted) {
          cleanup();
          controller.error(
            postWaitErr instanceof Error
              ? postWaitErr
              : new Error(String(postWaitErr || 'SABR stream interrupted'))
          );
          return;
        }

        if (waitTimedOut && job.bytesWritten <= cursor) {
          consecutiveTimeouts += 1;
          if (consecutiveTimeouts >= 2) {
            cleanup();
            controller.error(
              new Error(`SABR stream timed out with zero progress for ${job.videoId} at offset ${cursor}`)
            );
            return;
          }
        } else if (job.bytesWritten > cursor) {
          consecutiveTimeouts = 0;
        }
      }
    },
    cancel() {
      // Close ONLY this per-request stream reader; never abort the shared ActiveStreamJob
      cleanup();
    },
  });
}

function inferAudioMimeFromUrl(targetUrl: string): string {
  const lower = targetUrl.toLowerCase().split('?')[0];
  if (lower.endsWith('.flac')) return 'audio/flac';
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4') || lower.endsWith('.aac')) return 'audio/mp4';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.ogg') || lower.endsWith('.opus')) return 'audio/ogg';
  if (lower.endsWith('.webm')) return 'audio/webm';
  if (lower.endsWith('.wav')) return 'audio/wav';
  return 'audio/flac';
}

function startProxyCacheJob(
  proxyKey: string,
  cacheDir: string,
  partPath: string,
  finalPath: string,
  contentType: string,
  upstreamBody: ReadableStream<Uint8Array> | null,
  knownTotalSize: number | null,
  abortController: AbortController
): ActiveStreamJob {
  const estimatedSize = knownTotalSize && knownTotalSize > 0 ? knownTotalSize : 8 * 1024 * 1024;
  const job: ActiveStreamJob = {
    videoId: path.basename(finalPath, '.bin'),
    cacheDir,
    partPath,
    finalPath,
    metaPath: '',
    ext: 'bin',
    mimeType: contentType,
    itag: 0,
    durationSec: 0,
    sourceClient: 'proxy',
    estimatedSize,
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
    startMs: 0,
    actualStartMs: 0,
    reportedTotal: estimatedSize,
    knownTotalSize,
    isSeekJob: false,
    abortController,
  };

  activeProxyJobs.set(proxyKey, job);

  job.completionPromise = (async () => {
    let fh: fsp.FileHandle | null = null;
    const reader = upstreamBody ? upstreamBody.getReader() : null;
    try {
      await fsp.mkdir(cacheDir, { recursive: true });
      fh = await fsp.open(partPath, 'w');
      job.fileHandle = fh;

      if (reader) {
        while (true) {
          if (job.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || value.byteLength === 0) continue;
          const buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
          await fh.write(buf, 0, buf.length, job.bytesWritten);
          job.bytesWritten += buf.length;
          notifyWaiters(job);
        }
      }

      if (job.aborted) {
        throw new Error('Proxy download aborted');
      }

      await fh.close();
      fh = null;
      job.fileHandle = null;

      await finalizePartFile(partPath, finalPath);
      job.finalSize = job.bytesWritten;
      job.knownTotalSize = job.bytesWritten;
      job.done = true;
      completedProxyMimes.set(proxyKey, contentType);
      notifyWaiters(job);
    } catch (err) {
      if (reader) {
        await reader.cancel().catch(() => {});
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
        reader?.releaseLock();
      } catch {
        // Ignore release errors
      }
      job.abortController = null;
      if (activeProxyJobs.get(proxyKey) === job) {
        activeProxyJobs.delete(proxyKey);
      }
    }
  })();

  return job;
}

export async function resolveRemoteAudioProxyRequest(
  request: Request,
  cacheDir: string = getDefaultCacheDir()
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: createCorsHeaders() });
  }

  let targetUrl: string | null = null;
  try {
    const parsedUrl = new URL(request.url);
    targetUrl = parsedUrl.searchParams.get('url');
  } catch {
    return new Response('Invalid proxy request URL', {
      status: 400,
      headers: createCorsHeaders({ 'Content-Type': 'text/plain' }),
    });
  }

  if (!targetUrl) {
    return new Response('Missing target url parameter', {
      status: 400,
      headers: createCorsHeaders({ 'Content-Type': 'text/plain' }),
    });
  }

  let parsedTarget: URL;
  try {
    parsedTarget = new URL(targetUrl);
    if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
      throw new Error('Unsupported protocol');
    }
  } catch {
    return new Response('Invalid target audio URL', {
      status: 400,
      headers: createCorsHeaders({ 'Content-Type': 'text/plain' }),
    });
  }

  const rangeHeader = request.headers.get('range') || request.headers.get('Range');
  const parsedRange = parseRangeHeader(rangeHeader);
  const urlHash = crypto.createHash('sha1').update(parsedTarget.toString()).digest('hex');
  const proxyKey = `${path.resolve(cacheDir)}::${urlHash}`;
  const partPath = path.join(cacheDir, `proxy-${urlHash}.part`);
  const finalPath = path.join(cacheDir, `proxy-${urlHash}.bin`);

  if (parsedRange) {
    const existingJob = activeProxyJobs.get(proxyKey);
    if (existingJob && !existingJob.error && !existingJob.aborted) {
      return serveActiveJobRangeResponse(request, existingJob, parsedRange);
    }

    try {
      const stat = await fsp.stat(finalPath);
      if (stat.isFile() && stat.size > 0) {
        const mimeType =
          completedProxyMimes.get(proxyKey) || inferAudioMimeFromUrl(parsedTarget.toString());
        return serveStaticRange(
          request,
          stat.size,
          mimeType,
          parsedRange,
          (s, e) => readFileSlice(finalPath, s, e)
        );
      }
    } catch {
      // Cache miss; fetch upstream
    }
  }

  const upstreamHeaders: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    Accept: '*/*',
  };
  if (rangeHeader) {
    upstreamHeaders['Range'] = rangeHeader;
  }

  const jobAbortController = new AbortController();
  let promoteToBackgroundJob = false;
  const onReqAbort = () => {
    if (!promoteToBackgroundJob) {
      jobAbortController.abort();
    }
  };
  if (request.signal) {
    if (request.signal.aborted) {
      return new Response(null, { status: 499, headers: createCorsHeaders() });
    }
    request.signal.addEventListener('abort', onReqAbort, { once: true });
  }

  try {
    let upstreamRes: Response | null = null;
    let lastFetchErr: unknown = null;
    const maxProxyAttempts = 3;

    for (let attempt = 1; attempt <= maxProxyAttempts; attempt++) {
      try {
        const res = await fetch(parsedTarget.toString(), {
          method: request.method === 'HEAD' ? 'HEAD' : 'GET',
          headers: upstreamHeaders,
          signal: jobAbortController.signal,
          redirect: 'follow',
        });

        if (
          (res.status === 403 || res.status === 429 || res.status === 502 || res.status === 503) &&
          attempt < maxProxyAttempts &&
          !request.signal?.aborted
        ) {
          await res.body?.cancel().catch(() => {});
          const backoffMs = res.status === 429 ? 1200 : 400 * attempt;
          await sleepMs(backoffMs);
          if (request.signal?.aborted) {
            return new Response(null, { status: 499, headers: createCorsHeaders() });
          }
          continue;
        }

        upstreamRes = res;
        break;
      } catch (err) {
        lastFetchErr = err;
        if (request.signal?.aborted || attempt >= maxProxyAttempts) {
          throw err;
        }
        await sleepMs(400 * attempt);
      }
    }

    if (!upstreamRes) {
      throw lastFetchErr instanceof Error ? lastFetchErr : new Error('Upstream audio proxy fetch failed');
    }

    const rawContentType = upstreamRes.headers.get('content-type') || '';
    const contentType =
      rawContentType && !rawContentType.includes('application/octet-stream')
        ? rawContentType
        : inferAudioMimeFromUrl(parsedTarget.toString());

    const rawContentLength = upstreamRes.headers.get('content-length');
    const parsedUpstreamLength =
      rawContentLength !== null && /^\d+$/.test(rawContentLength.trim())
        ? parseInt(rawContentLength.trim(), 10)
        : null;

    // If client sent Range and upstream returned 200 OK (ignored Range), stream into
    // deduplicated disk cache and serve strict HTTP 206 Partial Content slices.
    if (parsedRange && upstreamRes.status === 200) {
      if (request.method === 'HEAD') {
        request.signal?.removeEventListener('abort', onReqAbort);
        if (parsedUpstreamLength !== null && parsedUpstreamLength > 0) {
          const totalSize = parsedUpstreamLength;
          let start = parsedRange.start;
          let end = parsedRange.end;
          if (start < 0) {
            start = Math.max(0, totalSize + start);
            end = totalSize - 1;
          } else if (end === null || end >= totalSize) {
            end = totalSize - 1;
          }
          if (start >= totalSize || start > end) {
            return new Response(null, {
              status: 416,
              headers: createCorsHeaders({
                'Content-Type': contentType,
                'Content-Range': `bytes */${totalSize}`,
              }),
            });
          }
          return new Response(null, {
            status: 206,
            headers: createCorsHeaders({
              'Content-Type': contentType,
              'Accept-Ranges': 'bytes',
              'Content-Length': String(end - start + 1),
              'Content-Range': `bytes ${start}-${end}/${totalSize}`,
            }),
          });
        }
        return new Response(null, {
          status: 200,
          headers: createCorsHeaders({
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
            ...(rawContentLength ? { 'Content-Length': rawContentLength } : {}),
          }),
        });
      }

      const concurrentJob = activeProxyJobs.get(proxyKey);
      if (concurrentJob && !concurrentJob.error && !concurrentJob.aborted) {
        request.signal?.removeEventListener('abort', onReqAbort);
        await upstreamRes.body?.cancel().catch(() => {});
        return serveActiveJobRangeResponse(request, concurrentJob, parsedRange);
      }

      promoteToBackgroundJob = true;
      request.signal?.removeEventListener('abort', onReqAbort);
      const proxyJob = startProxyCacheJob(
        proxyKey,
        cacheDir,
        partPath,
        finalPath,
        contentType,
        upstreamRes.body,
        parsedUpstreamLength,
        jobAbortController
      );
      return serveActiveJobRangeResponse(request, proxyJob, parsedRange);
    }

    const extraHeaders: Record<string, string> = {
      'Content-Type': contentType,
      'Accept-Ranges':
        upstreamRes.status === 206 ? 'bytes' : upstreamRes.headers.get('accept-ranges') || 'bytes',
    };

    const contentRange = upstreamRes.headers.get('content-range');
    if (contentRange) {
      extraHeaders['Content-Range'] = contentRange;
    }

    if (rawContentLength) {
      extraHeaders['Content-Length'] = rawContentLength;
    } else if (upstreamRes.status === 206 && contentRange) {
      const crMatch = contentRange.match(/^bytes\s+(\d+)-(\d+)\/(?:\d+|\*)$/i);
      if (crMatch) {
        const crStart = Number(crMatch[1]);
        const crEnd = Number(crMatch[2]);
        if (Number.isFinite(crStart) && Number.isFinite(crEnd) && crEnd >= crStart) {
          extraHeaders['Content-Length'] = String(crEnd - crStart + 1);
        }
      }
    }

    return new Response(request.method === 'HEAD' ? null : upstreamRes.body, {
      status: upstreamRes.status,
      headers: createCorsHeaders(extraHeaders),
    });
  } catch (err) {
    if (request.signal?.aborted) {
      return new Response(null, { status: 499, headers: createCorsHeaders() });
    }
    return new Response(
      err instanceof Error ? err.message : 'Upstream audio proxy fetch failed',
      {
        status: 502,
        headers: createCorsHeaders({ 'Content-Type': 'text/plain' }),
      }
    );
  }
}

export async function resolveYoutubeStreamProtocolRequest(
  request: Request,
  cacheDir: string = getDefaultCacheDir()
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: createCorsHeaders() });
  }

  let videoId: string | null = null;
  let startMs = 0;
  try {
    const parsedUrl = new URL(request.url);
    if (
      parsedUrl.hostname === 'proxy' ||
      parsedUrl.pathname === '/proxy' ||
      (!parsedUrl.searchParams.get('v') && parsedUrl.searchParams.get('url'))
    ) {
      return resolveRemoteAudioProxyRequest(request, cacheDir);
    }
    videoId = parsedUrl.searchParams.get('v');
    startMs = Math.max(0, Math.floor(Number(parsedUrl.searchParams.get('startMs')) || 0));
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

  const rangeHeader = request.headers.get('range') || request.headers.get('Range');
  const parsedRange = parseRangeHeader(rangeHeader);

  if (startMs > 0) {
    const serveCachedSeekSlice = async (): Promise<Response | null> => {
      const cached = await readCachedMeta(cacheDir, videoId);
      if (
        cached &&
        (cached.meta.ext === 'webm' || (cached.meta.mimeType || '').includes('webm'))
      ) {
        const seekSlice = await findWebmClusterSeekSlice(cached.filePath, startMs);
        if (seekSlice) {
          const contentType = cached.meta.mimeType || 'audio/webm';
          return serveStaticRange(
            request,
            seekSlice.totalLength,
            contentType,
            parsedRange,
            (s, e) => readVirtualSeekSlice(cached.filePath, seekSlice, s, e),
            { 'X-Waveform-Start-Ms': String(seekSlice.actualStartMs) }
          );
        }
      }
      return null;
    };

    const cachedResp = await serveCachedSeekSlice();
    if (cachedResp) return cachedResp;

    try {
      const seekJob = await ensureSeekJob(videoId, cacheDir, startMs);
      return serveActiveJobRangeResponse(request, seekJob, parsedRange, {
        'X-Waveform-Start-Ms': String(seekJob.actualStartMs ?? startMs),
      });
    } catch (err) {
      if (request.signal?.aborted) {
        return new Response(null, { status: 499, headers: createCorsHeaders() });
      }
      if (!(err instanceof Error && err.message.includes('superseded'))) {
        const cachedAfter = await serveCachedSeekSlice();
        if (cachedAfter) return cachedAfter;

        const jobKey = getJobKey(cacheDir, videoId);
        try {
          const bgJob = activeJobs.get(jobKey) || (await startYtDlpFallbackJob(videoId, cacheDir));
          await bgJob.completionPromise;
          if (!request.signal?.aborted) {
            const cachedFromBg = await serveCachedSeekSlice();
            if (cachedFromBg) return cachedFromBg;
          }
        } catch {
          // Fall through to 404 error below
        }
      }

      return new Response(err instanceof Error ? err.message : 'Stream not found', {
        status: 404,
        headers: createCorsHeaders({ 'Content-Type': 'text/plain' }),
      });
    }
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

  // Case 1: Fully cached file on disk
  if (state.type === 'cached') {
    const { meta, filePath } = state;
    const totalSize = meta.contentLength;
    const contentType = meta.mimeType || 'audio/webm';
    return serveStaticRange(
      request,
      totalSize,
      contentType,
      parsedRange,
      (s, e) => readFileSlice(filePath, s, e)
    );
  }

  // Case 2: Active progressive SABR / yt-dlp download
  return serveActiveJobRangeResponse(request, state.job, parsedRange);
}

export async function destroyAllSabrStreams(): Promise<void> {
  const jobs = [
    ...activeJobs.values(),
    ...activeSeekJobs.values(),
    ...activeProxyJobs.values(),
  ];
  activeJobs.clear();
  activeSeekJobs.clear();
  activeProxyJobs.clear();
  activeSeekSeq.clear();

  await Promise.all(jobs.map((job) => abortAndCleanupJob(job)));
}
