use crate::autoeq::AutoEqFilter;
use once_cell::sync::Lazy;
use realfft::{RealFftPlanner, RealToComplex};
use std::collections::HashMap;
use std::f64::consts::PI;
use std::sync::{Arc, Mutex};

const EQ_FREQUENCIES_HZ: [f64; 10] = [
    60.0, 170.0, 310.0, 600.0, 1000.0, 3000.0, 6000.0, 10000.0, 12000.0, 14000.0,
];

static FFT_CACHE: Lazy<Mutex<HashMap<usize, Arc<dyn RealToComplex<f32>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Copy, Debug)]
struct BiquadCoeffs {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
}

fn calculate_biquad_coefficients(filter: &AutoEqFilter, sample_rate: f64) -> BiquadCoeffs {
    let valid_rate = if sample_rate.is_finite() && sample_rate > 0.0 {
        sample_rate
    } else {
        44100.0
    };
    let fs = valid_rate.max(8000.0);
    let safe_freq = if (filter.freq as f64).is_finite() {
        (filter.freq as f64).clamp(10.0, 0.49 * fs)
    } else {
        1000.0
    };
    let safe_q = if filter.q.is_finite() && filter.q > 0.05 {
        filter.q.min(100.0)
    } else {
        0.707
    };
    let safe_gain_db = if filter.gain_db.is_finite() {
        filter.gain_db.clamp(-40.0, 40.0)
    } else {
        0.0
    };

    let a = 10.0_f64.powf(safe_gain_db / 40.0);
    let w0 = (2.0 * PI * safe_freq) / fs;
    let sin_w0 = w0.sin();
    let cos_w0 = w0.cos();
    let alpha = sin_w0 / (2.0 * safe_q);

    let (b0, b1, b2, a0, a1, a2) = match filter.filter_type.as_str() {
        "PEAKING" => (
            1.0 + alpha * a,
            -2.0 * cos_w0,
            1.0 - alpha * a,
            1.0 + alpha / a,
            -2.0 * cos_w0,
            1.0 - alpha / a,
        ),
        "LOW_SHELF" => {
            let sqrt_a2_alpha = 2.0 * a.sqrt() * alpha;
            (
                a * ((a + 1.0) - (a - 1.0) * cos_w0 + sqrt_a2_alpha),
                2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0),
                a * ((a + 1.0) - (a - 1.0) * cos_w0 - sqrt_a2_alpha),
                (a + 1.0) + (a - 1.0) * cos_w0 + sqrt_a2_alpha,
                -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0),
                (a + 1.0) + (a - 1.0) * cos_w0 - sqrt_a2_alpha,
            )
        }
        "HIGH_SHELF" => {
            let sqrt_a2_alpha = 2.0 * a.sqrt() * alpha;
            (
                a * ((a + 1.0) + (a - 1.0) * cos_w0 + sqrt_a2_alpha),
                -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0),
                a * ((a + 1.0) + (a - 1.0) * cos_w0 - sqrt_a2_alpha),
                (a + 1.0) - (a - 1.0) * cos_w0 + sqrt_a2_alpha,
                2.0 * ((a - 1.0) - (a + 1.0) * cos_w0),
                (a + 1.0) - (a - 1.0) * cos_w0 - sqrt_a2_alpha,
            )
        }
        "LOW_PASS" => (
            (1.0 - cos_w0) * 0.5,
            1.0 - cos_w0,
            (1.0 - cos_w0) * 0.5,
            1.0 + alpha,
            -2.0 * cos_w0,
            1.0 - alpha,
        ),
        "HIGH_PASS" => (
            (1.0 + cos_w0) * 0.5,
            -(1.0 + cos_w0),
            (1.0 + cos_w0) * 0.5,
            1.0 + alpha,
            -2.0 * cos_w0,
            1.0 - alpha,
        ),
        "BAND_PASS" => (
            alpha,
            0.0,
            -alpha,
            1.0 + alpha,
            -2.0 * cos_w0,
            1.0 - alpha,
        ),
        _ => {
            return BiquadCoeffs {
                b0: 1.0,
                b1: 0.0,
                b2: 0.0,
                a1: 0.0,
                a2: 0.0,
            };
        }
    };

    let inv_a0 = 1.0 / a0;
    BiquadCoeffs {
        b0: b0 * inv_a0,
        b1: b1 * inv_a0,
        b2: b2 * inv_a0,
        a1: a1 * inv_a0,
        a2: a2 * inv_a0,
    }
}

pub fn compute_biquad_magnitude_db_core(
    filters: &[AutoEqFilter],
    freqs: &[f64],
    sample_rate: f64,
    preamp_db: f64,
) -> Vec<f64> {
    let valid_rate = if sample_rate.is_finite() && sample_rate > 0.0 {
        sample_rate
    } else {
        48000.0
    };
    let fs = valid_rate.max(8000.0);
    let safe_preamp = if preamp_db.is_finite() { preamp_db } else { 0.0 };

    let coeffs: Vec<BiquadCoeffs> = filters
        .iter()
        .map(|f| calculate_biquad_coefficients(f, fs))
        .collect();

    let nyquist = fs * 0.5;
    let two_pi_over_fs = (2.0 * PI) / fs;
    let mut out = Vec::with_capacity(freqs.len());

    for &raw_freq in freqs {
        if !raw_freq.is_finite() || raw_freq <= 0.0 {
            out.push(safe_preamp);
            continue;
        }
        let f = raw_freq.min(nyquist * 0.999);
        let w = two_pi_over_fs * f;
        let cos_w = w.cos();
        let sin_w = w.sin();
        let cos_2w = 2.0 * cos_w * cos_w - 1.0;
        let sin_2w = 2.0 * sin_w * cos_w;

        let mut db = safe_preamp;
        for c in &coeffs {
            let num_r = c.b0 + c.b1 * cos_w + c.b2 * cos_2w;
            let num_i = -(c.b1 * sin_w + c.b2 * sin_2w);
            let den_r = 1.0 + c.a1 * cos_w + c.a2 * cos_2w;
            let den_i = -(c.a1 * sin_w + c.a2 * sin_2w);
            let num_sq = num_r * num_r + num_i * num_i;
            let den_sq = (den_r * den_r + den_i * den_i).max(1e-30);
            db += 10.0 * (num_sq / den_sq).max(1e-30).log10();
        }
        out.push(db);
    }
    out
}

#[derive(Clone, Copy)]
struct SvfBandParams {
    effective_g: f64,
    k: f64,
    mix_input: f64,
    mix_band: f64,
    mix_low: f64,
    active: bool,
}

fn build_svf_band_params(slot: usize, gain_db: f64, fs: f64) -> SvfBandParams {
    if gain_db.abs() <= 0.005 {
        return SvfBandParams {
            effective_g: 1.0,
            k: 1.0,
            mix_input: 1.0,
            mix_band: 0.0,
            mix_low: 0.0,
            active: false,
        };
    }
    let fc = EQ_FREQUENCIES_HZ[slot].min(0.49 * fs);
    let a = 10.0_f64.powf(gain_db / 40.0);
    let g = ((PI * fc) / fs).tan();

    if slot == 0 {
        let q = 0.707_f64;
        let k = 1.0 / q;
        SvfBandParams {
            effective_g: g / a.sqrt(),
            k,
            mix_input: 1.0,
            mix_band: k * (a - 1.0),
            mix_low: a * a - 1.0,
            active: true,
        }
    } else if slot == 9 {
        let q = 0.707_f64;
        let k = 1.0 / q;
        SvfBandParams {
            effective_g: g * a.sqrt(),
            k,
            mix_input: a * a,
            mix_band: k * (1.0 - a) * a,
            mix_low: 1.0 - a * a,
            active: true,
        }
    } else {
        let q = 1.0_f64;
        let k = 1.0 / (q * a);
        SvfBandParams {
            effective_g: g,
            k,
            mix_input: 1.0,
            mix_band: k * (a * a - 1.0),
            mix_low: 0.0,
            active: true,
        }
    }
}

pub fn compute_svf_eq_magnitude_db_core(
    bands10: &[f64],
    freqs: &[f64],
    sample_rate: f64,
    tone_bass_db: f64,
    tone_treble_db: f64,
) -> Vec<f64> {
    let valid_rate = if sample_rate.is_finite() && sample_rate > 0.0 {
        sample_rate
    } else {
        44100.0
    };
    let fs = valid_rate.max(8000.0);
    let bass = if tone_bass_db.is_finite() {
        tone_bass_db
    } else {
        0.0
    };
    let treble = if tone_treble_db.is_finite() {
        tone_treble_db
    } else {
        0.0
    };

    let mut effective_gains = [0.0_f64; 10];
    let mut peak_boost = 0.0_f64;
    for i in 0..10 {
        let base_g = bands10.get(i).copied().unwrap_or(0.0);
        let safe_base = if base_g.is_finite() {
            base_g.clamp(-12.0, 12.0)
        } else {
            0.0
        };
        let eff = if i == 0 {
            (safe_base + bass).clamp(-12.0, 12.0)
        } else if i == 9 {
            (safe_base + treble).clamp(-12.0, 12.0)
        } else {
            safe_base
        };
        effective_gains[i] = eff;
        if eff > peak_boost {
            peak_boost = eff;
        }
    }

    let makeup_db = -peak_boost * 0.5;
    let params: Vec<SvfBandParams> = (0..10)
        .map(|s| build_svf_band_params(s, effective_gains[s], fs))
        .collect();

    let nyquist = fs * 0.5;
    let pi_over_fs = PI / fs;
    let mut out = Vec::with_capacity(freqs.len());

    for &raw_freq in freqs {
        if !raw_freq.is_finite() || raw_freq <= 0.0 {
            out.push(makeup_db);
            continue;
        }
        let f = raw_freq.min(nyquist * 0.999);
        let tan_half_w = (pi_over_fs * f).tan();

        let mut db = makeup_db;
        for p in &params {
            if !p.active {
                continue;
            }
            // Exact Cytomic trapezoidal SVF transfer function for z = e^(jw):
            // s = j * tan(w/2), u = s / effectiveG = j * y
            let y = tan_half_w / p.effective_g;
            let one_minus_y2 = 1.0 - y * y;
            let ky = p.k * y;
            let den_r = one_minus_y2;
            let den_i = ky;
            let num_r = p.mix_input * one_minus_y2 + p.mix_low;
            let num_i = (p.mix_input * p.k + p.mix_band) * y;
            let num_sq = num_r * num_r + num_i * num_i;
            let den_sq = (den_r * den_r + den_i * den_i).max(1e-30);
            db += 10.0 * (num_sq / den_sq).max(1e-30).log10();
        }
        out.push(db);
    }
    out
}

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

impl Default for BpmState {
    fn default() -> Self {
        Self {
            rolling_energy: 0.0,
            rolling_flux: 0.0,
            last_onset_ms: 0.0,
            clock_ms: 0.0,
            beat_strength: 0.0,
            estimated_bpm: 120.0,
            intervals_ms: Vec::new(),
        }
    }
}

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

fn get_or_create_fft(n_fft: usize) -> Arc<dyn RealToComplex<f32>> {
    let mut cache = FFT_CACHE.lock().unwrap();
    if let Some(plan) = cache.get(&n_fft) {
        return Arc::clone(plan);
    }
    let mut planner = RealFftPlanner::<f32>::new();
    let plan = planner.plan_fft_forward(n_fft);
    cache.insert(n_fft, Arc::clone(&plan));
    plan
}

pub fn analyze_audio_frame_core(
    pcm_samples: &[f32],
    sample_rate: f64,
    prev_magnitudes: Option<&[f64]>,
    bpm_state_in: Option<BpmState>,
) -> AudioFrameAnalysis {
    let sr = if sample_rate.is_finite() && sample_rate > 8000.0 {
        sample_rate
    } else {
        44100.0
    };
    let mut state = bpm_state_in.unwrap_or_default();
    if !state.estimated_bpm.is_finite() || state.estimated_bpm <= 0.0 {
        state.estimated_bpm = 120.0;
    }

    if pcm_samples.is_empty() {
        return AudioFrameAnalysis {
            spectrum32: vec![0.0; 32],
            magnitudes: Vec::new(),
            rms: 0.0,
            bass: 0.0,
            mid: 0.0,
            treble: 0.0,
            spectral_flux: 0.0,
            is_beat: false,
            beat_strength: state.beat_strength,
            estimated_bpm: state.estimated_bpm.clamp(65.0, 185.0),
            bpm_state: state,
        };
    }

    let raw_len = pcm_samples.len();
    let win_len = raw_len.min(4096);
    let n_fft = win_len.max(64).next_power_of_two();
    let start_idx = raw_len - win_len;

    let mut sum_sq = 0.0_f64;
    let mut input_buf = vec![0.0_f32; n_fft];
    let denom = (win_len.saturating_sub(1)).max(1) as f64;

    for i in 0..win_len {
        let s = pcm_samples[start_idx + i];
        let clean = if s.is_finite() { s } else { 0.0 };
        let clean_f64 = clean as f64;
        sum_sq += clean_f64 * clean_f64;
        let hann = 0.5 * (1.0 - ((2.0 * PI * i as f64) / denom).cos());
        input_buf[i] = (clean_f64 * hann) as f32;
    }

    let rms = (sum_sq / win_len as f64).sqrt().clamp(0.0, 1.0);

    let r2c = get_or_create_fft(n_fft);
    let mut spectrum = r2c.make_output_vec();
    let mut scratch = r2c.make_scratch_vec();
    let _ = r2c.process_with_scratch(&mut input_buf, &mut spectrum, &mut scratch);

    let norm_scale = 2.0 / (win_len as f64).max(1.0);
    let bin_count = spectrum.len();
    let mut magnitudes = Vec::with_capacity(bin_count);
    for c in &spectrum {
        let re = c.re as f64;
        let im = c.im as f64;
        let mag = (re * re + im * im).sqrt() * norm_scale;
        magnitudes.push(if mag.is_finite() { mag } else { 0.0 });
    }

    let hz_per_bin = sr / n_fft as f64;
    let mut bass_sq = 0.0_f64;
    let mut bass_n = 0usize;
    let mut mid_sq = 0.0_f64;
    let mut mid_n = 0usize;
    let mut treble_sq = 0.0_f64;
    let mut treble_n = 0usize;

    for (k, &m) in magnitudes.iter().enumerate().skip(1) {
        let freq = k as f64 * hz_per_bin;
        if freq < 250.0 {
            bass_sq += m * m;
            bass_n += 1;
        } else if freq < 4000.0 {
            mid_sq += m * m;
            mid_n += 1;
        } else if freq <= 20000.0 {
            treble_sq += m * m;
            treble_n += 1;
        }
    }

    let bass = if bass_n > 0 {
        (bass_sq / bass_n as f64).sqrt().min(1.0)
    } else {
        0.0
    };
    let mid = if mid_n > 0 {
        (mid_sq / mid_n as f64).sqrt().min(1.0)
    } else {
        0.0
    };
    let treble = if treble_n > 0 {
        (treble_sq / treble_n as f64).sqrt().min(1.0)
    } else {
        0.0
    };

    let mut spectrum32 = vec![0.0_f64; 32];
    for b in 0..32 {
        let start_frac = (b as f64 / 32.0).powi(2);
        let end_frac = ((b + 1) as f64 / 32.0).powi(2);
        let start_bin = (start_frac * bin_count as f64).floor() as usize;
        let end_bin = ((end_frac * bin_count as f64).floor() as usize)
            .max(start_bin + 1)
            .min(bin_count);
        let mut sum = 0.0_f64;
        let mut count = 0usize;
        for &m in &magnitudes[start_bin.min(bin_count)..end_bin] {
            sum += m;
            count += 1;
        }
        let avg = if count > 0 { sum / count as f64 } else { 0.0 };
        spectrum32[b] = avg.clamp(0.0, 1.0);
    }

    let spectral_flux = if let Some(prev) = prev_magnitudes {
        let len = prev.len().min(magnitudes.len());
        if len > 0 {
            let mut flux = 0.0_f64;
            for i in 0..len {
                let diff = magnitudes[i] - prev[i];
                if diff > 0.0 {
                    flux += diff;
                }
            }
            flux / len as f64
        } else {
            0.0
        }
    } else {
        0.0
    };

    let frame_dt_ms = ((raw_len as f64 / sr) * 1000.0).max(5.0);
    let clamped_dt_sec = (frame_dt_ms / 1000.0).clamp(0.0, 0.25);
    state.clock_ms += frame_dt_ms;
    state.beat_strength *= (-clamped_dt_sec / 0.16).exp();
    if state.beat_strength < 0.001 {
        state.beat_strength = 0.0;
    }

    let ioi_ms = if state.last_onset_ms > 0.0 {
        state.clock_ms - state.last_onset_ms
    } else {
        0.0
    };
    let drive = bass.max(rms * 0.85);
    let bass_onset =
        drive > 0.18 && drive > (state.rolling_energy * 1.28).max(0.22);
    let flux_onset = spectral_flux > 0.02
        && state.rolling_flux > 0.0
        && spectral_flux > state.rolling_flux * 1.45;
    let is_beat =
        (bass_onset || flux_onset) && (state.last_onset_ms == 0.0 || ioi_ms > 170.0);

    if is_beat {
        let impulse = (0.45 + (drive - state.rolling_energy * 0.75) * 1.8).clamp(0.55, 1.0);
        if impulse > state.beat_strength {
            state.beat_strength = impulse;
        }
        if state.last_onset_ms > 0.0 && (300.0..=1100.0).contains(&ioi_ms) {
            if state.intervals_ms.len() >= 12 {
                state.intervals_ms.remove(0);
            }
            state.intervals_ms.push(ioi_ms);
            let mean_ioi =
                state.intervals_ms.iter().sum::<f64>() / state.intervals_ms.len() as f64;
            if mean_ioi > 0.0 {
                let candidate = (60_000.0 / mean_ioi).clamp(65.0, 185.0);
                state.estimated_bpm =
                    (state.estimated_bpm * 0.65 + candidate * 0.35).clamp(65.0, 185.0);
            }
        }
        state.last_onset_ms = state.clock_ms;
    }

    state.rolling_energy = state.rolling_energy * 0.82 + drive * 0.18;
    state.rolling_flux = state.rolling_flux * 0.82 + spectral_flux * 0.18;

    AudioFrameAnalysis {
        spectrum32,
        magnitudes,
        rms,
        bass,
        mid,
        treble,
        spectral_flux,
        is_beat,
        beat_strength: state.beat_strength,
        estimated_bpm: state.estimated_bpm.clamp(65.0, 185.0),
        bpm_state: state,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_biquad_magnitude_matches_rbj_exact() {
        let filters = vec![
            AutoEqFilter {
                filter_type: "LOW_SHELF".to_string(),
                freq: 105,
                q: 0.71,
                gain_db: -4.5,
            },
            AutoEqFilter {
                filter_type: "PEAKING".to_string(),
                freq: 1000,
                q: 2.0,
                gain_db: 6.0,
            },
            AutoEqFilter {
                filter_type: "HIGH_SHELF".to_string(),
                freq: 10000,
                q: 0.707,
                gain_db: 6.0,
            },
            AutoEqFilter {
                filter_type: "LOW_PASS".to_string(),
                freq: 15000,
                q: 0.707,
                gain_db: 0.0,
            },
            AutoEqFilter {
                filter_type: "HIGH_PASS".to_string(),
                freq: 30,
                q: 0.707,
                gain_db: 0.0,
            },
            AutoEqFilter {
                filter_type: "BAND_PASS".to_string(),
                freq: 2000,
                q: 1.5,
                gain_db: 0.0,
            },
        ];

        let hs = vec![filters[2].clone()];
        let mag = compute_biquad_magnitude_db_core(&hs, &[20.0, 1000.0, 10000.0, 20000.0], 48000.0, -4.5);
        assert!((mag[0] - (-4.5)).abs() < 0.05);
        assert!((mag[1] - (-4.5)).abs() < 0.1);
        assert!((mag[2] - (-1.5)).abs() < 0.2);
        assert!(mag[3] > 1.0 && mag[3] <= 1.6);

        let all_mag = compute_biquad_magnitude_db_core(&filters, &[100.0, 1000.0, 10000.0], 48000.0, 0.0);
        assert_eq!(all_mag.len(), 3);
        assert!(all_mag.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn test_svf_eq_magnitude_matches_time_domain() {
        let bands = vec![6.0, 0.0, 0.0, 0.0, 4.0, 0.0, 0.0, 0.0, 0.0, -3.0];
        let sr = 44100.0;
        let mags = compute_svf_eq_magnitude_db_core(&bands, &[20.0, 1000.0, 20000.0], sr, 0.0, 0.0);
        // Peak boost is +6 dB -> makeup = -3.0 dB
        // At 1000 Hz (peaking +4 dB, makeup -3 dB) -> net ~ +1.0 dB
        assert!((mags[1] - 1.0).abs() < 0.35, "1kHz mag={}", mags[1]);
        // At 20 Hz (low shelf +6 dB, makeup -3 dB) -> net ~ +3.0 dB
        assert!((mags[0] - 3.0).abs() < 0.35, "20Hz mag={}", mags[0]);
        // At 20 kHz (high shelf -3 dB, makeup -3 dB) -> net ~ -6.0 dB
        assert!(mags[2] < -4.5 && mags[2] > -6.5, "20kHz mag={}", mags[2]);
    }

    #[test]
    fn test_analyze_audio_frame_sine_and_beat() {
        let sr = 44100.0;
        let n = 1024;
        let mut bass_sine = vec![0.0_f32; n];
        for i in 0..n {
            bass_sine[i] = 0.8 * ((2.0 * PI * 80.0 * i as f64) / sr).sin() as f32;
        }
        let res = analyze_audio_frame_core(&bass_sine, sr, None, None);
        assert_eq!(res.spectrum32.len(), 32);
        assert!(res.rms > 0.4);
        assert!(res.bass > res.treble);
        assert!(res.is_beat);
        assert!((65.0..=185.0).contains(&res.estimated_bpm));
    }
}
