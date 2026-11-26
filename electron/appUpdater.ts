import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

export const DEFAULT_GITHUB_REPO = 'Trapston3/waveform-desktop';
export const DEFAULT_CHECK_TIMEOUT_MS = 8000;
export const DEFAULT_COLD_BOOT_DELAY_MS = 2500;
const PROGRESS_EMIT_INTERVAL_MS = 100;

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'error';

export interface AppUpdateProgress {
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  bytesPerSecond: number;
}

export interface AppUpdateState {
  status: AppUpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  assetName: string | null;
  assetSize: number | null;
  updateStrategy?: 'direct_patch' | 'full_installer';
  deltaChangedCount?: number | null;
  deltaRemovedCount?: number | null;
  dismissedThisSession: boolean;
  progress: AppUpdateProgress | null;
  error: string | null;
  lastCheckedAt: number | null;
}

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
}

export interface GitHubReleasePayload {
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  html_url?: string | null;
  published_at?: string | null;
  assets?: GitHubReleaseAsset[];
}

export interface ReleaseAssetRef {
  name: string;
  url: string;
  size: number | null;
}

export interface SelectedReleaseAssets {
  installerAsset: ReleaseAssetRef | null;
  checksumAsset: ReleaseAssetRef | null;
  patchAsset: ReleaseAssetRef | null;
  manifestAsset: ReleaseAssetRef | null;
}

export interface ManifestEntry {
  sha256: string;
  size: number;
}

export interface DeltaUpdatePlan {
  strategy: 'direct_patch' | 'full_installer';
  changedFiles: string[];
  removedFiles: string[];
  requiresBinaryUpgrade: boolean;
  estimatedBytes: number;
}

export interface AppUpdaterControllerOptions {
  fetchFn?: typeof fetch;
  currentVersion: string;
  tempDir?: string;
  installDir?: string;
  relaunchExePath?: string;
  pid?: number;
  extractZipFn?: (zipPath: string, destDir: string) => Promise<void> | void;
  spawnFn?: (
    command: string,
    args: readonly string[],
    options: Record<string, any>
  ) => Pick<ChildProcess, 'unref'> | ChildProcess;
  quitFn?: () => void;
  openExternalFn?: (url: string) => Promise<void> | void;
  onStateChange?: (state: AppUpdateState) => void;
  githubRepo?: string;
  checkTimeoutMs?: number;
  quitDelayMs?: number;
}

interface ParsedSemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemVer(raw: string): ParsedSemVer {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/^[vV]/, '')
    .split('+')[0];
  const dashIdx = cleaned.indexOf('-');
  const corePart = dashIdx >= 0 ? cleaned.slice(0, dashIdx) : cleaned;
  const prePart = dashIdx >= 0 ? cleaned.slice(dashIdx + 1) : '';
  const nums = corePart.split('.').map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  });

  return {
    major: nums[0] ?? 0,
    minor: nums[1] ?? 0,
    patch: nums[2] ?? 0,
    prerelease: prePart ? prePart.split('.').filter(Boolean) : [],
  };
}

/**
 * Compares two SemVer strings (with optional leading "v").
 * Returns 1 if a > b, -1 if a < b, and 0 if equal.
 */
export function compareSemVer(a: string, b: string): number {
  const pa = parseSemVer(a);
  const pb = parseSemVer(b);

  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;

  const aHasPre = pa.prerelease.length > 0;
  const bHasPre = pb.prerelease.length > 0;
  if (!aHasPre && !bHasPre) return 0;
  if (!aHasPre && bHasPre) return 1;
  if (aHasPre && !bHasPre) return -1;

  const len = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const idA = pa.prerelease[i];
    const idB = pb.prerelease[i];
    if (idA === undefined) return -1;
    if (idB === undefined) return 1;
    if (idA === idB) continue;

    const numA = /^\d+$/.test(idA) ? Number(idA) : null;
    const numB = /^\d+$/.test(idB) ? Number(idB) : null;
    if (numA !== null && numB !== null) {
      return numA > numB ? 1 : -1;
    }
    if (numA !== null) return -1;
    if (numB !== null) return 1;
    return idA > idB ? 1 : -1;
  }

  return 0;
}

/**
 * Parses SHA256SUMS.txt lines (`<hex>  <filename>` or `<hex> *<filename>`) into a Map<filename, sha256Hex>.
 */
export function parseSha256Sums(text: string): Map<string, string> {
  const map = new Map<string, string>();
  if (typeof text !== 'string' || !text.trim()) return map;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (!match) continue;

    const hash = match[1].toLowerCase();
    const rawName = match[2].trim().replace(/^\.\//, '').replace(/^\.\\/, '');
    if (!rawName) continue;

    const baseName = path.basename(rawName);
    map.set(baseName, hash);
  }

  return map;
}

/**
 * Selects WaveForm-Setup-*.exe and SHA256SUMS.txt from a GitHub release payload.
 */
export function selectReleaseAssets(release: GitHubReleasePayload | null | undefined): SelectedReleaseAssets {
  const assets = Array.isArray(release?.assets) ? release.assets : [];

  let installerAsset: SelectedReleaseAssets['installerAsset'] = null;
  let checksumAsset: SelectedReleaseAssets['checksumAsset'] = null;
  let patchAsset: SelectedReleaseAssets['patchAsset'] = null;
  let manifestAsset: SelectedReleaseAssets['manifestAsset'] = null;

  for (const asset of assets) {
    if (!asset || typeof asset.name !== 'string' || typeof asset.browser_download_url !== 'string') {
      continue;
    }
    const name = asset.name.trim();
    const lower = name.toLowerCase();
    const size = typeof asset.size === 'number' && Number.isFinite(asset.size) ? asset.size : null;

    if (!installerAsset && /^waveform-setup-.*\.exe$/i.test(name)) {
      installerAsset = { name, url: asset.browser_download_url, size };
    } else if (!checksumAsset && lower === 'sha256sums.txt') {
      checksumAsset = { name, url: asset.browser_download_url, size };
    } else if (!patchAsset && /^waveform-apppatch-.*\.zip$/i.test(name)) {
      patchAsset = { name, url: asset.browser_download_url, size };
    } else if (!manifestAsset && lower === 'install-manifest.tsv') {
      manifestAsset = { name, url: asset.browser_download_url, size };
    }
  }

  return { installerAsset, checksumAsset, patchAsset, manifestAsset };
}

function normalizeWinManifestRelPath(relPath: string): string {
  return String(relPath || '').trim().replace(/\//g, '\\').replace(/^\\+/, '');
}

/**
 * Parses resources/install-manifest.tsv (`version\tsize\tsha256\trelPath`) into Map<relPath, ManifestEntry>.
 */
export function parseInstallManifest(tsv: string): Map<string, ManifestEntry> {
  const entries = new Map<string, ManifestEntry>();
  if (typeof tsv !== 'string' || !tsv.trim()) return entries;

  for (const rawLine of tsv.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('version\t')) continue;
    const cols = line.split('\t');
    if (cols.length < 4) continue;
    const size = Number.parseInt(cols[1], 10);
    const sha256 = cols[2].trim().toLowerCase();
    const relPath = normalizeWinManifestRelPath(cols.slice(3).join('\t'));
    if (!relPath || !/^[a-f0-9]{64}$/.test(sha256) || !Number.isFinite(size) || size < 0) continue;
    entries.set(relPath, { sha256, size });
  }
  return entries;
}

/**
 * Computes direct delta vs full installer strategy by comparing local vs remote install manifests.
 */
export function planDeltaUpdate(
  localManifest: Map<string, ManifestEntry>,
  remoteManifest: Map<string, ManifestEntry>
): DeltaUpdatePlan {
  if (!localManifest || localManifest.size === 0 || !remoteManifest || remoteManifest.size === 0) {
    return {
      strategy: 'full_installer',
      changedFiles: [],
      removedFiles: [],
      requiresBinaryUpgrade: true,
      estimatedBytes: 0,
    };
  }

  const changedFiles: string[] = [];
  const removedFiles: string[] = [];
  let requiresBinaryUpgrade = false;
  let estimatedBytes = 0;

  const isResourcePath = (rel: string): boolean => rel.toLowerCase().startsWith('resources\\');

  for (const [relPath, remoteMeta] of remoteManifest.entries()) {
    const localMeta = localManifest.get(relPath);
    if (!localMeta || localMeta.sha256 !== remoteMeta.sha256 || localMeta.size !== remoteMeta.size) {
      changedFiles.push(relPath);
      estimatedBytes += remoteMeta.size;
      if (!isResourcePath(relPath)) {
        requiresBinaryUpgrade = true;
      }
    }
  }

  for (const oldRelPath of localManifest.keys()) {
    if (!remoteManifest.has(oldRelPath)) {
      removedFiles.push(oldRelPath);
      if (!isResourcePath(oldRelPath)) {
        requiresBinaryUpgrade = true;
      }
    }
  }

  changedFiles.sort((a, b) => a.localeCompare(b));
  removedFiles.sort((a, b) => a.localeCompare(b));

  return {
    strategy: requiresBinaryUpgrade ? 'full_installer' : 'direct_patch',
    changedFiles,
    removedFiles,
    requiresBinaryUpgrade,
    estimatedBytes,
  };
}

export interface DirectPatchScriptOptions {
  targetPid: number;
  installDir: string;
  stagingDir: string;
  updateDir: string;
  relaunchExePath: string;
  targetVersion: string;
  changedFiles: readonly string[];
  removedFiles: readonly string[];
}

/**
 * Generates an atomic PowerShell patch applier with PID exit wait, per-file backup & rollback,
 * obsolete file cleanup, Registry DisplayVersion sync, temp cleanup, and direct relaunch (no NSIS).
 */
export function buildDirectPatchApplierScript(opts: DirectPatchScriptOptions): string {
  const safeChanged = opts.changedFiles.map((f) => normalizeWinManifestRelPath(f));
  const safeRemoved = opts.removedFiles.map((f) => normalizeWinManifestRelPath(f));
  const manifestRel = 'resources\\install-manifest.tsv';
  const filesToCopy = safeChanged.includes(manifestRel)
    ? safeChanged
    : [...safeChanged, manifestRel];

  const changedLiteral = filesToCopy.map((f) => `  ${psSingleQuote(f)}`).join(',\n');
  const removedLiteral = safeRemoved.map((f) => `  ${psSingleQuote(f)}`).join(',\n');

  return [
    '$ErrorActionPreference = "Stop"',
    `$TargetPid = ${Math.max(0, Math.floor(opts.targetPid || 0))}`,
    `$InstallDir = ${psSingleQuote(opts.installDir)}`,
    `$StagingDir = ${psSingleQuote(opts.stagingDir)}`,
    `$UpdateDir = ${psSingleQuote(opts.updateDir)}`,
    `$BackupDir = Join-Path $UpdateDir "backup"`,
    `$RelaunchExe = ${psSingleQuote(opts.relaunchExePath)}`,
    `$TargetVersion = ${psSingleQuote(opts.targetVersion)}`,
    `$ChangedFiles = @(\n${changedLiteral}\n)`,
    `$RemovedFiles = @(\n${removedLiteral}\n)`,
    '',
    'if ($TargetPid -gt 0) {',
    '  for ($i = 0; $i -lt 120; $i++) {',
    '    $proc = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue',
    '    if (-not $proc) { break }',
    '    Start-Sleep -Milliseconds 250',
    '  }',
    '}',
    'Start-Sleep -Milliseconds 350',
    '',
    'New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null',
    '$BackedUp = @()',
    '$CreatedNew = @()',
    '',
    'function Copy-WithRetry([string]$Src, [string]$Dst) {',
    '  for ($attempt = 0; $attempt -lt 6; $attempt++) {',
    '    try {',
    '      Copy-Item -LiteralPath $Src -Destination $Dst -Force',
    '      return',
    '    } catch {',
    '      if ($attempt -ge 5) { throw }',
    '      Start-Sleep -Milliseconds 350',
    '    }',
    '  }',
    '}',
    '',
    'function Remove-WithRetry([string]$TargetPath) {',
    '  for ($attempt = 0; $attempt -lt 6; $attempt++) {',
    '    try {',
    '      Remove-Item -LiteralPath $TargetPath -Force',
    '      return',
    '    } catch {',
    '      if ($attempt -ge 5) { throw }',
    '      Start-Sleep -Milliseconds 350',
    '    }',
    '  }',
    '}',
    '',
    'try {',
    '  foreach ($rel in $ChangedFiles) {',
    '    if ([string]::IsNullOrWhiteSpace($rel)) { continue }',
    '    $src = Join-Path $StagingDir $rel',
    '    $dst = Join-Path $InstallDir $rel',
    '    if (-not (Test-Path -LiteralPath $src)) { continue }',
    '    $dstParent = Split-Path -Parent $dst',
    '    if (-not (Test-Path -LiteralPath $dstParent)) { New-Item -ItemType Directory -Force -Path $dstParent | Out-Null }',
    '    if (Test-Path -LiteralPath $dst) {',
    '      $bak = Join-Path $BackupDir $rel',
    '      $bakParent = Split-Path -Parent $bak',
    '      if (-not (Test-Path -LiteralPath $bakParent)) { New-Item -ItemType Directory -Force -Path $bakParent | Out-Null }',
    '      Copy-WithRetry $dst $bak',
    '      $BackedUp += $rel',
    '    } else {',
    '      $CreatedNew += $rel',
    '    }',
    '    Copy-WithRetry $src $dst',
    '  }',
    '  foreach ($rel in $RemovedFiles) {',
    '    if ([string]::IsNullOrWhiteSpace($rel)) { continue }',
    '    $dst = Join-Path $InstallDir $rel',
    '    if (Test-Path -LiteralPath $dst) {',
    '      $bak = Join-Path $BackupDir $rel',
    '      $bakParent = Split-Path -Parent $bak',
    '      if (-not (Test-Path -LiteralPath $bakParent)) { New-Item -ItemType Directory -Force -Path $bakParent | Out-Null }',
    '      Copy-WithRetry $dst $bak',
    '      $BackedUp += $rel',
    '      Remove-WithRetry $dst',
    '    }',
    '  }',
    '  $UninstallRoots = @(',
    '    "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",',
    '    "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*"',
    '  )',
    '  foreach ($rootPattern in $UninstallRoots) {',
    '    Get-ItemProperty -Path $rootPattern -ErrorAction SilentlyContinue | Where-Object {',
    '      $_.DisplayName -like "WaveForm*"',
    '    } | ForEach-Object {',
    '      Set-ItemProperty -LiteralPath $_.PSPath -Name "DisplayVersion" -Value $TargetVersion -ErrorAction SilentlyContinue',
    '    }',
    '  }',
    '} catch {',
    '  foreach ($rel in $CreatedNew) {',
    '    $dst = Join-Path $InstallDir $rel',
    '    if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Force -ErrorAction SilentlyContinue }',
    '  }',
    '  foreach ($rel in $BackedUp) {',
    '    $bak = Join-Path $BackupDir $rel',
    '    $dst = Join-Path $InstallDir $rel',
    '    if (Test-Path -LiteralPath $bak) { Copy-Item -LiteralPath $bak -Destination $dst -Force -ErrorAction SilentlyContinue }',
    '  }',
    '  try { Remove-Item -LiteralPath $UpdateDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}',
    '  if (Test-Path -LiteralPath $RelaunchExe) { Start-Process -FilePath $RelaunchExe }',
    '  exit 1',
    '}',
    '',
    'try { Remove-Item -LiteralPath $UpdateDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}',
    'if (Test-Path -LiteralPath $RelaunchExe) { Start-Process -FilePath $RelaunchExe }',
    '',
  ].join('\n');
}

export async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
  });
}

/**
 * Verifies a file's streaming SHA-256 digest against an expected 64-char hex hash.
 */
export async function verifyFileSha256(filePath: string, expectedHash: string): Promise<boolean> {
  const normalizedExpected = String(expectedHash ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedExpected)) {
    return false;
  }
  const actual = await computeFileSha256(filePath);
  return actual === normalizedExpected;
}

function normalizeErrorMessage(err: unknown): string {
  if (!err) return 'Unknown update error';
  if (err instanceof Error) {
    if (err.name === 'AbortError') {
      return 'Update check timed out while contacting GitHub.';
    }
    return err.message || 'Unknown update error';
  }
  return String(err);
}

function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function streamBodyToFile(
  response: Response,
  destPath: string,
  totalBytes: number,
  onProgress: (progress: AppUpdateProgress) => void
): Promise<number> {
  const body: any = response.body;
  if (!body) {
    throw new Error('Download response contained no body stream.');
  }

  const startedAt = Date.now();
  let lastEmitAt = 0;
  let bytesDownloaded = 0;

  const emit = (force: boolean) => {
    const now = Date.now();
    if (!force && now - lastEmitAt < PROGRESS_EMIT_INTERVAL_MS) return;
    lastEmitAt = now;
    const elapsedSec = Math.max(0.05, (now - startedAt) / 1000);
    const bytesPerSecond = Math.round(bytesDownloaded / elapsedSec);
    const percent =
      totalBytes > 0 ? Math.min(100, Math.round((bytesDownloaded / totalBytes) * 1000) / 10) : 0;
    onProgress({
      bytesDownloaded,
      totalBytes,
      percent,
      bytesPerSecond,
    });
  };

  const writeStream = fs.createWriteStream(destPath);
  const writeChunk = (chunk: Uint8Array): Promise<void> =>
    new Promise((resolve, reject) => {
      const ok = writeStream.write(chunk, (err) => {
        if (err) reject(err);
      });
      if (ok) {
        resolve();
      } else {
        writeStream.once('drain', resolve);
      }
    });

  const streamErrorPromise = new Promise<never>((_resolve, reject) => {
    writeStream.once('error', reject);
  });

  try {
    if (typeof body[Symbol.asyncIterator] === 'function') {
      for await (const rawChunk of body as AsyncIterable<Uint8Array>) {
        const chunk = rawChunk instanceof Uint8Array ? rawChunk : new Uint8Array(rawChunk);
        bytesDownloaded += chunk.byteLength;
        await Promise.race([writeChunk(chunk), streamErrorPromise]);
        emit(false);
      }
    } else if (typeof body.getReader === 'function') {
      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
            bytesDownloaded += chunk.byteLength;
            await Promise.race([writeChunk(chunk), streamErrorPromise]);
            emit(false);
          }
        }
      } finally {
        reader.releaseLock?.();
      }
    } else if (body instanceof Readable) {
      for await (const rawChunk of body) {
        const chunk = rawChunk instanceof Uint8Array ? rawChunk : new Uint8Array(rawChunk);
        bytesDownloaded += chunk.byteLength;
        await Promise.race([writeChunk(chunk), streamErrorPromise]);
        emit(false);
      }
    } else {
      throw new Error('Unsupported download stream type.');
    }

    await new Promise<void>((resolve, reject) => {
      writeStream.once('error', reject);
      writeStream.end(() => resolve());
    });

    emit(true);
    return bytesDownloaded;
  } catch (err) {
    writeStream.destroy();
    throw err;
  }
}

export function createAppUpdaterController(options: AppUpdaterControllerOptions) {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const currentVersion = String(options.currentVersion || '0.0.0').replace(/^[vV]/, '');
  const tempDir = options.tempDir ?? os.tmpdir();
  const installDir = options.installDir ?? path.dirname(process.execPath);
  const relaunchExePath = options.relaunchExePath ?? path.join(installDir, 'WaveForm.exe');
  const targetPid = options.pid ?? process.pid;
  const spawnFn = options.spawnFn ?? spawn;
  const extractZipFn =
    options.extractZipFn ??
    ((zipPath: string, destDir: string) =>
      new Promise<void>((resolve, reject) => {
        const psCmd = `Expand-Archive -LiteralPath ${psSingleQuote(zipPath)} -DestinationPath ${psSingleQuote(destDir)} -Force`;
        const proc = spawnFn(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-WindowStyle',
            'Hidden',
            '-Command',
            psCmd,
          ],
          { windowsHide: true, stdio: 'ignore' }
        ) as ChildProcess;
        if (!proc || typeof proc.on !== 'function') {
          resolve();
          return;
        }
        proc.on('error', reject);
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Expand-Archive failed with exit code ${code}`));
        });
      }));
  const quitFn = options.quitFn ?? (() => {});
  const openExternalFn = options.openExternalFn ?? (() => {});
  const githubRepo = options.githubRepo ?? DEFAULT_GITHUB_REPO;
  const checkTimeoutMs = options.checkTimeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const quitDelayMs = options.quitDelayMs ?? 250;

  let installerUrl: string | null = null;
  let patchUrl: string | null = null;
  let checksumUrl: string | null = null;
  let remoteManifestMap: Map<string, ManifestEntry> | null = null;
  let plannedDelta: DeltaUpdatePlan | null = null;
  let coldBootTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlightCheck: Promise<AppUpdateState> | null = null;

  let state: AppUpdateState = {
    status: 'idle',
    currentVersion,
    latestVersion: null,
    releaseName: null,
    releaseNotes: null,
    releaseUrl: null,
    publishedAt: null,
    assetName: null,
    assetSize: null,
    updateStrategy: 'full_installer',
    deltaChangedCount: null,
    deltaRemovedCount: null,
    dismissedThisSession: false,
    progress: null,
    error: null,
    lastCheckedAt: null,
  };

  const emitState = (patch: Partial<AppUpdateState>): AppUpdateState => {
    state = { ...state, ...patch };
    options.onStateChange?.({ ...state });
    return { ...state };
  };

  const getState = (): AppUpdateState => ({ ...state });

  const cancelScheduledCheck = (): void => {
    if (coldBootTimer) {
      clearTimeout(coldBootTimer);
      coldBootTimer = null;
    }
  };

  const checkForUpdates = async (manual = false): Promise<AppUpdateState> => {
    if (
      state.status === 'downloading' ||
      state.status === 'verifying' ||
      state.status === 'installing'
    ) {
      return getState();
    }

    if (inFlightCheck) {
      return inFlightCheck;
    }

    const run = async (): Promise<AppUpdateState> => {
      emitState({
        status: 'checking',
        error: null,
        progress: null,
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), checkTimeoutMs);

      try {
        const apiUrl = `https://api.github.com/repos/${githubRepo}/releases/latest`;
        const response = await fetchFn(apiUrl, {
          headers: {
            'User-Agent': `WaveForm-Desktop/${currentVersion}`,
            Accept: 'application/vnd.github+json',
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`GitHub release check failed (${response.status} ${response.statusText || 'HTTP Error'})`.trim());
        }

        const release = (await response.json()) as GitHubReleasePayload;
        const rawTag = String(release.tag_name || release.name || '').trim();
        const latestVersion = rawTag.replace(/^[vV]/, '');
        if (!latestVersion) {
          throw new Error('Latest GitHub release did not contain a valid version tag.');
        }

        const { installerAsset, checksumAsset, patchAsset, manifestAsset } =
          selectReleaseAssets(release);
        const isNewer = compareSemVer(latestVersion, currentVersion) > 0;
        const now = Date.now();

        if (isNewer && (installerAsset || patchAsset)) {
          installerUrl = installerAsset?.url ?? null;
          checksumUrl = checksumAsset?.url ?? null;
          patchUrl = null;
          remoteManifestMap = null;
          plannedDelta = null;

          let chosenStrategy: 'direct_patch' | 'full_installer' = 'full_installer';
          let chosenName = installerAsset?.name ?? patchAsset?.name ?? null;
          let chosenSize = installerAsset?.size ?? patchAsset?.size ?? null;
          let changedCount: number | null = null;
          let removedCount: number | null = null;

          const localManifestPath = path.join(installDir, 'resources', 'install-manifest.tsv');
          if (patchAsset && manifestAsset && fs.existsSync(localManifestPath)) {
            try {
              const localText = fs.readFileSync(localManifestPath, 'utf-8');
              const localMap = parseInstallManifest(localText);
              const manResp = await fetchFn(manifestAsset.url, {
                headers: {
                  'User-Agent': `WaveForm-Desktop/${currentVersion}`,
                  Accept: 'text/plain',
                },
                signal: controller.signal,
              });
              if (manResp.ok) {
                const remoteText = await manResp.text();
                const remoteMap = parseInstallManifest(remoteText);
                const plan = planDeltaUpdate(localMap, remoteMap);
                if (plan.strategy === 'direct_patch') {
                  chosenStrategy = 'direct_patch';
                  patchUrl = patchAsset.url;
                  remoteManifestMap = remoteMap;
                  plannedDelta = plan;
                  chosenName = patchAsset.name;
                  chosenSize = patchAsset.size ?? plan.estimatedBytes;
                  changedCount = plan.changedFiles.length;
                  removedCount = plan.removedFiles.length;
                }
              }
            } catch {
              // Fall back seamlessly to full installer when remote manifest check fails
            }
          }

          if (chosenStrategy === 'direct_patch' || installerAsset) {
            return emitState({
              status: 'available',
              latestVersion,
              releaseName: release.name || `WaveForm v${latestVersion}`,
              releaseNotes: release.body ?? '',
              releaseUrl:
                release.html_url || `https://github.com/${githubRepo}/releases/latest`,
              publishedAt: release.published_at ?? null,
              assetName: chosenName,
              assetSize: chosenSize,
              updateStrategy: chosenStrategy,
              deltaChangedCount: changedCount,
              deltaRemovedCount: removedCount,
              progress: null,
              error: null,
              lastCheckedAt: now,
            });
          }
        }

        if (isNewer && !installerAsset && !patchAsset) {
          installerUrl = null;
          checksumUrl = null;
          if (!manual) {
            return emitState({
              status: 'idle',
              error: null,
              progress: null,
              lastCheckedAt: now,
            });
          }
          return emitState({
            status: 'error',
            latestVersion,
            releaseName: release.name || `WaveForm v${latestVersion}`,
            releaseNotes: release.body ?? '',
            releaseUrl:
              release.html_url || `https://github.com/${githubRepo}/releases/latest`,
            publishedAt: release.published_at ?? null,
            assetName: null,
            assetSize: null,
            progress: null,
            error: `Release v${latestVersion} does not include a Windows installer asset yet.`,
            lastCheckedAt: now,
          });
        }

        installerUrl = null;
        checksumUrl = null;
        return emitState({
          status: 'up-to-date',
          latestVersion,
          releaseName: release.name || `WaveForm v${latestVersion}`,
          releaseNotes: release.body ?? '',
          releaseUrl:
            release.html_url || `https://github.com/${githubRepo}/releases/latest`,
          publishedAt: release.published_at ?? null,
          assetName: installerAsset?.name ?? null,
          assetSize: installerAsset?.size ?? null,
          progress: null,
          error: null,
          lastCheckedAt: now,
        });
      } catch (err) {
        if (!manual) {
          // Automatic cold-boot checks fail silently without surfacing an error modal
          return emitState({
            status: 'idle',
            error: null,
            progress: null,
          });
        }
        return emitState({
          status: 'error',
          error: normalizeErrorMessage(err),
          progress: null,
          lastCheckedAt: Date.now(),
        });
      } finally {
        clearTimeout(timeout);
        inFlightCheck = null;
      }
    };

    inFlightCheck = run();
    return inFlightCheck;
  };

  const scheduleColdBootCheck = (delayMs = DEFAULT_COLD_BOOT_DELAY_MS): void => {
    cancelScheduledCheck();
    coldBootTimer = setTimeout(() => {
      coldBootTimer = null;
      void checkForUpdates(false);
    }, Math.max(0, delayMs));
    coldBootTimer.unref?.();
  };

  const dismissForSession = (): AppUpdateState => {
    return emitState({ dismissedThisSession: true });
  };

  const downloadAndInstall = async (): Promise<AppUpdateState> => {
    if (
      state.status === 'downloading' ||
      state.status === 'verifying' ||
      state.status === 'installing'
    ) {
      return getState();
    }

    const useDirectPatch =
      state.updateStrategy === 'direct_patch' && Boolean(patchUrl && plannedDelta && remoteManifestMap);
    const activeDownloadUrl = useDirectPatch ? patchUrl : installerUrl;

    if (!activeDownloadUrl || !state.assetName) {
      return emitState({
        status: 'error',
        error: 'No downloadable update package is currently available.',
        progress: null,
      });
    }

    const safeAssetName = path.basename(state.assetName);
    const updateDir = path.join(tempDir, 'WaveForm-Update');
    const destPath = path.join(updateDir, safeAssetName);

    const cleanupDownloadedInstaller = async () => {
      await fs.promises.rm(destPath, { force: true }).catch(() => {});
      await fs.promises.rm(updateDir, { recursive: true, force: true }).catch(() => {});
    };

    try {
      await fs.promises.rm(updateDir, { recursive: true, force: true });
      await fs.promises.mkdir(updateDir, { recursive: true });

      const totalKnown = state.assetSize ?? 0;
      emitState({
        status: 'downloading',
        error: null,
        progress: {
          bytesDownloaded: 0,
          totalBytes: totalKnown,
          percent: 0,
          bytesPerSecond: 0,
        },
      });

      const downloadResp = await fetchFn(activeDownloadUrl, {
        headers: {
          'User-Agent': `WaveForm-Desktop/${currentVersion}`,
          Accept: 'application/octet-stream',
        },
      });

      if (!downloadResp.ok) {
        throw new Error(
          `Failed to download installer (${downloadResp.status} ${downloadResp.statusText || 'HTTP Error'})`.trim()
        );
      }

      const headerLen = Number(downloadResp.headers?.get?.('content-length') || 0);
      const totalBytes = Number.isFinite(headerLen) && headerLen > 0 ? headerLen : totalKnown;

      await streamBodyToFile(downloadResp, destPath, totalBytes, (progress) => {
        if (state.status === 'downloading') {
          emitState({ progress });
        }
      });

      emitState({
        status: 'verifying',
        progress: null,
        error: null,
      });

      if (!checksumUrl) {
        await cleanupDownloadedInstaller();
        return emitState({
          status: 'error',
          progress: null,
          error: 'SHA256SUMS.txt is missing from the release. Update aborted and installer removed.',
        });
      }

      const checksumResp = await fetchFn(checksumUrl, {
        headers: {
          'User-Agent': `WaveForm-Desktop/${currentVersion}`,
          Accept: 'text/plain',
        },
      });

      if (!checksumResp.ok) {
        await cleanupDownloadedInstaller();
        return emitState({
          status: 'error',
          progress: null,
          error: `Failed to download SHA256SUMS.txt (${checksumResp.status}). Update aborted and installer removed.`,
        });
      }

      const sumsText = await checksumResp.text();
      const sumsMap = parseSha256Sums(sumsText);
      let expectedHash = sumsMap.get(safeAssetName);
      if (!expectedHash) {
        const lowerTarget = safeAssetName.toLowerCase();
        for (const [key, val] of sumsMap.entries()) {
          if (key.toLowerCase() === lowerTarget) {
            expectedHash = val;
            break;
          }
        }
      }

      if (!expectedHash) {
        await cleanupDownloadedInstaller();
        return emitState({
          status: 'error',
          progress: null,
          error: `Missing SHA-256 checksum entry for ${safeAssetName}. Update aborted and installer removed.`,
        });
      }

      const actualHash = await computeFileSha256(destPath);
      if (actualHash !== expectedHash.toLowerCase()) {
        await cleanupDownloadedInstaller();
        return emitState({
          status: 'error',
          progress: null,
          error: `SHA-256 checksum mismatch for ${safeAssetName}. Downloaded installer was deleted for safety.`,
        });
      }

      if (useDirectPatch && plannedDelta && remoteManifestMap) {
        const stagingDir = path.join(updateDir, 'staging');
        await fs.promises.mkdir(stagingDir, { recursive: true });
        await extractZipFn(destPath, stagingDir);

        for (const relPath of plannedDelta.changedFiles) {
          const expectedEntry = remoteManifestMap.get(relPath);
          if (!expectedEntry) continue;
          const stagedFilePath = path.join(stagingDir, relPath.replace(/\\/g, path.sep));
          if (!fs.existsSync(stagedFilePath)) {
            await cleanupDownloadedInstaller();
            return emitState({
              status: 'error',
              progress: null,
              error: `Extracted patch missing modified file ${relPath}. Update aborted.`,
            });
          }
          const ok = await verifyFileSha256(stagedFilePath, expectedEntry.sha256);
          if (!ok) {
            await cleanupDownloadedInstaller();
            return emitState({
              status: 'error',
              progress: null,
              error: `SHA-256 verification failed for extracted file ${relPath}. Update aborted.`,
            });
          }
        }

        emitState({
          status: 'installing',
          progress: null,
          error: null,
        });

        const scriptText = buildDirectPatchApplierScript({
          targetPid,
          installDir,
          stagingDir,
          updateDir,
          relaunchExePath,
          targetVersion: state.latestVersion || currentVersion,
          changedFiles: plannedDelta.changedFiles,
          removedFiles: plannedDelta.removedFiles,
        });
        const scriptPath = path.join(updateDir, 'apply-patch.ps1');
        await fs.promises.writeFile(scriptPath, scriptText, 'utf-8');

        const child = spawnFn(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-WindowStyle',
            'Hidden',
            '-File',
            scriptPath,
          ],
          {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          }
        );
        child?.unref?.();

        const quitTimer = setTimeout(() => {
          quitFn();
        }, quitDelayMs);
        quitTimer.unref?.();

        return getState();
      }

      emitState({
        status: 'installing',
        progress: null,
        error: null,
      });

      const psCommand = [
        'Start-Sleep -Milliseconds 800',
        `$proc = Start-Process -FilePath ${psSingleQuote(destPath)} -ArgumentList '/S' -Wait -PassThru`,
        `if ($proc -and $proc.ExitCode -eq 0 -and (Test-Path -LiteralPath ${psSingleQuote(relaunchExePath)})) { Start-Process -FilePath ${psSingleQuote(relaunchExePath)} }`,
      ].join('; ');

      const child = spawnFn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-WindowStyle',
          'Hidden',
          '-Command',
          psCommand,
        ],
        {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        }
      );

      child?.unref?.();

      const quitTimer = setTimeout(() => {
        quitFn();
      }, quitDelayMs);
      quitTimer.unref?.();

      return getState();
    } catch (err) {
      await cleanupDownloadedInstaller();
      return emitState({
        status: 'error',
        progress: null,
        error: normalizeErrorMessage(err),
      });
    }
  };

  const openReleasePage = async (): Promise<void> => {
    const fallbackUrl = `https://github.com/${githubRepo}/releases/latest`;
    const targetUrl = state.releaseUrl && /^https:\/\//i.test(state.releaseUrl)
      ? state.releaseUrl
      : fallbackUrl;
    await openExternalFn(targetUrl);
  };

  const dispose = (): void => {
    cancelScheduledCheck();
  };

  return {
    getState,
    checkForUpdates,
    scheduleColdBootCheck,
    cancelScheduledCheck,
    dismissForSession,
    downloadAndInstall,
    openReleasePage,
    dispose,
  };
}

export interface InitAppUpdaterIpcDeps {
  ipcMain: {
    handle: (channel: string, listener: (...args: any[]) => any) => void;
    removeHandler?: (channel: string) => void;
  };
  app: {
    getVersion?: () => string;
    quit?: () => void;
    once?: (event: string, listener: (...args: any[]) => void) => void;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  getMainWindow: () => {
    isDestroyed?: () => boolean;
    isVisible?: () => boolean;
    once?: (event: string, listener: () => void) => void;
    webContents?: {
      isDestroyed?: () => boolean;
      send: (channel: string, ...args: any[]) => void;
    };
  } | null;
  fetchFn?: typeof fetch;
  tempDir?: string;
  installDir?: string;
}

export function initAppUpdaterIpc({
  ipcMain,
  app,
  shell,
  getMainWindow,
  fetchFn,
  tempDir,
  installDir,
}: InitAppUpdaterIpcDeps) {
  const controller = createAppUpdaterController({
    currentVersion: app.getVersion?.() || '1.0.0',
    fetchFn,
    tempDir,
    installDir,
    quitFn: () => app.quit?.(),
    openExternalFn: (url) => shell.openExternal(url),
    onStateChange: (nextState) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed?.() && !win.webContents?.isDestroyed?.()) {
        win.webContents?.send('updater:state-changed', nextState);
      }
    },
  });

  const registerHandle = (channel: string, handler: (...args: any[]) => any) => {
    ipcMain.removeHandler?.(channel);
    ipcMain.handle(channel, handler);
  };

  registerHandle('updater:check', () => controller.checkForUpdates(true));
  registerHandle('updater:downloadAndInstall', () => controller.downloadAndInstall());
  registerHandle('updater:dismissForSession', () => controller.dismissForSession());
  registerHandle('updater:getState', () => controller.getState());
  registerHandle('updater:openReleasePage', () => controller.openReleasePage());

  let coldBootScheduled = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  const triggerColdBoot = () => {
    if (coldBootScheduled) return;
    coldBootScheduled = true;
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    controller.scheduleColdBootCheck(DEFAULT_COLD_BOOT_DELAY_MS);
  };

  const win = getMainWindow();
  if (win && !win.isDestroyed?.()) {
    if (win.isVisible?.()) {
      triggerColdBoot();
    } else {
      win.once?.('ready-to-show', triggerColdBoot);
      fallbackTimer = setTimeout(triggerColdBoot, 6000);
      fallbackTimer.unref?.();
    }
  } else {
    app.once?.('browser-window-created', (_event: unknown, createdWin: any) => {
      if (createdWin && !createdWin.isDestroyed?.()) {
        if (createdWin.isVisible?.()) {
          triggerColdBoot();
        } else {
          createdWin.once?.('ready-to-show', triggerColdBoot);
        }
      }
    });
    fallbackTimer = setTimeout(triggerColdBoot, 6000);
    fallbackTimer.unref?.();
  }

  return controller;
}
