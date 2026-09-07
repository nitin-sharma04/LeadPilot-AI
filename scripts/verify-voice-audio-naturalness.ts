/**
 * Realtime audio pipeline + naturalness regression tests.
 * Run: npx tsx scripts/verify-voice-audio-naturalness.ts
 */
import { readFileSync } from "fs";
import path from "path";
import {
  decimateWithLowpass,
  downsample16kTo8k,
  downsample24kTo8k,
  downsample48kTo8k,
  mulawDecode,
  mulawEncode,
  MULAW_FRAME_BYTES,
  parsePcmSampleRate,
  pcmBase64ToMulaw8k,
  pcmToMulaw8kWithStats,
  StreamingGeminiAudioPipeline,
  StreamingPcmTo8kResampler,
  upsample8kTo16k,
} from "../voice-server/src/audio";
import { OutboundMulawFrameBuffer } from "../voice-server/src/outbound-mulaw-buffer";
import { REALTIME_HUMAN_SDR_PROMPT } from "../src/lib/ai/prompts/realtime-voice";
import { detectsSlowSpeechRequest } from "../voice-server/src/speech-pace";
import { AppointmentIntentTracker } from "../voice-server/src/appointment-intent-tracker";
import {
  detectsEndCallIntent,
  detectsAgentFarewell,
} from "../voice-server/src/end-call-intent";
import { resolveGeminiLiveVoice } from "../voice-server/src/config";

function assert(c: boolean, m: string) {
  if (!c) throw new Error(`FAIL: ${m}`);
}

function almostEqual(a: number, b: number, tol: number, msg: string) {
  assert(Math.abs(a - b) <= tol, `${msg} (got ${a} vs ${b})`);
}

// --- Duration-preserving resample ---
{
  const pcm16 = new Int16Array(16000);
  for (let i = 0; i < pcm16.length; i++) pcm16[i] = Math.sin(i / 20) * 10000;
  assert(downsample16kTo8k(pcm16).length === 8000, "16k→8k exact length");

  const pcm24 = new Int16Array(24000);
  for (let i = 0; i < pcm24.length; i++) pcm24[i] = Math.sin(i / 30) * 10000;
  assert(downsample24kTo8k(pcm24).length === 8000, "24k→8k exact length");

  const pcm48 = new Int16Array(48000);
  for (let i = 0; i < pcm48.length; i++) pcm48[i] = Math.sin(i / 40) * 10000;
  assert(downsample48kTo8k(pcm48).length === 8000, "48k→8k exact length");

  const s16 = pcmToMulaw8kWithStats(pcm16, 16000).stats;
  almostEqual(s16.inputDurationMs, 1000, 0.5, "16k duration in");
  almostEqual(s16.outputDurationMs, 1000, 0.5, "16k duration out");

  const s24 = pcmToMulaw8kWithStats(pcm24, 24000).stats;
  almostEqual(s24.inputDurationMs, 1000, 0.5, "24k duration in");
  almostEqual(s24.outputDurationMs, 1000, 0.5, "24k duration out");

  const s48 = pcmToMulaw8kWithStats(pcm48, 48000).stats;
  almostEqual(s48.inputDurationMs, 1000, 0.5, "48k duration in");
  almostEqual(s48.outputDurationMs, 1000, 0.5, "48k duration out");
}

// Wrong rate would speed up — 16k treated as 24k yields fewer samples.
{
  const pcm16 = new Int16Array(16000);
  const right = pcmToMulaw8kWithStats(pcm16, 16000).mulaw.length;
  const wrong = pcmToMulaw8kWithStats(pcm16, 24000).mulaw.length;
  assert(right > wrong, "correct rate keeps realtime duration");
  almostEqual(right, 8000, 0, "16k→8k mulaw bytes");
}

// --- µ-law round trip smoke ---
{
  const pcm = new Int16Array(160);
  for (let i = 0; i < 160; i++) pcm[i] = (i % 40) * 100;
  const encoded = mulawEncode(pcm);
  assert(encoded.length === 160, "mulaw len");
  const decoded = mulawDecode(encoded);
  assert(decoded.length === 160, "decode len");
}

// --- Streaming pipeline duration over chunks ---
{
  const pipe = new StreamingGeminiAudioPipeline();
  const pcm24 = new Int16Array(24000);
  for (let i = 0; i < pcm24.length; i++) pcm24[i] = Math.sin(i / 25) * 8000;
  let outSamples = 0;
  const chunk = 480; // 20ms @ 24k
  for (let off = 0; off < pcm24.length; off += chunk) {
    const slice = pcm24.subarray(off, Math.min(off + chunk, pcm24.length));
    const b64 = Buffer.from(
      slice.buffer,
      slice.byteOffset,
      slice.byteLength
    ).toString("base64");
    const { mulaw } = pipe.pushPcmBase64(b64, 24000);
    outSamples += mulaw.length;
  }
  outSamples += pipe.flush().length;
  // Allow FIR priming/tail tolerance of a few ms
  almostEqual(outSamples, 8000, 80, "streaming 24k→8k ~1s");
}

// --- 20ms frame buffer ---
{
  const buf = new OutboundMulawFrameBuffer();
  assert(MULAW_FRAME_BYTES === 160, "frame bytes 160");
  const frames1 = buf.push(Buffer.alloc(100, 1));
  assert(frames1.length === 0, "buffer until 160");
  const frames2 = buf.push(Buffer.alloc(60, 2));
  assert(frames2.length === 1, "emit one 20ms frame");
  assert(frames2[0].length === 160, "frame size 160");
  const frames3 = buf.push(Buffer.alloc(320, 3));
  assert(frames3.length === 2, "emit two frames");
  buf.push(Buffer.alloc(50, 4));
  const flushed = buf.flush();
  assert(flushed !== null && flushed.length === 50, "final flush remainder");
  assert(buf.flush() === null, "empty flush");
  buf.push(Buffer.alloc(10, 5));
  buf.clear();
  assert(buf.pendingBytes === 0, "clear drops pending");
}

// --- MIME rate parsing ---
assert(parsePcmSampleRate("audio/pcm;rate=16000") === 16000, "mime 16k");
assert(parsePcmSampleRate("audio/pcm;rate=24000") === 24000, "mime 24k");
assert(parsePcmSampleRate("audio/pcm;rate=48000") === 48000, "mime 48k");
assert(parsePcmSampleRate(undefined) === 24000, "mime default");

// --- Upsample length ---
assert(upsample8kTo16k(new Int16Array(160)).length === 320, "upsample 8→16");

// --- FIR exists / not simple avg only ---
{
  const src = readFileSync(
    path.join(process.cwd(), "voice-server/src/audio.ts"),
    "utf8"
  );
  assert(src.includes("designLowpassFir"), "FIR lowpass");
  assert(src.includes("decimateWithLowpass"), "decimate with LPF");
  assert(src.includes("StreamingGeminiAudioPipeline"), "streaming pipeline");
}

// --- Handler: no mark-per-frame; farewell mark; barge-in clear ---
{
  const bridge = readFileSync(
    path.join(process.cwd(), "voice-server/src/twilio-stream-handler.ts"),
    "utf8"
  );
  assert(bridge.includes("OutboundMulawFrameBuffer"), "frame buffer");
  assert(bridge.includes("sendFarewellMark"), "farewell mark path");
  assert(bridge.includes("clearOutboundAudio"), "barge-in clears buffer");
  assert(!/sendMulawAudio\s*=/.test(bridge), "old per-chunk mark sender gone");
  assert(bridge.includes("enqueueMulaw"), "enqueue frames");
  assert(bridge.includes("StreamingGeminiAudioPipeline"), "pipeline wired");
}

// --- Gemini opening / internal notify ---
{
  const gemini = readFileSync(
    path.join(process.cwd(), "voice-server/src/gemini-live.ts"),
    "utf8"
  );
  assert(gemini.includes("[EVENT:call_answered]"), "clean opening event");
  assert(gemini.includes("clientContent"), "clientContent for opening");
  assert(gemini.includes("[INTERNAL]"), "internal notify");
  assert(!gemini.includes("Greet them warmly by name if known"), "no long coaching in opening");
  assert(gemini.includes("prebuiltVoiceConfig"), "voice config");
  assert(gemini.includes("silenceDurationMs: 950"), "VAD 950");
  assert(gemini.includes("voiceName: this.voice"), "voice passed");
}

// --- Prompt naturalness ---
assert(REALTIME_HUMAN_SDR_PROMPT.includes("Ask at most one question"), "one Q");
assert(REALTIME_HUMAN_SDR_PROMPT.includes("COLLECT_DATE"), "appt stages");
assert(REALTIME_HUMAN_SDR_PROMPT.includes("[EVENT:call_answered]"), "opening event");
assert(REALTIME_HUMAN_SDR_PROMPT.includes("contractions"), "contractions");
assert(!REALTIME_HUMAN_SDR_PROMPT.includes("Never sound like an AI assistant"), "no identity claim as primary");
assert(REALTIME_HUMAN_SDR_PROMPT.includes("Do not force an acknowledgement"), "no forced ack");

// --- Slow speech / appointment / hangup ---
assert(detectsSlowSpeechRequest("thoda slow bolo"), "hinglish slow");
assert(!detectsEndCallIntent("I want to schedule a meeting."), "meeting not end");
assert(detectsEndCallIntent("Goodbye"), "goodbye ends");
assert(!detectsEndCallIntent("Okay."), "okay not end");
{
  const tr = new AppointmentIntentTracker();
  tr.noteLead("Schedule a meeting with your members.");
  assert(tr.isFlowActive, "meeting intent active");
  assert(!tr.hasBooked, "not booked");
}
assert(resolveGeminiLiveVoice("Aoede") === "Aoede", "voice Aoede");
assert(!detectsAgentFarewell("What day works for you?"), "question not farewell");

// Anti-alias vs naive avg still duration-correct
assert(decimateWithLowpass(new Int16Array(300), 3).length === 100, "FIR factor3 len");
assert(new StreamingPcmTo8kResampler(24000).sourceFactor === 3, "resampler factor");

console.log("Voice audio naturalness verification passed.");
