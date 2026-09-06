/**
 * Offline Phase 5B voice mode resolution checks.
 * Run: npx tsx scripts/verify-voice-mode.ts
 */
import {
  getVoiceStreamUrl,
  resolveEffectiveVoiceMode,
  resolveVoiceMode,
} from "../src/lib/voice/mode";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const prevMode = process.env.VOICE_MODE;
const prevStream = process.env.VOICE_STREAM_URL;
const prevKey = process.env.GEMINI_API_KEY;

process.env.VOICE_MODE = "realtime";
delete process.env.VOICE_STREAM_URL;
delete process.env.VOICE_SERVER_URL;
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
const rt = resolveEffectiveVoiceMode();
assert(rt.mode === "realtime", "configured realtime should stay realtime");

process.env.VOICE_MODE = "turn_based";
assert(resolveEffectiveVoiceMode().mode === "turn_based", "explicit turn_based");

if (prevMode !== undefined) process.env.VOICE_MODE = prevMode;
else delete process.env.VOICE_MODE;
if (prevStream !== undefined) process.env.VOICE_STREAM_URL = prevStream;
else delete process.env.VOICE_STREAM_URL;
if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
else delete process.env.GEMINI_API_KEY;

console.log("Voice mode verification passed.");
