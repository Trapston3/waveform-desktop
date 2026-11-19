// tests/fixtures/mockAudio.mjs
// DSP audio simulators, buffer synthesizers & mathematical reference formulas conforming to Survey 2

export const mockAudio = {
  SAMPLE_RATE: 44100,

  /**
   * Generates a mono Float32Array sine wave buffer.
   */
  generateSine(freq = 440, durationSec = 1.0, amplitude = 0.8, sampleRate = 44100) {
    const totalSamples = Math.floor(durationSec * sampleRate);
    const buffer = new Float32Array(totalSamples);
    const omega = (2 * Math.PI * freq) / sampleRate;
    for (let i = 0; i < totalSamples; i++) {
      buffer[i] = amplitude * Math.sin(omega * i);
    }
    return buffer;
  },

  /**
   * Generates stereo Float32Array buffers with optional phase difference.
   */
  generateStereo(freq = 440, durationSec = 1.0, amplitude = 0.8, phaseDiffRad = Math.PI / 4, sampleRate = 44100) {
    const totalSamples = Math.floor(durationSec * sampleRate);
    const left = new Float32Array(totalSamples);
    const right = new Float32Array(totalSamples);
    const omega = (2 * Math.PI * freq) / sampleRate;
    for (let i = 0; i < totalSamples; i++) {
      left[i] = amplitude * Math.sin(omega * i);
      right[i] = amplitude * Math.sin(omega * i + phaseDiffRad);
    }
    return { left, right, sampleRate, length: totalSamples };
  },

  /**
   * Generates synthetic kick drum matching Survey 2 §4.8 formula:
   * f(t) = 120 * e^(-35t) + 45, env(t) = 0.8 * e^(-30t)
   */
  generateKickDrum(durationSec = 0.5, sampleRate = 44100) {
    const totalSamples = Math.floor(durationSec * sampleRate);
    const buffer = new Float32Array(totalSamples);
    let phase = 0;
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const freq = 120 * Math.exp(-35 * t) + 45;
      const env = 0.8 * Math.exp(-30 * t);
      phase += (2 * Math.PI * freq) / sampleRate;
      buffer[i] = env * Math.sin(phase);
    }
    return buffer;
  },

  /**
   * Generates 31-bit LCG white noise hi-hat with exponential decay matching Survey 2 §4.8.
   */
  generateHiHat(durationSec = 0.2, sampleRate = 44100) {
    const totalSamples = Math.floor(durationSec * sampleRate);
    const buffer = new Float32Array(totalSamples);
    let seed = 123456789;
    const tau = 1 / 120;
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const noise = (seed / 0x7fffffff) * 2 - 1;
      const env = Math.exp(-t / tau);
      buffer[i] = 0.5 * noise * env;
    }
    return buffer;
  },

  /**
   * Constant-power crossfade gain curves:
   * gain_out(t) = cos(pi/2 * t), gain_in(t) = sin(pi/2 * t) where t in [0, 1]
   */
  calculateConstantPowerGains(progress) {
    const t = Math.max(0, Math.min(1, progress));
    const gainOut = Math.cos((Math.PI / 2) * t);
    const gainIn = Math.sin((Math.PI / 2) * t);
    const powerSum = gainOut * gainOut + gainIn * gainIn;
    return { gainOut, gainIn, powerSum };
  },

  /**
   * Spatial Audio processor simulation (Mid/Side widening + 15ms circular delay crossfeed)
   * matching Survey 2 §4.2.
   */
  processSpatialAudio(leftIn, rightIn, widthGain = 2.5, delayMs = 15, sampleRate = 44100) {
    const len = leftIn.length;
    const leftOut = new Float32Array(len);
    const rightOut = new Float32Array(len);
    const delaySamples = Math.floor((delayMs / 1000) * sampleRate);
    const delayBufferL = new Float32Array(delaySamples);
    const delayBufferR = new Float32Array(delaySamples);
    let delayIdx = 0;
    let lpL = 0;
    let lpR = 0;

    for (let i = 0; i < len; i++) {
      const l = leftIn[i];
      const r = rightIn[i];

      // 1. Mid/Side decomposition
      const mid = 0.5 * (l + r);
      const side = 0.5 * (l - r) * widthGain;
      let widenedL = mid + side;
      let widenedR = mid - side;

      // 2. Delayed crossfeed with one-pole low-pass (alpha = 0.3)
      const dL = delayBufferL[delayIdx];
      const dR = delayBufferR[delayIdx];
      delayBufferL[delayIdx] = l;
      delayBufferR[delayIdx] = r;
      delayIdx = (delayIdx + 1) % delaySamples;

      lpL += 0.3 * (dR - lpL);
      lpR += 0.3 * (dL - lpR);

      widenedL += lpL * 0.2;
      widenedR += lpR * 0.2;

      // 3. Headroom makeup gain
      leftOut[i] = widenedL * 0.82;
      rightOut[i] = widenedR * 0.82;
    }

    return { leftOut, rightOut };
  },

  /**
   * Lookahead Peak Limiter simulation matching Survey 2 §4.6:
   * Ceiling = 0.985, instant attack, exponential release tau = 0.1s.
   */
  applyLookaheadLimiter(samples, ceiling = 0.985, sampleRate = 44100) {
    const len = samples.length;
    const output = new Float32Array(len);
    const releaseCoef = 1.0 - Math.exp(-1.0 / (0.1 * sampleRate));
    let envelope = 0;

    for (let i = 0; i < len; i++) {
      const absSample = Math.abs(samples[i]);
      if (absSample > envelope) {
        envelope = absSample;
      } else {
        envelope += releaseCoef * (absSample - envelope);
      }

      let gain = 1.0;
      if (envelope > ceiling) {
        gain = ceiling / envelope;
      }
      let val = samples[i] * gain;
      if (val > ceiling) val = ceiling;
      else if (val < -ceiling) val = -ceiling;
      output[i] = val;
    }

    return { output, ceiling };
  },

  /**
   * Extracts 200-bucket amplitude envelope from audio buffer.
   */
  extract200BucketEnvelope(buffer) {
    const buckets = new Float32Array(200);
    const bucketSize = Math.floor(buffer.length / 200);
    if (bucketSize === 0) return buckets;

    for (let b = 0; b < 200; b++) {
      const start = b * bucketSize;
      const end = Math.min(start + bucketSize, buffer.length);
      let sumSq = 0;
      for (let i = start; i < end; i++) {
        sumSq += buffer[i] * buffer[i];
      }
      const count = end - start;
      buckets[b] = count > 0 ? Math.sqrt(sumSq / count) : 0;
    }

    // Normalize max peak to 1.0 if not completely silent
    let maxPeak = 0;
    for (let b = 0; b < 200; b++) {
      if (buckets[b] > maxPeak) maxPeak = buckets[b];
    }
    if (maxPeak > 0) {
      for (let b = 0; b < 200; b++) {
        buckets[b] /= maxPeak;
      }
    }
    return buckets;
  },

  /**
   * Resamples 200 buckets to 68 waveform seekbar bars.
   */
  resampleTo68Bars(buckets200) {
    const bars68 = new Float32Array(68);
    const ratio = buckets200.length / 68;
    for (let i = 0; i < 68; i++) {
      const srcIdx = Math.min(Math.floor(i * ratio), buckets200.length - 1);
      bars68[i] = buckets200[srcIdx];
    }
    return bars68;
  },

  /**
   * Computes zero-allocation 32-band PCM live energy spectrum from Float32 PCM block.
   */
  compute32BandPcmEnergy(pcmBlock) {
    const energy32 = new Float32Array(32);
    const blockSize = Math.floor(pcmBlock.length / 32);
    if (blockSize === 0) return energy32;

    for (let band = 0; band < 32; band++) {
      let sum = 0;
      const start = band * blockSize;
      for (let i = 0; i < blockSize; i++) {
        sum += Math.abs(pcmBlock[start + i]);
      }
      energy32[band] = Math.min(1.0, sum / blockSize);
    }
    return energy32;
  },
};
