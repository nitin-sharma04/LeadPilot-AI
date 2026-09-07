/**
 * Voice conversation regression tests (natural SDR + appointment flow).
 * Run: npx tsx scripts/verify-voice-conversation-regression.ts
 */
import { readFileSync } from "fs";
import path from "path";
import { AppointmentIntentTracker } from "../voice-server/src/appointment-intent-tracker";
import {
  detectsEndCallIntent,
  detectsAgentFarewell,
} from "../voice-server/src/end-call-intent";
import { detectsSlowSpeechRequest } from "../voice-server/src/speech-pace";
import {
  parsePcmSampleRate,
  pcmBase64ToMulaw8k,
  downsample16kTo8k,
  downsample24kTo8k,
} from "../voice-server/src/audio";
import {
  clearGatherCallState,
  heuristicGatherTurn,
  noteGatherBookingResult,
  sanitizeGatherModelTurn,
} from "../src/lib/voice/gather-call-state";
import { buildGatherTwiml, buildHangupTwiml } from "../src/lib/voice/twilio-client";
import { REALTIME_HUMAN_SDR_PROMPT } from "../src/lib/ai/prompts/realtime-voice";
import { resolveGeminiLiveVoice } from "../voice-server/src/config";

function assert(c: boolean, m: string) {
  if (!c) throw new Error(`FAIL: ${m}`);
}

const callId = "test-call-regression-1";
clearGatherCallState(callId);

// --- TEST 1: schedule meeting → ask DATE, stay active ---
{
  const t = heuristicGatherTurn(callId, "I want to schedule a meeting.");
  assert(!t.endCall, "T1 endCall false");
  assert(/day/i.test(t.reply), `T1 ask date got: ${t.reply}`);
  assert(t.appointmentRequested, "T1 appointmentRequested");
  assert(!/team will schedule|send the details shortly/i.test(t.reply), "T1 no fake book");
}

// --- TEST 2: Tuesday → ask TIME ---
{
  const t = heuristicGatherTurn(callId, "Tuesday.");
  assert(!t.endCall, "T2 active");
  assert(/time/i.test(t.reply), `T2 ask time got: ${t.reply}`);
}

// --- TEST 3: Around 8 PM → confirm ---
{
  const t = heuristicGatherTurn(callId, "Around 8 PM.");
  assert(!t.endCall, "T3 active");
  assert(/confirm|right|works/i.test(t.reply), `T3 confirm got: ${t.reply}`);
}

// --- TEST 4: confirm → shouldBook (bookAppointment path) ---
{
  const t = heuristicGatherTurn(callId, "Yes.");
  assert(t.shouldBook, "T4 shouldBook");
  assert(!t.endCall || t.shouldBook, "T4 not premature goodbye before book");
  const failReply = noteGatherBookingResult(callId, false);
  assert(/couldn'?t complete|isn'?t|another time/i.test(failReply), "T10 fail honesty");
  assert(!/you'?re all set|i'?ve booked/i.test(failReply), "T10 no false booked");
  clearGatherCallState(callId);
  heuristicGatherTurn(callId, "I want to schedule a meeting.");
  heuristicGatherTurn(callId, "Tuesday.");
  heuristicGatherTurn(callId, "8 PM.");
  const conf = heuristicGatherTurn(callId, "Yes.");
  assert(conf.shouldBook, "T4 retry shouldBook");
  const okReply = noteGatherBookingResult(callId, true);
  assert(/booked|all set/i.test(okReply), "T4 booked reply");
}

clearGatherCallState(callId);

// --- TEST 5 & 6: speak slower ---
{
  const t5 = heuristicGatherTurn(callId, "You're speaking too fast.");
  assert(t5.speechPace === "slow", "T5 speechPace slow");
  assert(/slow/i.test(t5.reply), "T5 acknowledge");
  assert(!t5.endCall, "T5 active");
  assert(detectsSlowSpeechRequest("Can you speak slowly?"), "T6 detect");
  assert(detectsSlowSpeechRequest("thoda slow bolo"), "T6 hinglish");
  const t6 = heuristicGatherTurn(callId, "Can you speak slowly?");
  assert(t6.speechPace === "slow", "T6 stays slow");
}

clearGatherCallState(callId);

// --- TEST 8: Okay does not end ---
{
  assert(!detectsEndCallIntent("Okay."), "T8 okay not end");
  assert(!detectsEndCallIntent("Sure"), "T8 sure not end");
  assert(!detectsEndCallIntent("Yes"), "T8 yes not end");
  const t = heuristicGatherTurn(callId, "Okay.");
  assert(!t.endCall, "T8 gather not end");
}

// --- TEST 9: Goodbye ends ---
{
  assert(detectsEndCallIntent("Goodbye."), "T9 goodbye");
  const t = heuristicGatherTurn(callId, "Goodbye.");
  assert(t.endCall, "T9 gather end");
}

clearGatherCallState(callId);

// --- Meeting intent never end-call intent ---
assert(
  !detectsEndCallIntent("Schedule a meeting with your members."),
  "meeting not end intent"
);
assert(
  !detectsEndCallIntent("I want to schedule a meeting."),
  "want meeting not end"
);

// --- Sanitize model regression (old heuristic reply) ---
{
  const bad = sanitizeGatherModelTurn(callId, "Schedule a meeting.", {
    reply:
      "Perfect. I will have our team schedule a meeting with you and send the details shortly. Thanks, goodbye.",
    endCall: true,
    handoffRequested: false,
    appointmentRequested: true,
    optOut: false,
  });
  assert(!bad.endCall, "sanitize blocks premature end");
  assert(!/team will schedule/i.test(bad.reply), "sanitize removes fake schedule");
  assert(/day/i.test(bad.reply), "sanitize asks date");
}

clearGatherCallState(callId);

// --- Realtime tracker state machine ---
{
  const tr = new AppointmentIntentTracker();
  tr.noteLead("I want to schedule a meeting.");
  assert(tr.isFlowActive, "tracker flow active");
  assert(/DATE|day/i.test(tr.coachingHint() || ""), "tracker date coach");
  tr.noteLead("Tuesday.");
  assert(tr.appointmentStatus === "collect_time" || Boolean(tr.dateHint), "has date");
  tr.noteLead("Around 8 PM.");
  assert(tr.preferredText.length > 0, "preferred built");
  assert(!tr.shouldAttemptBooking("Around 8 PM."), "no book before confirm");
  assert(tr.shouldAttemptBooking("Yes."), "book after confirm");
}

// --- TwiML: no 112%, speechTimeout auto ---
{
  const g = buildGatherTwiml({ sayText: "Hello there", actionUrl: "https://x/g" });
  assert(!g.includes("112%"), "no 112% gather");
  assert(g.includes('speechTimeout="auto"'), "speechTimeout auto");
  const slow = buildGatherTwiml({
    sayText: "Hello",
    actionUrl: "https://x/g",
    prosodyRate: "88%",
  });
  assert(slow.includes('rate="88%"'), "slow prosody");
  const h = buildHangupTwiml({ sayText: "Bye" });
  assert(!h.includes("112%"), "no 112% hangup");
}

// --- Audio rate parsing / resample ---
{
  assert(parsePcmSampleRate("audio/pcm;rate=24000") === 24000, "rate 24k");
  assert(parsePcmSampleRate("audio/pcm;rate=16000") === 16000, "rate 16k");
  const pcm16 = new Int16Array(160);
  assert(downsample16kTo8k(pcm16).length === 80, "16→8 len");
  const pcm24 = new Int16Array(240);
  assert(downsample24kTo8k(pcm24).length === 80, "24→8 len");
  const b64 = Buffer.from(pcm24.buffer).toString("base64");
  assert(pcmBase64ToMulaw8k(b64, 24000).length > 0, "mulaw out");
  // Wrong rate would shrink too much — 16k treated as 24k yields fewer samples (sped up).
  const as16 = pcmBase64ToMulaw8k(Buffer.from(pcm16.buffer).toString("base64"), 16000);
  const wrong = pcmBase64ToMulaw8k(Buffer.from(pcm16.buffer).toString("base64"), 24000);
  assert(as16.length > wrong.length, "correct 16k rate keeps realtime duration");
}

// --- Prompt + voice ---
assert(REALTIME_HUMAN_SDR_PROMPT.includes("COLLECT_DATE"), "prompt stages");
assert(REALTIME_HUMAN_SDR_PROMPT.includes("slow down"), "prompt slow");
assert(!REALTIME_HUMAN_SDR_PROMPT.includes("112%"), "prompt no 112");
assert(resolveGeminiLiveVoice() === "Aoede" || resolveGeminiLiveVoice("Aoede") === "Aoede", "voice");

// --- Barge-in still present ---
{
  const bridge = readFileSync(
    path.join(process.cwd(), "voice-server/src/twilio-stream-handler.ts"),
    "utf8"
  );
  assert(bridge.includes("sendClear"), "T7 barge-in clear");
  assert(bridge.includes("speechPace"), "speechPace wired");
  assert(bridge.includes("isFlowActive"), "block premature farewell");
  const gemini = readFileSync(
    path.join(process.cwd(), "voice-server/src/gemini-live.ts"),
    "utf8"
  );
  assert(gemini.includes("silenceDurationMs: 950"), "VAD 950ms");
  assert(!gemini.includes("112%"), "no accel in live");
  const voiceCalls = readFileSync(
    path.join(process.cwd(), "src/services/voice-calls.ts"),
    "utf8"
  );
  assert(!voiceCalls.includes("team schedule a meeting"), "old heuristic gone");
  assert(voiceCalls.includes("heuristicGatherTurn"), "new gather heuristic");
}

assert(!detectsAgentFarewell("What day works best for you?"), "question not farewell");

console.log("Voice conversation regression verification passed.");
