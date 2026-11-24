use napi::bindgen_prelude::Either;
use napi_derive::napi;
use once_cell::sync::Lazy;
use rusqlite::{Connection, OpenFlags};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;
use unicode_normalization::UnicodeNormalization;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct AutoEqFilter {
    #[napi(js_name = "type")]
    pub filter_type: String,
    pub freq: u32,
    pub q: f64,
    pub gain_db: f64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct AutoEqSearchResult {
    pub id: u32,
    pub name: String,
    pub meta: String,
    pub parametric: bool,
    pub rig: String,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct AutoEqProfile {
    pub id: String,
    pub db_id: u32,
    pub name: String,
    pub source: String,
    pub meta: String,
    pub parametric: bool,
    pub preamp_gain_db: f64,
    pub filters: Vec<AutoEqFilter>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct AutoEqStatus {
    pub ready: bool,
    pub count: u32,
    pub total_rows: u32,
    pub parametric_rows: u32,
    pub total_count: u32,
    pub parametric_count: u32,
    pub db_path: Option<String>,
    pub load_time_ms: f64,
    pub error: Option<String>,
}

#[derive(Clone, Debug)]
struct AutoEqIndexEntry {
    id: u32,
    name: String,
    meta: String,
    parametric: bool,
    lower_name: String,
    compact_name: String,
    tokens: Vec<String>,
    char_mask: u64,
    rig: String,
    rig_priority: i64,
}

struct AutoEqDbState {
    entries: Vec<AutoEqIndexEntry>,
    db_path: String,
    conn: Mutex<Connection>,
    total_rows: u32,
    parametric_rows: u32,
    load_time_ms: f64,
}

struct CachedEngine {
    state: Option<Arc<AutoEqDbState>>,
    last_error: Option<String>,
    last_load_ms: f64,
}

static ENGINE: Lazy<RwLock<CachedEngine>> = Lazy::new(|| {
    RwLock::new(CachedEngine {
        state: None,
        last_error: None,
        last_load_ms: 0.0,
    })
});

fn fold_accents_and_lower(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.nfd() {
        if ('\u{0300}'..='\u{036F}').contains(&ch) {
            continue;
        }
        for lc in ch.to_lowercase() {
            out.push(lc);
        }
    }
    out
}

pub fn normalize_compact(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.nfd() {
        if ('\u{0300}'..='\u{036F}').contains(&ch) {
            continue;
        }
        for lc in ch.to_lowercase() {
            if lc.is_ascii_alphanumeric() {
                out.push(lc);
            }
        }
    }
    out
}

fn split_alnum_tokens(lower: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for ch in lower.chars() {
        if ch.is_ascii_alphanumeric() {
            current.push(ch);
        } else if !current.is_empty() {
            tokens.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn char_to_alnum_code(b: u8) -> Option<u32> {
    match b {
        b'0'..=b'9' => Some((b - b'0') as u32),
        b'a'..=b'z' => Some((b - b'a' + 10) as u32),
        _ => None,
    }
}

fn compute_char_mask(compact: &str) -> u64 {
    let mut mask: u64 = 0;
    for b in compact.bytes() {
        if let Some(code) = char_to_alnum_code(b) {
            mask |= 1u64 << code;
        }
    }
    mask
}

pub fn extract_measurement_rig(meta: &str) -> (String, i64) {
    let raw = meta.trim();
    if raw.is_empty() {
        return ("Unknown".to_string(), 0);
    }
    let lower = raw.to_ascii_lowercase();
    if lower.contains("oratory1990") {
        return ("Oratory1990".to_string(), 100);
    }
    if lower.contains("crinacle") {
        return ("Crinacle".to_string(), 80);
    }
    if lower.contains("rtings") {
        return ("Rtings".to_string(), 60);
    }
    const KNOWN_LABS: &[(&str, &str)] = &[
        ("hypethesonics", "HypetheSonics"),
        ("innerfidelity", "Innerfidelity"),
        ("headphone.com", "Headphone.com"),
        ("super review", "Super Review"),
        ("kuulokenurkka", "Kuulokenurkka"),
        ("auriculares argentina", "Auriculares Argentina"),
        ("speakerphone", "Speakerphone"),
        ("tone", "ToneDeafMonk"),
        ("harpo", "Harpo"),
        ("filk", "Filk"),
        ("regan cipher", "Regan Cipher"),
        ("dhrme", "DHRME"),
    ];
    for &(needle, label) in KNOWN_LABS {
        if lower.contains(needle) {
            return (label.to_string(), 30);
        }
    }
    (raw.to_string(), 10)
}

fn is_bidi_or_zw(c: char) -> bool {
    matches!(
        c,
        '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{FEFF}'
    )
}

fn has_word_pair(words: &[&str], first: &str, second: &str) -> bool {
    words.windows(2).any(|w| w[0] == first && w[1] == second)
}

fn contains_sqli_pattern(cleaned: &str) -> bool {
    if cleaned.contains(';')
        || cleaned.contains("--")
        || cleaned.contains("/*")
        || cleaned.contains("*/")
    {
        return true;
    }
    let lower = cleaned.to_ascii_lowercase();
    if lower.contains("sqlite_master") || lower.contains("eq_presets") {
        return true;
    }

    // Quote followed by SQL keyword: ' or, " union, etc.
    let bytes = lower.as_bytes();
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'\'' || b == b'"' || b == b'`' {
            let rest = lower[i + 1..].trim_start();
            for kw in ["or", "and", "union", "select", "drop", "order"] {
                if let Some(after) = rest.strip_prefix(kw) {
                    if after.is_empty()
                        || !after
                            .as_bytes()
                            .first()
                            .map(|c| c.is_ascii_alphanumeric() || *c == b'_')
                            .unwrap_or(false)
                    {
                        return true;
                    }
                }
            }
        }
    }

    // Tokenize words cleanly for keyword pairs and `or X=Y`
    let alnum_words_owned: Vec<String> = lower
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    let words: Vec<&str> = alnum_words_owned.iter().map(|s| s.as_str()).collect();

    if has_word_pair(&words, "union", "select")
        || has_word_pair(&words, "drop", "table")
        || has_word_pair(&words, "order", "by")
        || has_word_pair(&words, "insert", "into")
        || has_word_pair(&words, "delete", "from")
    {
        return true;
    }

    if let Some(sel_pos) = words.iter().position(|&w| w == "select") {
        if words[sel_pos + 1..].contains(&"from") {
            return true;
        }
    }

    // Check `or <lhs>=<rhs>` / `or ''=''`
    if lower.contains('=') {
        let mut idx = 0;
        while let Some(pos) = lower[idx..].find("or") {
            let abs = idx + pos;
            let before_ok = abs == 0
                || !lower.as_bytes()[abs - 1].is_ascii_alphanumeric();
            let after_slice = &lower[abs + 2..];
            let after_ok = after_slice
                .as_bytes()
                .first()
                .map(|c| !c.is_ascii_alphanumeric())
                .unwrap_or(false);
            if before_ok && after_ok && after_slice.contains('=') {
                return true;
            }
            idx = abs + 2;
        }
    }

    false
}

pub fn sanitize_query(raw: &str) -> Option<String> {
    if raw.is_empty() || raw.encode_utf16().count() > 256 {
        return None;
    }
    if raw.chars().any(|c| {
        let code = c as u32;
        code < 0x20 || code == 0x7f
    }) {
        return None;
    }
    let cleaned: String = raw
        .chars()
        .filter(|&c| !is_bidi_or_zw(c))
        .collect::<String>()
        .trim()
        .to_string();
    if cleaned.is_empty() {
        return None;
    }
    if contains_sqli_pattern(&cleaned) {
        return None;
    }
    Some(cleaned)
}

pub fn decode_pap_blob(blob: &[u8]) -> Vec<AutoEqFilter> {
    const HEADER_SIZE: usize = 36;
    const RECORD_SIZE: usize = 20;
    const MAX_NYQUIST: u32 = 21609;

    if blob.len() < HEADER_SIZE || &blob[0..4] != b"PaP\x01" {
        return Vec::new();
    }

    let mut filters = Vec::with_capacity((blob.len() - HEADER_SIZE) / RECORD_SIZE);
    let mut offset = HEADER_SIZE;
    while offset + RECORD_SIZE <= blob.len() {
        let tag = u32::from_le_bytes(blob[offset..offset + 4].try_into().unwrap());
        let raw_gain = f32::from_le_bytes(blob[offset + 4..offset + 8].try_into().unwrap()) as f64;
        let raw_freq = u32::from_le_bytes(blob[offset + 8..offset + 12].try_into().unwrap());
        let raw_q = f32::from_le_bytes(blob[offset + 12..offset + 16].try_into().unwrap()) as f64;

        let filter_type = match tag {
            0x7003 => "PEAKING",
            0x7004 => "LOW_SHELF",
            0x7005 => "HIGH_SHELF",
            0x7006 => "LOW_PASS",
            0x7007 => "HIGH_PASS",
            0x7008 => "BAND_PASS",
            _ => "PEAKING",
        };

        let safe_freq = raw_freq.min(MAX_NYQUIST);
        let safe_q = if raw_q.is_finite() && raw_q > 0.1 {
            raw_q
        } else {
            0.1
        };
        let safe_gain = if raw_gain.is_finite() {
            raw_gain.clamp(-24.0, 12.0)
        } else {
            0.0
        };

        let q_rounded = (safe_q * 100.0).round() / 100.0;
        let gain_rounded = (safe_gain * 10.0).round() / 10.0;

        filters.push(AutoEqFilter {
            filter_type: filter_type.to_string(),
            freq: safe_freq,
            q: if q_rounded == 0.0 { 0.0 } else { q_rounded },
            gain_db: if gain_rounded == 0.0 { 0.0 } else { gain_rounded },
        });
        offset += RECORD_SIZE;
    }

    filters
}

pub fn calculate_preamp_gain_db(filters: &[AutoEqFilter]) -> f64 {
    let mut max_boost = 0.0_f64;
    for f in filters {
        if f.gain_db > max_boost {
            max_boost = f.gain_db;
        }
    }
    if max_boost > 0.0 {
        let v = -((max_boost * 10.0).round() / 10.0);
        if v == 0.0 { 0.0 } else { v }
    } else {
        0.0
    }
}

struct PreparedQuery {
    q_lower: String,
    q_compact: String,
    q_tokens: Vec<String>,
    q_mask: u64,
    q_distinct_chars: u32,
    q_trigrams: Vec<u16>,
}

fn build_sorted_trigrams(compact: &str) -> Vec<u16> {
    let bytes = compact.as_bytes();
    if bytes.len() < 3 {
        return Vec::new();
    }
    let mut tris = Vec::with_capacity(bytes.len() - 2);
    for w in bytes.windows(3) {
        if let (Some(a), Some(b), Some(c)) = (
            char_to_alnum_code(w[0]),
            char_to_alnum_code(w[1]),
            char_to_alnum_code(w[2]),
        ) {
            tris.push((a * 1296 + b * 36 + c) as u16);
        }
    }
    tris.sort_unstable();
    tris.dedup();
    tris
}

fn trigram_jaccard(q_tris: &[u16], target_compact: &str) -> f64 {
    if q_tris.is_empty() || target_compact.len() < 3 {
        return 0.0;
    }
    let t_tris = build_sorted_trigrams(target_compact);
    if t_tris.is_empty() {
        return 0.0;
    }
    let mut i = 0;
    let mut j = 0;
    let mut intersection = 0usize;
    while i < q_tris.len() && j < t_tris.len() {
        match q_tris[i].cmp(&t_tris[j]) {
            std::cmp::Ordering::Less => i += 1,
            std::cmp::Ordering::Greater => j += 1,
            std::cmp::Ordering::Equal => {
                intersection += 1;
                i += 1;
                j += 1;
            }
        }
    }
    let union = q_tris.len() + t_tris.len() - intersection;
    if union > 0 {
        intersection as f64 / union as f64
    } else {
        0.0
    }
}

fn is_subsequence_match(q_compact: &str, target_compact: &str) -> bool {
    if q_compact.len() < 4 || q_compact.len() > target_compact.len() {
        return false;
    }
    let q_bytes = q_compact.as_bytes();
    let mut qi = 0;
    for tb in target_compact.bytes() {
        if tb == q_bytes[qi] {
            qi += 1;
            if qi == q_bytes.len() {
                break;
            }
        }
    }
    qi == q_bytes.len() && (q_compact.len() as f64 / target_compact.len() as f64) >= 0.55
}

fn prepare_query(cleaned: &str, with_trigrams: bool) -> Option<PreparedQuery> {
    let q_lower = fold_accents_and_lower(cleaned);
    let q_compact = normalize_compact(&q_lower);
    if q_compact.is_empty() {
        return None;
    }
    let q_tokens = split_alnum_tokens(&q_lower);
    let q_mask = compute_char_mask(&q_compact);
    let q_trigrams = if with_trigrams && q_compact.len() >= 4 {
        build_sorted_trigrams(&q_compact)
    } else {
        Vec::new()
    };
    Some(PreparedQuery {
        q_lower,
        q_compact,
        q_tokens,
        q_mask,
        q_distinct_chars: q_mask.count_ones(),
        q_trigrams,
    })
}

fn score_entry(entry: &AutoEqIndexEntry, q: &PreparedQuery, allow_fuzzy: bool) -> i64 {
    let mut base: i64 = 0;
    let has_all_chars = (entry.char_mask & q.q_mask) == q.q_mask;

    if has_all_chars {
        if entry.lower_name == q.q_lower {
            base = 120_000;
        } else if !q.q_compact.is_empty() && entry.compact_name == q.q_compact {
            base = 100_000;
        } else if !q.q_compact.is_empty() && entry.compact_name.starts_with(&q.q_compact) {
            let diff = entry.compact_name.len().saturating_sub(q.q_compact.len()) as i64;
            base = 80_000 - (diff * 10).min(5_000);
        } else if q.q_lower.len() >= 2 && entry.lower_name.contains(&q.q_lower) {
            let idx = entry.lower_name.find(&q.q_lower).unwrap_or(0);
            let boundary = if idx == 0
                || !entry.lower_name.as_bytes()[idx - 1].is_ascii_alphanumeric()
            {
                3_000
            } else {
                0
            };
            base = 65_000 + boundary - (entry.lower_name.len() as i64 * 10).min(5_000);
        } else if q.q_compact.len() >= 2 && entry.compact_name.contains(&q.q_compact) {
            let token_bonus = if !q.q_tokens.is_empty()
                && q.q_tokens
                    .iter()
                    .all(|t| entry.tokens.iter().any(|et| et == t))
            {
                2_000
            } else {
                0
            };
            base = 60_000 + token_bonus - (entry.compact_name.len() as i64 * 10).min(5_000);
        } else if !q.q_tokens.is_empty()
            && q.q_compact.len() >= 2
            && q.q_tokens.iter().all(|t| entry.compact_name.contains(t))
        {
            let whole_hits = q
                .q_tokens
                .iter()
                .filter(|qt| entry.tokens.iter().any(|et| et == *qt))
                .count() as i64;
            base = 40_000 + whole_hits * 500 - (entry.compact_name.len() as i64 * 10).min(4_000);
        }
    }

    if base == 0 && allow_fuzzy && q.q_compact.len() >= 4 {
        let min_overlap = ((q.q_distinct_chars as f64 * 0.55).ceil() as u32).max(3);
        let overlap = (entry.char_mask & q.q_mask).count_ones();
        if overlap >= min_overlap {
            let jaccard = trigram_jaccard(&q.q_trigrams, &entry.compact_name);
            if jaccard >= 0.45 {
                base = 20_000 + (jaccard * 10_000.0).round() as i64;
            } else if is_subsequence_match(&q.q_compact, &entry.compact_name) {
                let diff = entry.compact_name.len().saturating_sub(q.q_compact.len()) as i64;
                base = 15_000 - (diff * 20).min(3_000);
            }
        }
    }

    if base == 0 {
        return 0;
    }

    base * 1_000
        + if entry.parametric { 500 } else { 0 }
        + (entry.rig_priority / 2).min(50)
        - (entry.name.len() as i64 / 4).min(40)
}

fn resolve_db_candidate_paths(extra_paths: Option<&[String]>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(env_path) = std::env::var("AUTOEQ_DB_PATH") {
        if !env_path.trim().is_empty() {
            candidates.push(PathBuf::from(env_path));
        }
    }
    if let Some(extra) = extra_paths {
        for p in extra {
            if !p.trim().is_empty() {
                candidates.push(PathBuf::from(p));
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("src/assets/data/auto_eq.db"));
        candidates.push(cwd.join("dist/assets/data/auto_eq.db"));
        candidates.push(cwd.join("resources/assets/data/auto_eq.db"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("resources/assets/data/auto_eq.db"));
            candidates.push(parent.join("src/assets/data/auto_eq.db"));
        }
    }
    candidates
}

fn load_db_from_path(path: &Path) -> Result<AutoEqDbState, String> {
    let t0 = Instant::now();
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open {}: {e}", path.display()))?;

    let mut stmt = conn
        .prepare("SELECT _id, name, meta, parametric FROM eq_presets")
        .map_err(|e| format!("Failed to prepare eq_presets query: {e}"))?;

    let mut entries = Vec::with_capacity(18_000);
    let mut parametric_rows: u32 = 0;

    let rows = stmt
        .query_map([], |row| {
            let id: u32 = row.get(0)?;
            let name: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
            let meta: String = row.get::<_, Option<String>>(2)?.unwrap_or_default();
            let parametric_int: i64 = row.get::<_, Option<i64>>(3)?.unwrap_or(0);
            Ok((id, name, meta, parametric_int == 1))
        })
        .map_err(|e| format!("Failed to query eq_presets: {e}"))?;

    for row_res in rows {
        let (id, name, meta, parametric) =
            row_res.map_err(|e| format!("Failed to read row: {e}"))?;
        if name.is_empty() {
            continue;
        }
        if parametric {
            parametric_rows += 1;
        }
        let lower_name = fold_accents_and_lower(&name);
        let compact_name = normalize_compact(&lower_name);
        let tokens = split_alnum_tokens(&lower_name);
        let char_mask = compute_char_mask(&compact_name);
        let (rig, rig_priority) = extract_measurement_rig(&meta);

        entries.push(AutoEqIndexEntry {
            id,
            name,
            meta,
            parametric,
            lower_name,
            compact_name,
            tokens,
            char_mask,
            rig,
            rig_priority,
        });
    }
    drop(stmt);

    let total_rows = entries.len() as u32;
    let load_time_ms = ((t0.elapsed().as_secs_f64() * 1000.0) * 100.0).round() / 100.0;

    Ok(AutoEqDbState {
        entries,
        db_path: path.to_string_lossy().to_string(),
        conn: Mutex::new(conn),
        total_rows,
        parametric_rows,
        load_time_ms,
    })
}

fn ensure_loaded(candidate_paths: Option<&[String]>) -> (Option<Arc<AutoEqDbState>>, Option<String>, f64) {
    let candidates = resolve_db_candidate_paths(candidate_paths);
    let chosen = candidates.into_iter().find(|p| p.is_file());

    // Fast path: already loaded and either no candidate change or matching path
    {
        let guard = ENGINE.read().unwrap();
        if let Some(ref st) = guard.state {
            if let Some(ref c) = chosen {
                if c.to_string_lossy() == st.db_path || candidate_paths.is_none() {
                    return (Some(Arc::clone(st)), None, st.load_time_ms);
                }
            } else if candidate_paths.is_none() {
                return (Some(Arc::clone(st)), None, st.load_time_ms);
            }
        }
    }

    let mut guard = ENGINE.write().unwrap();
    if let Some(ref st) = guard.state {
        if let Some(ref c) = chosen {
            if c.to_string_lossy() == st.db_path {
                return (Some(Arc::clone(st)), None, st.load_time_ms);
            }
        } else if candidate_paths.is_none() {
            return (Some(Arc::clone(st)), None, st.load_time_ms);
        }
    }

    let Some(db_path) = chosen else {
        let msg = "auto_eq.db not found in candidate paths".to_string();
        guard.last_error = Some(msg.clone());
        return (None, Some(msg), guard.last_load_ms);
    };

    match load_db_from_path(&db_path) {
        Ok(state) => {
            let arc = Arc::new(state);
            let ms = arc.load_time_ms;
            guard.state = Some(Arc::clone(&arc));
            guard.last_error = None;
            guard.last_load_ms = ms;
            (Some(arc), None, ms)
        }
        Err(err) => {
            guard.last_error = Some(err.clone());
            (None, Some(err), guard.last_load_ms)
        }
    }
}

fn build_status(state: Option<&AutoEqDbState>, error: Option<String>, load_ms: f64) -> AutoEqStatus {
    if let Some(st) = state {
        AutoEqStatus {
            ready: true,
            count: st.total_rows,
            total_rows: st.total_rows,
            parametric_rows: st.parametric_rows,
            total_count: st.total_rows,
            parametric_count: st.parametric_rows,
            db_path: Some(st.db_path.clone()),
            load_time_ms: st.load_time_ms,
            error: None,
        }
    } else {
        AutoEqStatus {
            ready: false,
            count: 0,
            total_rows: 0,
            parametric_rows: 0,
            total_count: 0,
            parametric_count: 0,
            db_path: None,
            load_time_ms: load_ms,
            error,
        }
    }
}

#[napi]
pub fn autoeq_init(candidate_paths: Option<Vec<String>>) -> AutoEqStatus {
    let (st, err, ms) = ensure_loaded(candidate_paths.as_deref());
    build_status(st.as_deref(), err, ms)
}

#[napi]
pub fn autoeq_status() -> AutoEqStatus {
    let (st, err, ms) = ensure_loaded(None);
    build_status(st.as_deref(), err, ms)
}

#[napi]
pub fn autoeq_search(query: String, limit: Option<u32>) -> Vec<AutoEqSearchResult> {
    let Some(cleaned) = sanitize_query(&query) else {
        return Vec::new();
    };
    let safe_limit = limit.unwrap_or(20).clamp(1, 100) as usize;
    let Some(mut prepared) = prepare_query(&cleaned, false) else {
        return Vec::new();
    };
    let (Some(state), _, _) = ensure_loaded(None) else {
        return Vec::new();
    };

    let mut scored: Vec<(i64, usize)> = Vec::new();
    for (idx, entry) in state.entries.iter().enumerate() {
        let s = score_entry(entry, &prepared, false);
        if s > 0 {
            scored.push((s, idx));
        }
    }

    if scored.len() < safe_limit.min(5) && prepared.q_compact.len() >= 4 {
        prepared.q_trigrams = build_sorted_trigrams(&prepared.q_compact);
        let seen: HashSet<usize> = scored.iter().map(|&(_, idx)| idx).collect();
        for (idx, entry) in state.entries.iter().enumerate() {
            if seen.contains(&idx) {
                continue;
            }
            let s = score_entry(entry, &prepared, true);
            if s > 0 {
                scored.push((s, idx));
            }
        }
    }

    scored.sort_unstable_by(|&(sa, ia), &(sb, ib)| {
        let a = &state.entries[ia];
        let b = &state.entries[ib];
        sb.cmp(&sa)
            .then_with(|| b.parametric.cmp(&a.parametric))
            .then_with(|| b.rig_priority.cmp(&a.rig_priority))
            .then_with(|| a.name.len().cmp(&b.name.len()))
            .then_with(|| a.id.cmp(&b.id))
    });

    let mut results = Vec::with_capacity(safe_limit);
    let mut seen_names = HashSet::with_capacity(safe_limit * 2);
    for (_, idx) in scored {
        let entry = &state.entries[idx];
        if !seen_names.insert(entry.lower_name.clone()) {
            continue;
        }
        results.push(AutoEqSearchResult {
            id: entry.id,
            name: entry.name.clone(),
            meta: entry.meta.clone(),
            parametric: entry.parametric,
            rig: entry.rig.clone(),
        });
        if results.len() >= safe_limit {
            break;
        }
    }
    results
}

fn load_profile_from_entry(state: &AutoEqDbState, entry: &AutoEqIndexEntry) -> Option<AutoEqProfile> {
    let blob: Vec<u8> = {
        let conn = state.conn.lock().ok()?;
        conn.query_row(
            "SELECT data_blob FROM eq_presets WHERE _id = ?1",
            [entry.id],
            |row| row.get(0),
        )
        .ok()?
    };
    if blob.is_empty() {
        return None;
    }
    let filters = decode_pap_blob(&blob);
    if filters.is_empty() {
        return None;
    }
    let preamp_gain_db = calculate_preamp_gain_db(&filters);
    let slug: String = entry
        .lower_name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();

    Some(AutoEqProfile {
        id: slug,
        db_id: entry.id,
        name: entry.name.clone(),
        source: if entry.meta.is_empty() {
            "AutoEQ".to_string()
        } else {
            entry.meta.clone()
        },
        meta: entry.meta.clone(),
        parametric: entry.parametric,
        preamp_gain_db,
        filters,
    })
}

#[napi]
pub fn autoeq_find_profile(name_or_id: Either<String, i64>) -> Option<AutoEqProfile> {
    let (Some(state), _, _) = ensure_loaded(None) else {
        return None;
    };

    let query_str = match name_or_id {
        Either::B(num) => {
            if num <= 0 {
                return None;
            }
            let target_id = num as u32;
            let entry = state
                .entries
                .iter()
                .find(|e| e.id == target_id && e.parametric)?;
            return load_profile_from_entry(&state, entry);
        }
        Either::A(s) => s,
    };

    let cleaned = sanitize_query(&query_str)?;
    if cleaned.bytes().all(|b| b.is_ascii_digit()) {
        if let Ok(target_id) = cleaned.parse::<u32>() {
            if let Some(entry) = state
                .entries
                .iter()
                .find(|e| e.id == target_id && e.parametric)
            {
                return load_profile_from_entry(&state, entry);
            }
        }
    }

    let prepared = prepare_query(&cleaned, false)?;
    let mut best_idx: Option<usize> = None;
    let mut best_score: i64 = 0;

    for (idx, entry) in state.entries.iter().enumerate() {
        if !entry.parametric {
            continue;
        }
        let s = score_entry(entry, &prepared, false);
        if s <= 0 {
            continue;
        }
        let better = match best_idx {
            None => true,
            Some(prev_idx) => {
                let prev = &state.entries[prev_idx];
                s > best_score
                    || (s == best_score
                        && (entry.rig_priority > prev.rig_priority
                            || (entry.rig_priority == prev.rig_priority && entry.id < prev.id)))
            }
        };
        if better {
            best_score = s;
            best_idx = Some(idx);
        }
    }

    let idx = best_idx?;
    load_profile_from_entry(&state, &state.entries[idx])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn find_repo_db() -> Option<String> {
        let candidates = [
            PathBuf::from("../../src/assets/data/auto_eq.db"),
            PathBuf::from("src/assets/data/auto_eq.db"),
        ];
        candidates
            .into_iter()
            .find(|p| p.is_file())
            .map(|p| p.to_string_lossy().to_string())
    }

    #[test]
    fn test_sanitize_rejects_sqli_and_controls() {
        let injections = [
            "' OR '1'='1",
            "' OR 1=1 --",
            "'; DROP TABLE eq_presets; --",
            "' UNION SELECT 1, 'Injected', 'Hack', X'50615001' --",
            "admin' --",
            "1' ORDER BY 1--",
            "\" OR \"\"=\"",
            "' OR ''='",
            "'; SELECT * FROM sqlite_master; --",
            "1; SELECT * FROM eq_presets WHERE 1=1; --",
            "' OR 'x'='x",
            "')) OR ((('1'='1",
            "Audeze\0LCD-X",
            "\r\n\t\x1b[31mRed\x1b[0m",
        ];
        for inj in injections {
            assert!(sanitize_query(inj).is_none(), "must reject: {inj}");
        }
        let overs = "A".repeat(257);
        assert!(sanitize_query(&overs).is_none());
        assert_eq!(sanitize_query("\u{202E}SONY\u{202C}").as_deref(), Some("SONY"));
        assert_eq!(normalize_compact("Sennheiser HD 600 — Café"), "sennheiserhd600cafe");
    }

    #[test]
    fn test_decode_pap_blob_clamping() {
        let mut buf = vec![0u8; 56];
        buf[0..4].copy_from_slice(b"PaP\x01");
        buf[36..40].copy_from_slice(&0x7003u32.to_le_bytes());
        buf[40..44].copy_from_slice(&35.0f32.to_le_bytes());
        buf[44..48].copy_from_slice(&23000u32.to_le_bytes());
        buf[48..52].copy_from_slice(&(-1.0f32).to_le_bytes());

        let filters = decode_pap_blob(&buf);
        assert_eq!(filters.len(), 1);
        assert_eq!(filters[0].filter_type, "PEAKING");
        assert_eq!(filters[0].gain_db, 12.0);
        assert_eq!(filters[0].freq, 21609);
        assert_eq!(filters[0].q, 0.1);
        assert_eq!(calculate_preamp_gain_db(&filters), -12.0);
    }

    #[test]
    fn test_autoeq_db_search_and_find_profile() {
        let Some(db_path) = find_repo_db() else {
            return;
        };
        let status = autoeq_init(Some(vec![db_path]));
        assert!(status.ready);
        assert_eq!(status.total_rows, 17703);
        assert_eq!(status.parametric_rows, 8850);

        let hits = autoeq_search("sony whch-720n".to_string(), Some(10));
        assert!(!hits.is_empty());
        assert_eq!(hits[0].name, "Sony WH-CH720N");
        assert!(hits[0].parametric);

        let prof = autoeq_find_profile(Either::A("7Hz Salnotes Zero".to_string())).unwrap();
        assert!(prof.parametric);
        assert_eq!(prof.filters.len(), 10);
        assert!(prof.preamp_gain_db <= 0.0);

        let rtl = autoeq_find_profile(Either::A("\u{202E}SONY\u{202C}".to_string())).unwrap();
        assert!(rtl.name.to_ascii_lowercase().contains("sony"));
    }
}
