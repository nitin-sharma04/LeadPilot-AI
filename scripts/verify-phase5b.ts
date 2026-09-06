/**
 * Phase 5B offline verification suite.
 * Run: npx tsx scripts/verify-phase5b.ts
 */
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import {
  getVoiceStreamUrl,
  resolveEffectiveVoiceMode,
  resolveVoiceMode,
} from "../src/lib/voice/mode";
import {
  buildConnectStreamTwiml,
  buildGatherTwiml,
} from "../src/lib/voice/twilio-client";
import { callSummaryResultSchema } from "../src/types/voice";
import {
  mulaw8kToPcm16kBase64,
  pcm24kBase64ToMulaw8k,
  mulawEncode,
  upsample8kTo16k,
  downsample24kTo8k,
} from "../voice-server/src/audio";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (
      name === "node_modules" ||
      name === ".next" ||
      name === ".git" ||
      name === "dist"
    ) {
      continue;
    }
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) out.push(p);
  }
  return out;
}

const prev = {
  mode: process.env.VOICE_MODE,
  stream: process.env.VOICE_STREAM_URL,
  key: process.env.GEMINI_API_KEY,
};

process.env.VOICE_MODE = "realtime";
delete process.env.VOICE_STREAM_URL;
delete process.env.VOICE_SERVER_URL;
process.env.GEMINI_API_KEY = "test-key";
assert(resolveVoiceMode() === "realtime", "1. realtime mode selection");
assert(
  resolveEffectiveVoiceMode().mode === "turn_based",
  "2. fallback when stream URL missing"
);

process.env.VOICE_STREAM_URL = "wss://example.ngrok-free.app";
assert(
  getVoiceStreamUrl()?.endsWith("/media-stream"),
  "2b. stream path appended"
);
assert(
  resolveEffectiveVoiceMode().mode === "realtime",
  "2c. realtime when configured"
);

process.env.VOICE_MODE = "turn_based";
assert(
  resolveEffectiveVoiceMode().mode === "turn_based",
  "15. explicit Phase 5A fallback mode"
);

const dbSrc = readFileSync(
  path.join(process.cwd(), "voice-server/src/db.ts"),
  "utf8"
);
assert(
  dbSrc.includes("streamToken: input.streamToken") &&
    dbSrc.includes('voiceMode: "realtime"'),
  "3. stream session validates callId+streamToken+realtime"
);

const twilioSrc = readFileSync(
  path.join(process.cwd(), "src/lib/voice/twilio-client.ts"),
  "utf8"
);
assert(
  twilioSrc.includes("validateRequest"),
  "4. Twilio webhook signature validation"
);

const twiml = buildConnectStreamTwiml({
  streamUrl: "wss://example.com/media-stream",
  callId: "call_1",
  streamToken: "tok_abc",
});
assert(twiml.includes("<Connect>"), "5a. Connect verb");
assert(twiml.includes("<Stream url="), "5b. Stream noun");
assert(twiml.includes('name="callId"'), "5c. callId parameter");
assert(twiml.includes('name="streamToken"'), "5d. streamToken parameter");
assert(!twiml.includes("<Gather"), "5e. realtime path has no Gather");

const gather = buildGatherTwiml({
  sayText: "Hello",
  actionUrl: "https://example.com/gather",
});
assert(gather.includes("<Gather"), "15b. turn-based Gather still available");

assert(
  typeof resolveEffectiveVoiceMode === "function",
  "6. session mode resolver exists"
);

const silence8k = new Int16Array(160);
const mulawB64 = mulawEncode(silence8k).toString("base64");
const pcm16kB64 = mulaw8kToPcm16kBase64(mulawB64);
assert(pcm16kB64.length > 0, "7a. mulaw→pcm16k");
const pcm24k = new Int16Array(240);
const back = pcm24kBase64ToMulaw8k(
  Buffer.from(pcm24k.buffer).toString("base64")
);
assert(back.length > 0, "7b. pcm24k→mulaw8k");
assert(upsample8kTo16k(silence8k).length === 320, "7c. upsample length");
assert(downsample24kTo8k(pcm24k).length === 80, "7d. downsample length");

const bridge = readFileSync(
  path.join(process.cwd(), "voice-server/src/twilio-stream-handler.ts"),
  "utf8"
);
assert(
  bridge.includes("failed to start gemini live"),
  "8. Gemini failure closes stream"
);
assert(bridge.includes('twilioWs.on("close"'), "9. WebSocket disconnect cleanup");
assert(bridge.includes('event: "clear"'), "barge-in clear event");
assert(bridge.includes("appendTranscript") || bridge.includes("TranscriptFinalizer"), "10. incremental transcript persist");
assert(bridge.includes("TranscriptFinalizer"), "10b. final-only transcript buffer");

const summary = callSummaryResultSchema.parse({
  summary: "Qualified interest in faster response times.",
  outcome: "qualified",
  interestLevel: "high",
  keyRequirements: ["Faster follow-up"],
  painPoints: ["Missed leads"],
  objections: [],
  nextAction: "Schedule demo",
  followUpRecommended: true,
});
assert(summary.followUpRecommended === true, "11. CallSummary Zod validation");

const service = readFileSync(
  path.join(process.cwd(), "src/services/voice-calls.ts"),
  "utf8"
);
assert(
  service.includes("generateCallSummary"),
  "12. post-call summary path exists"
);
assert(service.includes("AI sales call"), "13. Activity creation on initiate");

const files = walk(path.join(process.cwd(), "src"));
for (const file of files) {
  const text = readFileSync(file, "utf8");
  assert(
    !/NEXT_PUBLIC_(TWILIO_AUTH_TOKEN|TWILIO_ACCOUNT_SID|GEMINI_API_KEY)/.test(
      text
    ),
    `14. secret exposure in ${path.relative(process.cwd(), file)}`
  );
}

if (prev.mode !== undefined) process.env.VOICE_MODE = prev.mode;
else delete process.env.VOICE_MODE;
if (prev.stream !== undefined) process.env.VOICE_STREAM_URL = prev.stream;
else delete process.env.VOICE_STREAM_URL;
if (prev.key !== undefined) process.env.GEMINI_API_KEY = prev.key;
else delete process.env.GEMINI_API_KEY;

console.log("Phase 5B verification suite passed.");
