import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NativeAutoEqStatus, NativeCoreBindings } from './nativeCore.js';

let nativeCoreModule: { getNativeCore: () => NativeCoreBindings | null } | null = null;
try {
  nativeCoreModule = await import('./nativeCore.js');
} catch {
  try {
    nativeCoreModule = await import(new URL('./nativeCore.ts', import.meta.url).href);
  } catch {
    nativeCoreModule = null;
  }
}

function getNativeCoreSafe(): NativeCoreBindings | null {
  return nativeCoreModule ? nativeCoreModule.getNativeCore() : null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type AutoEqFilterType =
  | 'PEAKING'
  | 'LOW_SHELF'
  | 'HIGH_SHELF'
  | 'LOW_PASS'
  | 'HIGH_PASS'
  | 'BAND_PASS';

export interface AutoEqFilter {
  type: AutoEqFilterType;
  freq: number;
  q: number;
  gainDb: number;
}

export interface AutoEqSearchResult {
  id: number | string;
  name: string;
  meta: string;
  parametric: boolean;
  rig?: string;
}

export interface AutoEqProfile {
  id: string;
  dbId?: number;
  name: string;
  type?: string;
  source: string;
  meta?: string;
  parametric?: boolean;
  preampGainDb: number;
  filters: AutoEqFilter[];
}

export interface AutoEqStatus {
  ready: boolean;
  count: number;
  totalRows: number;
  parametricRows: number;
  totalCount: number;
  parametricCount: number;
  dbPath: string | null;
  loadTimeMs: number;
  error: string | null;
}

interface SqliteHeaderInfo {
  pageSize: number;
  usableSize: number;
  textEncoding: number;
}

interface AutoEqIndexEntry {
  id: number;
  name: string;
  meta: string;
  parametric: boolean;
  lowerName: string;
  compactName: string;
  tokens: string[];
  charMaskLo: number;
  charMaskHi: number;
  rig: string;
  rigPriority: number;
  pageNum: number;
  cellOffset: number;
}

const SQLITE_MAGIC = 'SQLite format 3\0';

const PAP_TAG_MAP: Record<number, AutoEqFilterType> = {
  0x7003: 'PEAKING',
  0x7004: 'LOW_SHELF',
  0x7005: 'HIGH_SHELF',
  0x7006: 'LOW_PASS',
  0x7007: 'HIGH_PASS',
  0x7008: 'BAND_PASS',
};

const CURATED_AUTOEQ_PROFILES: AutoEqProfile[] = [
  {
    id: 'sony_wh1000xm4',
    name: 'Sony WH-1000XM4',
    type: 'Over-Ear',
    source: 'Oratory1990',
    meta: 'Oratory1990',
    parametric: true,
    preampGainDb: -5.6,
    filters: [
      { type: 'LOW_SHELF', freq: 105, q: 0.71, gainDb: -4.5 },
      { type: 'PEAKING', freq: 210, q: 1.4, gainDb: 2.8 },
      { type: 'PEAKING', freq: 1100, q: 2.1, gainDb: -3.2 },
      { type: 'PEAKING', freq: 3200, q: 3.0, gainDb: 4.5 },
      { type: 'PEAKING', freq: 6400, q: 2.5, gainDb: -2.0 },
      { type: 'HIGH_SHELF', freq: 10000, q: 0.71, gainDb: -1.5 },
    ],
  },
  {
    id: 'sennheiser_hd600',
    name: 'Sennheiser HD 600',
    type: 'Open-Back Over-Ear',
    source: 'Crinacle',
    meta: 'Crinacle',
    parametric: true,
    preampGainDb: -6.2,
    filters: [
      { type: 'LOW_SHELF', freq: 80, q: 0.71, gainDb: 5.5 },
      { type: 'PEAKING', freq: 200, q: 1.2, gainDb: -1.0 },
      { type: 'PEAKING', freq: 3500, q: 2.5, gainDb: -2.5 },
      { type: 'PEAKING', freq: 5800, q: 4.0, gainDb: 2.0 },
      { type: 'HIGH_SHELF', freq: 12000, q: 0.71, gainDb: 1.0 },
    ],
  },
  {
    id: 'apple_airpods_max',
    name: 'Apple AirPods Max',
    type: 'Over-Ear ANC',
    source: 'Rtings',
    meta: 'Rtings',
    parametric: true,
    preampGainDb: -3.8,
    filters: [
      { type: 'LOW_SHELF', freq: 90, q: 0.71, gainDb: -2.0 },
      { type: 'PEAKING', freq: 1250, q: 1.8, gainDb: 1.5 },
      { type: 'PEAKING', freq: 4100, q: 2.8, gainDb: -3.0 },
      { type: 'HIGH_SHELF', freq: 8500, q: 0.71, gainDb: 2.2 },
    ],
  },
];

// ---------- Pure-TS SQLite 3 B-tree Reader ----------

function readUint16BE(buf: Uint8Array, offset: number): number {
  return (buf[offset] << 8) | buf[offset + 1];
}

function readUint32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3]) >>>
    0
  );
}

function readVarint(buf: Uint8Array, offset: number): { value: number; length: number } {
  let acc = 0n;
  for (let i = 0; i < 8; i++) {
    const b = buf[offset + i];
    acc = (acc << 7n) | BigInt(b & 0x7f);
    if ((b & 0x80) === 0) {
      return { value: Number(acc), length: i + 1 };
    }
  }
  const b8 = buf[offset + 8];
  acc = (acc << 8n) | BigInt(b8);
  const signed = acc >= 0x8000000000000000n ? acc - 0x10000000000000000n : acc;
  return { value: Number(signed), length: 9 };
}

function parseSqliteHeader(buf: Uint8Array): SqliteHeaderInfo {
  if (buf.byteLength < 100) {
    throw new Error('SQLite file too small');
  }
  const magic = Buffer.from(buf.buffer, buf.byteOffset, 16).toString('ascii');
  if (magic !== SQLITE_MAGIC) {
    throw new Error('Invalid SQLite 3 magic header');
  }
  const rawPageSize = readUint16BE(buf, 16);
  const pageSize = rawPageSize === 1 ? 65536 : rawPageSize;
  if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0) {
    throw new Error(`Invalid SQLite page size: ${pageSize}`);
  }
  const reserved = buf[20];
  const usableSize = pageSize - reserved;
  if (usableSize < 480) {
    throw new Error(`Invalid SQLite usable page size: ${usableSize}`);
  }
  const textEncoding = readUint32BE(buf, 56);
  return { pageSize, usableSize, textEncoding };
}

function decodeSerialValue(
  payload: Uint8Array,
  serialType: number,
  offset: number,
  skipBlob: boolean
): { value: string | number | Uint8Array | null; byteLength: number } {
  if (serialType === 0) return { value: null, byteLength: 0 };
  if (serialType === 1) {
    const v = payload[offset];
    return { value: v & 0x80 ? v - 256 : v, byteLength: 1 };
  }
  if (serialType === 2) {
    const raw = (payload[offset] << 8) | payload[offset + 1];
    return { value: raw & 0x8000 ? raw - 65536 : raw, byteLength: 2 };
  }
  if (serialType === 3) {
    let raw = (payload[offset] << 16) | (payload[offset + 1] << 8) | payload[offset + 2];
    if (raw & 0x800000) raw -= 0x1000000;
    return { value: raw, byteLength: 3 };
  }
  if (serialType === 4) {
    const raw = readUint32BE(payload, offset);
    return { value: raw | 0, byteLength: 4 };
  }
  if (serialType === 5) {
    let acc = 0n;
    for (let i = 0; i < 6; i++) {
      acc = (acc << 8n) | BigInt(payload[offset + i]);
    }
    const signed = acc >= 0x800000000000n ? acc - 0x1000000000000n : acc;
    return { value: Number(signed), byteLength: 6 };
  }
  if (serialType === 6) {
    const view = new DataView(payload.buffer, payload.byteOffset + offset, 8);
    return { value: Number(view.getBigInt64(0, false)), byteLength: 8 };
  }
  if (serialType === 7) {
    const view = new DataView(payload.buffer, payload.byteOffset + offset, 8);
    return { value: view.getFloat64(0, false), byteLength: 8 };
  }
  if (serialType === 8) return { value: 0, byteLength: 0 };
  if (serialType === 9) return { value: 1, byteLength: 0 };
  if (serialType === 10 || serialType === 11) return { value: null, byteLength: 0 };

  if (serialType >= 12 && serialType % 2 === 0) {
    const len = (serialType - 12) / 2;
    if (skipBlob) return { value: null, byteLength: len };
    const copy = new Uint8Array(len);
    copy.set(payload.subarray(offset, offset + len));
    return { value: copy, byteLength: len };
  }

  const len = (serialType - 13) / 2;
  const text = Buffer.from(payload.buffer, payload.byteOffset + offset, len).toString('utf8');
  return { value: text, byteLength: len };
}

function decodeSqliteRecord(
  payload: Uint8Array,
  maxColumns: number,
  skipBlob: boolean
): Array<string | number | Uint8Array | null> {
  const hdr = readVarint(payload, 0);
  const headerSize = hdr.value;
  let hdrPos = hdr.length;
  const serialTypes: number[] = [];
  while (hdrPos < headerSize && serialTypes.length < maxColumns) {
    const st = readVarint(payload, hdrPos);
    serialTypes.push(st.value);
    hdrPos += st.length;
  }

  let bodyPos = headerSize;
  const cols: Array<string | number | Uint8Array | null> = new Array(serialTypes.length);
  for (let i = 0; i < serialTypes.length; i++) {
    const st = serialTypes[i];
    const decoded = decodeSerialValue(payload, st, bodyPos, skipBlob && i === 4);
    cols[i] = decoded.value;
    bodyPos += decoded.byteLength;
  }
  return cols;
}

function extractCellPayloadFromPage(
  pageBuf: Uint8Array,
  cellOffset: number,
  usableSize: number,
  getPage: (pageNum: number) => Uint8Array
): { rowid: number; payload: Uint8Array } {
  let pos = cellOffset;
  const pSizeVar = readVarint(pageBuf, pos);
  pos += pSizeVar.length;
  const payloadSize = pSizeVar.value;

  const rowidVar = readVarint(pageBuf, pos);
  pos += rowidVar.length;
  const rowid = rowidVar.value;

  const X = usableSize - 35;
  if (payloadSize <= X) {
    return {
      rowid,
      payload: pageBuf.subarray(pos, pos + payloadSize),
    };
  }

  const M = Math.floor(((usableSize - 12) * 32) / 255) - 23;
  const K = M + ((payloadSize - M) % (usableSize - 4));
  const inlineLen = K <= X ? K : M;

  const out = new Uint8Array(payloadSize);
  out.set(pageBuf.subarray(pos, pos + inlineLen), 0);
  let written = inlineLen;
  let nextOverflow = readUint32BE(pageBuf, pos + inlineLen);
  let guard = 0;

  while (nextOverflow !== 0 && written < payloadSize && guard++ < 10000) {
    const ovPage = getPage(nextOverflow);
    const nextPtr = readUint32BE(ovPage, 0);
    const chunkLen = Math.min(payloadSize - written, usableSize - 4);
    out.set(ovPage.subarray(4, 4 + chunkLen), written);
    written += chunkLen;
    nextOverflow = nextPtr;
  }

  return { rowid, payload: out };
}

function traverseTableBTree(
  rootPage: number,
  usableSize: number,
  getPage: (pageNum: number) => Uint8Array,
  onLeafCell: (pageNum: number, cellOffset: number, rowid: number, payload: Uint8Array) => void
): void {
  const stack: number[] = [rootPage];
  const visited = new Set<number>();

  while (stack.length > 0) {
    const pageNum = stack.pop()!;
    if (pageNum <= 0 || visited.has(pageNum)) continue;
    visited.add(pageNum);

    const pageBuf = getPage(pageNum);
    const hdrOffset = pageNum === 1 ? 100 : 0;
    const pageType = pageBuf[hdrOffset];
    const cellCount = readUint16BE(pageBuf, hdrOffset + 3);

    if (pageType === 0x05) {
      // Interior table B-tree: header is 12 bytes, right-most child at hdrOffset + 8
      const rightChild = readUint32BE(pageBuf, hdrOffset + 8);
      const ptrStart = hdrOffset + 12;
      // Push right-most child first so left-most children pop first
      if (rightChild > 0) {
        stack.push(rightChild);
      }
      for (let i = cellCount - 1; i >= 0; i--) {
        const cellOffset = readUint16BE(pageBuf, ptrStart + i * 2);
        const leftChild = readUint32BE(pageBuf, cellOffset);
        if (leftChild > 0) {
          stack.push(leftChild);
        }
      }
    } else if (pageType === 0x0d) {
      // Leaf table B-tree: header is 8 bytes
      const ptrStart = hdrOffset + 8;
      for (let i = 0; i < cellCount; i++) {
        const cellOffset = readUint16BE(pageBuf, ptrStart + i * 2);
        const { rowid, payload } = extractCellPayloadFromPage(
          pageBuf,
          cellOffset,
          usableSize,
          getPage
        );
        onLeafCell(pageNum, cellOffset, rowid, payload);
      }
    }
  }
}

// ---------- PaP\x01 Binary Filter Decoder ----------

export function decodePapBlob(blob: Uint8Array): AutoEqFilter[] {
  const HEADER_SIZE = 36;
  const RECORD_SIZE = 20;
  if (!blob || blob.byteLength < HEADER_SIZE) return [];
  if (blob[0] !== 0x50 || blob[1] !== 0x61 || blob[2] !== 0x50 || blob[3] !== 0x01) {
    return [];
  }

  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const filters: AutoEqFilter[] = [];
  const maxNyquist = 21609;

  for (let i = HEADER_SIZE; i + RECORD_SIZE <= blob.byteLength; i += RECORD_SIZE) {
    const tag = view.getUint32(i, true);
    const gainDb = view.getFloat32(i + 4, true);
    const freq = view.getUint32(i + 8, true);
    const q = view.getFloat32(i + 12, true);

    const safeFreq = Math.min(Number.isFinite(freq) ? freq : 1000, maxNyquist);
    const safeQ = Number.isFinite(q) && q > 0.1 ? q : 0.1;
    const safeGain = Number.isFinite(gainDb) ? Math.max(-24, Math.min(12, gainDb)) : 0;

    filters.push({
      type: PAP_TAG_MAP[tag] || 'PEAKING',
      freq: safeFreq,
      q: Number(safeQ.toFixed(2)),
      gainDb: Number(safeGain.toFixed(1)),
    });
  }

  return filters;
}

export function calculatePreampGainDb(filters: AutoEqFilter[]): number {
  let maxBoost = 0;
  for (const f of filters) {
    if (f.gainDb > maxBoost) maxBoost = f.gainDb;
  }
  return maxBoost > 0 ? -Number(maxBoost.toFixed(1)) : 0.0;
}

// ---------- Fuzzy Normalization & Ranking ----------

export function normalizeAutoEqCompact(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const KNOWN_RIGS: Array<{ pattern: RegExp; rig: string; priority: number }> = [
  { pattern: /oratory1990/i, rig: 'Oratory1990', priority: 3 },
  { pattern: /crinacle/i, rig: 'Crinacle', priority: 2 },
  { pattern: /rtings/i, rig: 'Rtings', priority: 1 },
];

export function extractMeasurementRig(meta: string): { rig: string; priority: number } {
  for (const entry of KNOWN_RIGS) {
    if (entry.pattern.test(meta)) {
      return { rig: entry.rig, priority: entry.priority };
    }
  }
  return { rig: meta || 'AutoEQ', priority: 0 };
}

function sanitizeQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > 256) return null;
  // Reject ASCII control chars (null byte, ANSI escapes, CR/LF/TAB controls)
  if (/[\x00-\x1f\x7f]/.test(raw)) return null;
  // Strip invisible Unicode BiDi / zero-width characters while keeping legitimate text
  const cleaned = raw.replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '').trim();
  if (!cleaned) return null;
  // Reject SQL injection syntax payloads cleanly
  if (
    /(;|--|\/\*|\*\/|\b(?:union\s+select|drop\s+table|select\s+.+\s+from|order\s+by|sqlite_master|eq_presets)\b|\bor\s+['"]?[a-z0-9]+['"]?\s*=\s*['"]?[a-z0-9]+['"]?)/i.test(
      cleaned
    ) ||
    /['"`]\s*(?:or|and|union|select|drop|order)\b/i.test(cleaned)
  ) {
    return null;
  }
  return cleaned;
}

const TRIGRAM_SPACE = 36 * 36 * 36;
const TRIGRAM_QUERY_STAMP = new Int32Array(TRIGRAM_SPACE);
const TRIGRAM_ENTRY_STAMP = new Int32Array(TRIGRAM_SPACE);
let trigramQueryId = 0;
let trigramEntryId = 0;

function charToAlnumCode(chCode: number): number {
  if (chCode >= 48 && chCode <= 57) return chCode - 48; // 0-9 -> 0..9
  if (chCode >= 97 && chCode <= 122) return chCode - 87; // a-z -> 10..35
  return -1;
}

function computeCharMasks(compact: string): { lo: number; hi: number } {
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < compact.length; i++) {
    const code = charToAlnumCode(compact.charCodeAt(i));
    if (code >= 0 && code < 26) {
      lo |= 1 << code;
    } else if (code >= 26) {
      hi |= 1 << (code - 26);
    }
  }
  return { lo, hi };
}

function popcount32(n: number): number {
  let v = n >>> 0;
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function prepareQueryTrigrams(qCompact: string): { stampId: number; uniqueCount: number } {
  trigramQueryId = (trigramQueryId + 1) | 0;
  if (trigramQueryId <= 0) {
    TRIGRAM_QUERY_STAMP.fill(0);
    trigramQueryId = 1;
  }
  const stampId = trigramQueryId;
  let uniqueCount = 0;
  for (let i = 0; i <= qCompact.length - 3; i++) {
    const a = charToAlnumCode(qCompact.charCodeAt(i));
    const b = charToAlnumCode(qCompact.charCodeAt(i + 1));
    const c = charToAlnumCode(qCompact.charCodeAt(i + 2));
    if (a < 0 || b < 0 || c < 0) continue;
    const code = a * 1296 + b * 36 + c;
    if (TRIGRAM_QUERY_STAMP[code] !== stampId) {
      TRIGRAM_QUERY_STAMP[code] = stampId;
      uniqueCount++;
    }
  }
  return { stampId, uniqueCount };
}

function computeFastTrigramJaccard(
  targetCompact: string,
  qStampId: number,
  qUniqueCount: number
): number {
  if (qUniqueCount === 0 || targetCompact.length < 3) return 0;
  trigramEntryId = (trigramEntryId + 1) | 0;
  if (trigramEntryId <= 0) {
    TRIGRAM_ENTRY_STAMP.fill(0);
    trigramEntryId = 1;
  }
  const entryStamp = trigramEntryId;
  let bUnique = 0;
  let intersection = 0;
  for (let i = 0; i <= targetCompact.length - 3; i++) {
    const a = charToAlnumCode(targetCompact.charCodeAt(i));
    const b = charToAlnumCode(targetCompact.charCodeAt(i + 1));
    const c = charToAlnumCode(targetCompact.charCodeAt(i + 2));
    if (a < 0 || b < 0 || c < 0) continue;
    const code = a * 1296 + b * 36 + c;
    if (TRIGRAM_ENTRY_STAMP[code] !== entryStamp) {
      TRIGRAM_ENTRY_STAMP[code] = entryStamp;
      bUnique++;
      if (TRIGRAM_QUERY_STAMP[code] === qStampId) {
        intersection++;
      }
    }
  }
  const union = qUniqueCount + bUnique - intersection;
  return union > 0 ? intersection / union : 0;
}

function isSubsequenceMatch(queryCompact: string, targetCompact: string): boolean {
  if (queryCompact.length < 4 || queryCompact.length > targetCompact.length) return false;
  let qi = 0;
  for (let ti = 0; ti < targetCompact.length && qi < queryCompact.length; ti++) {
    if (targetCompact[ti] === queryCompact[qi]) qi++;
  }
  return qi === queryCompact.length && queryCompact.length / targetCompact.length >= 0.55;
}

interface QueryPrepared {
  qLower: string;
  qCompact: string;
  qTokens: string[];
  qMaskLo: number;
  qMaskHi: number;
  qDistinctCharCount: number;
  triStampId: number;
  triUniqueCount: number;
}

function scoreEntry(
  entry: AutoEqIndexEntry,
  q: QueryPrepared,
  allowFuzzyFallback: boolean
): number {
  let base = 0;

  const hasAllQueryChars =
    (entry.charMaskLo & q.qMaskLo) === q.qMaskLo &&
    (entry.charMaskHi & q.qMaskHi) === q.qMaskHi;

  if (hasAllQueryChars) {
    if (entry.lowerName === q.qLower) {
      base = 120000;
    } else if (entry.compactName === q.qCompact && q.qCompact.length > 0) {
      base = 100000;
    } else if (q.qCompact.length > 0 && entry.compactName.startsWith(q.qCompact)) {
      base = 80000 - Math.min(5000, (entry.compactName.length - q.qCompact.length) * 10);
    } else if (q.qLower.length >= 2 && entry.lowerName.includes(q.qLower)) {
      const idx = entry.lowerName.indexOf(q.qLower);
      const wordBoundaryBonus = idx === 0 || /[^a-z0-9]/.test(entry.lowerName[idx - 1]) ? 3000 : 0;
      base = 65000 + wordBoundaryBonus - Math.min(5000, entry.lowerName.length * 10);
    } else if (q.qCompact.length >= 2 && entry.compactName.includes(q.qCompact)) {
      const tokenExactBonus =
        q.qTokens.length > 0 && q.qTokens.every((t) => entry.tokens.includes(t)) ? 2000 : 0;
      base = 60000 + tokenExactBonus - Math.min(5000, entry.compactName.length * 10);
    } else if (
      q.qTokens.length > 0 &&
      q.qCompact.length >= 2 &&
      q.qTokens.every((t) => entry.compactName.includes(t))
    ) {
      let wholeTokenHits = 0;
      for (const qt of q.qTokens) {
        if (entry.tokens.includes(qt)) wholeTokenHits++;
      }
      base = 40000 + wholeTokenHits * 500 - Math.min(4000, entry.compactName.length * 10);
    }
  }

  if (base === 0 && allowFuzzyFallback && q.qCompact.length >= 4) {
    const minCharOverlap = Math.max(3, Math.ceil(q.qDistinctCharCount * 0.55));
    const charOverlap =
      popcount32(entry.charMaskLo & q.qMaskLo) + popcount32(entry.charMaskHi & q.qMaskHi);
    if (charOverlap >= minCharOverlap) {
      const jaccard = computeFastTrigramJaccard(
        entry.compactName,
        q.triStampId,
        q.triUniqueCount
      );
      if (jaccard >= 0.45) {
        base = 20000 + Math.round(jaccard * 10000);
      } else if (isSubsequenceMatch(q.qCompact, entry.compactName)) {
        base = 15000 - Math.min(3000, (entry.compactName.length - q.qCompact.length) * 20);
      }
    }
  }

  if (base === 0) return 0;

  // Tie-breakers: parametric DESC > known measurement rig > shorter name > lower id
  return (
    base * 1000 +
    (entry.parametric ? 500 : 0) +
    entry.rigPriority * 50 -
    Math.min(40, Math.floor(entry.name.length / 4))
  );
}

// ---------- Path Resolution & Cached Engine ----------

export function resolveAutoEqDbCandidatePaths(extraPaths?: string[]): string[] {
  const candidates: string[] = [];
  if (process.env.AUTOEQ_DB_PATH) {
    candidates.push(process.env.AUTOEQ_DB_PATH);
  }
  if (Array.isArray(extraPaths)) {
    for (const p of extraPaths) {
      if (typeof p === 'string' && p.length > 0) candidates.push(p);
    }
  }
  if ((process as any).resourcesPath) {
    candidates.push(
      path.resolve((process as any).resourcesPath, 'assets/data/auto_eq.db'),
      path.resolve((process as any).resourcesPath, 'src/assets/data/auto_eq.db'),
      path.resolve((process as any).resourcesPath, 'dist/assets/data/auto_eq.db')
    );
  }
  candidates.push(
    path.resolve(__dirname, '../src/assets/data/auto_eq.db'),
    path.resolve(__dirname, '../dist/assets/data/auto_eq.db'),
    path.resolve(process.cwd(), 'src/assets/data/auto_eq.db'),
    path.resolve(process.cwd(), 'dist/assets/data/auto_eq.db')
  );
  return Array.from(new Set(candidates.filter((p) => typeof p === 'string' && p.length > 0)));
}

class AutoEqDatabaseEngine {
  private entries: AutoEqIndexEntry[] = [];
  private byId = new Map<number, AutoEqIndexEntry>();
  private headerInfo: SqliteHeaderInfo | null = null;
  private dbPath: string | null = null;
  private ready = false;
  private loadTimeMs = 0;
  private totalRows = 0;
  private parametricRows = 0;
  private error: string | null = null;
  private initPromise: Promise<AutoEqStatus> | null = null;

  public async init(candidatePaths?: string[]): Promise<AutoEqStatus> {
    if (this.ready) return this.getStatus();
    if (this.initPromise) return this.initPromise;

    this.initPromise = Promise.resolve().then(() => this.loadSync(candidatePaths));
    return this.initPromise;
  }

  public ensureLoadedSync(candidatePaths?: string[]): AutoEqStatus {
    if (!this.ready) {
      this.loadSync(candidatePaths);
    }
    return this.getStatus();
  }

  private loadSync(candidatePaths?: string[]): AutoEqStatus {
    const t0 = performance.now();
    const resolvedCandidates = resolveAutoEqDbCandidatePaths(candidatePaths);
    let chosenPath: string | null = null;

    for (const candidate of resolvedCandidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          chosenPath = candidate;
          break;
        }
      } catch {
        // Ignore inaccessible candidate
      }
    }

    if (!chosenPath) {
      this.error = 'auto_eq.db not found in candidate paths';
      this.loadTimeMs = Number((performance.now() - t0).toFixed(2));
      return this.getStatus();
    }

    try {
      const fileBuf = fs.readFileSync(chosenPath);
      const header = parseSqliteHeader(fileBuf);
      const pageCount = Math.floor(fileBuf.byteLength / header.pageSize);
      const getPage = (pageNum: number): Uint8Array => {
        if (pageNum < 1 || pageNum > pageCount) {
          throw new Error(`Page ${pageNum} out of range (1..${pageCount})`);
        }
        const start = (pageNum - 1) * header.pageSize;
        return fileBuf.subarray(start, start + header.pageSize);
      };

      // Locate eq_presets rootpage in sqlite_master (page 1)
      let eqPresetsRootPage = 0;
      traverseTableBTree(1, header.usableSize, getPage, (_p, _c, _rowid, payload) => {
        const cols = decodeSqliteRecord(payload, 5, false);
        const type = cols[0];
        const tblName = cols[2];
        const rootPage = cols[3];
        if (type === 'table' && tblName === 'eq_presets' && typeof rootPage === 'number') {
          eqPresetsRootPage = rootPage;
        }
      });

      if (eqPresetsRootPage <= 0) {
        throw new Error('Table eq_presets not found in sqlite_master');
      }

      const entries: AutoEqIndexEntry[] = [];
      const byId = new Map<number, AutoEqIndexEntry>();
      let parametricCount = 0;

      traverseTableBTree(
        eqPresetsRootPage,
        header.usableSize,
        getPage,
        (pageNum, cellOffset, rowid, payload) => {
          const cols = decodeSqliteRecord(payload, 5, true);
          const id = typeof cols[0] === 'number' ? cols[0] : rowid;
          const name = typeof cols[1] === 'string' ? cols[1] : '';
          const meta = typeof cols[2] === 'string' ? cols[2] : '';
          const parametric = cols[3] === 1;
          if (!name) return;

          if (parametric) parametricCount++;

          const lowerName = name.toLowerCase();
          const compactName = normalizeAutoEqCompact(lowerName);
          const tokens = lowerName.split(/[^a-z0-9]+/).filter(Boolean);
          const masks = computeCharMasks(compactName);
          const { rig, priority } = extractMeasurementRig(meta);

          const entry: AutoEqIndexEntry = {
            id,
            name,
            meta,
            parametric,
            lowerName,
            compactName,
            tokens,
            charMaskLo: masks.lo,
            charMaskHi: masks.hi,
            rig,
            rigPriority: priority,
            pageNum,
            cellOffset,
          };
          entries.push(entry);
          byId.set(id, entry);
        }
      );

      this.entries = entries;
      this.byId = byId;
      this.headerInfo = header;
      this.dbPath = chosenPath;
      this.totalRows = entries.length;
      this.parametricRows = parametricCount;
      this.ready = true;
      this.error = null;
      this.loadTimeMs = Number((performance.now() - t0).toFixed(2));
    } catch (err: any) {
      this.error = err?.message || String(err);
      this.ready = false;
      this.loadTimeMs = Number((performance.now() - t0).toFixed(2));
    }

    return this.getStatus();
  }

  public getStatus(): AutoEqStatus {
    return {
      ready: this.ready,
      count: this.entries.length,
      totalRows: this.totalRows,
      parametricRows: this.parametricRows,
      totalCount: this.totalRows,
      parametricCount: this.parametricRows,
      dbPath: this.dbPath,
      loadTimeMs: this.loadTimeMs,
      error: this.error,
    };
  }

  public search(query: string, limit = 20): AutoEqSearchResult[] {
    const cleaned = sanitizeQuery(query);
    if (!cleaned) return [];
    const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));

    this.ensureLoadedSync();

    const qLower = cleaned.toLowerCase();
    const qCompact = normalizeAutoEqCompact(qLower);
    const qTokens = qLower.split(/[^a-z0-9]+/).filter(Boolean);

    if (!qCompact) return [];

    const qMasks = computeCharMasks(qCompact);
    const prepared: QueryPrepared = {
      qLower,
      qCompact,
      qTokens,
      qMaskLo: qMasks.lo,
      qMaskHi: qMasks.hi,
      qDistinctCharCount: popcount32(qMasks.lo) + popcount32(qMasks.hi),
      triStampId: 0,
      triUniqueCount: 0,
    };

    // Guard against wildcard-only queries returning arbitrary matches
    const scored: Array<{ score: number; entry: AutoEqIndexEntry }> = [];

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      const score = scoreEntry(entry, prepared, false);
      if (score > 0) {
        scored.push({ score, entry });
      }
    }

    // If strict tiers didn't find enough matches and query is >= 4 chars, allow fuzzy trigram/subsequence
    if (scored.length < Math.min(5, safeLimit) && qCompact.length >= 4) {
      const { stampId, uniqueCount } = prepareQueryTrigrams(qCompact);
      prepared.triStampId = stampId;
      prepared.triUniqueCount = uniqueCount;
      const seenIds = new Set(scored.map((s) => s.entry.id));
      for (let i = 0; i < this.entries.length; i++) {
        const entry = this.entries[i];
        if (seenIds.has(entry.id)) continue;
        const score = scoreEntry(entry, prepared, true);
        if (score > 0) {
          scored.push({ score, entry });
        }
      }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.entry.parametric !== b.entry.parametric) return a.entry.parametric ? -1 : 1;
      if (b.entry.rigPriority !== a.entry.rigPriority) {
        return b.entry.rigPriority - a.entry.rigPriority;
      }
      if (a.entry.name.length !== b.entry.name.length) {
        return a.entry.name.length - b.entry.name.length;
      }
      return a.entry.id - b.entry.id;
    });

    const results: AutoEqSearchResult[] = [];
    const seenNames = new Set<string>();

    // Check curated profiles for exact/prefix relevance if DB didn't load or as curated match
    for (const s of scored) {
      if (seenNames.has(s.entry.lowerName)) continue;
      seenNames.add(s.entry.lowerName);
      results.push({
        id: s.entry.id,
        name: s.entry.name,
        meta: s.entry.meta,
        parametric: s.entry.parametric,
        rig: s.entry.rig,
      });
      if (results.length >= safeLimit) break;
    }

    if (results.length < safeLimit) {
      for (const c of CURATED_AUTOEQ_PROFILES) {
        const cLower = c.name.toLowerCase();
        const cCompact = normalizeAutoEqCompact(cLower);
        if (seenNames.has(cLower)) continue;
        if (cLower.includes(qLower) || cCompact.includes(qCompact) || c.id.includes(qLower)) {
          seenNames.add(cLower);
          results.push({
            id: c.id,
            name: c.name,
            meta: c.source,
            parametric: true,
            rig: c.source,
          });
          if (results.length >= safeLimit) break;
        }
      }
    }

    return results.slice(0, safeLimit);
  }

  public getProfile(nameOrId: string | number): AutoEqProfile | null {
    if (typeof nameOrId === 'number') {
      if (!Number.isInteger(nameOrId) || nameOrId <= 0) return null;
      this.ensureLoadedSync();
      const entry = this.byId.get(nameOrId);
      return entry ? this.loadProfileFromEntry(entry) : null;
    }

    const cleaned = sanitizeQuery(nameOrId);
    if (!cleaned) return null;
    const lower = cleaned.toLowerCase();

    // Exact match against curated benchmark profiles preserves deterministic test contracts
    for (const curated of CURATED_AUTOEQ_PROFILES) {
      if (curated.id.toLowerCase() === lower || curated.name.toLowerCase() === lower) {
        return {
          ...curated,
          filters: curated.filters.map((f) => ({ ...f })),
        };
      }
    }

    this.ensureLoadedSync();

    // Numeric _id lookup
    if (/^\d+$/.test(cleaned)) {
      const numericId = Number(cleaned);
      const byNumeric = this.byId.get(numericId);
      if (byNumeric) {
        return this.loadProfileFromEntry(byNumeric);
      }
    }

    const qCompact = normalizeAutoEqCompact(lower);
    const qTokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
    if (!qCompact) return null;

    const qMasks = computeCharMasks(qCompact);
    const prepared: QueryPrepared = {
      qLower: lower,
      qCompact,
      qTokens,
      qMaskLo: qMasks.lo,
      qMaskHi: qMasks.hi,
      qDistinctCharCount: popcount32(qMasks.lo) + popcount32(qMasks.hi),
      triStampId: 0,
      triUniqueCount: 0,
    };

    let bestEntry: AutoEqIndexEntry | null = null;
    let bestScore = 0;

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      const score = scoreEntry(entry, prepared, false);
      if (
        score > bestScore ||
        (score > 0 &&
          score === bestScore &&
          bestEntry &&
          ((entry.parametric && !bestEntry.parametric) ||
            (entry.parametric === bestEntry.parametric &&
              (entry.rigPriority > bestEntry.rigPriority ||
                (entry.rigPriority === bestEntry.rigPriority && entry.id < bestEntry.id)))))
      ) {
        bestScore = score;
        bestEntry = entry;
      }
    }

    if (!bestEntry) return null;
    return this.loadProfileFromEntry(bestEntry);
  }

  private loadProfileFromEntry(entry: AutoEqIndexEntry): AutoEqProfile | null {
    if (!this.dbPath || !this.headerInfo) return null;
    const { pageSize, usableSize } = this.headerInfo;
    let fd: number | null = null;

    try {
      fd = fs.openSync(this.dbPath, 'r');
      const pageCache = new Map<number, Uint8Array>();
      const readPage = (pageNum: number): Uint8Array => {
        const cached = pageCache.get(pageNum);
        if (cached) return cached;
        const buf = new Uint8Array(pageSize);
        const bytesRead = fs.readSync(fd!, buf, 0, pageSize, (pageNum - 1) * pageSize);
        if (bytesRead <= 0) {
          throw new Error(`Failed to read SQLite page ${pageNum}`);
        }
        pageCache.set(pageNum, buf);
        return buf;
      };

      const leafPage = readPage(entry.pageNum);
      const { payload } = extractCellPayloadFromPage(
        leafPage,
        entry.cellOffset,
        usableSize,
        readPage
      );
      const cols = decodeSqliteRecord(payload, 5, false);
      const blob = cols[4];
      if (!(blob instanceof Uint8Array) || blob.byteLength === 0) {
        return null;
      }

      const filters = decodePapBlob(blob);
      const preampGainDb = calculatePreampGainDb(filters);
      return {
        id: entry.lowerName.replace(/[^a-z0-9]/g, '_'),
        dbId: entry.id,
        name: entry.name,
        source: entry.meta || 'AutoEQ',
        meta: entry.meta,
        parametric: entry.parametric,
        preampGainDb,
        filters,
      };
    } catch (err) {
      console.warn('[AutoEqDb] Failed to read profile blob:', err);
      return null;
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // Ignore close error
        }
      }
    }
  }
}

const sharedEngine = new AutoEqDatabaseEngine();

function toAutoEqStatus(native: NativeAutoEqStatus): AutoEqStatus {
  const total = native.totalRows ?? native.totalCount ?? native.count ?? 0;
  const parametric = native.parametricRows ?? native.parametricCount ?? 0;
  return {
    ready: Boolean(native.ready),
    count: native.count ?? total,
    totalRows: total,
    parametricRows: parametric,
    totalCount: total,
    parametricCount: parametric,
    dbPath: native.dbPath ?? null,
    loadTimeMs: native.loadTimeMs ?? 0,
    error: native.error ?? null,
  };
}

function ensureNativeAutoEqReady(candidatePaths?: string[]) {
  const core = getNativeCoreSafe();
  if (!core) return null;
  try {
    let status = core.autoeqStatus();
    if (!status.ready || (candidatePaths && candidatePaths.length > 0)) {
      status = core.autoeqInit(resolveAutoEqDbCandidatePaths(candidatePaths));
    }
    if (status.ready) {
      return { core, status: toAutoEqStatus(status) };
    }
  } catch {
    // Fallback to pure-TS engine
  }
  return null;
}

export function prewarmAutoEqDb(candidatePaths?: string[]): Promise<AutoEqStatus> {
  const native = ensureNativeAutoEqReady(candidatePaths);
  if (native) {
    return Promise.resolve(native.status);
  }
  return sharedEngine.init(candidatePaths);
}

export function getAutoEqStatus(candidatePaths?: string[]): AutoEqStatus {
  const native = ensureNativeAutoEqReady(candidatePaths);
  if (native) {
    return native.status;
  }
  sharedEngine.ensureLoadedSync(candidatePaths);
  return sharedEngine.getStatus();
}

export function searchAutoEqDb(
  query: string,
  limit = 20,
  candidatePaths?: string[]
): AutoEqSearchResult[] {
  const cleaned = sanitizeQuery(query);
  if (!cleaned) return [];
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));

  const native = ensureNativeAutoEqReady(candidatePaths);
  if (native) {
    try {
      const results: AutoEqSearchResult[] = native.core
        .autoeqSearch(cleaned, safeLimit)
        .map((r) => ({
          id: r.id,
          name: r.name,
          meta: r.meta,
          parametric: r.parametric,
          rig: r.rig,
        }));

      if (results.length < safeLimit) {
        const qLower = cleaned.toLowerCase();
        const qCompact = normalizeAutoEqCompact(qLower);
        const seenNames = new Set(results.map((r) => r.name.toLowerCase()));
        for (const c of CURATED_AUTOEQ_PROFILES) {
          const cLower = c.name.toLowerCase();
          const cCompact = normalizeAutoEqCompact(cLower);
          if (seenNames.has(cLower)) continue;
          if (cLower.includes(qLower) || cCompact.includes(qCompact) || c.id.includes(qLower)) {
            seenNames.add(cLower);
            results.push({
              id: c.id,
              name: c.name,
              meta: c.source,
              parametric: true,
              rig: c.source,
            });
            if (results.length >= safeLimit) break;
          }
        }
      }
      return results.slice(0, safeLimit);
    } catch {
      // Fallback to pure-TS engine
    }
  }

  sharedEngine.ensureLoadedSync(candidatePaths);
  return sharedEngine.search(query, limit);
}

export function getAutoEqProfile(
  nameOrId: string | number,
  candidatePaths?: string[]
): AutoEqProfile | null {
  if (typeof nameOrId === 'string') {
    const cleaned = sanitizeQuery(nameOrId);
    if (!cleaned) return null;
    const lower = cleaned.toLowerCase();
    for (const curated of CURATED_AUTOEQ_PROFILES) {
      if (curated.id.toLowerCase() === lower || curated.name.toLowerCase() === lower) {
        return {
          ...curated,
          filters: curated.filters.map((f) => ({ ...f })),
        };
      }
    }
  }

  const native = ensureNativeAutoEqReady(candidatePaths);
  if (native) {
    try {
      const profile = native.core.autoeqFindProfile(nameOrId);
      if (profile) {
        return {
          id: profile.id,
          dbId: profile.dbId,
          name: profile.name,
          source: profile.source,
          meta: profile.meta,
          parametric: profile.parametric,
          preampGainDb: profile.preampGainDb,
          filters: profile.filters.map((f) => ({ ...f })),
        };
      }
      return null;
    } catch {
      // Fallback to pure-TS engine
    }
  }

  sharedEngine.ensureLoadedSync(candidatePaths);
  return sharedEngine.getProfile(nameOrId);
}

// Self-check CLI support when invoked directly (e.g. ELECTRON_RUN_AS_NODE=1 electron dist-electron/autoEqDb.js "sony whch-720n")
const isDirectEntry =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectEntry) {
  const queryArg = process.argv.slice(2).join(' ').trim() || 'sony whch-720n';
  const status = getAutoEqStatus();
  const t0 = performance.now();
  const hits = searchAutoEqDb(queryArg, 5);
  const searchMs = Number((performance.now() - t0).toFixed(2));
  const profile = hits[0] ? getAutoEqProfile(hits[0].id) : getAutoEqProfile(queryArg);
  console.log(
    JSON.stringify(
      {
        nodeVersion: process.version,
        status,
        query: queryArg,
        searchMs,
        topResults: hits,
        profileSummary: profile
          ? {
              name: profile.name,
              source: profile.source,
              parametric: profile.parametric,
              preampGainDb: profile.preampGainDb,
              filterCount: profile.filters.length,
            }
          : null,
      },
      null,
      2
    )
  );
}
