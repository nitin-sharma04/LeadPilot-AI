/**
 * G.711 µ-law codec + resampling for Twilio ↔ Gemini Live.
 * Twilio: audio/x-mulaw @ 8 kHz
 * Gemini Live input: PCM16 LE @ 16 kHz
 * Gemini Live output: PCM16 LE @ 24 kHz
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

/** Downsample 24 kHz → 8 kHz by averaging each group of 3 samples. */
export function downsample24kTo8k(pcm24k: Int16Array): Int16Array {
  const outLen = Math.floor(pcm24k.length / 3);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const i0 = i * 3;
    out[i] = Math.round(
      (pcm24k[i0] + pcm24k[i0 + 1] + pcm24k[i0 + 2]) / 3
    );
  }
  return out;
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

export function pcm24kBase64ToMulaw8k(pcmB64: string): string {
  const pcmBuf = Buffer.from(pcmB64, "base64");
  const pcm24k = bufferToInt16(pcmBuf);
  const pcm8k = downsample24kTo8k(pcm24k);
  return mulawEncode(pcm8k).toString("base64");
}
