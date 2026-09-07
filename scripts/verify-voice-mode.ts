/**
 * Offline Phase 5B voice mode resolution checks.
 * Run: npx tsx scripts/verify-voice-mode.ts
 */
import {
  getVoiceStreamUrl,
  isEphemeralVoiceStreamUrl,
  resolveEffectiveVoiceMode,
  resolveVoiceMode,
} from "../src/lib/voice/mode";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const prevMode = process.env.VOICE_MODE;
const prevStream = process.env.VOICE_STREAM_URL;
const prevKey = process.env.GEMINI_API_KEY;
const prevNodeEnv = process.env.NODE_ENV;
const prevAllow = process.env.VOICE_ALLOW_TUNNEL;

process.env.VOICE_MODE = "realtime";
delete process.env.VOICE_STREAM_URL;
delete process.env.VOICE_SERVER_URL;
delete process.env.VOICE_ALLOW_TUNNEL;
process.env.GEMINI_API_KEY = "test";
assert(resolveVoiceMode() === "realtime", "realtime should resolve");
const fb = resolveEffectiveVoiceMode();
assert(fb.mode === "turn_based", "missing stream URL should fall back");
assert(Boolean(fb.fallbackReason), "fallback reason required");

process.env.VOICE_STREAM_URL = "wss://example.ngrok-free.app";
assert(
  getVoiceStreamUrl()?.endsWith("/media-stream"),
  "stream url should include /media-stream"
);
assert(
  isEphemeralVoiceStreamUrl(getVoiceStreamUrl()),
  "ngrok should be treated as ephemeral"
);

process.env.NODE_ENV = "development";
const rtDev = resolveEffectiveVoiceMode();
assert(rtDev.mode === "realtime", "dev may use tunnel for realtime");

process.env.NODE_ENV = "production";
const rtProdTunnel = resolveEffectiveVoiceMode();
assert(
  rtProdTunnel.mode === "turn_based",
  "production must reject ephemeral tunnels by default"
);
assert(Boolean(rtProdTunnel.fallbackReason), "production tunnel fallback reason");

process.env.VOICE_STREAM_URL =
  "wss://leadpilot-voice.onrender.com/media-stream";
const rtProdStable = resolveEffectiveVoiceMode();
assert(
  rtProdStable.mode === "realtime",
  "stable Render WSS should enable realtime in production"
);

process.env.VOICE_MODE = "turn_based";
assert(resolveEffectiveVoiceMode().mode === "turn_based", "explicit turn_based");

if (prevMode !== undefined) process.env.VOICE_MODE = prevMode;
else delete process.env.VOICE_MODE;
if (prevStream !== undefined) process.env.VOICE_STREAM_URL = prevStream;
else delete process.env.VOICE_STREAM_URL;
if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
else delete process.env.GEMINI_API_KEY;
if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
else delete process.env.NODE_ENV;
if (prevAllow !== undefined) process.env.VOICE_ALLOW_TUNNEL = prevAllow;
else delete process.env.VOICE_ALLOW_TUNNEL;

console.log("Voice mode verification passed.");
