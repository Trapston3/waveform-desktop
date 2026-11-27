use once_cell::sync::Lazy;
use ort::environment::Environment;
use ort::session::Session;
use ort::value::Tensor;
use realfft::RealFftPlanner;
use std::f64::consts::PI;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock};

const BEAT_MODEL_FILENAME: &str = "beat_this_final0_q8.onnx";
const VOCALS_MODEL_FILENAME: &str = "vocals_umxhq_int8.onnx";

#[derive(Clone, Debug, Default)]
pub struct OnnxStatus {
    pub ort_loaded: bool,
    pub ort_dylib_path: Option<String>,
    pub beat_model_loaded: bool,
    pub beat_model_path: Option<String>,
    pub beat_model_valid: bool,
    pub beat_model_bytes: f64,
    pub vocals_model_loaded: bool,
    pub vocals_model_path: Option<String>,
    pub vocals_model_valid: bool,
    pub vocals_model_bytes: f64,
    pub error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct BeatInferenceResult {
    pub used_onnx: bool,
    pub beat_probabilities: Vec<f64>,
    pub downbeat_probabilities: Vec<f64>,
    pub beat_times_sec: Vec<f64>,
    pub downbeat_times_sec: Vec<f64>,
    pub estimated_bpm: f64,
    pub error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct VocalsMaskResult {
    pub used_onnx: bool,
    pub target_magnitude: Vec<f64>,
    pub channels: u32,
    pub freq_bins: u32,
    pub time_frames: u32,
    pub error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct TimeRange {
    pub start_sec: f64,
    pub end_sec: f64,
}

#[derive(Clone, Debug)]
pub struct TrackBeatAnalysisResult {
    pub used_onnx: bool,
    pub bpm: f64,
    pub beats: Vec<f64>,
    pub downbeats: Vec<f64>,
    pub chorus_start_sec: f64,
    pub vocal_silence_ranges: Vec<TimeRange>,
    pub vocal_envelope: Vec<f64>,
    pub envelope_fps: f64,
    pub duration_sec: f64,
    pub error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct VocalSeparationResult {
    pub used_onnx: bool,
    pub vocals_left: Vec<f32>,
    pub vocals_right: Vec<f32>,
    pub sample_rate: f64,
    pub error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct LyricAutoSyncResult {
    pub offset_ms: f64,
    pub confidence: f64,
}

struct OnnxManager {
    status: OnnxStatus,
    env: Option<Environment>,
    beat_session: Option<Mutex<Session>>,
    vocals_session: Option<Mutex<Session>>,
}

static MANAGER: Lazy<RwLock<OnnxManager>> = Lazy::new(|| {
    RwLock::new(OnnxManager {
        status: OnnxStatus::default(),
        env: None,
        beat_session: None,
        vocals_session: None,
    })
});

pub fn validate_onnx_protobuf(path: &Path) -> (bool, f64, Option<String>) {
    let Ok(meta) = std::fs::metadata(path) else {
        return (false, 0.0, Some(format!("File not found: {}", path.display())));
    };
    let size = meta.len();
    if size < 8 {
        return (
            false,
            size as f64,
            Some(format!("ONNX file too small: {size} bytes")),
        );
    }
    let Ok(mut file) = File::open(path) else {
        return (
            false,
            size as f64,
            Some(format!("Failed to open {}", path.display())),
        );
    };
    let mut magic = [0u8; 4];
    if file.read_exact(&mut magic).is_err() {
        return (false, size as f64, Some("Failed to read ONNX header".to_string()));
    }
    // ONNX ModelProto starts with field 1 (ir_version, varint): tag byte 0x08 and non-zero value
    if magic[0] != 0x08 || magic[1] == 0 {
        return (
            false,
            size as f64,
            Some(format!(
                "Invalid ONNX protobuf header: {:02x} {:02x}",
                magic[0], magic[1]
            )),
        );
    }
    (true, size as f64, None)
}

fn find_model_file(filename: &str, models_dir: Option<&str>) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = models_dir {
        if !dir.trim().is_empty() {
            candidates.push(PathBuf::from(dir).join(filename));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("src/assets/data").join(filename));
        candidates.push(cwd.join("dist/assets/data").join(filename));
        candidates.push(cwd.join("resources/assets/data").join(filename));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("resources/assets/data").join(filename));
            candidates.push(parent.join("src/assets/data").join(filename));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

fn find_onnxruntime_dll(explicit_ort_path: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = explicit_ort_path {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return Some(pb);
        }
    }
    if let Ok(env_p) = std::env::var("ORT_DYLIB_PATH") {
        let pb = PathBuf::from(env_p);
        if pb.is_file() {
            return Some(pb);
        }
    }
    let dll_name = if cfg!(windows) {
        "onnxruntime.dll"
    } else if cfg!(target_os = "macos") {
        "libonnxruntime.dylib"
    } else {
        "libonnxruntime.so"
    };

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let p1 = parent.join(dll_name);
            if p1.is_file() {
                return Some(p1);
            }
            let p2 = parent.join("resources").join(dll_name);
            if p2.is_file() {
                return Some(p2);
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let p = cwd.join(dll_name);
        if p.is_file() {
            return Some(p);
        }
    }
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join(dll_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn try_load_sessions(
    dll_path: &Path,
    existing_env: Option<Environment>,
    beat_path: Option<&Path>,
    beat_valid: bool,
    vocals_path: Option<&Path>,
    vocals_valid: bool,
) -> (bool, Option<Environment>, Option<Session>, Option<Session>, Option<String>) {
    let env = match existing_env {
        Some(e) => e,
        None => {
            let dll_buf = dll_path.to_path_buf();
            let builder = match ort::init_from(&dll_buf) {
                Ok(b) => b,
                Err(e) => {
                    return (
                        false,
                        None,
                        None,
                        None,
                        Some(format!("ONNX Runtime dylib load error: {e}")),
                    );
                }
            };
            match builder.with_name("waveform-core").build() {
                Ok(e) => e,
                Err(e) => {
                    return (
                        false,
                        None,
                        None,
                        None,
                        Some(format!("ONNX Runtime env build error: {e}")),
                    );
                }
            }
        }
    };

    let mut errors = Vec::new();
    let beat_session = if beat_valid {
        if let Some(p) = beat_path {
            match Session::builder(&env).and_then(|mut b| b.commit_from_file(p)) {
                Ok(s) => Some(s),
                Err(e) => {
                    errors.push(format!("beat model load failed: {e}"));
                    None
                }
            }
        } else {
            None
        }
    } else {
        None
    };

    let vocals_session = if vocals_valid {
        if let Some(p) = vocals_path {
            match Session::builder(&env).and_then(|mut b| b.commit_from_file(p)) {
                Ok(s) => Some(s),
                Err(e) => {
                    errors.push(format!("vocals model load failed: {e}"));
                    None
                }
            }
        } else {
            None
        }
    } else {
        None
    };

    let err = if errors.is_empty() {
        None
    } else {
        Some(errors.join("; "))
    };
    (true, Some(env), beat_session, vocals_session, err)
}

pub fn init_models_sync(
    models_dir: Option<&str>,
    ort_dylib_path: Option<&str>,
) -> OnnxStatus {
    let beat_path = find_model_file(BEAT_MODEL_FILENAME, models_dir);
    let vocals_path = find_model_file(VOCALS_MODEL_FILENAME, models_dir);

    let (beat_valid, beat_bytes, beat_err) = match &beat_path {
        Some(p) => validate_onnx_protobuf(p),
        None => (false, 0.0, Some("beat_this_final0_q8.onnx not found".to_string())),
    };
    let (vocals_valid, vocals_bytes, vocals_err) = match &vocals_path {
        Some(p) => validate_onnx_protobuf(p),
        None => (false, 0.0, Some("vocals_umxhq_int8.onnx not found".to_string())),
    };

    let existing_env = MANAGER.read().ok().and_then(|g| g.env.clone());
    let dll_opt = find_onnxruntime_dll(ort_dylib_path);
    let mut ort_loaded = existing_env.is_some();
    let mut next_env = existing_env.clone();
    let mut beat_session = None;
    let mut vocals_session = None;
    let mut errors = Vec::new();
    if let Some(e) = beat_err {
        errors.push(e);
    }
    if let Some(e) = vocals_err {
        errors.push(e);
    }

    if let Some(ref dll) = dll_opt {
        let (ok, env_out, bs, vs, err) = try_load_sessions(
            dll,
            existing_env,
            beat_path.as_deref(),
            beat_valid,
            vocals_path.as_deref(),
            vocals_valid,
        );
        ort_loaded = ok;
        next_env = env_out;
        beat_session = bs;
        vocals_session = vs;
        if let Some(e) = err {
            errors.push(e);
        }
    } else {
        errors.push("onnxruntime.dll not found; spectral-flux fallback active".to_string());
    }

    let status = OnnxStatus {
        ort_loaded,
        ort_dylib_path: dll_opt.map(|p| p.to_string_lossy().to_string()),
        beat_model_loaded: beat_session.is_some(),
        beat_model_path: beat_path.map(|p| p.to_string_lossy().to_string()),
        beat_model_valid: beat_valid,
        beat_model_bytes: beat_bytes,
        vocals_model_loaded: vocals_session.is_some(),
        vocals_model_path: vocals_path.map(|p| p.to_string_lossy().to_string()),
        vocals_model_valid: vocals_valid,
        vocals_model_bytes: vocals_bytes,
        error: if errors.is_empty() {
            None
        } else {
            Some(errors.join("; "))
        },
    };

    if let Ok(mut guard) = MANAGER.write() {
        guard.status = status.clone();
        guard.env = next_env;
        guard.beat_session = beat_session.map(Mutex::new);
        guard.vocals_session = vocals_session.map(Mutex::new);
    }

    status
}

pub fn onnx_status() -> OnnxStatus {
    MANAGER
        .read()
        .map(|g| g.status.clone())
        .unwrap_or_default()
}

fn sigmoid_f64(x: f32) -> f64 {
    1.0 / (1.0 + (-(x as f64)).exp())
}

fn pick_peaks_and_bpm(
    beat_probs: &[f64],
    downbeat_probs: &[f64],
    fps: f64,
) -> (Vec<f64>, Vec<f64>, f64) {
    let min_gap_frames = (0.22 * fps).round().max(1.0) as usize;
    let mut beat_times = Vec::new();
    let mut last_beat_idx: Option<usize> = None;

    for i in 0..beat_probs.len() {
        let p = beat_probs[i];
        if p < 0.5 {
            continue;
        }
        let left = if i > 0 { beat_probs[i - 1] } else { 0.0 };
        let right = if i + 1 < beat_probs.len() {
            beat_probs[i + 1]
        } else {
            0.0
        };
        if p >= left && p >= right {
            let far_enough = last_beat_idx
                .map(|prev| i.saturating_sub(prev) >= min_gap_frames)
                .unwrap_or(true);
            if far_enough {
                beat_times.push(i as f64 / fps);
                last_beat_idx = Some(i);
            }
        }
    }

    let mut downbeat_times = Vec::new();
    let mut last_db_idx: Option<usize> = None;
    for i in 0..downbeat_probs.len() {
        let p = downbeat_probs[i];
        if p < 0.5 {
            continue;
        }
        let left = if i > 0 { downbeat_probs[i - 1] } else { 0.0 };
        let right = if i + 1 < downbeat_probs.len() {
            downbeat_probs[i + 1]
        } else {
            0.0
        };
        if p >= left && p >= right {
            let far_enough = last_db_idx
                .map(|prev| i.saturating_sub(prev) >= min_gap_frames * 2)
                .unwrap_or(true);
            if far_enough {
                downbeat_times.push(i as f64 / fps);
                last_db_idx = Some(i);
            }
        }
    }

    let mut iois = Vec::new();
    for w in beat_times.windows(2) {
        let dt_ms = (w[1] - w[0]) * 1000.0;
        if (300.0..=1100.0).contains(&dt_ms) {
            iois.push(dt_ms);
        }
    }
    let bpm = if !iois.is_empty() {
        let mean = iois.iter().sum::<f64>() / iois.len() as f64;
        (60_000.0 / mean).clamp(65.0, 185.0)
    } else {
        120.0
    };

    (beat_times, downbeat_times, bpm)
}

pub fn infer_beats_spectral_fallback(
    spectrogram: &[f32],
    time_frames: usize,
    fps: f64,
) -> BeatInferenceResult {
    const MEL_BINS: usize = 128;
    if time_frames == 0 || spectrogram.len() < MEL_BINS {
        return BeatInferenceResult {
            used_onnx: false,
            beat_probabilities: Vec::new(),
            downbeat_probabilities: Vec::new(),
            beat_times_sec: Vec::new(),
            downbeat_times_sec: Vec::new(),
            estimated_bpm: 120.0,
            error: None,
        };
    }

    let usable_frames = time_frames.min(spectrogram.len() / MEL_BINS);
    let mut flux = vec![0.0_f64; usable_frames];

    for t in 1..usable_frames {
        let prev = &spectrogram[(t - 1) * MEL_BINS..t * MEL_BINS];
        let curr = &spectrogram[t * MEL_BINS..(t + 1) * MEL_BINS];
        let mut f_sum = 0.0_f64;
        for b in 0..MEL_BINS {
            let w = if b < 24 { 1.5 } else { 1.0 };
            let diff = (curr[b] - prev[b]) as f64;
            if diff > 0.0 && diff.is_finite() {
                f_sum += diff * w;
            }
        }
        flux[t] = f_sum / MEL_BINS as f64;
    }

    let max_flux = flux.iter().copied().fold(0.0_f64, f64::max).max(1e-6);
    let mut beat_probs = vec![0.0_f64; usable_frames];
    let mut downbeat_probs = vec![0.0_f64; usable_frames];

    let mut rolling = 0.0_f64;
    let mut beat_idx = 0usize;
    let min_gap = (0.22 * fps).round().max(1.0) as usize;
    let mut last_onset = 0usize;

    for t in 0..usable_frames {
        let norm = (flux[t] / max_flux).clamp(0.0, 1.0);
        let is_peak = norm > 0.28
            && norm > rolling * 1.45
            && (last_onset == 0 || t.saturating_sub(last_onset) >= min_gap);
        if is_peak {
            beat_probs[t] = (0.55 + norm * 0.45).clamp(0.0, 1.0);
            if beat_idx % 4 == 0 {
                downbeat_probs[t] = beat_probs[t];
            }
            beat_idx += 1;
            last_onset = t;
        } else {
            beat_probs[t] = (norm * 0.35).clamp(0.0, 0.45);
        }
        rolling = rolling * 0.85 + norm * 0.15;
    }

    let (beat_times_sec, downbeat_times_sec, estimated_bpm) =
        pick_peaks_and_bpm(&beat_probs, &downbeat_probs, fps);

    BeatInferenceResult {
        used_onnx: false,
        beat_probabilities: beat_probs,
        downbeat_probabilities: downbeat_probs,
        beat_times_sec,
        downbeat_times_sec,
        estimated_bpm,
        error: None,
    }
}

pub fn infer_beats_core(
    spectrogram: &[f32],
    time_frames: u32,
    sample_rate: Option<f64>,
) -> BeatInferenceResult {
    let tf = time_frames as usize;
    let _sr = sample_rate.unwrap_or(22050.0);
    let fps = 50.0;
    let expected = tf.saturating_mul(128);

    if tf == 0 || spectrogram.len() != expected {
        let mut fallback = infer_beats_spectral_fallback(spectrogram, tf, fps);
        fallback.error = Some(format!(
            "Invalid spectrogram buffer length {} for shape [1, {}, 128]",
            spectrogram.len(),
            tf
        ));
        return fallback;
    }

    if let Ok(guard) = MANAGER.read() {
        if let Some(ref session_mutex) = guard.beat_session {
            if let Ok(mut session) = session_mutex.lock() {
                let data = spectrogram.to_vec();
                if let Ok(tensor) = Tensor::from_array(([1usize, tf, 128usize], data)) {
                    if let Ok(outputs) = session.run(ort::inputs!["input_spectrogram" => tensor]) {
                        let beat_raw = outputs
                            .get("beat")
                            .and_then(|v| v.try_extract_tensor::<f32>().ok())
                            .map(|(_, s)| s.iter().map(|&x| sigmoid_f64(x)).collect::<Vec<f64>>());
                        let downbeat_raw = outputs
                            .get("downbeat")
                            .and_then(|v| v.try_extract_tensor::<f32>().ok())
                            .map(|(_, s)| s.iter().map(|&x| sigmoid_f64(x)).collect::<Vec<f64>>());

                        if let (Some(beat_probs), Some(downbeat_probs)) = (beat_raw, downbeat_raw)
                        {
                            let (beat_times_sec, downbeat_times_sec, estimated_bpm) =
                                pick_peaks_and_bpm(&beat_probs, &downbeat_probs, fps);
                            return BeatInferenceResult {
                                used_onnx: true,
                                beat_probabilities: beat_probs,
                                downbeat_probabilities: downbeat_probs,
                                beat_times_sec,
                                downbeat_times_sec,
                                estimated_bpm,
                                error: None,
                            };
                        }
                    }
                }
            }
        }
    }

    infer_beats_spectral_fallback(spectrogram, tf, fps)
}

pub fn infer_vocals_mask_core(mix_magnitude: &[f32], frames: Option<u32>) -> VocalsMaskResult {
    let tf = frames.unwrap_or(960) as usize;
    let expected = 2usize.saturating_mul(2049).saturating_mul(tf);
    if tf == 0 || mix_magnitude.len() != expected {
        return VocalsMaskResult {
            used_onnx: false,
            target_magnitude: Vec::new(),
            channels: 2,
            freq_bins: 2049,
            time_frames: tf as u32,
            error: Some(format!(
                "Invalid mix_magnitude length {} for shape [1, 2, 2049, {}]",
                mix_magnitude.len(),
                tf
            )),
        };
    }

    if let Ok(guard) = MANAGER.read() {
        if let Some(ref session_mutex) = guard.vocals_session {
            if let Ok(mut session) = session_mutex.lock() {
                let data = mix_magnitude.to_vec();
                match Tensor::from_array(([1usize, 2usize, 2049usize, tf], data))
                    .and_then(|t| session.run(ort::inputs!["mix_magnitude" => t]))
                {
                    Ok(outputs) => {
                        if let Some(out_val) = outputs.get("target_magnitude") {
                            if let Ok((_, slice)) = out_val.try_extract_tensor::<f32>() {
                                return VocalsMaskResult {
                                    used_onnx: true,
                                    target_magnitude: slice.iter().map(|&v| v as f64).collect(),
                                    channels: 2,
                                    freq_bins: 2049,
                                    time_frames: tf as u32,
                                    error: None,
                                };
                            }
                        }
                    }
                    Err(e) => {
                        return VocalsMaskResult {
                            used_onnx: false,
                            target_magnitude: Vec::new(),
                            channels: 2,
                            freq_bins: 2049,
                            time_frames: tf as u32,
                            error: Some(format!("ONNX vocals inference failed: {e}")),
                        };
                    }
                }
            }
        }
    }

    VocalsMaskResult {
        used_onnx: false,
        target_magnitude: Vec::new(),
        channels: 2,
        freq_bins: 2049,
        time_frames: tf as u32,
        error: Some("onnxruntime.dll not loaded; vocals inference unavailable".to_string()),
    }
}

fn resample_linear(samples: &[f32], src_sr: f64, dst_sr: f64) -> Vec<f32> {
    if samples.is_empty() || !src_sr.is_finite() || src_sr <= 0.0 || !dst_sr.is_finite() || dst_sr <= 0.0 {
        return Vec::new();
    }
    if (src_sr - dst_sr).abs() < 1.0 {
        return samples.to_vec();
    }
    let out_len = ((samples.len() as f64) * (dst_sr / src_sr)).round().max(1.0) as usize;
    let ratio = src_sr / dst_sr;
    let mut out = Vec::with_capacity(out_len);
    let max_idx = samples.len() - 1;
    for i in 0..out_len {
        let pos = i as f64 * ratio;
        let idx = (pos.floor() as usize).min(max_idx);
        let next = (idx + 1).min(max_idx);
        let frac = (pos - idx as f64) as f32;
        let s0 = if samples[idx].is_finite() { samples[idx] } else { 0.0 };
        let s1 = if samples[next].is_finite() { samples[next] } else { 0.0 };
        out.push(s0 + (s1 - s0) * frac);
    }
    out
}

fn hz_to_mel(hz: f64) -> f64 {
    2595.0 * (1.0 + hz / 700.0).log10()
}

fn mel_to_hz(mel: f64) -> f64 {
    700.0 * (10.0_f64.powf(mel / 2595.0) - 1.0)
}

fn build_mel_filterbank(n_fft: usize, sr: f64, n_mels: usize, f_min: f64, f_max: f64) -> Vec<Vec<(usize, f32)>> {
    let n_bins = n_fft / 2 + 1;
    let mel_min = hz_to_mel(f_min);
    let mel_max = hz_to_mel(f_max.min(sr * 0.5));
    let mut pts = Vec::with_capacity(n_mels + 2);
    for m in 0..(n_mels + 2) {
        let mel = mel_min + (mel_max - mel_min) * (m as f64) / ((n_mels + 1) as f64);
        let hz = mel_to_hz(mel);
        let bin = (hz / (sr / n_fft as f64)).clamp(0.0, (n_bins - 1) as f64);
        pts.push(bin);
    }

    let mut bank = Vec::with_capacity(n_mels);
    for m in 0..n_mels {
        let left = pts[m];
        let center = pts[m + 1];
        let right = pts[m + 2];
        let mut weights = Vec::new();
        let start_b = left.floor() as usize;
        let end_b = (right.ceil() as usize).min(n_bins - 1);
        for b in start_b..=end_b {
            let bf = b as f64;
            let w = if bf >= left && bf <= center && center > left {
                (bf - left) / (center - left)
            } else if bf > center && bf <= right && right > center {
                (right - bf) / (right - center)
            } else {
                0.0
            };
            if w > 1e-6 {
                weights.push((b, w as f32));
            }
        }
        bank.push(weights);
    }
    bank
}

fn build_hann_window(len: usize) -> Vec<f32> {
    let mut win = Vec::with_capacity(len);
    for i in 0..len {
        let w = 0.5 * (1.0 - ((2.0 * PI * i as f64) / len as f64).cos());
        win.push(w as f32);
    }
    win
}

pub fn analyze_track_beats_pcm_core(
    left: &[f32],
    right: Option<&[f32]>,
    sample_rate: f64,
) -> TrackBeatAnalysisResult {
    let sr_in = if sample_rate.is_finite() && sample_rate >= 8000.0 {
        sample_rate
    } else {
        44100.0
    };
    if left.is_empty() {
        return TrackBeatAnalysisResult {
            used_onnx: false,
            bpm: 120.0,
            beats: Vec::new(),
            downbeats: Vec::new(),
            chorus_start_sec: 0.0,
            vocal_silence_ranges: Vec::new(),
            vocal_envelope: Vec::new(),
            envelope_fps: 10.0,
            duration_sec: 0.0,
            error: Some("Empty PCM buffer".to_string()),
        };
    }

    let duration_sec = left.len() as f64 / sr_in;
    let mut mono_in = Vec::with_capacity(left.len());
    let mut side_in = if right.is_some() {
        Vec::with_capacity(left.len())
    } else {
        Vec::new()
    };

    for i in 0..left.len() {
        let l = if left[i].is_finite() { left[i] } else { 0.0 };
        if let Some(r_slice) = right {
            let r = r_slice.get(i).copied().unwrap_or(l);
            let r = if r.is_finite() { r } else { l };
            mono_in.push(0.5 * (l + r));
            side_in.push(0.5 * (l - r));
        } else {
            mono_in.push(l);
        }
    }

    // Resample to 22050 Hz so hop=441 matches 50 fps expected by Beat This!
    const TARGET_SR: f64 = 22050.0;
    const N_FFT: usize = 2048;
    const HOP: usize = 441;
    const N_MELS: usize = 128;

    let mono_22k = resample_linear(&mono_in, sr_in, TARGET_SR);
    let side_22k = if !side_in.is_empty() {
        resample_linear(&side_in, sr_in, TARGET_SR)
    } else {
        Vec::new()
    };

    if mono_22k.len() < N_FFT {
        return TrackBeatAnalysisResult {
            used_onnx: false,
            bpm: 120.0,
            beats: Vec::new(),
            downbeats: Vec::new(),
            chorus_start_sec: 0.0,
            vocal_silence_ranges: Vec::new(),
            vocal_envelope: Vec::new(),
            envelope_fps: 10.0,
            duration_sec,
            error: None,
        };
    }

    let tf = ((mono_22k.len() - N_FFT) / HOP) + 1;
    let mut planner = RealFftPlanner::<f32>::new();
    let r2c = planner.plan_fft_forward(N_FFT);
    let hann = build_hann_window(N_FFT);
    let mel_bank = build_mel_filterbank(N_FFT, TARGET_SR, N_MELS, 30.0, 11000.0);

    let mut input_buf = vec![0.0_f32; N_FFT];
    let mut side_buf = vec![0.0_f32; N_FFT];
    let mut spec = r2c.make_output_vec();
    let mut side_spec = r2c.make_output_vec();
    let mut scratch = r2c.make_scratch_vec();

    let n_bins = N_FFT / 2 + 1;
    let hz_per_bin = TARGET_SR / N_FFT as f64;
    let vocal_bin_lo = (280.0 / hz_per_bin).floor() as usize;
    let vocal_bin_hi = ((3600.0 / hz_per_bin).ceil() as usize).min(n_bins - 1);

    let mut mel_spec = vec![0.0_f32; tf * N_MELS];
    let mut mags = vec![0.0_f32; n_bins];
    let mut frame_total_e = vec![0.0_f64; tf];
    let mut frame_vocal_raw = vec![0.0_f64; tf];

    for t in 0..tf {
        let offset = t * HOP;
        for i in 0..N_FFT {
            input_buf[i] = mono_22k[offset + i] * hann[i];
        }
        let _ = r2c.process_with_scratch(&mut input_buf, &mut spec, &mut scratch);

        let mut total_e = 0.0_f64;
        for (b, c) in spec.iter().enumerate() {
            let p = c.re * c.re + c.im * c.im;
            let mag = p.sqrt();
            mags[b] = mag;
            total_e += mag as f64;
        }
        frame_total_e[t] = total_e / n_bins as f64;

        let mut vocal_e = 0.0_f64;
        if !side_22k.is_empty() {
            for i in 0..N_FFT {
                side_buf[i] = side_22k[offset + i] * hann[i];
            }
            let _ = r2c.process_with_scratch(&mut side_buf, &mut side_spec, &mut scratch);
            for b in vocal_bin_lo..=vocal_bin_hi {
                let m = mags[b] as f64;
                let s = ((side_spec[b].re * side_spec[b].re + side_spec[b].im * side_spec[b].im) as f64).sqrt();
                let center = (m - 0.65 * s).max(0.0);
                vocal_e += center;
            }
        } else {
            for b in vocal_bin_lo..=vocal_bin_hi {
                vocal_e += mags[b] as f64;
            }
        }
        frame_vocal_raw[t] = vocal_e / ((vocal_bin_hi - vocal_bin_lo + 1) as f64);

        let row = &mut mel_spec[t * N_MELS..(t + 1) * N_MELS];
        for (m, weights) in mel_bank.iter().enumerate() {
            let mut sum = 0.0_f32;
            for &(b, w) in weights {
                sum += mags[b] * w;
            }
            row[m] = (1.0 + sum).ln();
        }
    }

    let beat_res = infer_beats_core(&mel_spec, tf as u32, Some(TARGET_SR));

    // Downsample 50 fps vocal & total energy into 10 fps (0.1s per step)
    const ENV_FPS: f64 = 10.0;
    let group = 5usize; // 50 / 10
    let env_len = (tf + group - 1) / group;
    let mut env_vocal = vec![0.0_f64; env_len];
    let mut env_energy = vec![0.0_f64; env_len];
    for e_i in 0..env_len {
        let s = e_i * group;
        let e = (s + group).min(tf);
        let cnt = (e - s).max(1) as f64;
        let v_sum: f64 = frame_vocal_raw[s..e].iter().sum();
        let t_sum: f64 = frame_total_e[s..e].iter().sum();
        env_vocal[e_i] = v_sum / cnt;
        env_energy[e_i] = t_sum / cnt;
    }

    // Normalize using 95th percentile so loud peaks don't suppress verses
    let norm_vec = |vals: &[f64]| -> Vec<f64> {
        if vals.is_empty() {
            return Vec::new();
        }
        let mut sorted = vals.to_vec();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let p95 = sorted[((sorted.len() as f64 * 0.95) as usize).min(sorted.len() - 1)].max(1e-6);
        vals.iter().map(|&v| (v / p95).clamp(0.0, 1.0)).collect()
    };

    let vocal_norm = norm_vec(&env_vocal);
    let energy_norm = norm_vec(&env_energy);

    // Smooth vocal envelope slightly for stable gap detection & lyric cross-correlation
    let mut vocal_smoothed = vec![0.0_f64; vocal_norm.len()];
    for i in 0..vocal_norm.len() {
        let lo = i.saturating_sub(1);
        let hi = (i + 2).min(vocal_norm.len());
        let avg: f64 = vocal_norm[lo..hi].iter().sum::<f64>() / ((hi - lo) as f64);
        vocal_smoothed[i] = avg.clamp(0.0, 1.0);
    }

    // Detect vocal silence / instrumental ranges (< 0.22 for >= 0.8s)
    let min_silence_frames = 8usize;
    let mut raw_silences: Vec<TimeRange> = Vec::new();
    let mut run_start: Option<usize> = None;
    for (i, &val) in vocal_smoothed.iter().enumerate() {
        if val < 0.22 {
            if run_start.is_none() {
                run_start = Some(i);
            }
        } else if let Some(st) = run_start.take() {
            if i.saturating_sub(st) >= min_silence_frames {
                raw_silences.push(TimeRange {
                    start_sec: st as f64 / ENV_FPS,
                    end_sec: i as f64 / ENV_FPS,
                });
            }
        }
    }
    if let Some(st) = run_start {
        if vocal_smoothed.len().saturating_sub(st) >= min_silence_frames {
            raw_silences.push(TimeRange {
                start_sec: st as f64 / ENV_FPS,
                end_sec: vocal_smoothed.len() as f64 / ENV_FPS,
            });
        }
    }

    let mut vocal_silence_ranges: Vec<TimeRange> = Vec::new();
    for seg in raw_silences {
        if let Some(last) = vocal_silence_ranges.last_mut() {
            if seg.start_sec - last.end_sec <= 0.35 {
                last.end_sec = seg.end_sec;
                continue;
            }
        }
        vocal_silence_ranges.push(seg);
    }

    // Find chorus start: max 8-second (80-frame) combined energy + vocal presence window
    let win_frames = (8.0 * ENV_FPS).round() as usize;
    let min_start_f = if duration_sec > 24.0 {
        ((duration_sec * 0.14).min(12.0) * ENV_FPS).round() as usize
    } else {
        0usize
    };
    let max_start_f = if duration_sec > 24.0 {
        ((duration_sec * 0.78) * ENV_FPS).round() as usize
    } else {
        vocal_smoothed.len().saturating_sub(win_frames / 2).max(1)
    };

    let mut best_idx = min_start_f.min(vocal_smoothed.len().saturating_sub(1));
    let mut best_score = -1.0_f64;
    let upper = max_start_f.min(vocal_smoothed.len().saturating_sub(win_frames.min(vocal_smoothed.len())));
    for s in min_start_f..=upper {
        let e = (s + win_frames).min(vocal_smoothed.len());
        let cnt = (e - s).max(1) as f64;
        let mut score = 0.0_f64;
        for k in s..e {
            score += 0.62 * energy_norm[k] + 0.38 * vocal_smoothed[k];
        }
        score /= cnt;
        if score > best_score {
            best_score = score;
            best_idx = s;
        }
    }

    let raw_chorus_sec = best_idx as f64 / ENV_FPS;
    let chorus_start_sec = if !beat_res.downbeat_times_sec.is_empty() {
        beat_res
            .downbeat_times_sec
            .iter()
            .copied()
            .min_by(|a, b| {
                (a - raw_chorus_sec)
                    .abs()
                    .partial_cmp(&(b - raw_chorus_sec).abs())
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .filter(|&d| (d - raw_chorus_sec).abs() <= 3.0)
            .unwrap_or(raw_chorus_sec)
    } else if !beat_res.beat_times_sec.is_empty() {
        beat_res
            .beat_times_sec
            .iter()
            .copied()
            .min_by(|a, b| {
                (a - raw_chorus_sec)
                    .abs()
                    .partial_cmp(&(b - raw_chorus_sec).abs())
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .filter(|&b| (b - raw_chorus_sec).abs() <= 1.5)
            .unwrap_or(raw_chorus_sec)
    } else {
        raw_chorus_sec
    };

    TrackBeatAnalysisResult {
        used_onnx: beat_res.used_onnx,
        bpm: beat_res.estimated_bpm,
        beats: beat_res.beat_times_sec,
        downbeats: beat_res.downbeat_times_sec,
        chorus_start_sec: (chorus_start_sec * 100.0).round() / 100.0,
        vocal_silence_ranges,
        vocal_envelope: vocal_smoothed,
        envelope_fps: ENV_FPS,
        duration_sec,
        error: beat_res.error,
    }
}

pub fn separate_vocals_pcm_core(
    left_in: &[f32],
    right_in: &[f32],
    sample_rate: f64,
) -> (bool, Vec<f32>, Vec<f32>, Option<String>) {
    let n = left_in.len().min(right_in.len());
    if n == 0 {
        return (false, Vec::new(), Vec::new(), Some("Empty stereo PCM".to_string()));
    }
    let sr = if sample_rate.is_finite() && sample_rate >= 8000.0 {
        sample_rate
    } else {
        44100.0
    };

    const N_FFT: usize = 4096;
    const HOP: usize = 1024;
    const BINS: usize = N_FFT / 2 + 1; // 2049

    let left_work = if (sr - 44100.0).abs() > 1.0 {
        resample_linear(&left_in[..n], sr, 44100.0)
    } else {
        left_in[..n].to_vec()
    };
    let right_work = if (sr - 44100.0).abs() > 1.0 {
        resample_linear(&right_in[..n], sr, 44100.0)
    } else {
        right_in[..n].to_vec()
    };
    let work_len = left_work.len().min(right_work.len());
    if work_len == 0 {
        return (false, vec![0.0; n], vec![0.0; n], None);
    }

    let pad = N_FFT / 2;
    let total_len = work_len + pad * 2;
    let frames = ((total_len.saturating_sub(N_FFT)) / HOP) + 1;

    let mut l_padded = vec![0.0_f32; frames * HOP + N_FFT];
    let mut r_padded = vec![0.0_f32; frames * HOP + N_FFT];
    for i in 0..work_len {
        l_padded[pad + i] = if left_work[i].is_finite() { left_work[i] } else { 0.0 };
        r_padded[pad + i] = if right_work[i].is_finite() { right_work[i] } else { 0.0 };
    }

    let hann = build_hann_window(N_FFT);
    let mut planner = RealFftPlanner::<f32>::new();
    let r2c = planner.plan_fft_forward(N_FFT);
    let c2r = planner.plan_fft_inverse(N_FFT);

    let mut f_buf = vec![0.0_f32; N_FFT];
    let mut c_spec_l = r2c.make_output_vec();
    let mut c_spec_r = r2c.make_output_vec();
    let mut f_scratch = r2c.make_scratch_vec();
    let mut i_scratch = c2r.make_scratch_vec();
    let mut i_out = vec![0.0_f32; N_FFT];

    let mut stft_l = Vec::with_capacity(frames * BINS);
    let mut stft_r = Vec::with_capacity(frames * BINS);
    let mut mags_l = vec![0.0_f32; BINS * frames];
    let mut mags_r = vec![0.0_f32; BINS * frames];

    for t in 0..frames {
        let start = t * HOP;
        for i in 0..N_FFT {
            f_buf[i] = l_padded[start + i] * hann[i];
        }
        let _ = r2c.process_with_scratch(&mut f_buf, &mut c_spec_l, &mut f_scratch);

        for i in 0..N_FFT {
            f_buf[i] = r_padded[start + i] * hann[i];
        }
        let _ = r2c.process_with_scratch(&mut f_buf, &mut c_spec_r, &mut f_scratch);

        for b in 0..BINS {
            let cl = c_spec_l[b];
            let cr = c_spec_r[b];
            stft_l.push(cl);
            stft_r.push(cr);
            mags_l[b * frames + t] = (cl.re * cl.re + cl.im * cl.im).sqrt();
            mags_r[b * frames + t] = (cr.re * cr.re + cr.im * cr.im).sqrt();
        }
    }

    // Attempt Open-Unmix ONNX inference in manageable time chunks
    let mut used_onnx = false;
    let mut target_l = vec![0.0_f32; BINS * frames];
    let mut target_r = vec![0.0_f32; BINS * frames];
    let mut onnx_err: Option<String> = None;

    if let Ok(guard) = MANAGER.read() {
        if let Some(ref session_mutex) = guard.vocals_session {
            if let Ok(mut session) = session_mutex.lock() {
                const CHUNK_FRAMES: usize = 320;
                let mut all_ok = true;
                let mut start_f = 0usize;
                while start_f < frames {
                    let cf = (frames - start_f).min(CHUNK_FRAMES);
                    let mut chunk = vec![0.0_f32; 2 * BINS * cf];
                    for b in 0..BINS {
                        let dst_l = b * cf;
                        let dst_r = BINS * cf + b * cf;
                        let src = b * frames + start_f;
                        chunk[dst_l..dst_l + cf].copy_from_slice(&mags_l[src..src + cf]);
                        chunk[dst_r..dst_r + cf].copy_from_slice(&mags_r[src..src + cf]);
                    }
                    match Tensor::from_array(([1usize, 2usize, BINS, cf], chunk))
                        .and_then(|t| session.run(ort::inputs!["mix_magnitude" => t]))
                    {
                        Ok(outputs) => {
                            if let Some((_, slice)) = outputs
                                .get("target_magnitude")
                                .and_then(|v| v.try_extract_tensor::<f32>().ok())
                            {
                                if slice.len() >= 2 * BINS * cf {
                                    for b in 0..BINS {
                                        let src_l = b * cf;
                                        let src_r = BINS * cf + b * cf;
                                        let dst = b * frames + start_f;
                                        target_l[dst..dst + cf]
                                            .copy_from_slice(&slice[src_l..src_l + cf]);
                                        target_r[dst..dst + cf]
                                            .copy_from_slice(&slice[src_r..src_r + cf]);
                                    }
                                } else {
                                    all_ok = false;
                                    break;
                                }
                            } else {
                                all_ok = false;
                                break;
                            }
                        }
                        Err(e) => {
                            onnx_err = Some(format!("ONNX vocals chunk failed: {e}"));
                            all_ok = false;
                            break;
                        }
                    }
                    start_f += cf;
                }
                used_onnx = all_ok;
            }
        }
    }

    // Reconstruct isolated vocal stem via ratio mask (ONNX) or frequency-weighted center DSP fallback
    let hz_per_bin = 44100.0 / N_FFT as f64;
    let out_buf_len = frames * HOP + N_FFT;
    let mut out_l = vec![0.0_f32; out_buf_len];
    let mut out_r = vec![0.0_f32; out_buf_len];
    let mut win_sum = vec![0.0_f32; out_buf_len];
    let fft_inv_scale = 1.0_f32 / (N_FFT as f32);

    for t in 0..frames {
        for b in 0..BINS {
            let cl = stft_l[t * BINS + b];
            let cr = stft_r[t * BINS + b];
            let (vl, vr) = if used_onnx {
                let ml = mags_l[b * frames + t] + 1e-7;
                let mr = mags_r[b * frames + t] + 1e-7;
                let mask_l = (target_l[b * frames + t] / ml).clamp(0.0, 1.15);
                let mask_r = (target_r[b * frames + t] / mr).clamp(0.0, 1.15);
                (cl * mask_l, cr * mask_r)
            } else {
                // Frequency-selective Mid/Side center extraction focused on vocal fundamentals + formants
                let hz = b as f64 * hz_per_bin;
                let band_w = if hz < 140.0 {
                    ((hz - 70.0) / 70.0).clamp(0.0, 1.0)
                } else if hz <= 6500.0 {
                    1.0
                } else {
                    (1.0 - (hz - 6500.0) / 4500.0).clamp(0.0, 1.0)
                } as f32;
                let mid = (cl + cr) * 0.5;
                let side = (cl - cr) * 0.5;
                let mid_p = mid.re * mid.re + mid.im * mid.im;
                let side_p = side.re * side.re + side.im * side.im;
                let center_ratio = if mid_p + side_p > 1e-12 {
                    (mid_p / (mid_p + 1.6 * side_p + 1e-12)).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                let gain = band_w * center_ratio;
                let v = mid * gain;
                (v, v)
            };
            c_spec_l[b] = vl;
            c_spec_r[b] = vr;
        }
        c_spec_l[0].im = 0.0;
        c_spec_l[BINS - 1].im = 0.0;
        c_spec_r[0].im = 0.0;
        c_spec_r[BINS - 1].im = 0.0;

        let start = t * HOP;
        let _ = c2r.process_with_scratch(&mut c_spec_l, &mut i_out, &mut i_scratch);
        for i in 0..N_FFT {
            let w = hann[i];
            out_l[start + i] += i_out[i] * fft_inv_scale * w;
            win_sum[start + i] += w * w;
        }

        let _ = c2r.process_with_scratch(&mut c_spec_r, &mut i_out, &mut i_scratch);
        for i in 0..N_FFT {
            out_r[start + i] += i_out[i] * fft_inv_scale * hann[i];
        }
    }

    let mut stem_l_44k = vec![0.0_f32; work_len];
    let mut stem_r_44k = vec![0.0_f32; work_len];
    for i in 0..work_len {
        let denom = win_sum[pad + i].max(1e-4);
        stem_l_44k[i] = (out_l[pad + i] / denom).clamp(-1.5, 1.5);
        stem_r_44k[i] = (out_r[pad + i] / denom).clamp(-1.5, 1.5);
    }

    if (sr - 44100.0).abs() > 1.0 {
        let mut res_l = resample_linear(&stem_l_44k, 44100.0, sr);
        let mut res_r = resample_linear(&stem_r_44k, 44100.0, sr);
        res_l.resize(n, 0.0);
        res_r.resize(n, 0.0);
        (used_onnx, res_l, res_r, onnx_err)
    } else {
        (used_onnx, stem_l_44k, stem_r_44k, onnx_err)
    }
}

pub fn estimate_lyric_offset_ms_core(
    vocal_envelope: &[f32],
    envelope_fps: f64,
    line_start_times_sec: &[f64],
) -> LyricAutoSyncResult {
    let fps = if envelope_fps.is_finite() && envelope_fps > 0.0 {
        envelope_fps
    } else {
        10.0
    };
    if vocal_envelope.len() < 4 || line_start_times_sec.is_empty() {
        return LyricAutoSyncResult {
            offset_ms: 0.0,
            confidence: 0.0,
        };
    }

    let mut starts: Vec<f64> = line_start_times_sec
        .iter()
        .copied()
        .filter(|t| t.is_finite() && *t >= 0.0)
        .collect();
    starts.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    if starts.is_empty() {
        return LyricAutoSyncResult {
            offset_ms: 0.0,
            confidence: 0.0,
        };
    }

    // Build vocal onset signal to sharpen alignment at phrase boundaries
    let n = vocal_envelope.len();
    let mut env = vec![0.0_f64; n];
    let mut onset = vec![0.0_f64; n];
    for i in 0..n {
        let v = if vocal_envelope[i].is_finite() {
            (vocal_envelope[i] as f64).clamp(0.0, 1.0)
        } else {
            0.0
        };
        env[i] = v;
        if i >= 2 {
            onset[i] = (v - env[i - 2]).max(0.0);
        }
    }

    // Evaluate cross-correlation score at candidate shift delta_ms (positive delta delays lyrics: lyricTime + delta ~= audioTime)
    let score_offset = |delta_ms: f64| -> f64 {
        let delta_sec = delta_ms / 1000.0;
        let mut total = 0.0_f64;
        let mut weight_sum = 0.0_f64;
        for (idx, &start_sec) in starts.iter().enumerate() {
            let dur = starts
                .get(idx + 1)
                .map(|&nxt| (nxt - start_sec).clamp(0.4, 4.0))
                .unwrap_or(2.0);
            let shifted_start = start_sec + delta_sec;
            let shifted_end = shifted_start + dur;
            if shifted_end < 0.0 || shifted_start >= (n as f64 / fps) {
                continue;
            }
            // Sample vocal presence across the lyric span
            let start_f = (shifted_start * fps).round().clamp(0.0, (n - 1) as f64) as usize;
            let end_f = ((shifted_end * fps).round() as usize).clamp(start_f + 1, n);
            let mut sum_e = 0.0_f64;
            for f in start_f..end_f {
                sum_e += env[f] - 0.15; // penalize silent frames where val < 0.15
            }
            let mean_presence = sum_e / ((end_f - start_f) as f64);

            // Reward onset near start_f (+/- 0.2s)
            let o_lo = start_f.saturating_sub(2);
            let o_hi = (start_f + 3).min(n);
            let peak_onset = onset[o_lo..o_hi]
                .iter()
                .copied()
                .fold(0.0_f64, f64::max);

            total += mean_presence + 0.55 * peak_onset;
            weight_sum += 1.0;
        }
        if weight_sum > 0.0 {
            total / weight_sum
        } else {
            -1.0
        }
    };

    let mut best_ms = 0.0_f64;
    let mut best_score = f64::NEG_INFINITY;
    let mut score_sum = 0.0_f64;
    let mut count = 0usize;

    let mut ms: i32 = -12000;
    while ms <= 12000 {
        let s = score_offset(ms as f64);
        score_sum += s;
        count += 1;
        // Gentle zero-prior tie-breaker when score is virtually identical
        let adjusted = s - (ms.abs() as f64) * 1e-6;
        if adjusted > best_score {
            best_score = adjusted;
            best_ms = ms as f64;
        }
        ms += 100;
    }

    // Fine 25ms sweep around coarse peak
    let fine_center = best_ms.round() as i32;
    let mut fine_ms = (fine_center - 150).max(-12000);
    let fine_max = (fine_center + 150).min(12000);
    while fine_ms <= fine_max {
        let s = score_offset(fine_ms as f64) - (fine_ms.abs() as f64) * 1e-6;
        if s > best_score {
            best_score = s;
            best_ms = fine_ms as f64;
        }
        fine_ms += 25;
    }

    let mean_score = if count > 0 { score_sum / count as f64 } else { 0.0 };
    let margin = (best_score - mean_score).max(0.0);
    let confidence = (margin / 0.35).clamp(0.0, 1.0);

    LyricAutoSyncResult {
        offset_ms: best_ms.clamp(-12000.0, 12000.0),
        confidence: (confidence * 100.0).round() / 100.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn find_models_dir() -> Option<String> {
        let candidates = [
            PathBuf::from("../../src/assets/data"),
            PathBuf::from("src/assets/data"),
        ];
        candidates
            .into_iter()
            .find(|p| p.join(BEAT_MODEL_FILENAME).is_file())
            .map(|p| p.to_string_lossy().to_string())
    }

    #[test]
    fn test_onnx_protobuf_validation_and_graceful_fallback() {
        let Some(dir) = find_models_dir() else {
            return;
        };
        let status = init_models_sync(Some(&dir), None);
        assert!(status.beat_model_valid);
        assert!(status.beat_model_bytes > 20_000_000.0);
        assert!(status.vocals_model_valid);
        assert!(status.vocals_model_bytes > 8_000_000.0);

        let frames = 100usize;
        let mut spec = vec![0.05_f32; frames * 128];
        for t in (5..frames).step_by(25) {
            for b in 0..32 {
                spec[t * 128 + b] = 2.5;
            }
        }
        let beats = infer_beats_core(&spec, frames as u32, Some(22050.0));
        assert_eq!(beats.beat_probabilities.len(), frames);
        assert!(!beats.beat_times_sec.is_empty());
        assert!((65.0..=185.0).contains(&beats.estimated_bpm));
    }

    #[test]
    fn test_pcm_beat_analysis_and_auto_lyric_sync() {
        let sr = 44100.0_f64;
        let dur_sec = 8.0_f64;
        let n = (sr * dur_sec) as usize;
        let mut left = vec![0.0_f32; n];
        let mut right = vec![0.0_f32; n];

        // Synthesize 120 BPM kick transients + center-panned vocal melody during [2.0s..3.5s] & [4.5s..6.5s]
        for i in 0..n {
            let t = i as f64 / sr;
            let beat_phase = (t * 2.0).fract(); // 120 BPM = 2 beats/sec
            let kick = if beat_phase < 0.04 {
                ((-beat_phase * 80.0).exp() * (2.0 * PI * 75.0 * t).sin()) as f32 * 0.7
            } else {
                0.0
            };
            let vocal_active = (2.0..=3.5).contains(&t) || (4.5..=6.5).contains(&t);
            let vocal = if vocal_active {
                0.45 * (2.0 * PI * 520.0 * t).sin() as f32
                    + 0.25 * (2.0 * PI * 1040.0 * t).sin() as f32
            } else {
                0.0
            };
            // Wide backing pad (anti-phase side)
            let pad = 0.12 * (2.0 * PI * 260.0 * t).sin() as f32;
            left[i] = kick + vocal + pad;
            right[i] = kick + vocal - pad;
        }

        let analysis = analyze_track_beats_pcm_core(&left, Some(&right), sr);
        assert!(!analysis.vocal_envelope.is_empty());
        assert!((analysis.duration_sec - dur_sec).abs() < 0.05);
        assert!(!analysis.vocal_silence_ranges.is_empty());

        // Planted lyrics shifted early by 1.2s => should recommend roughly +1200ms offset
        let env_f32: Vec<f32> = analysis.vocal_envelope.iter().map(|&v| v as f32).collect();
        let unaligned_lines = vec![0.8, 3.3];
        let sync = estimate_lyric_offset_ms_core(&env_f32, analysis.envelope_fps, &unaligned_lines);
        assert!(
            (sync.offset_ms - 1200.0).abs() <= 450.0,
            "Expected auto-sync offset near +1200ms, got {}",
            sync.offset_ms
        );
        assert!(sync.confidence > 0.1);

        // Vocal separation should attenuate side-panned backing relative to center vocal
        let (_, v_left, v_right, _) = separate_vocals_pcm_core(&left[..sr as usize * 3], &right[..sr as usize * 3], sr);
        assert_eq!(v_left.len(), sr as usize * 3);
        assert_eq!(v_right.len(), sr as usize * 3);
        let vocal_seg_rms: f32 = v_left[(sr * 2.2) as usize..(sr * 2.8) as usize]
            .iter()
            .map(|&s| s * s)
            .sum::<f32>()
            .sqrt();
        let silent_seg_rms: f32 = v_left[(sr * 0.4) as usize..(sr * 1.0) as usize]
            .iter()
            .map(|&s| s * s)
            .sum::<f32>()
            .sqrt();
        assert!(vocal_seg_rms > silent_seg_rms * 2.0);
    }
}
