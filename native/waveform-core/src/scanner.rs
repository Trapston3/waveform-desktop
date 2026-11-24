use lofty::config::ParseOptions;
use lofty::file::{AudioFile, FileType, TaggedFileExt};
use lofty::id3::v2::{FrameFlags, SynchronizedTextFrame, TimestampFormat};
use lofty::picture::MimeType;
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey, ItemValue, Tag, TagType};
use napi::bindgen_prelude::{AsyncTask, Env, Result as NapiResult, Task};
use napi_derive::napi;
use once_cell::sync::Lazy;
use rayon::prelude::*;
use sha1::{Digest as Sha1Digest, Sha1};
use sha2::Sha256;
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

static ART_WRITE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "wav", "m4a", "aac", "ogg", "opus", "mp4", "webm",
];

const FOLDER_COVER_NAMES: &[&str] = &[
    "cover.jpg",
    "cover.jpeg",
    "cover.png",
    "cover.webp",
    "folder.jpg",
    "folder.jpeg",
    "folder.png",
    "folder.webp",
    "front.jpg",
    "front.jpeg",
    "front.png",
    "front.webp",
    "album.jpg",
    "album.jpeg",
    "album.png",
    "album.webp",
];

#[napi(object)]
#[derive(Clone, Debug)]
pub struct TrackArtist {
    pub id: String,
    pub name: String,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct LocalTrack {
    pub id: String,
    pub video_id: String,
    pub local_file_path: String,
    pub folder_path: String,
    pub mtime_ms: f64,
    pub last_modified_ms: f64,
    pub size: f64,
    pub file_size_bytes: f64,
    pub title: String,
    pub artist: String,
    pub artists: Vec<TrackArtist>,
    pub artist_id: String,
    pub artist_ids: Vec<String>,
    pub album: Option<String>,
    pub album_name: Option<String>,
    pub album_artist: String,
    pub album_id: Option<String>,
    pub track_number: Option<u32>,
    pub year: Option<String>,
    pub duration_sec: u32,
    pub duration_text: String,
    pub total_play_time_ms: f64,
    pub codec: String,
    pub bit_depth: Option<u32>,
    pub sample_rate: Option<u32>,
    pub bitrate: Option<u32>,
    pub source_quality: String,
    pub audio_quality: String,
    pub artwork_hash: Option<String>,
    pub thumbnail_url: Option<String>,
    pub artwork_url: Option<String>,
    pub source: String,
    pub is_local: bool,
    pub playback_source_type: String,
    pub stream_url: String,
    pub liked: bool,
    pub play_count: u32,
    pub is_explicit: bool,
    pub has_original_audio: bool,
    pub lyrics: Option<String>,
    pub metadata_cache_key: String,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct CachedTrackInput {
    pub local_file_path: String,
    pub mtime_ms: f64,
    pub size: f64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct IncrementalScanResult {
    pub folders: Vec<String>,
    pub tracks: Vec<LocalTrack>,
    pub unchanged_paths: Vec<String>,
    pub added: u32,
    pub updated: u32,
    pub removed: u32,
}

fn sha1_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    hex_lower(&digest)
}

fn sha256_hex_40(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    hex_lower(&digest[..20])
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

fn encode_uri_component(input: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(input.len() + 16);
    for &b in input.as_bytes() {
        let unescaped = b.is_ascii_alphanumeric()
            || matches!(
                b,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            );
        if unescaped {
            out.push(b as char);
        } else {
            out.push('%');
            out.push(HEX[(b >> 4) as usize] as char);
            out.push(HEX[(b & 0x0f) as usize] as char);
        }
    }
    out
}

fn resolve_lexical(path_str: &str) -> PathBuf {
    let p = Path::new(path_str);
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else if let Ok(cwd) = std::env::current_dir() {
        cwd.join(p)
    } else {
        p.to_path_buf()
    };

    let mut out = PathBuf::new();
    for comp in abs.components() {
        match comp {
            Component::Prefix(pre) => out.push(pre.as_os_str()),
            Component::RootDir => out.push(comp.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::Normal(seg) => out.push(seg),
        }
    }
    out
}

pub fn normalize_fs_path(path_str: &str) -> String {
    if path_str.trim().is_empty() {
        return String::new();
    }
    let resolved = resolve_lexical(path_str);
    let s = resolved.to_string_lossy().replace('\\', "/");
    #[cfg(windows)]
    {
        s.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        s
    }
}

fn is_audio_file(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
        return false;
    };
    let lower = ext.to_ascii_lowercase();
    AUDIO_EXTENSIONS.contains(&lower.as_str())
}

fn ext_for_mime(mime: Option<&MimeType>) -> &'static str {
    match mime {
        Some(MimeType::Png) => ".png",
        Some(MimeType::Jpeg) => ".jpg",
        Some(MimeType::Unknown(s)) => {
            let l = s.to_ascii_lowercase();
            if l.contains("png") {
                ".png"
            } else if l.contains("webp") {
                ".webp"
            } else {
                ".jpg"
            }
        }
        _ => ".jpg",
    }
}

fn format_sample_rate_khz(sr: u32) -> String {
    if sr % 1000 == 0 {
        (sr / 1000).to_string()
    } else {
        let s = format!("{:.1}", sr as f64 / 1000.0);
        s.strip_suffix(".0").unwrap_or(&s).to_string()
    }
}

fn format_lrc_timestamp(ms: u32) -> String {
    let mins = ms / 60_000;
    let secs = (ms % 60_000) / 1000;
    let centis = (ms % 1000) / 10;
    format!("[{mins:02}:{secs:02}.{centis:02}]")
}

fn sync_entries_to_lrc(entries: &[(u32, String)]) -> Option<String> {
    let mut filtered: Vec<(u32, String)> = entries
        .iter()
        .filter_map(|(ts, text)| {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some((*ts, trimmed.to_string()))
            }
        })
        .collect();
    if filtered.is_empty() {
        return None;
    }
    filtered.sort_by_key(|(ts, _)| *ts);
    let lines: Vec<String> = filtered
        .into_iter()
        .map(|(ts, txt)| format!("{} {}", format_lrc_timestamp(ts), txt))
        .collect();
    Some(lines.join("\n"))
}

fn extract_lyrics_from_tags(tags: &[Tag]) -> Option<String> {
    // 1. Prefer synced SYLT lyrics if present
    for tag in tags {
        if tag.tag_type() == TagType::Id3v2 {
            for item in tag.items() {
                let is_sylt = matches!(item.key(), ItemKey::Unknown(k) if k.eq_ignore_ascii_case("SYLT"));
                if is_sylt {
                    if let ItemValue::Binary(bytes) = item.value() {
                        if let Ok(parsed) =
                            SynchronizedTextFrame::parse(bytes, FrameFlags::default())
                        {
                            if parsed.timestamp_format == TimestampFormat::MS {
                                if let Some(lrc) = sync_entries_to_lrc(&parsed.content) {
                                    return Some(lrc);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Standard Lyrics ItemKey (USLT / ©lyr / LYRICS / Vorbis / MP4)
    for tag in tags {
        if let Some(val) = tag.get_string(&ItemKey::Lyrics) {
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
        for item in tag.items() {
            let key_match = match item.key() {
                ItemKey::Lyrics => true,
                ItemKey::Unknown(k) => {
                    let up = k.to_ascii_uppercase();
                    up == "USLT" || up == "LYRICS" || k == "©lyr"
                }
                _ => false,
            };
            if key_match {
                if let ItemValue::Text(t) = item.value() {
                    let trimmed = t.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
    }
    None
}

fn strip_leading_track_prefix(stem: &str) -> &str {
    let bytes = stem.as_bytes();
    let mut digits = 0usize;
    while digits < bytes.len() && digits < 3 && bytes[digits].is_ascii_digit() {
        digits += 1;
    }
    if digits == 0 {
        return stem;
    }
    let mut rest = digits;
    let mut had_sep = false;
    while rest < bytes.len()
        && matches!(bytes[rest], b' ' | b'\t' | b'.' | b'_' | b'-')
    {
        had_sep = true;
        rest += 1;
    }
    if had_sep {
        &stem[rest..]
    } else {
        stem
    }
}

fn write_hashed_artwork_atomic(
    user_data_path: &Path,
    bytes: &[u8],
    ext: &str,
) -> Option<(String, String)> {
    if bytes.is_empty() {
        return None;
    }
    let hash = sha256_hex_40(bytes);
    let safe_ext = if ext.starts_with('.') {
        ext.to_ascii_lowercase()
    } else {
        format!(".{}", ext.to_ascii_lowercase())
    };
    let art_dir = user_data_path.join("artwork-cache");
    let out_path = art_dir.join(format!("{hash}{safe_ext}"));

    if !out_path.exists() {
        let _guard = ART_WRITE_LOCK.lock().ok()?;
        if !out_path.exists() {
            fs::create_dir_all(&art_dir).ok()?;
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&out_path)
            {
                Ok(mut f) => {
                    if f.write_all(bytes).is_err() {
                        let _ = fs::remove_file(&out_path);
                        return None;
                    }
                    let _ = f.sync_all();
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return None,
            }
        }
    }

    let url = format!("waveform-local://art?key={}", encode_uri_component(&hash));
    Some((hash, url))
}

fn find_folder_cover_art(
    dir: &Path,
    user_data_path: &Path,
    folder_cache: &Mutex<HashMap<String, Option<(String, String)>>>,
) -> Option<(String, String)> {
    let norm_dir = normalize_fs_path(&dir.to_string_lossy());
    if let Ok(cache) = folder_cache.lock() {
        if let Some(cached) = cache.get(&norm_dir) {
            return cached.clone();
        }
    }

    let mut found: Option<(String, String)> = None;
    if let Ok(entries) = fs::read_dir(dir) {
        let mut by_lower: HashMap<String, PathBuf> = HashMap::new();
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                    by_lower.insert(name.to_ascii_lowercase(), p);
                }
            }
        }
        for candidate in FOLDER_COVER_NAMES {
            if let Some(cover_path) = by_lower.get(*candidate) {
                if let Ok(bytes) = fs::read(cover_path) {
                    if !bytes.is_empty() {
                        let ext = cover_path
                            .extension()
                            .and_then(|e| e.to_str())
                            .map(|e| format!(".{}", e.to_ascii_lowercase()))
                            .unwrap_or_else(|| ".jpg".to_string());
                        found = write_hashed_artwork_atomic(user_data_path, &bytes, &ext);
                        if found.is_some() {
                            break;
                        }
                    }
                }
            }
        }
    }

    if let Ok(mut cache) = folder_cache.lock() {
        cache.insert(norm_dir, found.clone());
    }
    found
}

fn codec_label(file_type: FileType, format_upper: &str) -> String {
    match file_type {
        FileType::Mpeg => "MPEG".to_string(),
        FileType::Flac => "FLAC".to_string(),
        FileType::Wav => "PCM".to_string(),
        FileType::Mp4 => "AAC".to_string(),
        FileType::Aac => "AAC".to_string(),
        FileType::Opus => "Opus".to_string(),
        FileType::Vorbis => "Vorbis".to_string(),
        _ => format_upper.to_string(),
    }
}

fn compute_metadata_cache_key(artist: &str, title: &str, duration_sec: u32) -> String {
    let norm = format!(
        "{}|{}|{}",
        artist.trim().to_ascii_lowercase(),
        title.trim().to_ascii_lowercase(),
        duration_sec
    );
    sha1_hex(norm.as_bytes())
}

fn extract_year_from_tags(tags: &[Tag]) -> Option<String> {
    for tag in tags {
        if let Some(y) = tag.year() {
            if y > 0 {
                return Some(y.to_string());
            }
        }
        for key in [ItemKey::RecordingDate, ItemKey::Year, ItemKey::OriginalReleaseDate] {
            if let Some(s) = tag.get_string(&key) {
                let trimmed = s.trim();
                if trimmed.len() >= 4 && trimmed.as_bytes()[..4].iter().all(|b| b.is_ascii_digit())
                {
                    return Some(trimmed[..4].to_string());
                }
            }
        }
    }
    None
}

fn parse_single_audio_file(
    file_path: &Path,
    dir: &Path,
    root: &Path,
    mtime_ms: f64,
    size: f64,
    user_data_path: &Path,
    folder_art_cache: &Mutex<HashMap<String, Option<(String, String)>>>,
) -> LocalTrack {
    let full_str = file_path.to_string_lossy().to_string();
    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_ascii_lowercase()))
        .unwrap_or_default();
    let format_upper = ext.trim_start_matches('.').to_ascii_uppercase();

    let raw_stem = file_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown Track");
    let stem = strip_leading_track_prefix(raw_stem);
    let (fallback_artist, fallback_title) = if let Some(idx) = stem.find(" - ") {
        let a = stem[..idx].trim();
        let t = stem[idx + 3..].trim();
        (
            if a.is_empty() { "Unknown Artist" } else { a },
            if t.is_empty() { stem } else { t },
        )
    } else {
        ("Unknown Artist", if stem.trim().is_empty() { raw_stem } else { stem.trim() })
    };

    let parent_name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let dir_norm = normalize_fs_path(&dir.to_string_lossy());
    let root_norm = normalize_fs_path(&root.to_string_lossy());
    let fallback_album = if dir_norm != root_norm { parent_name } else { None };

    let tagged_file = Probe::open(file_path)
        .ok()
        .and_then(|p| p.options(ParseOptions::new()).read().ok());

    let mut title = String::new();
    let mut artist = String::new();
    let mut album_artist = String::new();
    let mut album: Option<String> = None;
    let mut track_number: Option<u32> = None;
    let mut year: Option<String> = None;
    let mut duration_sec: u32 = 0;
    let mut sample_rate: Option<u32> = None;
    let mut bit_depth: Option<u32> = None;
    let mut bitrate: Option<u32> = None;
    let mut codec = format_upper.clone();
    let mut artwork_hash: Option<String> = None;
    let mut thumbnail_url: Option<String> = None;
    let mut lyrics: Option<String> = None;

    if let Some(ref tf) = tagged_file {
        let props = tf.properties();
        duration_sec = props.duration().as_secs_f64().round() as u32;
        sample_rate = props.sample_rate().filter(|&v| v > 0);
        bit_depth = props.bit_depth().map(|v| v as u32).filter(|&v| v > 0);
        bitrate = props
            .audio_bitrate()
            .or_else(|| props.overall_bitrate())
            .filter(|&v| v > 0);
        codec = codec_label(tf.file_type(), &format_upper);

        let tags = tf.tags();
        let primary = tf.primary_tag().or_else(|| tf.first_tag());
        if let Some(tag) = primary {
            if let Some(t) = tag.title() {
                let s = t.trim();
                if !s.is_empty() {
                    title = s.to_string();
                }
            }
            if let Some(a) = tag.artist() {
                let s = a.trim();
                if !s.is_empty() {
                    artist = s.to_string();
                }
            }
            if let Some(aa) = tag.get_string(&ItemKey::AlbumArtist) {
                let s = aa.trim();
                if !s.is_empty() {
                    album_artist = s.to_string();
                }
            }
            if let Some(alb) = tag.album() {
                let s = alb.trim();
                if !s.is_empty() {
                    album = Some(s.to_string());
                }
            }
            if let Some(tn) = tag.track() {
                if tn > 0 {
                    track_number = Some(tn);
                }
            }
        }
        // Fallback across all tags if primary lacked any field
        for tag in tags {
            if title.is_empty() {
                if let Some(t) = tag.title() {
                    let s = t.trim();
                    if !s.is_empty() {
                        title = s.to_string();
                    }
                }
            }
            if artist.is_empty() {
                if let Some(a) = tag.artist() {
                    let s = a.trim();
                    if !s.is_empty() {
                        artist = s.to_string();
                    }
                }
            }
            if album_artist.is_empty() {
                if let Some(aa) = tag.get_string(&ItemKey::AlbumArtist) {
                    let s = aa.trim();
                    if !s.is_empty() {
                        album_artist = s.to_string();
                    }
                }
            }
            if album.is_none() {
                if let Some(alb) = tag.album() {
                    let s = alb.trim();
                    if !s.is_empty() {
                        album = Some(s.to_string());
                    }
                }
            }
            if track_number.is_none() {
                if let Some(tn) = tag.track() {
                    if tn > 0 {
                        track_number = Some(tn);
                    }
                }
            }
            if artwork_hash.is_none() {
                if let Some(pic) = tag.pictures().first() {
                    if !pic.data().is_empty() {
                        let art_ext = ext_for_mime(pic.mime_type());
                        if let Some((h, url)) =
                            write_hashed_artwork_atomic(user_data_path, pic.data(), art_ext)
                        {
                            artwork_hash = Some(h);
                            thumbnail_url = Some(url);
                        }
                    }
                }
            }
        }

        year = extract_year_from_tags(tags);
        lyrics = extract_lyrics_from_tags(tags);
    }

    if title.is_empty() {
        title = fallback_title.to_string();
    }
    if artist.is_empty() {
        artist = if !album_artist.is_empty() {
            album_artist.clone()
        } else {
            fallback_artist.to_string()
        };
    }
    if album_artist.is_empty() {
        album_artist = artist.clone();
    }
    if album.is_none() {
        album = fallback_album;
    }

    if thumbnail_url.is_none() {
        if let Some((h, url)) = find_folder_cover_art(dir, user_data_path, folder_art_cache) {
            artwork_hash = Some(h);
            thumbnail_url = Some(url);
        }
    }

    let duration_text = if duration_sec > 0 {
        format!("{}:{:02}", duration_sec / 60, duration_sec % 60)
    } else {
        "--:--".to_string()
    };
    let total_play_time_ms = (duration_sec as f64) * 1000.0;

    let source_quality = match (bit_depth, sample_rate, bitrate) {
        (Some(bd), Some(sr), _) => {
            format!("{bd}-bit / {}kHz {format_upper}", format_sample_rate_khz(sr))
        }
        (_, _, Some(br)) => format!("{br}kbps {format_upper}"),
        _ => format_upper,
    };

    let cache_key = compute_metadata_cache_key(&artist, &title, duration_sec);

    let norm_path = normalize_fs_path(&full_str);
    let video_id = format!("local_{}", &sha1_hex(norm_path.as_bytes())[..20]);
    let norm_artist = artist.trim().to_ascii_lowercase();
    let norm_artist = if norm_artist.is_empty() {
        "unknown artist"
    } else {
        norm_artist.as_str()
    };
    let artist_id = format!("local_art_{}", &sha1_hex(norm_artist.as_bytes())[..14]);

    let album_id = album.as_ref().map(|alb| {
        let norm_alb = alb.trim().to_ascii_lowercase();
        let norm_aa = album_artist.trim().to_ascii_lowercase();
        let key = format!("{norm_alb}|{norm_aa}");
        format!("local_alb_{}", &sha1_hex(key.as_bytes())[..14])
    });

    let stream_url = format!("waveform-local://file?path={}", encode_uri_component(&full_str));
    let folder_path = resolve_lexical(&root.to_string_lossy())
        .to_string_lossy()
        .to_string();

    LocalTrack {
        id: video_id.clone(),
        video_id,
        local_file_path: full_str,
        folder_path,
        mtime_ms,
        last_modified_ms: mtime_ms,
        size,
        file_size_bytes: size,
        title,
        artist: artist.clone(),
        artists: vec![TrackArtist {
            id: artist_id.clone(),
            name: artist,
        }],
        artist_id: artist_id.clone(),
        artist_ids: vec![artist_id],
        album: album.clone(),
        album_name: album,
        album_artist,
        album_id,
        track_number,
        year,
        duration_sec,
        duration_text,
        total_play_time_ms,
        codec,
        bit_depth,
        sample_rate,
        bitrate,
        source_quality: source_quality.clone(),
        audio_quality: source_quality,
        artwork_hash,
        thumbnail_url: thumbnail_url.clone(),
        artwork_url: thumbnail_url,
        source: "local".to_string(),
        is_local: true,
        playback_source_type: "LOCAL".to_string(),
        stream_url,
        liked: false,
        play_count: 0,
        is_explicit: false,
        has_original_audio: true,
        lyrics,
        metadata_cache_key: cache_key,
    }
}

struct DiscoveredFile {
    full: PathBuf,
    dir: PathBuf,
    root: PathBuf,
    norm: String,
    mtime_ms: f64,
    size: f64,
}

fn collect_audio_files_in_folder(root: &Path) -> Vec<DiscoveredFile> {
    let mut files = Vec::new();
    for entry in WalkDir::new(root).follow_links(false).into_iter().flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if !is_audio_file(path) {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let mtime_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0);
        let size = meta.len() as f64;
        let full = resolve_lexical(&path.to_string_lossy());
        let dir = full
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| root.to_path_buf());
        let norm = normalize_fs_path(&full.to_string_lossy());
        files.push(DiscoveredFile {
            full,
            dir,
            root: root.to_path_buf(),
            norm,
            mtime_ms,
            size,
        });
    }
    files
}

fn dedupe_folders(folders: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for raw in folders {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let resolved = resolve_lexical(trimmed).to_string_lossy().to_string();
        let norm = normalize_fs_path(&resolved);
        if seen.insert(norm) {
            out.push(resolved);
        }
    }
    out
}

pub fn scan_folder_sync(folder_path: &str, user_data_path: &str) -> Vec<LocalTrack> {
    let root = resolve_lexical(folder_path);
    let user_data = PathBuf::from(user_data_path);
    let files = collect_audio_files_in_folder(&root);
    let folder_art_cache = Mutex::new(HashMap::new());
    files
        .par_iter()
        .map(|f| {
            parse_single_audio_file(
                &f.full,
                &f.dir,
                &f.root,
                f.mtime_ms,
                f.size,
                &user_data,
                &folder_art_cache,
            )
        })
        .collect()
}

pub fn scan_incremental_sync(
    folders: &[String],
    user_data_path: &str,
    cached_entries: &[CachedTrackInput],
) -> IncrementalScanResult {
    let deduped_folders = dedupe_folders(folders);
    let user_data = PathBuf::from(user_data_path);

    let mut cached_map: HashMap<String, &CachedTrackInput> =
        HashMap::with_capacity(cached_entries.len());
    for entry in cached_entries {
        if !entry.local_file_path.trim().is_empty() {
            cached_map.insert(normalize_fs_path(&entry.local_file_path), entry);
        }
    }

    let mut seen_paths = HashSet::new();
    let mut to_parse: Vec<(DiscoveredFile, bool)> = Vec::new();
    let mut unchanged_paths: Vec<String> = Vec::new();
    let mut added: u32 = 0;
    let mut updated: u32 = 0;

    for folder in &deduped_folders {
        let root = PathBuf::from(folder);
        for f in collect_audio_files_in_folder(&root) {
            if !seen_paths.insert(f.norm.clone()) {
                continue;
            }
            if let Some(prev) = cached_map.get(&f.norm) {
                if (f.mtime_ms - prev.mtime_ms).abs() < 1.0 && (f.size - prev.size).abs() < 0.5 {
                    unchanged_paths.push(prev.local_file_path.clone());
                    continue;
                }
                updated += 1;
                to_parse.push((f, true));
            } else {
                added += 1;
                to_parse.push((f, false));
            }
        }
    }

    let mut removed: u32 = 0;
    for norm in cached_map.keys() {
        if !seen_paths.contains(norm) {
            removed += 1;
        }
    }

    let folder_art_cache = Mutex::new(HashMap::new());
    let tracks: Vec<LocalTrack> = to_parse
        .par_iter()
        .map(|(f, _)| {
            parse_single_audio_file(
                &f.full,
                &f.dir,
                &f.root,
                f.mtime_ms,
                f.size,
                &user_data,
                &folder_art_cache,
            )
        })
        .collect();

    IncrementalScanResult {
        folders: deduped_folders,
        tracks,
        unchanged_paths,
        added,
        updated,
        removed,
    }
}

pub struct ScanFolderTask {
    folder_path: String,
    user_data_path: String,
}

impl Task for ScanFolderTask {
    type Output = Vec<LocalTrack>;
    type JsValue = Vec<LocalTrack>;

    fn compute(&mut self) -> NapiResult<Self::Output> {
        Ok(scan_folder_sync(&self.folder_path, &self.user_data_path))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> NapiResult<Self::JsValue> {
        Ok(output)
    }
}

pub struct IncrementalScanTask {
    folders: Vec<String>,
    user_data_path: String,
    cached_entries: Vec<CachedTrackInput>,
}

impl Task for IncrementalScanTask {
    type Output = IncrementalScanResult;
    type JsValue = IncrementalScanResult;

    fn compute(&mut self) -> NapiResult<Self::Output> {
        Ok(scan_incremental_sync(
            &self.folders,
            &self.user_data_path,
            &self.cached_entries,
        ))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> NapiResult<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
pub fn scan_folder_metadata(
    folder_path: String,
    user_data_path: String,
) -> AsyncTask<ScanFolderTask> {
    AsyncTask::new(ScanFolderTask {
        folder_path,
        user_data_path,
    })
}

#[napi]
pub fn scan_local_folders_incremental(
    folders: Vec<String>,
    user_data_path: String,
    cached_entries: Option<Vec<CachedTrackInput>>,
) -> AsyncTask<IncrementalScanTask> {
    AsyncTask::new(IncrementalScanTask {
        folders,
        user_data_path,
        cached_entries: cached_entries.unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    const MINIMAL_PNG: &[u8] = &[
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
        0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];

    fn make_frame(id: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(10 + payload.len());
        out.extend_from_slice(id);
        out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        out.extend_from_slice(&[0u8, 0u8]);
        out.extend_from_slice(payload);
        out
    }

    fn make_text_frame(id: &[u8; 4], text: &str) -> Vec<u8> {
        let mut p = vec![0x00];
        p.extend_from_slice(text.as_bytes());
        make_frame(id, &p)
    }

    fn make_uslt_frame(lyrics: &str) -> Vec<u8> {
        let mut p = vec![0x00];
        p.extend_from_slice(b"eng");
        p.push(0x00);
        p.extend_from_slice(lyrics.as_bytes());
        make_frame(b"USLT", &p)
    }

    fn make_apic_frame(png: &[u8]) -> Vec<u8> {
        let mut p = vec![0x00];
        p.extend_from_slice(b"image/png\0");
        p.push(0x03);
        p.push(0x00);
        p.extend_from_slice(png);
        make_frame(b"APIC", &p)
    }

    fn build_test_mp3(
        title: &str,
        artist: &str,
        album: &str,
        lyrics: Option<&str>,
        png: Option<&[u8]>,
        frame_count: usize,
    ) -> Vec<u8> {
        let mut body = Vec::new();
        body.extend_from_slice(&make_text_frame(b"TIT2", title));
        body.extend_from_slice(&make_text_frame(b"TPE1", artist));
        body.extend_from_slice(&make_text_frame(b"TPE2", artist));
        body.extend_from_slice(&make_text_frame(b"TALB", album));
        body.extend_from_slice(&make_text_frame(b"TRCK", "3"));
        body.extend_from_slice(&make_text_frame(b"TYER", "2024"));
        if let Some(l) = lyrics {
            body.extend_from_slice(&make_uslt_frame(l));
        }
        if let Some(p) = png {
            body.extend_from_slice(&make_apic_frame(p));
        }

        let len = body.len();
        let syncsafe = [
            ((len >> 21) & 0x7f) as u8,
            ((len >> 14) & 0x7f) as u8,
            ((len >> 7) & 0x7f) as u8,
            (len & 0x7f) as u8,
        ];
        let mut out = Vec::new();
        out.extend_from_slice(b"ID3\x03\x00\x00");
        out.extend_from_slice(&syncsafe);
        out.extend_from_slice(&body);

        let mut mpeg = vec![0u8; 417];
        mpeg[0] = 0xff;
        mpeg[1] = 0xfb;
        mpeg[2] = 0x90;
        mpeg[3] = 0x00;
        for _ in 0..frame_count {
            out.extend_from_slice(&mpeg);
        }
        out
    }

    #[test]
    fn test_scanner_id3_apic_uslt_folder_cover_and_incremental() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("waveform-rust-scan-test-{nanos}"));
        let music_dir = root.join("music");
        let cover_dir = music_dir.join("AlbumCover");
        let user_data = root.join("userData");
        fs::create_dir_all(&cover_dir).unwrap();

        let mp3_embedded = music_dir.join("01 - Ignored.mp3");
        fs::write(
            &mp3_embedded,
            build_test_mp3(
                "Midnight Signal",
                "Neon Horizon",
                "Night Drive",
                Some("Line one\nLine two"),
                Some(MINIMAL_PNG),
                40,
            ),
        )
        .unwrap();

        fs::write(cover_dir.join("cover.png"), MINIMAL_PNG).unwrap();
        let mp3_folder_art = cover_dir.join("02_Track.mp3");
        fs::write(
            &mp3_folder_art,
            build_test_mp3("Folder Track", "Cover Artist", "Folder Album", None, None, 40),
        )
        .unwrap();

        let tracks = scan_folder_sync(
            &music_dir.to_string_lossy(),
            &user_data.to_string_lossy(),
        );
        assert_eq!(tracks.len(), 2);

        let t1 = tracks.iter().find(|t| t.title == "Midnight Signal").unwrap();
        assert_eq!(t1.artist, "Neon Horizon");
        assert_eq!(t1.album.as_deref(), Some("Night Drive"));
        assert_eq!(t1.track_number, Some(3));
        assert_eq!(t1.year.as_deref(), Some("2024"));
        assert!(t1.duration_sec >= 1);
        assert_eq!(t1.lyrics.as_deref(), Some("Line one\nLine two"));
        assert!(t1.video_id.starts_with("local_") && t1.video_id.len() == 26);
        assert!(t1.artist_id.starts_with("local_art_") && t1.artist_id.len() == 24);
        assert!(t1
            .album_id
            .as_ref()
            .map(|s| s.starts_with("local_alb_") && s.len() == 24)
            .unwrap_or(false));
        let art_hash = t1.artwork_hash.as_ref().unwrap();
        assert_eq!(art_hash.len(), 40);
        assert!(art_hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')));
        assert!(user_data
            .join("artwork-cache")
            .join(format!("{art_hash}.png"))
            .is_file());

        let t2 = tracks.iter().find(|t| t.title == "Folder Track").unwrap();
        assert_eq!(t2.artwork_hash.as_deref(), Some(art_hash.as_str()));

        // Incremental scan: 0 added, 2 unchanged
        let cached: Vec<CachedTrackInput> = tracks
            .iter()
            .map(|t| CachedTrackInput {
                local_file_path: t.local_file_path.clone(),
                mtime_ms: t.mtime_ms,
                size: t.size,
            })
            .collect();

        let inc1 = scan_incremental_sync(
            &[music_dir.to_string_lossy().to_string()],
            &user_data.to_string_lossy(),
            &cached,
        );
        assert_eq!(inc1.added, 0);
        assert_eq!(inc1.updated, 0);
        assert_eq!(inc1.removed, 0);
        assert_eq!(inc1.unchanged_paths.len(), 2);
        assert_eq!(inc1.tracks.len(), 0);

        // Modify one file and delete the other
        fs::write(
            &mp3_embedded,
            build_test_mp3(
                "Midnight Signal v2",
                "Neon Horizon",
                "Night Drive",
                None,
                None,
                60,
            ),
        )
        .unwrap();
        fs::remove_file(&mp3_folder_art).unwrap();

        let inc2 = scan_incremental_sync(
            &[music_dir.to_string_lossy().to_string()],
            &user_data.to_string_lossy(),
            &cached,
        );
        assert_eq!(inc2.added, 0);
        assert_eq!(inc2.updated, 1);
        assert_eq!(inc2.removed, 1);
        assert_eq!(inc2.tracks.len(), 1);
        assert_eq!(inc2.tracks[0].title, "Midnight Signal v2");

        let _ = fs::remove_dir_all(&root);
    }
}
