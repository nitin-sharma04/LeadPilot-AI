/**
 * Phase 5B human-voice / transcript / hangup verification.
 * Run: npx tsx scripts/verify-realtime-human.ts
 */
import { resolveGeminiLiveVoice, resolveCustomVocabulary, GEMINI_LIVE_VOICES } from "../voice-server/src/config";
import {
  detectsEndCallIntent,
  isClearAppointmentConfirmation,
  isUnclearUtterance,
} from "../src/lib/voice/end-call-intent";
import {
  normalizeTranscriptText,
  shouldSkipDuplicate,
  markUnclearIfEmpty,
} from "../src/lib/voice/transcript-cleanup";
import { buildConnectStreamTwiml, buildGatherTwiml } from "../src/lib/voice/twilio-client";
import { resolveEffectiveVoiceMode } from "../src/lib/voice/mode";
import { REALTIME_HUMAN_SDR_PROMPT } from "../src/lib/ai/prompts/realtime-voice";
import { readFileSync } from "fs";
import path from "path";

function assert(c: boolean, m: string) {
  if (!c) throw new Error(m);
}

// 1 voice config
assert(resolveGeminiLiveVoice("Aoede") === "Aoede", "voice Aoede");
assert(resolveGeminiLiveVoice("callirrhoe") === "Callirrhoe", "voice case");
assert(resolveGeminiLiveVoice("Nope") === "Aoede", "unsupported → Aoede");
assert(GEMINI_LIVE_VOICES.includes("Sulafat"), "Sulafat supported");

// 2 prompt behavior
assert(REALTIME_HUMAN_SDR_PROMPT.includes("ONE question"), "one question");
assert(
  REALTIME_HUMAN_SDR_PROMPT.includes("NEVER say booked") ||
    REALTIME_HUMAN_SDR_PROMPT.includes("SYSTEM booking success"),
  "no false booking"
);
assert(!REALTIME_HUMAN_SDR_PROMPT.includes("Certainly. Wonderful."), "no rigid fillers");

// 3 smart transcription config present in gemini-live
const geminiSrc = readFileSync(
  path.join(process.cwd(), "voice-server/src/gemini-live.ts"),
  "utf8"
);
assert(geminiSrc.includes('mode: "SMART"'), "SMART transcription");
assert(geminiSrc.includes("prebuiltVoiceConfig"), "speechConfig voice");
assert(geminiSrc.includes("START_SENSITIVITY_HIGH"), "VAD barge-in");
assert(geminiSrc.includes("silenceDurationMs"), "VAD silence");

// 4 vocabulary
const vocab = resolveCustomVocabulary(["CustomCo"]);
assert(vocab.includes("LeadPilot"), "base vocab");
assert(vocab.includes("CustomCo"), "extra vocab");

// 5 duplicate prevention
assert(shouldSkipDuplicate("Hello there", "Hello there"), "exact dup");
assert(!shouldSkipDuplicate("Hello", "Hello there friend"), "extension ok");

// 6 appointment confirmation
assert(!isClearAppointmentConfirmation("[unclear]"), "unclear not confirm");
assert(!isClearAppointmentConfirmation("uh"), "uh not confirm");
assert(isClearAppointmentConfirmation("Yes that works"), "yes confirms");

// 7 end-call
assert(detectsEndCallIntent("Okay, that's all. Thanks."), "end intent");
assert(detectsEndCallIntent("Why aren't you hanging up?"), "force hangup");
assert(!detectsEndCallIntent("Can you tell me more about pricing?"), "not end");

// 8 barge-in clear in handler
const bridge = readFileSync(
  path.join(process.cwd(), "voice-server/src/twilio-stream-handler.ts"),
  "utf8"
);
assert(bridge.includes("sendClear"), "barge-in clear");
assert(bridge.includes("discardAgentBuffer"), "drop stale agent transcript");
assert(bridge.includes("CallEndController"), "hangup controller");
assert(bridge.includes("completeTwilioCall"), "hangup path");
assert(bridge.includes('event === "mark"'), "mark-based farewell delivery");
assert(detectsEndCallIntent("please hang up"), "please hang up intent");
assert(detectsEndCallIntent("we're done"), "were done intent");

// 9 no false booking without real Appointment create
const service = readFileSync(
  path.join(process.cwd(), "src/services/voice-calls.ts"),
  "utf8"
);
assert(service.includes("attemptBookAppointmentFromCall"), "can book via shared service");
const voiceBook = readFileSync(
  path.join(process.cwd(), "src/services/voice-appointment-booking.ts"),
  "utf8"
);
assert(voiceBook.includes("bookAppointment"), "shared service books");
assert(
  voiceBook.includes('idempotencyKey: `call:${call.id}`'),
  "call booking idempotent"
);
assert(
  !service.includes("const appointmentActuallyBooked = false;"),
  "does not force booked=false always"
);

// 10 turn-based fallback still available
const prev = process.env.VOICE_MODE;
process.env.VOICE_MODE = "turn_based";
assert(resolveEffectiveVoiceMode().mode === "turn_based", "5A fallback");
if (prev !== undefined) process.env.VOICE_MODE = prev;
else delete process.env.VOICE_MODE;

assert(buildGatherTwiml({ sayText: "Hi", actionUrl: "https://x/g" }).includes("<Gather"), "Gather exists");
assert(
  buildConnectStreamTwiml({
    streamUrl: "wss://x/media-stream",
    callId: "c1",
    streamToken: "t1",
  }).includes("<Hangup/>"),
  "Connect then Hangup"
);

assert(normalizeTranscriptText("hello   hello") === "Hello", "cleanup dup");
assert(markUnclearIfEmpty("um") === "[unclear]", "unclear marker");
assert(isUnclearUtterance("[unclear]"), "unclear detect");

console.log("Realtime human-voice verification passed.");
