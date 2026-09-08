/**
 * G.711 µ-law codec + telephony-quality resampling for Twilio ↔ Gemini Live.
 *
 * Pipeline:
 *   Twilio µ-law 8 kHz mono
 *   → PCM16 LE 8 kHz
 *   → upsample → PCM16 LE 16 kHz → Gemini Live input
 *   Gemini Live output PCM16 LE mono @ mime rate (16k / 24k / 48k)
 *   → anti-aliased downsample → PCM16 LE 8 kHz
 *   → µ-law 8 kHz → Twilio Media Stream (~20 ms / 160-byte frames)
 *
 * Format assumptions (verified at convert time):
 *   - PCM: signed 16-bit little-endian, mono, 2 bytes/sample
 *   - Twilio: G.711 µ-law, 8 kHz, mono, 1 byte/sample
 */

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;
const MULAW_ENCODE: number[] = [
  0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
  4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
];

/** Twilio / telephony frame: 20 ms @ 8 kHz µ-law = 160 bytes. */
export const MULAW_FRAME_BYTES = 160;
export const TWILIO_SAMPLE_RATE = 8000;
export const GEMINI_INPUT_SAMPLE_RATE = 16000;

export type AudioConvertStats = {
  geminiRate: number;
  inputSamples: number;
  outputSamples: number;
  inputDurationMs: number;
  outputDurationMs: number;
  mulawBytes: number;
};

export function mulawDecode(mulaw: Buffer): Int16Array {
  const out = new Int16Array(mulaw.length);
  for (let i = 0; i < mulaw.length; i++) {
    let u = ~mulaw[i];
    const sign = u & 0x80;
    const exponent = (u >> 4) & 0x07;
    const mantissa = u & 0x0f;
    let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
    sample -= MULAW_BIAS;
    out[i] = sign ? -sample : sample;
  }
  return out;
}

/** RMS of a µ-law frame (Twilio inbound). Used to ignore speaker-echo during AI playback. */
export function mulawRms(mulaw: Buffer): number {
  if (!mulaw.length) return 0;
  const pcm = mulawDecode(mulaw);
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const s = pcm[i];
    sum += s * s;
  }
  return Math.sqrt(sum / pcm.length);
}

export function mulawBase64Rms(b64: string): number {
  if (!b64) return 0;
  return mulawRms(Buffer.from(b64, "base64"));
}

export function mulawEncode(pcm: Int16Array): Buffer {
  const out = Buffer.alloc(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    let sample = pcm[i];
    const sign = sample < 0 ? 0x80 : 0;
    if (sample < 0) sample = -sample;
    if (sample > MULAW_CLIP) sample = MULAW_CLIP;
    sample += MULAW_BIAS;
    const exponent = MULAW_ENCODE[sample >> 7] ?? 7;
    const mantissa = (sample >> (exponent + 3)) & 0x0f;
    out[i] = ~(sign | (exponent << 4) | mantissa);
  }
  return out;
}

/**
 * Hamming-windowed sinc low-pass FIR.
 * @param normalizedCutoff fraction of input sample rate (0..0.5), e.g. 0.45/factor
 */
export function designLowpassFir(
  numTaps: number,
  normalizedCutoff: number
): Float64Array {
  const taps = Math.max(3, numTaps | 1); // odd length
  const fc = Math.min(0.49, Math.max(0.01, normalizedCutoff));
  const mid = (taps - 1) / 2;
  const h = new Float64Array(taps);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const n = i - mid;
    const sinc =
      n === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n);
    const hamm = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1));
    h[i] = sinc * hamm;
    sum += h[i];
  }
  if (sum !== 0) {
    for (let i = 0; i < taps; i++) h[i] /= sum;
  }
  return h;
}

function clamp16(v: number): number {
  if (v > 32767) return 32767;
  if (v < -32768) return -32768;
  return v | 0;
}

/**
 * Anti-aliased integer-factor decimation (low-pass then take every Nth sample).
 * Preserves duration and pitch; does not time-stretch.
 */
export function decimateWithLowpass(
  pcm: Int16Array,
  factor: number,
  kernel?: Float64Array
): Int16Array {
  if (factor <= 1) return pcm;
  const h = kernel ?? designLowpassFir(factor <= 2 ? 31 : factor <= 3 ? 47 : 63, 0.45 / factor);
  const hist = h.length - 1;
  const outLen = Math.floor(pcm.length / factor);
  const out = new Int16Array(outLen);
  for (let o = 0; o < outLen; o++) {
    const center = o * factor;
    let acc = 0;
    for (let k = 0; k < h.length; k++) {
      const idx = center + k - hist;
      const s = idx >= 0 && idx < pcm.length ? pcm[idx] : 0;
      acc += h[k] * s;
    }
    out[o] = clamp16(Math.round(acc));
  }
  return out;
}

/** Streaming anti-aliased resampler: sourceRate → 8 kHz PCM16 mono. */
export class StreamingPcmTo8kResampler {
  private readonly factor: number;
  private readonly kernel: Float64Array;
  private readonly histLen: number;
  /** Unprocessed input samples (includes FIR history prefix). */
  private pending: number[] = [];
  private primed = false;

  constructor(sourceRateHz: number) {
    if (![8000, 16000, 24000, 48000].includes(sourceRateHz)) {
      throw new Error(`Unsupported PCM sample rate: ${sourceRateHz}`);
    }
    this.factor = sourceRateHz / TWILIO_SAMPLE_RATE;
    if (this.factor === 1) {
      this.kernel = new Float64Array([1]);
      this.histLen = 0;
      return;
    }
    const taps = this.factor <= 2 ? 31 : this.factor <= 3 ? 47 : 63;
    this.kernel = designLowpassFir(taps, 0.45 / this.factor);
    this.histLen = this.kernel.length - 1;
  }

  get sourceFactor() {
    return this.factor;
  }

  reset() {
    this.pending = [];
    this.primed = false;
  }

  process(input: Int16Array): Int16Array {
    if (this.factor === 1) {
      return input.slice();
    }
    for (let i = 0; i < input.length; i++) this.pending.push(input[i]);

    if (!this.primed) {
      // Zero-pad history so the first real sample can be filtered.
      if (this.pending.length < this.histLen + 1) {
        return new Int16Array(0);
      }
      const pad = new Array(this.histLen).fill(0);
      this.pending = pad.concat(this.pending);
      this.primed = true;
    }

    const out: number[] = [];
    // Need histLen samples after center for causal FIR (center at histLen).
    while (this.pending.length >= this.kernel.length) {
      let acc = 0;
      for (let k = 0; k < this.kernel.length; k++) {
        acc += this.kernel[k] * this.pending[k];
      }
      out.push(clamp16(Math.round(acc)));
      // Advance by factor samples (decimate).
      this.pending.splice(0, this.factor);
    }
    return Int16Array.from(out);
  }

  /** Emit any final complete frames; drop incomplete FIR tail (sub-ms). */
  flush(): Int16Array {
    if (this.factor === 1) {
      const left = Int16Array.from(this.pending);
      this.pending = [];
      return left;
    }
    const out = this.process(new Int16Array(0));
    this.pending = [];
    this.primed = false;
    return out;
  }
}

/** Linear-interpolation upsample 8 kHz → 16 kHz (better than sample-hold for Gemini in). */
export function upsample8kTo16k(pcm8k: Int16Array): Int16Array {
  if (pcm8k.length === 0) return new Int16Array(0);
  const out = new Int16Array(pcm8k.length * 2);
  for (let i = 0; i < pcm8k.length; i++) {
    const a = pcm8k[i];
    const b = i + 1 < pcm8k.length ? pcm8k[i + 1] : a;
    out[i * 2] = a;
    out[i * 2 + 1] = clamp16(Math.round((a + b) / 2));
  }
  return out;
}

/** @deprecated Prefer StreamingPcmTo8kResampler / decimateWithLowpass */
export function downsampleByFactor(pcm: Int16Array, factor: number): Int16Array {
  return decimateWithLowpass(pcm, factor);
}

export function downsample24kTo8k(pcm24k: Int16Array): Int16Array {
  return decimateWithLowpass(pcm24k, 3);
}

export function downsample16kTo8k(pcm16k: Int16Array): Int16Array {
  return decimateWithLowpass(pcm16k, 2);
}

export function downsample48kTo8k(pcm48k: Int16Array): Int16Array {
  return decimateWithLowpass(pcm48k, 6);
}

export function parsePcmSampleRate(mimeType: string | undefined): number {
  if (!mimeType) return 24000;
  const m = mimeType.match(/rate\s*=\s*(\d+)/i);
  if (!m) return 24000;
  const rate = Number.parseInt(m[1], 10);
  if (rate === 8000 || rate === 16000 || rate === 24000 || rate === 48000) {
    return rate;
  }
  return 24000;
}

/** Confirm buffer looks like PCM16 LE mono (even byte length). */
export function assertPcm16Mono(buf: Buffer): void {
  if (buf.length % 2 !== 0) {
    throw new Error("PCM buffer length is odd — expected PCM16 LE mono");
  }
}

export function int16ToBuffer(samples: Int16Array): Buffer {
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
}

export function bufferToInt16(buf: Buffer): Int16Array {
  assertPcm16Mono(buf);
  return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
}

export function mulaw8kToPcm16kBase64(mulawB64: string): string {
  const mulaw = Buffer.from(mulawB64, "base64");
  const pcm8k = mulawDecode(mulaw);
  const pcm16k = upsample8kTo16k(pcm8k);
  return int16ToBuffer(pcm16k).toString("base64");
}

export function pcmToMulaw8kWithStats(
  pcm: Int16Array,
  sourceRateHz: number
): { mulaw: Buffer; stats: AudioConvertStats } {
  let pcm8k: Int16Array;
  if (sourceRateHz === 8000) pcm8k = pcm;
  else if (sourceRateHz === 16000) pcm8k = downsample16kTo8k(pcm);
  else if (sourceRateHz === 48000) pcm8k = downsample48kTo8k(pcm);
  else pcm8k = downsample24kTo8k(pcm);

  const mulaw = mulawEncode(pcm8k);
  const inputDurationMs = (pcm.length / sourceRateHz) * 1000;
  const outputDurationMs = (pcm8k.length / TWILIO_SAMPLE_RATE) * 1000;
  return {
    mulaw,
    stats: {
      geminiRate: sourceRateHz,
      inputSamples: pcm.length,
      outputSamples: pcm8k.length,
      inputDurationMs,
      outputDurationMs,
      mulawBytes: mulaw.length,
    },
  };
}

/**
 * One-shot convert Gemini PCM (base64) → µ-law 8 kHz.
 * Prefer StreamingGeminiAudioPipeline for live calls (filter continuity).
 */
export function pcmBase64ToMulaw8k(
  pcmB64: string,
  sourceRateHz = 24000
): string {
  const pcmBuf = Buffer.from(pcmB64, "base64");
  const pcm = bufferToInt16(pcmBuf);
  return pcmToMulaw8kWithStats(pcm, sourceRateHz).mulaw.toString("base64");
}

export function pcm24kBase64ToMulaw8k(pcmB64: string): string {
  return pcmBase64ToMulaw8k(pcmB64, 24000);
}

/**
 * Continuous Gemini→Twilio converter: MIME-rate aware + anti-aliased + duration-safe.
 */
export class StreamingGeminiAudioPipeline {
  private resampler: StreamingPcmTo8kResampler | null = null;
  private rate = 0;
  private chunkCount = 0;

  get currentRate() {
    return this.rate;
  }

  reset() {
    this.resampler?.reset();
    this.resampler = null;
    this.rate = 0;
    this.chunkCount = 0;
  }

  /**
   * Push one Gemini PCM chunk. Returns µ-law bytes (may be empty if FIR priming).
   */
  pushPcmBase64(
    pcmB64: string,
    sourceRateHz: number
  ): { mulaw: Buffer; stats: AudioConvertStats } {
    if (!this.resampler || this.rate !== sourceRateHz) {
      this.resampler = new StreamingPcmTo8kResampler(sourceRateHz);
      this.rate = sourceRateHz;
    }
    const pcmBuf = Buffer.from(pcmB64, "base64");
    const pcm = bufferToInt16(pcmBuf);
    const pcm8k = this.resampler.process(pcm);
    const mulaw = mulawEncode(pcm8k);
    this.chunkCount += 1;
    const inputDurationMs = (pcm.length / sourceRateHz) * 1000;
    const outputDurationMs = (pcm8k.length / TWILIO_SAMPLE_RATE) * 1000;
    return {
      mulaw,
      stats: {
        geminiRate: sourceRateHz,
        inputSamples: pcm.length,
        outputSamples: pcm8k.length,
        inputDurationMs,
        outputDurationMs,
        mulawBytes: mulaw.length,
      },
    };
  }

  flush(): Buffer {
    if (!this.resampler) return Buffer.alloc(0);
    const pcm8k = this.resampler.flush();
    return mulawEncode(pcm8k);
  }
}

export function isVoiceAudioDebugEnabled(): boolean {
  const v = (process.env.VOICE_AUDIO_DEBUG || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Sampled / debug logging — never logs audio bytes or secrets. */
export function logVoiceAudioStats(
  stats: AudioConvertStats,
  extra?: Record<string, unknown>
) {
  if (!isVoiceAudioDebugEnabled()) return;
  const driftMs = Math.abs(stats.outputDurationMs - stats.inputDurationMs);
  console.debug("[voice-audio]", {
    rate: stats.geminiRate,
    pcmSamples: stats.inputSamples,
    outSamples: stats.outputSamples,
    durationMs: Math.round(stats.inputDurationMs * 10) / 10,
    outDurationMs: Math.round(stats.outputDurationMs * 10) / 10,
    driftMs: Math.round(driftMs * 10) / 10,
    mulawBytes: stats.mulawBytes,
    ...extra,
  });
}
