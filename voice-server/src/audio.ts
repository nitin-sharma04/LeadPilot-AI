/**
 * G.711 µ-law codec + resampling for Twilio ↔ Gemini Live.
 * Twilio: audio/x-mulaw @ 8 kHz
 * Gemini Live input: PCM16 LE @ 16 kHz
 * Gemini Live output: PCM16 LE @ 24 kHz (verify mime rate — wrong rate = sped-up playback)
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

/** Exact 2× upsample 8 kHz → 16 kHz (duplicate samples). */
export function upsample8kTo16k(pcm8k: Int16Array): Int16Array {
  const out = new Int16Array(pcm8k.length * 2);
  for (let i = 0; i < pcm8k.length; i++) {
    out[i * 2] = pcm8k[i];
    out[i * 2 + 1] = pcm8k[i];
  }
  return out;
}

/** Downsample by averaging groups of `factor` samples (integer factor only). */
export function downsampleByFactor(pcm: Int16Array, factor: number): Int16Array {
  if (factor <= 1) return pcm;
  const outLen = Math.floor(pcm.length / factor);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const i0 = i * factor;
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += pcm[i0 + j];
    out[i] = Math.round(sum / factor);
  }
  return out;
}

/** Downsample 24 kHz → 8 kHz by averaging each group of 3 samples. */
export function downsample24kTo8k(pcm24k: Int16Array): Int16Array {
  return downsampleByFactor(pcm24k, 3);
}

/** Downsample 16 kHz → 8 kHz by averaging pairs. */
export function downsample16kTo8k(pcm16k: Int16Array): Int16Array {
  return downsampleByFactor(pcm16k, 2);
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

export function int16ToBuffer(samples: Int16Array): Buffer {
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
}

export function bufferToInt16(buf: Buffer): Int16Array {
  return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
}

export function mulaw8kToPcm16kBase64(mulawB64: string): string {
  const mulaw = Buffer.from(mulawB64, "base64");
  const pcm8k = mulawDecode(mulaw);
  const pcm16k = upsample8kTo16k(pcm8k);
  return int16ToBuffer(pcm16k).toString("base64");
}

/**
 * Convert Gemini PCM (typically 24 kHz, sometimes 16 kHz) → Twilio µ-law 8 kHz.
 * Using the wrong source rate makes playback sound sped-up or slowed-down.
 */
export function pcmBase64ToMulaw8k(
  pcmB64: string,
  sourceRateHz = 24000
): string {
  const pcmBuf = Buffer.from(pcmB64, "base64");
  const pcm = bufferToInt16(pcmBuf);
  let pcm8k: Int16Array;
  if (sourceRateHz === 8000) {
    pcm8k = pcm;
  } else if (sourceRateHz === 16000) {
    pcm8k = downsample16kTo8k(pcm);
  } else if (sourceRateHz === 48000) {
    pcm8k = downsampleByFactor(pcm, 6);
  } else {
    // Default / 24000
    pcm8k = downsample24kTo8k(pcm);
  }
  return mulawEncode(pcm8k).toString("base64");
}

/** @deprecated Prefer pcmBase64ToMulaw8k(pcm, 24000) */
export function pcm24kBase64ToMulaw8k(pcmB64: string): string {
  return pcmBase64ToMulaw8k(pcmB64, 24000);
}
