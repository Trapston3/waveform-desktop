import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface ScrobbleTrackInput {
  trackId?: string;
  title: string;
  artist: string;
  album?: string;
  durationSec?: number;
  startedAtSec: number;
}

export interface ScrobblerConfig {
  lastFmEnabled: boolean;
  lastFmApiKey: string;
  lastFmApiSecret: string;
  lastFmSessionKey: string;
  listenBrainzEnabled: boolean;
  listenBrainzToken: string;
}

export type ScrobbleServiceName = 'lastfm' | 'listenbrainz';

export interface QueuedScrobbleItem {
  id: string;
  service: ScrobbleServiceName;
  track: ScrobbleTrackInput;
  queuedAtMs: number;
  attempts: number;
  lastError?: string;
}

export interface ScrobbleFetchLikeResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

export type ScrobbleFetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<ScrobbleFetchLikeResponse>;

export interface ListenBrainzValidationResult {
  ok: boolean;
  valid: boolean;
  userName?: string;
  error?: string;
}

export interface LastFmTestResult {
  ok: boolean;
  valid: boolean;
  userName?: string;
  error?: string;
}

export interface FlushQueueResult {
  flushed: number;
  remaining: number;
  errors: string[];
}

export interface ScrobblerStatusSnapshot {
  lastFmConfigured: boolean;
  listenBrainzConfigured: boolean;
  queueLength: number;
  lastError: string | null;
  lastSubmittedAtMs: number | null;
}

const DEFAULT_SCROBBLER_CONFIG: ScrobblerConfig = {
  lastFmEnabled: false,
  lastFmApiKey: '',
  lastFmApiSecret: '',
  lastFmSessionKey: '',
  listenBrainzEnabled: false,
  listenBrainzToken: '',
};

const MAX_QUEUE_ITEMS = 1000;

function defaultFetch(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<ScrobbleFetchLikeResponse> {
  return fetch(url, init as RequestInit) as Promise<ScrobbleFetchLikeResponse>;
}

/**
 * Generates an MD5 signature matching Last.fm Web Services API specification:
 * sort params lexicographically by key (excluding 'format' & 'callback'),
 * concatenate `key + value`, append `apiSecret`, and compute lowercase hex MD5.
 */
export function signLastFmParams(
  params: Record<string, string | number | undefined>,
  apiSecret: string
): string {
  const keys = Object.keys(params)
    .filter((k) => k !== 'format' && k !== 'callback' && k !== 'api_sig' && params[k] !== undefined)
    .sort();
  let concat = '';
  for (const k of keys) {
    concat += k + String(params[k]);
  }
  concat += apiSecret;
  return createHash('md5').update(concat, 'utf8').digest('hex');
}

/**
 * Standard scrobble commit rule: track duration >= 30s (or unknown duration with played >= 30s),
 * committed once played >= 50% of duration OR >= 240 seconds.
 */
export function shouldCommitScrobble(playedSec: number, durationSec: number): boolean {
  if (!Number.isFinite(playedSec) || playedSec <= 0) return false;
  const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  if (dur > 0 && dur < 30) return false;
  if (dur === 0) return playedSec >= 30;
  return playedSec >= 240 || playedSec >= dur * 0.5;
}

function buildListenBrainzPayload(
  listenType: 'playing_now' | 'single',
  track: ScrobbleTrackInput
) {
  const metadata: Record<string, unknown> = {
    artist_name: track.artist || 'Unknown Artist',
    track_name: track.title || 'Untitled',
  };
  if (track.album && track.album.trim()) {
    metadata.release_name = track.album.trim();
  }
  const additionalInfo: Record<string, unknown> = {
    media_player: 'WaveForm Desktop',
    submission_client: 'WaveForm Desktop',
  };
  if (track.durationSec && track.durationSec > 0) {
    additionalInfo.duration_ms = Math.round(track.durationSec * 1000);
  }
  metadata.additional_info = additionalInfo;

  const listenEntry: Record<string, unknown> = { track_metadata: metadata };
  if (listenType === 'single') {
    listenEntry.listened_at = Math.max(
      1,
      Math.floor(Number.isFinite(track.startedAtSec) ? track.startedAtSec : Date.now() / 1000)
    );
  }

  return {
    listen_type: listenType,
    payload: [listenEntry],
  };
}

export async function validateListenBrainzToken(
  token: string,
  fetchFn: ScrobbleFetchFn = defaultFetch
): Promise<ListenBrainzValidationResult> {
  const trimmed = (token || '').trim();
  if (!trimmed) {
    return { ok: false, valid: false, error: 'ListenBrainz token is required' };
  }
  try {
    const resp = await fetchFn('https://api.listenbrainz.org/1/validate-token', {
      method: 'GET',
      headers: {
        Authorization: `Token ${trimmed}`,
        Accept: 'application/json',
      },
    });
    const raw = await resp.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (!resp.ok) {
      return {
        ok: false,
        valid: false,
        error: parsed?.error || `HTTP ${resp.status}`,
      };
    }
    const valid = Boolean(parsed?.valid);
    return {
      ok: valid,
      valid,
      userName: typeof parsed?.user_name === 'string' ? parsed.user_name : undefined,
      error: valid ? undefined : parsed?.message || 'Invalid ListenBrainz token',
    };
  } catch (err) {
    return {
      ok: false,
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function submitListenBrainzNowPlaying(
  track: ScrobbleTrackInput,
  token: string,
  fetchFn: ScrobbleFetchFn = defaultFetch
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = (token || '').trim();
  if (!trimmed) return { ok: false, error: 'Missing ListenBrainz token' };
  try {
    const resp = await fetchFn('https://api.listenbrainz.org/1/submit-listens', {
      method: 'POST',
      headers: {
        Authorization: `Token ${trimmed}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildListenBrainzPayload('playing_now', track)),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return { ok: false, error: txt || `ListenBrainz HTTP ${resp.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function submitListenBrainzScrobble(
  track: ScrobbleTrackInput,
  token: string,
  fetchFn: ScrobbleFetchFn = defaultFetch
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = (token || '').trim();
  if (!trimmed) return { ok: false, error: 'Missing ListenBrainz token' };
  try {
    const resp = await fetchFn('https://api.listenbrainz.org/1/submit-listens', {
      method: 'POST',
      headers: {
        Authorization: `Token ${trimmed}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildListenBrainzPayload('single', track)),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return { ok: false, error: txt || `ListenBrainz HTTP ${resp.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function postLastFmSigned(
  params: Record<string, string>,
  apiSecret: string,
  fetchFn: ScrobbleFetchFn
): Promise<{ ok: boolean; parsed?: any; error?: string }> {
  const apiSig = signLastFmParams(params, apiSecret);
  const body = new URLSearchParams({
    ...params,
    api_sig: apiSig,
    format: 'json',
  }).toString();

  try {
    const resp = await fetchFn('https://ws.audioscrobbler.com/2.0/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
      body,
    });
    const raw = await resp.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (!resp.ok || parsed?.error) {
      return {
        ok: false,
        parsed,
        error: parsed?.message || `Last.fm HTTP ${resp.status}`,
      };
    }
    return { ok: true, parsed };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function submitLastFmNowPlaying(
  track: ScrobbleTrackInput,
  cfg: Pick<ScrobblerConfig, 'lastFmApiKey' | 'lastFmApiSecret' | 'lastFmSessionKey'>,
  fetchFn: ScrobbleFetchFn = defaultFetch
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = (cfg.lastFmApiKey || '').trim();
  const apiSecret = (cfg.lastFmApiSecret || '').trim();
  const sk = (cfg.lastFmSessionKey || '').trim();
  if (!apiKey || !apiSecret || !sk) {
    return { ok: false, error: 'Missing Last.fm API Key, API Secret, or Session Key' };
  }
  const params: Record<string, string> = {
    method: 'track.updateNowPlaying',
    api_key: apiKey,
    sk,
    artist: track.artist || 'Unknown Artist',
    track: track.title || 'Untitled',
  };
  if (track.album && track.album.trim()) params.album = track.album.trim();
  if (track.durationSec && track.durationSec > 0) {
    params.duration = String(Math.round(track.durationSec));
  }
  const res = await postLastFmSigned(params, apiSecret, fetchFn);
  return { ok: res.ok, error: res.error };
}

export async function submitLastFmScrobble(
  track: ScrobbleTrackInput,
  cfg: Pick<ScrobblerConfig, 'lastFmApiKey' | 'lastFmApiSecret' | 'lastFmSessionKey'>,
  fetchFn: ScrobbleFetchFn = defaultFetch
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = (cfg.lastFmApiKey || '').trim();
  const apiSecret = (cfg.lastFmApiSecret || '').trim();
  const sk = (cfg.lastFmSessionKey || '').trim();
  if (!apiKey || !apiSecret || !sk) {
    return { ok: false, error: 'Missing Last.fm API Key, API Secret, or Session Key' };
  }
  const timestamp = Math.max(
    1,
    Math.floor(Number.isFinite(track.startedAtSec) ? track.startedAtSec : Date.now() / 1000)
  );
  const params: Record<string, string> = {
    method: 'track.scrobble',
    api_key: apiKey,
    sk,
    artist: track.artist || 'Unknown Artist',
    track: track.title || 'Untitled',
    timestamp: String(timestamp),
  };
  if (track.album && track.album.trim()) params.album = track.album.trim();
  if (track.durationSec && track.durationSec > 0) {
    params.duration = String(Math.round(track.durationSec));
  }
  const res = await postLastFmSigned(params, apiSecret, fetchFn);
  return { ok: res.ok, error: res.error };
}

export async function testLastFmConnection(
  cfg: Pick<ScrobblerConfig, 'lastFmApiKey' | 'lastFmApiSecret' | 'lastFmSessionKey'>,
  fetchFn: ScrobbleFetchFn = defaultFetch
): Promise<LastFmTestResult> {
  const apiKey = (cfg.lastFmApiKey || '').trim();
  const apiSecret = (cfg.lastFmApiSecret || '').trim();
  const sk = (cfg.lastFmSessionKey || '').trim();
  if (!apiKey || !apiSecret || !sk) {
    return {
      ok: false,
      valid: false,
      error: 'Enter Last.fm API Key, API Secret, and Session Key first',
    };
  }
  const res = await postLastFmSigned(
    {
      method: 'user.getInfo',
      api_key: apiKey,
      sk,
    },
    apiSecret,
    fetchFn
  );
  if (!res.ok) {
    return { ok: false, valid: false, error: res.error || 'Last.fm validation failed' };
  }
  const userName = typeof res.parsed?.user?.name === 'string' ? res.parsed.user.name : undefined;
  return { ok: true, valid: true, userName };
}

export class ScrobblerManager {
  private readonly queueFilePath: string;
  private readonly fetchFn: ScrobbleFetchFn;
  private config: ScrobblerConfig = { ...DEFAULT_SCROBBLER_CONFIG };
  private queue: QueuedScrobbleItem[] = [];
  private lastError: string | null = null;
  private lastSubmittedAtMs: number | null = null;
  private flushInFlight: Promise<FlushQueueResult> | null = null;

  constructor(userDataPath: string, fetchFn: ScrobbleFetchFn = defaultFetch) {
    this.queueFilePath = path.join(userDataPath, 'scrobble-queue.json');
    this.fetchFn = fetchFn;
    this.loadQueue();
  }

  private loadQueue(): void {
    try {
      if (!fs.existsSync(this.queueFilePath)) {
        this.queue = [];
        return;
      }
      const parsed = JSON.parse(fs.readFileSync(this.queueFilePath, 'utf8'));
      if (Array.isArray(parsed)) {
        this.queue = parsed.filter(
          (item): item is QueuedScrobbleItem =>
            Boolean(item) &&
            (item.service === 'lastfm' || item.service === 'listenbrainz') &&
            Boolean(item.track?.title)
        );
      }
    } catch {
      this.queue = [];
    }
  }

  private saveQueue(): void {
    try {
      fs.mkdirSync(path.dirname(this.queueFilePath), { recursive: true });
      const trimmed = this.queue.slice(-MAX_QUEUE_ITEMS);
      this.queue = trimmed;
      const tmp = `${this.queueFilePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2), 'utf8');
      fs.renameSync(tmp, this.queueFilePath);
    } catch {
      // Non-fatal persistence error
    }
  }

  private enqueue(service: ScrobbleServiceName, track: ScrobbleTrackInput, errorMsg?: string): void {
    const id = `${service}:${(track.artist || '').toLowerCase()}:${(track.title || '').toLowerCase()}:${Math.floor(
      track.startedAtSec
    )}`;
    if (this.queue.some((item) => item.id === id)) return;
    this.queue.push({
      id,
      service,
      track: { ...track },
      queuedAtMs: Date.now(),
      attempts: 1,
      lastError: errorMsg,
    });
    this.saveQueue();
  }

  public configure(next: Partial<ScrobblerConfig>): ScrobblerStatusSnapshot {
    this.config = {
      ...this.config,
      ...next,
    };
    if (this.queue.length > 0 && (this.isLastFmReady() || this.isListenBrainzReady())) {
      void this.flushQueue().catch(() => {});
    }
    return this.getStatus();
  }

  private isLastFmReady(): boolean {
    return Boolean(
      this.config.lastFmEnabled &&
        this.config.lastFmApiKey.trim() &&
        this.config.lastFmApiSecret.trim() &&
        this.config.lastFmSessionKey.trim()
    );
  }

  private isListenBrainzReady(): boolean {
    return Boolean(this.config.listenBrainzEnabled && this.config.listenBrainzToken.trim());
  }

  public getStatus(): ScrobblerStatusSnapshot {
    return {
      lastFmConfigured: this.isLastFmReady(),
      listenBrainzConfigured: this.isListenBrainzReady(),
      queueLength: this.queue.length,
      lastError: this.lastError,
      lastSubmittedAtMs: this.lastSubmittedAtMs,
    };
  }

  public getQueueItems(): QueuedScrobbleItem[] {
    return this.queue.map((item) => ({ ...item, track: { ...item.track } }));
  }

  public async nowPlaying(track: ScrobbleTrackInput): Promise<{ ok: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!track?.title?.trim()) return { ok: false, errors: ['Missing track title'] };

    const tasks: Promise<void>[] = [];
    if (this.isListenBrainzReady()) {
      tasks.push(
        submitListenBrainzNowPlaying(track, this.config.listenBrainzToken, this.fetchFn).then((r) => {
          if (!r.ok && r.error) errors.push(`ListenBrainz: ${r.error}`);
        })
      );
    }
    if (this.isLastFmReady()) {
      tasks.push(
        submitLastFmNowPlaying(track, this.config, this.fetchFn).then((r) => {
          if (!r.ok && r.error) errors.push(`Last.fm: ${r.error}`);
        })
      );
    }
    await Promise.all(tasks);
    if (errors.length > 0) this.lastError = errors[0];
    return { ok: errors.length === 0, errors };
  }

  public async submitScrobble(
    track: ScrobbleTrackInput
  ): Promise<{ ok: boolean; queued: number; errors: string[] }> {
    if (!track?.title?.trim()) return { ok: false, queued: 0, errors: ['Missing track title'] };
    const errors: string[] = [];
    let queued = 0;

    if (this.queue.length > 0) {
      await this.flushQueue().catch(() => {});
    }

    if (this.isListenBrainzReady()) {
      const r = await submitListenBrainzScrobble(track, this.config.listenBrainzToken, this.fetchFn);
      if (r.ok) {
        this.lastSubmittedAtMs = Date.now();
        this.lastError = null;
      } else {
        this.enqueue('listenbrainz', track, r.error);
        queued += 1;
        if (r.error) errors.push(`ListenBrainz: ${r.error}`);
      }
    }

    if (this.isLastFmReady()) {
      const r = await submitLastFmScrobble(track, this.config, this.fetchFn);
      if (r.ok) {
        this.lastSubmittedAtMs = Date.now();
        this.lastError = null;
      } else {
        this.enqueue('lastfm', track, r.error);
        queued += 1;
        if (r.error) errors.push(`Last.fm: ${r.error}`);
      }
    }

    if (errors.length > 0) this.lastError = errors[0];
    return { ok: queued === 0 && errors.length === 0, queued, errors };
  }

  public async flushQueue(): Promise<FlushQueueResult> {
    if (this.flushInFlight) return this.flushInFlight;
    this.flushInFlight = (async () => {
      if (this.queue.length === 0) {
        return { flushed: 0, remaining: 0, errors: [] };
      }
      const nextQueue: QueuedScrobbleItem[] = [];
      let flushed = 0;
      const errors: string[] = [];

      for (const item of this.queue) {
        if (item.service === 'listenbrainz') {
          if (!this.isListenBrainzReady()) {
            nextQueue.push(item);
            continue;
          }
          const r = await submitListenBrainzScrobble(
            item.track,
            this.config.listenBrainzToken,
            this.fetchFn
          );
          if (r.ok) {
            flushed += 1;
            this.lastSubmittedAtMs = Date.now();
          } else {
            nextQueue.push({
              ...item,
              attempts: item.attempts + 1,
              lastError: r.error,
            });
            if (r.error) errors.push(r.error);
          }
        } else {
          if (!this.isLastFmReady()) {
            nextQueue.push(item);
            continue;
          }
          const r = await submitLastFmScrobble(item.track, this.config, this.fetchFn);
          if (r.ok) {
            flushed += 1;
            this.lastSubmittedAtMs = Date.now();
          } else {
            nextQueue.push({
              ...item,
              attempts: item.attempts + 1,
              lastError: r.error,
            });
            if (r.error) errors.push(r.error);
          }
        }
      }

      this.queue = nextQueue;
      this.saveQueue();
      if (errors.length > 0) this.lastError = errors[0];
      else if (flushed > 0) this.lastError = null;

      return { flushed, remaining: this.queue.length, errors };
    })();

    try {
      return await this.flushInFlight;
    } finally {
      this.flushInFlight = null;
    }
  }
}
