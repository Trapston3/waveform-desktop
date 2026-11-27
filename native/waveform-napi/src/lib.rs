use napi::bindgen_prelude::{AsyncTask, Either, Env, Float32Array, Result as NapiResult, Task};
use napi_derive::napi;
use waveform_core::{autoeq, dsp, onnx_engine, scanner};

#[napi]
pub fn native_core_version() -> String {
    waveform_core::native_core_version()
}

// ---------- AutoEQ ----------

#[napi(object)]
#[derive(Clone, Debug)]
pub struct AutoEqFilter {
    #[napi(js_name = "type")]
    pub filter_type: String,
    pub freq: u32,
    pub q: f64,
    pub gain_db: f64,
}

impl From<autoeq::AutoEqFilter> for AutoEqFilter {
    fn from(f: autoeq::AutoEqFilter) -> Self {
        Self {
            filter_type: f.filter_type,
            freq: f.freq,
            q: f.q,
            gain_db: f.gain_db,
        }
    }
}

impl From<AutoEqFilter> for autoeq::AutoEqFilter {
    fn from(f: AutoEqFilter) -> Self {
        Self {
            filter_type: f.filter_type,
            freq: f.freq,
            q: f.q,
            gain_db: f.gain_db,
        }
    }
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

impl From<autoeq::AutoEqSearchResult> for AutoEqSearchResult {
    fn from(r: autoeq::AutoEqSearchResult) -> Self {
        Self {
            id: r.id,
            name: r.name,
            meta: r.meta,
            parametric: r.parametric,
            rig: r.rig,
        }
    }
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

impl From<autoeq::AutoEqProfile> for AutoEqProfile {
    fn from(p: autoeq::AutoEqProfile) -> Self {
        Self {
            id: p.id,
            db_id: p.db_id,
            name: p.name,
            source: p.source,
            meta: p.meta,
            parametric: p.parametric,
            preamp_gain_db: p.preamp_gain_db,
            filters: p.filters.into_iter().map(Into::into).collect(),
        }
    }
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

impl From<autoeq::AutoEqStatus> for AutoEqStatus {
    fn from(s: autoeq::AutoEqStatus) -> Self {
        Self {
            ready: s.ready,
            count: s.count,
            total_rows: s.total_rows,
            parametric_rows: s.parametric_rows,
            total_count: s.total_count,
            parametric_count: s.parametric_count,
            db_path: s.db_path,
            load_time_ms: s.load_time_ms,
            error: s.error,
        }
    }
}

#[napi]
pub fn autoeq_init(candidate_paths: Option<Vec<String>>) -> AutoEqStatus {
    autoeq::autoeq_init(candidate_paths).into()
}

#[napi]
pub fn autoeq_status() -> AutoEqStatus {
    autoeq::autoeq_status().into()
}

#[napi]
pub fn autoeq_search(query: String, limit: Option<u32>) -> Vec<AutoEqSearchResult> {
    autoeq::autoeq_search(query, limit)
        .into_iter()
        .map(Into::into)
        .collect()
}

#[napi]
pub fn autoeq_find_profile(name_or_id: Either<String, i64>) -> Option<AutoEqProfile> {
    let lookup = match name_or_id {
        Either::A(s) => autoeq::AutoEqLookup::Name(s),
        Either::B(n) => autoeq::AutoEqLookup::Id(n),
    };
    autoeq::autoeq_find_profile(lookup).map(Into::into)
}

// ---------- DSP ----------

#[napi(object)]
#[derive(Clone, Debug)]
pub struct BpmState {
    pub rolling_energy: f64,
    pub rolling_flux: f64,
    pub last_onset_ms: f64,
    pub clock_ms: f64,
    pub beat_strength: f64,
    pub estimated_bpm: f64,
    pub intervals_ms: Vec<f64>,
}

impl From<dsp::BpmState> for BpmState {
    fn from(s: dsp::BpmState) -> Self {
        Self {
            rolling_energy: s.rolling_energy,
            rolling_flux: s.rolling_flux,
            last_onset_ms: s.last_onset_ms,
            clock_ms: s.clock_ms,
            beat_strength: s.beat_strength,
            estimated_bpm: s.estimated_bpm,
            intervals_ms: s.intervals_ms,
        }
    }
}

impl From<BpmState> for dsp::BpmState {
    fn from(s: BpmState) -> Self {
        Self {
            rolling_energy: s.rolling_energy,
            rolling_flux: s.rolling_flux,
            last_onset_ms: s.last_onset_ms,
            clock_ms: s.clock_ms,
            beat_strength: s.beat_strength,
            estimated_bpm: s.estimated_bpm,
            intervals_ms: s.intervals_ms,
        }
    }
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct AudioFrameAnalysis {
    pub spectrum32: Vec<f64>,
    pub magnitudes: Vec<f64>,
    pub rms: f64,
    pub bass: f64,
    pub mid: f64,
    pub treble: f64,
    pub spectral_flux: f64,
    pub is_beat: bool,
    pub beat_strength: f64,
    pub estimated_bpm: f64,
    pub bpm_state: BpmState,
}

impl From<dsp::AudioFrameAnalysis> for AudioFrameAnalysis {
    fn from(a: dsp::AudioFrameAnalysis) -> Self {
        Self {
            spectrum32: a.spectrum32,
            magnitudes: a.magnitudes,
            rms: a.rms,
            bass: a.bass,
            mid: a.mid,
            treble: a.treble,
            spectral_flux: a.spectral_flux,
            is_beat: a.is_beat,
            beat_strength: a.beat_strength,
            estimated_bpm: a.estimated_bpm,
            bpm_state: a.bpm_state.into(),
        }
    }
}

#[napi]
pub fn compute_biquad_magnitude_db(
    filters: Vec<AutoEqFilter>,
    freqs: Vec<f64>,
    sample_rate: Option<f64>,
    preamp_db: Option<f64>,
) -> Vec<f64> {
    let core_filters: Vec<autoeq::AutoEqFilter> = filters.into_iter().map(Into::into).collect();
    dsp::compute_biquad_magnitude_db_core(
        &core_filters,
        &freqs,
        sample_rate.unwrap_or(48000.0),
        preamp_db.unwrap_or(0.0),
    )
}

#[napi]
pub fn compute_svf_eq_magnitude_db(
    bands10: Vec<f64>,
    freqs: Vec<f64>,
    sample_rate: Option<f64>,
    tone_bass_db: Option<f64>,
    tone_treble_db: Option<f64>,
) -> Vec<f64> {
    dsp::compute_svf_eq_magnitude_db_core(
        &bands10,
        &freqs,
        sample_rate.unwrap_or(44100.0),
        tone_bass_db.unwrap_or(0.0),
        tone_treble_db.unwrap_or(0.0),
    )
}

#[napi]
pub fn analyze_audio_frame(
    pcm_samples: Float32Array,
    sample_rate: Option<f64>,
    prev_magnitudes: Option<Either<Float32Array, Vec<f64>>>,
    bpm_state: Option<BpmState>,
) -> AudioFrameAnalysis {
    let prev_vec: Option<Vec<f64>> = prev_magnitudes.map(|either| match either {
        Either::A(arr) => arr.as_ref().iter().map(|&v| v as f64).collect(),
        Either::B(vec) => vec,
    });
    dsp::analyze_audio_frame_core(
        pcm_samples.as_ref(),
        sample_rate.unwrap_or(44100.0),
        prev_vec.as_deref(),
        bpm_state.map(Into::into),
    )
    .into()
}

// ---------- ONNX Audio ML Engine ----------

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

impl From<onnx_engine::OnnxStatus> for OnnxStatus {
    fn from(s: onnx_engine::OnnxStatus) -> Self {
        Self {
            ort_loaded: s.ort_loaded,
            ort_dylib_path: s.ort_dylib_path,
            beat_model_loaded: s.beat_model_loaded,
            beat_model_path: s.beat_model_path,
            beat_model_valid: s.beat_model_valid,
            beat_model_bytes: s.beat_model_bytes,
            vocals_model_loaded: s.vocals_model_loaded,
            vocals_model_path: s.vocals_model_path,
            vocals_model_valid: s.vocals_model_valid,
            vocals_model_bytes: s.vocals_model_bytes,
            error: s.error,
        }
    }
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

impl From<onnx_engine::BeatInferenceResult> for BeatInferenceResult {
    fn from(r: onnx_engine::BeatInferenceResult) -> Self {
        Self {
            used_onnx: r.used_onnx,
            beat_probabilities: r.beat_probabilities,
            downbeat_probabilities: r.downbeat_probabilities,
            beat_times_sec: r.beat_times_sec,
            downbeat_times_sec: r.downbeat_times_sec,
            estimated_bpm: r.estimated_bpm,
            error: r.error,
        }
    }
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

impl From<onnx_engine::VocalsMaskResult> for VocalsMaskResult {
    fn from(r: onnx_engine::VocalsMaskResult) -> Self {
        Self {
            used_onnx: r.used_onnx,
            target_magnitude: r.target_magnitude,
            channels: r.channels,
            freq_bins: r.freq_bins,
            time_frames: r.time_frames,
            error: r.error,
        }
    }
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct TimeRange {
    pub start_sec: f64,
    pub end_sec: f64,
}

impl From<onnx_engine::TimeRange> for TimeRange {
    fn from(r: onnx_engine::TimeRange) -> Self {
        Self {
            start_sec: r.start_sec,
            end_sec: r.end_sec,
        }
    }
}

#[napi(object)]
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

impl From<onnx_engine::TrackBeatAnalysisResult> for TrackBeatAnalysisResult {
    fn from(r: onnx_engine::TrackBeatAnalysisResult) -> Self {
        Self {
            used_onnx: r.used_onnx,
            bpm: r.bpm,
            beats: r.beats,
            downbeats: r.downbeats,
            chorus_start_sec: r.chorus_start_sec,
            vocal_silence_ranges: r.vocal_silence_ranges.into_iter().map(Into::into).collect(),
            vocal_envelope: r.vocal_envelope,
            envelope_fps: r.envelope_fps,
            duration_sec: r.duration_sec,
            error: r.error,
        }
    }
}

#[napi(object)]
pub struct VocalSeparationResult {
    pub used_onnx: bool,
    pub vocals_left: Float32Array,
    pub vocals_right: Float32Array,
    pub sample_rate: f64,
    pub error: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct LyricAutoSyncResult {
    pub offset_ms: f64,
    pub confidence: f64,
}

impl From<onnx_engine::LyricAutoSyncResult> for LyricAutoSyncResult {
    fn from(r: onnx_engine::LyricAutoSyncResult) -> Self {
        Self {
            offset_ms: r.offset_ms,
            confidence: r.confidence,
        }
    }
}

pub struct OnnxInitTask {
    models_dir: Option<String>,
    ort_dylib_path: Option<String>,
}

impl Task for OnnxInitTask {
    type Output = onnx_engine::OnnxStatus;
    type JsValue = OnnxStatus;

    fn compute(&mut self) -> NapiResult<Self::Output> {
        Ok(onnx_engine::init_models_sync(
            self.models_dir.as_deref(),
            self.ort_dylib_path.as_deref(),
        ))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> NapiResult<Self::JsValue> {
        Ok(output.into())
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
    onnx_engine::onnx_status().into()
}

#[napi]
pub fn onnx_infer_beats(
    spectrogram: Float32Array,
    time_frames: u32,
    sample_rate: Option<f64>,
) -> BeatInferenceResult {
    onnx_engine::infer_beats_core(spectrogram.as_ref(), time_frames, sample_rate).into()
}

#[napi]
pub fn onnx_infer_vocals_mask(
    mix_magnitude: Float32Array,
    frames: Option<u32>,
) -> VocalsMaskResult {
    onnx_engine::infer_vocals_mask_core(mix_magnitude.as_ref(), frames).into()
}

pub struct AnalyzeBeatsPcmTask {
    left: Vec<f32>,
    right: Option<Vec<f32>>,
    sample_rate: f64,
}

impl Task for AnalyzeBeatsPcmTask {
    type Output = onnx_engine::TrackBeatAnalysisResult;
    type JsValue = TrackBeatAnalysisResult;

    fn compute(&mut self) -> NapiResult<Self::Output> {
        Ok(onnx_engine::analyze_track_beats_pcm_core(
            &self.left,
            self.right.as_deref(),
            self.sample_rate,
        ))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> NapiResult<Self::JsValue> {
        Ok(output.into())
    }
}

#[napi]
pub fn onnx_analyze_track_beats_pcm(
    left_pcm: Float32Array,
    right_pcm: Option<Float32Array>,
    sample_rate: f64,
) -> AsyncTask<AnalyzeBeatsPcmTask> {
    AsyncTask::new(AnalyzeBeatsPcmTask {
        left: left_pcm.to_vec(),
        right: right_pcm.map(|r| r.to_vec()),
        sample_rate,
    })
}

pub struct SeparateVocalsOutput {
    used_onnx: bool,
    vocals_left: Vec<f32>,
    vocals_right: Vec<f32>,
    sample_rate: f64,
    error: Option<String>,
}

pub struct SeparateVocalsPcmTask {
    left: Vec<f32>,
    right: Vec<f32>,
    sample_rate: f64,
}

impl Task for SeparateVocalsPcmTask {
    type Output = SeparateVocalsOutput;
    type JsValue = VocalSeparationResult;

    fn compute(&mut self) -> NapiResult<Self::Output> {
        let (used_onnx, vocals_left, vocals_right, error) =
            onnx_engine::separate_vocals_pcm_core(&self.left, &self.right, self.sample_rate);
        Ok(SeparateVocalsOutput {
            used_onnx,
            vocals_left,
            vocals_right,
            sample_rate: self.sample_rate,
            error,
        })
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> NapiResult<Self::JsValue> {
        Ok(VocalSeparationResult {
            used_onnx: output.used_onnx,
            vocals_left: Float32Array::new(output.vocals_left),
            vocals_right: Float32Array::new(output.vocals_right),
            sample_rate: output.sample_rate,
            error: output.error,
        })
    }
}

#[napi]
pub fn onnx_separate_vocals_pcm(
    left_pcm: Float32Array,
    right_pcm: Float32Array,
    sample_rate: f64,
) -> AsyncTask<SeparateVocalsPcmTask> {
    AsyncTask::new(SeparateVocalsPcmTask {
        left: left_pcm.to_vec(),
        right: right_pcm.to_vec(),
        sample_rate,
    })
}

#[napi]
pub fn estimate_lyric_offset_ms(
    vocal_envelope: Float32Array,
    envelope_fps: f64,
    line_start_times_sec: Vec<f64>,
) -> LyricAutoSyncResult {
    onnx_engine::estimate_lyric_offset_ms_core(
        vocal_envelope.as_ref(),
        envelope_fps,
        &line_start_times_sec,
    )
    .into()
}

// ---------- Local Library Scanner ----------

#[napi(object)]
#[derive(Clone, Debug)]
pub struct TrackArtist {
    pub id: String,
    pub name: String,
}

impl From<scanner::TrackArtist> for TrackArtist {
    fn from(a: scanner::TrackArtist) -> Self {
        Self {
            id: a.id,
            name: a.name,
        }
    }
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

impl From<scanner::LocalTrack> for LocalTrack {
    fn from(t: scanner::LocalTrack) -> Self {
        Self {
            id: t.id,
            video_id: t.video_id,
            local_file_path: t.local_file_path,
            folder_path: t.folder_path,
            mtime_ms: t.mtime_ms,
            last_modified_ms: t.last_modified_ms,
            size: t.size,
            file_size_bytes: t.file_size_bytes,
            title: t.title,
            artist: t.artist,
            artists: t.artists.into_iter().map(Into::into).collect(),
            artist_id: t.artist_id,
            artist_ids: t.artist_ids,
            album: t.album,
            album_name: t.album_name,
            album_artist: t.album_artist,
            album_id: t.album_id,
            track_number: t.track_number,
            year: t.year,
            duration_sec: t.duration_sec,
            duration_text: t.duration_text,
            total_play_time_ms: t.total_play_time_ms,
            codec: t.codec,
            bit_depth: t.bit_depth,
            sample_rate: t.sample_rate,
            bitrate: t.bitrate,
            source_quality: t.source_quality,
            audio_quality: t.audio_quality,
            artwork_hash: t.artwork_hash,
            thumbnail_url: t.thumbnail_url,
            artwork_url: t.artwork_url,
            source: t.source,
            is_local: t.is_local,
            playback_source_type: t.playback_source_type,
            stream_url: t.stream_url,
            liked: t.liked,
            play_count: t.play_count,
            is_explicit: t.is_explicit,
            has_original_audio: t.has_original_audio,
            lyrics: t.lyrics,
            metadata_cache_key: t.metadata_cache_key,
        }
    }
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct CachedTrackInput {
    pub local_file_path: String,
    pub mtime_ms: f64,
    pub size: f64,
}

impl From<CachedTrackInput> for scanner::CachedTrackInput {
    fn from(c: CachedTrackInput) -> Self {
        Self {
            local_file_path: c.local_file_path,
            mtime_ms: c.mtime_ms,
            size: c.size,
        }
    }
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

impl From<scanner::IncrementalScanResult> for IncrementalScanResult {
    fn from(r: scanner::IncrementalScanResult) -> Self {
        Self {
            folders: r.folders,
            tracks: r.tracks.into_iter().map(Into::into).collect(),
            unchanged_paths: r.unchanged_paths,
            added: r.added,
            updated: r.updated,
            removed: r.removed,
        }
    }
}

pub struct ScanFolderTask {
    folder_path: String,
    user_data_path: String,
}

impl Task for ScanFolderTask {
    type Output = Vec<scanner::LocalTrack>;
    type JsValue = Vec<LocalTrack>;

    fn compute(&mut self) -> NapiResult<Self::Output> {
        Ok(scanner::scan_folder_sync(&self.folder_path, &self.user_data_path))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> NapiResult<Self::JsValue> {
        Ok(output.into_iter().map(Into::into).collect())
    }
}

pub struct IncrementalScanTask {
    folders: Vec<String>,
    user_data_path: String,
    cached_entries: Vec<scanner::CachedTrackInput>,
}

impl Task for IncrementalScanTask {
    type Output = scanner::IncrementalScanResult;
    type JsValue = IncrementalScanResult;

    fn compute(&mut self) -> NapiResult<Self::Output> {
        Ok(scanner::scan_incremental_sync(
            &self.folders,
            &self.user_data_path,
            &self.cached_entries,
        ))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> NapiResult<Self::JsValue> {
        Ok(output.into())
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
        cached_entries: cached_entries
            .unwrap_or_default()
            .into_iter()
            .map(Into::into)
            .collect(),
    })
}
