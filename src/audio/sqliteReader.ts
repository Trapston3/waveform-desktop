// src/audio/sqliteReader.ts
// Zero-dependency pure-TypeScript SQLite 3 read-only B-tree reader & AutoEQ fuzzy matcher.
// Works across Electron 30 (Node 20.16 without node:sqlite), Node ESM, and browser/test buffers.

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

const fs = getNodeBuiltin('node:fs');
const SQLITE_MAGIC = 'SQLite format 3\0';
const UTF8_DECODER = new TextDecoder('utf-8');

export interface AutoEqIndexEntry {
  id: number;
  name: string;
  meta: string;
  parametric: boolean;
  compact: string;
  lowerName: string;
  tokens: string[];
  rig: string;
  rigPriority: number;
  rigKnown: boolean;
  pageNum: number;
  cellOffset: number;
}

export interface AutoEqDbPresetRow {
  _id: number;
  name: string;
  meta: string;
  parametric: number;
  data_blob: Uint8Array;
}

export interface MeasurementRigInfo {
  rig: string;
  priority: number;
  known: boolean;
}

const SQL_INJECTION_REGEX =
  /(?:;|--|\*\/|\/\*|\b(?:union\s+select|drop\s+table|select\s+[\w*]+\s+from|order\s+by|insert\s+into|delete\s+from)\b|\bor\b\s*['"\d]|['"]\s*=\s*['"])/i;
const CONTROL_CHAR_REGEX = /[\x00-\x1f\x7f]/;
const INVISIBLE_BIDI_REGEX = /[\u200B-\u200F\u202A-\u202E\uFEFF]/g;

/**
 * Strips punctuation, hyphens, spaces, and non-alphanumerics for compact model comparisons.
 */
export function normalizeAutoEqCompact(s: string): string {
  if (!s || typeof s !== 'string') return '';
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Extracts normalized measurement rig name and priority from AutoEQ `meta`.
 * Priority preserves canonical AutoEQ measurement hierarchy:
 * Oratory1990 > Crinacle > Rtings > other known acoustic labs > unknown.
 */
export function extractMeasurementRig(meta?: string | null): MeasurementRigInfo {
  const raw = (meta || '').trim();
  if (!raw) {
    return { rig: 'Unknown', priority: 0, known: false };
  }
  const lower = raw.toLowerCase();
  if (lower.includes('oratory1990')) {
    return { rig: 'Oratory1990', priority: 100, known: true };
  }
  if (lower.includes('crinacle')) {
    return { rig: 'Crinacle', priority: 80, known: true };
  }
  if (lower.includes('rtings')) {
    return { rig: 'Rtings', priority: 60, known: true };
  }
  const knownRigs: Array<[string, string]> = [
    ['hypethesonics', 'HypetheSonics'],
    ['innerfidelity', 'Innerfidelity'],
    ['headphone.com', 'Headphone.com'],
    ['super review', 'Super Review'],
    ['kuulokenurkka', 'Kuulokenurkka'],
    ['auriculares argentina', 'Auriculares Argentina'],
    ['speakerphone', 'Speakerphone'],
    ['tone', 'ToneDeafMonk'],
    ['harpo', 'Harpo'],
    ['filk', 'Filk'],
    ['regan cipher', 'Regan Cipher'],
    ['dhrme', 'DHRME'],
  ];
  for (const [needle, label] of knownRigs) {
    if (lower.includes(needle)) {
      return { rig: label, priority: 30, known: true };
    }
  }
  return { rig: raw, priority: 10, known: false };
}

function buildTrigrams(s: string): Set<string> {
  const out = new Set<string>();
  if (s.length < 3) {
    if (s.length > 0) out.add(s);
    return out;
  }
  for (let i = 0; i <= s.length - 3; i++) {
    out.add(s.slice(i, i + 3));
  }
  return out;
}

function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle || needle.length > haystack.length) return false;
  let ni = 0;
  for (let hi = 0; hi < haystack.length && ni < needle.length; hi++) {
    if (haystack[hi] === needle[ni]) {
      ni++;
    }
  }
  return ni === needle.length;
}

function sanitizeQuery(query: string): {
  rawLower: string;
  asciiLower: string;
  compact: string;
  tokens: string[];
} | null {
  if (!query || typeof query !== 'string' || query.length > 256) {
    return null;
  }
  if (CONTROL_CHAR_REGEX.test(query)) {
    return null;
  }
  const stripped = query.replace(INVISIBLE_BIDI_REGEX, '').trim();
  if (!stripped || SQL_INJECTION_REGEX.test(stripped)) {
    return null;
  }
  const rawLower = stripped.toLowerCase();
  const compact = normalizeAutoEqCompact(rawLower);
  if (compact.length === 0) {
    return null;
  }
  const tokens = rawLower.split(/[^a-z0-9]+/).filter(Boolean);
  const asciiLower = tokens.join(' ');
  return { rawLower, asciiLower, compact, tokens };
}

/**
 * Scores an AutoEQ index entry against a user query.
 * Hierarchy: exact > exact compact > prefix > substring > all-tokens > trigram/subsequence.
 * Tie-break within tier: parametric DESC, shorter name, known rig.
 */
export function scoreAutoEqMatch(
  query: string,
  entry:
    | AutoEqIndexEntry
    | { name: string; meta?: string | null; parametric?: boolean | number }
): number {
  const q = sanitizeQuery(query);
  if (!q) return 0;

  const entryLower = 'lowerName' in entry ? entry.lowerName : (entry.name || '').toLowerCase();
  const entryCompact = 'compact' in entry ? entry.compact : normalizeAutoEqCompact(entry.name || '');
  if (!entryCompact) return 0;

  const entryTokens =
    'tokens' in entry ? entry.tokens : entryLower.split(/[^a-z0-9]+/).filter(Boolean);

  let tierScore = 0;

  if (entryLower === q.rawLower || entryLower === q.asciiLower) {
    tierScore = 1_000_000;
  } else if (entryCompact === q.compact) {
    tierScore = 900_000;
  } else if (
    entryLower.startsWith(q.rawLower) ||
    (q.asciiLower.length > 0 && entryLower.startsWith(q.asciiLower))
  ) {
    tierScore = 750_000;
  } else if (entryCompact.startsWith(q.compact)) {
    tierScore = 700_000;
  } else if (entryLower.includes(q.rawLower)) {
    tierScore = 550_000;
  } else if (q.asciiLower.length > 0 && entryLower.includes(q.asciiLower)) {
    tierScore = 525_000;
  } else if (entryCompact.includes(q.compact)) {
    tierScore = 500_000;
  } else if (
    q.tokens.length > 0 &&
    q.tokens.every((qt) => entryLower.includes(qt) || entryTokens.some((et) => et.startsWith(qt)))
  ) {
    let exactTokenHits = 0;
    for (const qt of q.tokens) {
      if (entryTokens.includes(qt)) exactTokenHits++;
    }
    tierScore = 350_000 + exactTokenHits * 1_000;
  } else if (q.compact.length >= 4) {
    const qTri = buildTrigrams(q.compact);
    const eTri = buildTrigrams(entryCompact);
    let intersection = 0;
    for (const tri of qTri) {
      if (eTri.has(tri)) intersection++;
    }
    const union = qTri.size + eTri.size - intersection;
    const jaccard = union > 0 ? intersection / union : 0;
    const subseq =
      isSubsequence(q.compact, entryCompact) && q.compact.length / entryCompact.length >= 0.4;
    if (jaccard >= 0.42 || subseq) {
      tierScore = 100_000 + Math.round(jaccard * 100_000) + (subseq ? 20_000 : 0);
    }
  }

  if (tierScore === 0) {
    return 0;
  }

  // Tie-breakers stay strictly within < 20_000 so they never cross match tiers.
  const isParametric =
    typeof entry.parametric === 'boolean' ? entry.parametric : Number(entry.parametric) === 1;
  const rigPriority =
    'rigPriority' in entry ? entry.rigPriority : extractMeasurementRig(entry.meta).priority;

  const parametricBonus = isParametric ? 10_000 : 0;
  const shorterNameBonus = Math.max(0, 5_000 - (entry.name?.length || 0) * 60);
  const rigBonus = rigPriority * 2;

  return tierScore + parametricBonus + shorterNameBonus + rigBonus;
}

// ============================================================================
// Pure-TS SQLite 3 Binary B-Tree Format Primitives
// ============================================================================

function readUint16BE(buf: Uint8Array, offset: number): number {
  return ((buf[offset] << 8) | buf[offset + 1]) >>> 0;
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

function readSignedIntBE(buf: Uint8Array, offset: number, byteLen: number): number {
  if (byteLen === 1) {
    const v = buf[offset];
    return v & 0x80 ? v - 0x100 : v;
  }
  if (byteLen === 2) {
    const v = (buf[offset] << 8) | buf[offset + 1];
    return v & 0x8000 ? v - 0x10000 : v;
  }
  if (byteLen === 3) {
    const v = (buf[offset] << 16) | (buf[offset + 1] << 8) | buf[offset + 2];
    return v & 0x800000 ? v - 0x1000000 : v;
  }
  if (byteLen === 4) {
    return (
      (buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3]
    );
  }
  let v = 0n;
  for (let i = 0; i < byteLen; i++) {
    v = (v << 8n) | BigInt(buf[offset + i]);
  }
  return Number(BigInt.asIntN(byteLen * 8, v));
}

function readVarint(buf: Uint8Array, offset: number): { value: number; bytes: number } {
  let acc = 0n;
  for (let i = 0; i < 8; i++) {
    const b = buf[offset + i];
    acc = (acc << 7n) | BigInt(b & 0x7f);
    if ((b & 0x80) === 0) {
      return { value: Number(acc), bytes: i + 1 };
    }
  }
  const b8 = buf[offset + 8];
  acc = (acc << 8n) | BigInt(b8);
  return { value: Number(BigInt.asIntN(64, acc)), bytes: 9 };
}

function serialTypeByteLength(serialType: number): number {
  if (serialType === 0 || serialType === 8 || serialType === 9 || serialType === 10 || serialType === 11) {
    return 0;
  }
  if (serialType <= 4) return serialType;
  if (serialType === 5) return 6;
  if (serialType === 6 || serialType === 7) return 8;
  if (serialType >= 12) {
    return serialType % 2 === 0 ? (serialType - 12) / 2 : (serialType - 13) / 2;
  }
  return 0;
}

type SqliteColumnValue = null | number | string | Uint8Array;

function decodeRecordColumns(
  payload: Uint8Array,
  rowid: number,
  skipBlob = false
): SqliteColumnValue[] {
  const hdrVarint = readVarint(payload, 0);
  const headerSize = hdrVarint.value;
  let hdrCursor = hdrVarint.bytes;
  const serialTypes: number[] = [];

  while (hdrCursor < headerSize && hdrCursor < payload.length) {
    const st = readVarint(payload, hdrCursor);
    serialTypes.push(st.value);
    hdrCursor += st.bytes;
  }

  let dataCursor = headerSize;
  const values: SqliteColumnValue[] = new Array(serialTypes.length);

  for (let i = 0; i < serialTypes.length; i++) {
    const st = serialTypes[i];
    const len = serialTypeByteLength(st);
    if (st === 0) {
      values[i] = i === 0 ? rowid : null;
    } else if (st === 8) {
      values[i] = 0;
    } else if (st === 9) {
      values[i] = 1;
    } else if (st >= 1 && st <= 6) {
      values[i] = readSignedIntBE(payload, dataCursor, len);
    } else if (st === 7) {
      const dv = new DataView(payload.buffer, payload.byteOffset + dataCursor, 8);
      values[i] = dv.getFloat64(0, false);
    } else if (st >= 12 && st % 2 === 0) {
      if (skipBlob) {
        values[i] = null;
      } else {
        const copy = new Uint8Array(len);
        copy.set(payload.subarray(dataCursor, dataCursor + len));
        values[i] = copy;
      }
    } else if (st >= 13 && st % 2 === 1) {
      values[i] = UTF8_DECODER.decode(payload.subarray(dataCursor, dataCursor + len));
    } else {
      values[i] = null;
    }
    dataCursor += len;
  }

  return values;
}

interface SqliteHeaderInfo {
  pageSize: number;
  usableSize: number;
  totalPages: number;
}

function parseSqliteHeader(buf: Uint8Array): SqliteHeaderInfo {
  if (buf.byteLength < 100) {
    throw new Error('Invalid SQLite database: file shorter than 100-byte header');
  }
  const magic = UTF8_DECODER.decode(buf.subarray(0, 16));
  if (magic !== SQLITE_MAGIC) {
    throw new Error('Invalid SQLite database header magic');
  }
  const rawPageSize = readUint16BE(buf, 16);
  const pageSize = rawPageSize === 1 ? 65536 : rawPageSize;
  if (pageSize < 512 || (pageSize & (pageSize - 1)) !== 0) {
    throw new Error(`Invalid SQLite page size: ${pageSize}`);
  }
  const reserved = buf[20];
  const usableSize = pageSize - reserved;
  if (usableSize < 480) {
    throw new Error(`Invalid SQLite usable page size: ${usableSize}`);
  }
  const totalPages = Math.floor(buf.byteLength / pageSize);
  return { pageSize, usableSize, totalPages };
}

function extractLeafCellFromBuffer(
  buf: Uint8Array,
  info: SqliteHeaderInfo,
  pageOffset: number,
  cellRelOffset: number
): { rowid: number; payload: Uint8Array } {
  const cellPos = pageOffset + cellRelOffset;
  const payloadVar = readVarint(buf, cellPos);
  const rowidVar = readVarint(buf, cellPos + payloadVar.bytes);
  const payloadSize = payloadVar.value;
  const rowid = rowidVar.value;
  const payloadStart = cellPos + payloadVar.bytes + rowidVar.bytes;

  const U = info.usableSize;
  const X = U - 35;
  const M = Math.floor(((U - 12) * 32) / 255) - 23;
  const K = M + ((payloadSize - M) % (U - 4));
  const localLen = payloadSize <= X ? payloadSize : K <= X ? K : M;

  if (localLen >= payloadSize) {
    return {
      rowid,
      payload: buf.subarray(payloadStart, payloadStart + payloadSize),
    };
  }

  const assembled = new Uint8Array(payloadSize);
  assembled.set(buf.subarray(payloadStart, payloadStart + localLen), 0);
  let written = localLen;
  let overflowPage = readUint32BE(buf, payloadStart + localLen);
  const maxOverflowData = U - 4;
  let safety = 0;

  while (overflowPage >= 1 && overflowPage <= info.totalPages && written < payloadSize && safety++ < 10000) {
    const ovOffset = (overflowPage - 1) * info.pageSize;
    const nextPage = readUint32BE(buf, ovOffset);
    const chunkLen = Math.min(maxOverflowData, payloadSize - written);
    assembled.set(buf.subarray(ovOffset + 4, ovOffset + 4 + chunkLen), written);
    written += chunkLen;
    overflowPage = nextPage;
  }

  return { rowid, payload: assembled };
}

function walkTableBTreeFromBuffer(
  buf: Uint8Array,
  info: SqliteHeaderInfo,
  rootPage: number,
  onLeafCell: (pageNum: number, cellRelOffset: number, rowid: number, payload: Uint8Array) => void
): void {
  const visited = new Set<number>();
  const stack: number[] = [rootPage];

  while (stack.length > 0) {
    const pageNum = stack.pop()!;
    if (pageNum < 1 || pageNum > info.totalPages || visited.has(pageNum)) {
      continue;
    }
    visited.add(pageNum);

    const pageOffset = (pageNum - 1) * info.pageSize;
    const hdrOffset = pageNum === 1 ? pageOffset + 100 : pageOffset;
    const pageType = buf[hdrOffset];
    const cellCount = readUint16BE(buf, hdrOffset + 3);

    if (pageType === 0x05) {
      // Interior Table B-Tree: push right-most first so left-most pops first
      const rightMost = readUint32BE(buf, hdrOffset + 8);
      if (rightMost >= 1 && rightMost <= info.totalPages) {
        stack.push(rightMost);
      }
      const ptrStart = hdrOffset + 12;
      for (let i = cellCount - 1; i >= 0; i--) {
        const cellRelOffset = readUint16BE(buf, ptrStart + i * 2);
        const childPage = readUint32BE(buf, pageOffset + cellRelOffset);
        if (childPage >= 1 && childPage <= info.totalPages) {
          stack.push(childPage);
        }
      }
    } else if (pageType === 0x0d) {
      // Leaf Table B-Tree
      const ptrStart = hdrOffset + 8;
      for (let i = 0; i < cellCount; i++) {
        const cellRelOffset = readUint16BE(buf, ptrStart + i * 2);
        const { rowid, payload } = extractLeafCellFromBuffer(buf, info, pageOffset, cellRelOffset);
        onLeafCell(pageNum, cellRelOffset, rowid, payload);
      }
    }
  }
}

function findTableRootPage(buf: Uint8Array, info: SqliteHeaderInfo, tableName: string): number {
  let rootPage = 0;
  walkTableBTreeFromBuffer(buf, info, 1, (_pageNum, _cellOffset, rowid, payload) => {
    if (rootPage > 0) return;
    const cols = decodeRecordColumns(payload, rowid, true);
    const objType = typeof cols[0] === 'string' ? cols[0] : '';
    const tblName = typeof cols[2] === 'string' ? cols[2] : '';
    const page = typeof cols[3] === 'number' ? cols[3] : 0;
    if (objType === 'table' && tblName === tableName && page >= 1) {
      rootPage = page;
    }
  });
  if (rootPage < 1) {
    throw new Error(`Table '${tableName}' not found in sqlite_master`);
  }
  return rootPage;
}

/**
 * Reads all rows from `eq_presets` in a pure-TS SQLite 3 database buffer or file.
 */
export function readEqPresetsFromBuffer(buf: Uint8Array): AutoEqDbPresetRow[] {
  const info = parseSqliteHeader(buf);
  const rootPage = findTableRootPage(buf, info, 'eq_presets');
  const rows: AutoEqDbPresetRow[] = [];

  walkTableBTreeFromBuffer(buf, info, rootPage, (_pageNum, _cellOffset, rowid, payload) => {
    const cols = decodeRecordColumns(payload, rowid, false);
    rows.push({
      _id: typeof cols[0] === 'number' ? cols[0] : rowid,
      name: typeof cols[1] === 'string' ? cols[1] : '',
      meta: typeof cols[2] === 'string' ? cols[2] : '',
      parametric: typeof cols[3] === 'number' ? cols[3] : 0,
      data_blob: cols[4] instanceof Uint8Array ? cols[4] : new Uint8Array(0),
    });
  });

  return rows;
}

/**
 * Pure-TS read-only SQLite 3 index + on-demand BLOB reader for `auto_eq.db`.
 * Indexes all 17,703 headphone presets into a lightweight in-memory list for <5ms search,
 * reading `data_blob` bytes on-demand from single 4KB pages (+ overflow pages if needed).
 */
export class SqliteAutoEqReader {
  readonly filePath: string;
  readonly entries: AutoEqIndexEntry[] = [];
  readonly totalCount: number;
  readonly parametricCount: number;

  private readonly headerInfo: SqliteHeaderInfo;
  private readonly blobCache = new Map<number, Uint8Array>();
  private closed = false;

  constructor(filePath: string) {
    if (!fs || typeof fs.readFileSync !== 'function') {
      throw new Error('Node fs module unavailable for SqliteAutoEqReader');
    }
    this.filePath = filePath;
    const raw = fs.readFileSync(filePath);
    const buf = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    this.headerInfo = parseSqliteHeader(buf);
    const rootPage = findTableRootPage(buf, this.headerInfo, 'eq_presets');

    let paramCount = 0;
    walkTableBTreeFromBuffer(buf, this.headerInfo, rootPage, (pageNum, cellOffset, rowid, payload) => {
      const cols = decodeRecordColumns(payload, rowid, true);
      const id = typeof cols[0] === 'number' ? cols[0] : rowid;
      const name = typeof cols[1] === 'string' ? cols[1] : '';
      const meta = typeof cols[2] === 'string' ? cols[2] : '';
      const parametric = (typeof cols[3] === 'number' ? cols[3] : 0) === 1;
      if (parametric) paramCount++;

      const lowerName = name.toLowerCase();
      const compact = normalizeAutoEqCompact(lowerName);
      const tokens = lowerName.split(/[^a-z0-9]+/).filter(Boolean);
      const rigInfo = extractMeasurementRig(meta);

      this.entries.push({
        id,
        name,
        meta,
        parametric,
        compact,
        lowerName,
        tokens,
        rig: rigInfo.rig,
        rigPriority: rigInfo.priority,
        rigKnown: rigInfo.known,
        pageNum,
        cellOffset,
      });
    });

    this.totalCount = this.entries.length;
    this.parametricCount = paramCount;
  }

  public isClosed(): boolean {
    return this.closed;
  }

  public close(): void {
    this.closed = true;
    this.blobCache.clear();
  }

  public search(query: string, limit = 20): AutoEqIndexEntry[] {
    if (this.closed || !query || typeof query !== 'string') return [];
    const cappedLimit = Math.max(1, Math.min(200, Math.floor(limit) || 20));
    if (!sanitizeQuery(query)) return [];

    const scored: Array<{ entry: AutoEqIndexEntry; score: number }> = [];
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      const score = scoreAutoEqMatch(query, entry);
      if (score > 0) {
        scored.push({ entry, score });
      }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.id - b.entry.id;
    });

    return scored.slice(0, cappedLimit).map((s) => s.entry);
  }

  public findBestMatch(query: string, requireParametric = true): AutoEqIndexEntry | null {
    if (this.closed || !query || typeof query !== 'string') return null;
    if (!sanitizeQuery(query)) return null;

    let bestEntry: AutoEqIndexEntry | null = null;
    let bestScore = 0;

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (requireParametric && !entry.parametric) continue;
      const score = scoreAutoEqMatch(query, entry);
      if (score > bestScore || (score > 0 && score === bestScore && bestEntry && entry.id < bestEntry.id)) {
        bestScore = score;
        bestEntry = entry;
      }
    }

    return bestEntry;
  }

  public readPresetBlob(entry: AutoEqIndexEntry): Uint8Array | null {
    if (this.closed) return null;
    const cached = this.blobCache.get(entry.id);
    if (cached) return cached;
    if (!fs || typeof fs.openSync !== 'function') return null;

    const info = this.headerInfo;
    const pageBuf = Buffer.allocUnsafe(info.pageSize);
    const fd = fs.openSync(this.filePath, 'r');
    try {
      const pageOffset = (entry.pageNum - 1) * info.pageSize;
      const bytesRead = fs.readSync(fd, pageBuf, 0, info.pageSize, pageOffset);
      if (bytesRead < info.pageSize) return null;

      const cellPos = entry.cellOffset;
      const payloadVar = readVarint(pageBuf, cellPos);
      const rowidVar = readVarint(pageBuf, cellPos + payloadVar.bytes);
      const payloadSize = payloadVar.value;
      const rowid = rowidVar.value;
      const payloadStart = cellPos + payloadVar.bytes + rowidVar.bytes;

      const U = info.usableSize;
      const X = U - 35;
      const M = Math.floor(((U - 12) * 32) / 255) - 23;
      const K = M + ((payloadSize - M) % (U - 4));
      const localLen = payloadSize <= X ? payloadSize : K <= X ? K : M;

      let payload: Uint8Array;
      if (localLen >= payloadSize) {
        payload = pageBuf.subarray(payloadStart, payloadStart + payloadSize);
      } else {
        const assembled = new Uint8Array(payloadSize);
        assembled.set(pageBuf.subarray(payloadStart, payloadStart + localLen), 0);
        let written = localLen;
        let overflowPage = readUint32BE(pageBuf, payloadStart + localLen);
        const ovBuf = Buffer.allocUnsafe(info.pageSize);
        const maxOverflowData = U - 4;
        let safety = 0;

        while (overflowPage >= 1 && overflowPage <= info.totalPages && written < payloadSize && safety++ < 10000) {
          const ovOffset = (overflowPage - 1) * info.pageSize;
          fs.readSync(fd, ovBuf, 0, info.pageSize, ovOffset);
          const nextPage = readUint32BE(ovBuf, 0);
          const chunkLen = Math.min(maxOverflowData, payloadSize - written);
          assembled.set(ovBuf.subarray(4, 4 + chunkLen), written);
          written += chunkLen;
          overflowPage = nextPage;
        }
        payload = assembled;
      }

      const cols = decodeRecordColumns(payload, rowid, false);
      const blob = cols[4] instanceof Uint8Array ? cols[4] : null;
      if (blob) {
        if (this.blobCache.size > 512) {
          const oldestKey = this.blobCache.keys().next().value;
          if (oldestKey !== undefined) this.blobCache.delete(oldestKey);
        }
        this.blobCache.set(entry.id, blob);
      }
      return blob;
    } finally {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close error
      }
    }
  }
}
