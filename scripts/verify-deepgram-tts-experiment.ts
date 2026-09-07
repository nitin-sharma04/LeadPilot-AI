/**
 * LOCAL EXPERIMENT — offline Deepgram TTS wiring tests (no live API).
 * Run: npx tsx scripts/verify-deepgram-tts-experiment.ts
 */
import { readFileSync } from "fs";
import path from "path";
import { OutboundMulawFrameBuffer } from "../voice-server/src/outbound-mulaw-buffer";
import { MULAW_FRAME_BYTES } from "../voice-server/src/audio";
import { resolveVoiceTtsProvider } from "../voice-server/src/tts/tts-provider";
import { loadDeepgramTtsConfig } from "../voice-server/src/tts/deepgram-tts";
import {
  isLikelyUnsupportedForFluxEnglish,
  shouldSkipDuplicateSynthesis,
  toSpeakableAgentText,
} from "../voice-server/src/tts/speakable-text";

function assert(c: boolean, m: string) {
  if (!c) throw new Error(`FAIL: ${m}`);
}

const prevProvider = process.env.VOICE_TTS_PROVIDER;
const prevKey = process.env.DEEPGRAM_API_KEY;

delete process.env.VOICE_TTS_PROVIDER;
assert(resolveVoiceTtsProvider() === "deepgram", "default deepgram");
process.env.VOICE_TTS_PROVIDER = "gemini";
assert(resolveVoiceTtsProvider() === "gemini", "select gemini fallback");
process.env.VOICE_TTS_PROVIDER = "DEEPGRAM";
assert(resolveVoiceTtsProvider() === "deepgram", "deepgram case-insensitive");
if (prevProvider !== undefined) process.env.VOICE_TTS_PROVIDER = prevProvider;
else delete process.env.VOICE_TTS_PROVIDER;

delete process.env.DEEPGRAM_API_KEY;
assert(loadDeepgramTtsConfig() === null, "no config without key");
process.env.DEEPGRAM_API_KEY = "dg-test-not-real";
process.env.DEEPGRAM_TTS_MODEL = "flux-hannah-en";
process.env.DEEPGRAM_TTS_SPEED = "1.0";
process.env.DEEPGRAM_TTS_EXPRESSIVITY = "0";
const cfg = loadDeepgramTtsConfig();
assert(cfg !== null && cfg.model === "flux-hannah-en", "config loads");
assert(cfg !== null && cfg.speed === 1, "speed 1");
assert(cfg !== null && cfg.expressivity === 0, "expressivity 0");
delete process.env.DEEPGRAM_API_KEY;
if (prevKey !== undefined) process.env.DEEPGRAM_API_KEY = prevKey;

assert(toSpeakableAgentText("[INTERNAL] booking_ok when=Tue") === null, "strip internal");
assert(toSpeakableAgentText("[EVENT:call_answered]") === null, "strip event");
assert(
  toSpeakableAgentText("Sure. What day works for you?") ===
    "Sure. What day works for you?",
  "keep speech"
);
assert(toSpeakableAgentText("[unclear]") === null, "unclear skipped");
assert(isLikelyUnsupportedForFluxEnglish("मैं हिंदी में बात करूँगा"), "hindi detected");
assert(!isLikelyUnsupportedForFluxEnglish("What day works for you?"), "english ok");
assert(shouldSkipDuplicateSynthesis("Hello", "Hello"), "dup synth");
assert(!shouldSkipDuplicateSynthesis(null, "Hello"), "first synth");

{
  const buf = new OutboundMulawFrameBuffer();
  const frames = buf.push(Buffer.alloc(320, 1));
  assert(frames.length === 2, "two 20ms frames");
  assert(frames[0].length === MULAW_FRAME_BYTES, "160 bytes");
}

{
  const handler = readFileSync(
    path.join(process.cwd(), "voice-server/src/twilio-stream-handler.ts"),
    "utf8"
  );
  assert(handler.includes('ttsProvider === "deepgram"'), "provider branch");
  assert(handler.includes("speakDeepgramTurn"), "deepgram speak hook");
  assert(handler.includes("cancelDeepgramTts"), "barge-in cancel");
  assert(handler.includes("OutboundMulawFrameBuffer"), "reuse buffer");
  assert(handler.includes("bookAppointmentFromVoiceCall"), "booking unchanged");
  assert(handler.includes("CallEndController"), "hangup unchanged");
  assert(handler.includes("prepareSpokenAgentText"), "spoken guard");
  assert(handler.includes("logVoiceLatency"), "latency logs");
  const gemini = readFileSync(
    path.join(process.cwd(), "voice-server/src/gemini-live.ts"),
    "utf8"
  );
  assert(gemini.includes("prebuiltVoiceConfig"), "gemini live intact");
  assert(gemini.includes("silenceDurationMs: this.vadSilenceMs"), "configurable VAD");
  assert(!gemini.includes("Deepgram"), "gemini-live has no Deepgram");
}

console.log("Deepgram TTS experiment (offline) verification passed.");
