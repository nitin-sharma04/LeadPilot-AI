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
  finalizeLeadUtterance,
  isInternalTranscript,
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
assert(REALTIME_HUMAN_SDR_PROMPT.includes("one question"), "one question");
assert(
  REALTIME_HUMAN_SDR_PROMPT.includes("booking_ok") ||
    REALTIME_HUMAN_SDR_PROMPT.includes("NEVER say booked") ||
    REALTIME_HUMAN_SDR_PROMPT.includes("Only claim booked"),
  "no false booking"
);
assert(REALTIME_HUMAN_SDR_PROMPT.includes("COLLECT_DATE"), "appointment stages");
assert(
  REALTIME_HUMAN_SDR_PROMPT.includes("slow down") ||
    REALTIME_HUMAN_SDR_PROMPT.includes("SPEAK SLOWER") ||
    REALTIME_HUMAN_SDR_PROMPT.includes("thoda slow"),
  "pace respect"
);
assert(!REALTIME_HUMAN_SDR_PROMPT.includes("Certainly. Wonderful."), "no rigid fillers");
assert(REALTIME_HUMAN_SDR_PROMPT.includes("[EVENT:call_answered]"), "opening event in prompt");
assert(REALTIME_HUMAN_SDR_PROMPT.includes("Do not force an acknowledgement"), "no forced ack");

// 3 smart transcription config present in gemini-live
const geminiSrc = readFileSync(
  path.join(process.cwd(), "voice-server/src/gemini-live.ts"),
  "utf8"
);
assert(geminiSrc.includes('mode: "SMART"'), "SMART transcription");
assert(geminiSrc.includes("prebuiltVoiceConfig"), "speechConfig voice");
assert(geminiSrc.includes("START_SENSITIVITY_HIGH"), "VAD barge-in");
assert(geminiSrc.includes("silenceDurationMs"), "VAD silence");
assert(!geminiSrc.includes("112%"), "no speech acceleration");
assert(geminiSrc.includes("[EVENT:call_answered]"), "opening event token");
assert(geminiSrc.includes("clientContent"), "clientContent opening");

// Gather must not accelerate TTS
const gatherTwiml = buildGatherTwiml({ sayText: "Hi", actionUrl: "https://x/g" });
assert(!gatherTwiml.includes("112%"), "gather no 112%");
assert(gatherTwiml.includes('speechTimeout="auto"'), "gather speechTimeout auto");

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
  !detectsEndCallIntent("Okay."),
  "okay is not hangup"
);
assert(
  !detectsEndCallIntent("I want to schedule a meeting."),
  "meeting intent is not hangup"
);
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
assert(finalizeLeadUtterance("", null) === null, "empty lead is not unclear");
assert(finalizeLeadUtterance("um", null) === null, "uh/um not unclear row");
assert(isInternalTranscript("[INTERNAL] booking_ok"), "internal detected");
assert(finalizeLeadUtterance("[INTERNAL] booking_ok", null) === null, "internal not lead");
assert(
  finalizeLeadUtterance("[unclear]", "[unclear]") === null,
  "no consecutive unclear"
);
assert(
  shouldSkipDuplicate("Yeah I'm looking for more leads.", "Yeah"),
  "shorter prefix skipped"
);

console.log("Realtime human-voice verification passed.");
