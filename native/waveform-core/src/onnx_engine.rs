use napi::bindgen_prelude::{AsyncTask, Env, Float32Array, Result as NapiResult, Task};
use napi_derive::napi;
use once_cell::sync::Lazy;
use ort::environment::Environment;
use ort::session::Session;
use ort::value::Tensor;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock};

const BEAT_MODEL_FILENAME: &str = "beat_this_final0_q8.onnx";
const VOCALS_MODEL_FILENAME: &str = "vocals_umxhq_int8.onnx";

#[napi(object)]
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

#[napi(object)]
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

#[napi(object)]
#[derive(Clone, Debug)]
pub struct VocalsMaskResult {
    pub used_onnx: bool,
    pub target_magnitude: Vec<f64>,
    pub channels: u32,
    pub freq_bins: u32,
    pub time_frames: u32,
    pub error: Option<String>,
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

pub struct OnnxInitTask {
    models_dir: Option<String>,
    ort_dylib_path: Option<String>,
}

impl Task for OnnxInitTask {
    type Output = OnnxStatus;
    type JsValue = OnnxStatus;

    fn compute(&mut self) -> NapiResult<Self::Output> {
        Ok(init_models_sync(
            self.models_dir.as_deref(),
            self.ort_dylib_path.as_deref(),
        ))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> NapiResult<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
pub fn onnx_init_models(
    models_dir: Option<String>,
    ort_dylib_path: Option<String>,
) -> AsyncTask<OnnxInitTask> {
    AsyncTask::new(OnnxInitTask {
        models_dir,
        ort_dylib_path,
    })
}

#[napi]
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

#[napi]
pub fn onnx_infer_beats(
    spectrogram: Float32Array,
    time_frames: u32,
    sample_rate: Option<f64>,
) -> BeatInferenceResult {
    infer_beats_core(spectrogram.as_ref(), time_frames, sample_rate)
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

#[napi]
pub fn onnx_infer_vocals_mask(
    mix_magnitude: Float32Array,
    frames: Option<u32>,
) -> VocalsMaskResult {
    infer_vocals_mask_core(mix_magnitude.as_ref(), frames)
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
}
