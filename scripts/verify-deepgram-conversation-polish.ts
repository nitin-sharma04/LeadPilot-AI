/**
 * Deepgram conversation polish — transcripts, booking truth, VAD, TTS guards.
 * Run: npx tsx scripts/verify-deepgram-conversation-polish.ts
 */
import { readFileSync } from "fs";
import path from "path";
import { AppointmentIntentTracker } from "../voice-server/src/appointment-intent-tracker";
import { getVadSilenceMs } from "../voice-server/src/config";
import {
  detectsEndCallIntent,
  detectsAgentFarewell,
} from "../voice-server/src/end-call-intent";
import {
  finalizeLeadUtterance,
  isInternalTranscript,
  mergeStreamingTranscript,
} from "../voice-server/src/transcript-cleanup";
import { spokenBookingFailure, spokenBookingSuccess } from "../voice-server/src/tts/booking-speech";
import {
  DeepgramTtsSession,
  deepgramLiveSpeakUrl,
  loadDeepgramTtsConfig,
} from "../voice-server/src/tts/deepgram-tts";
import {
  claimsPrematureBooking,
  prepareSpokenAgentText,
} from "../voice-server/src/tts/spoken-guard";
import { toSpeakableAgentText } from "../voice-server/src/tts/speakable-text";
import { emptyVoiceLatencyMarks } from "../voice-server/src/voice-latency";
import { resolveTimezoneAlias } from "../src/lib/calendar/timezone-aliases";

function assert(c: boolean, m: string) {
  if (!c) throw new Error(`FAIL: ${m}`);
}

const handler = readFileSync(
  path.join(process.cwd(), "voice-server/src/twilio-stream-handler.ts"),
  "utf8"
);
const gemini = readFileSync(
  path.join(process.cwd(), "voice-server/src/gemini-live.ts"),
  "utf8"
);

// 1. VAD silence threshold
{
  const prev = process.env.GEMINI_VAD_SILENCE_MS;
  delete process.env.GEMINI_VAD_SILENCE_MS;
  assert(getVadSilenceMs() === 500, "default VAD 500");
  if (prev !== undefined) process.env.GEMINI_VAD_SILENCE_MS = prev;
  assert(getVadSilenceMs("500") === 500, "500 allowed");
  assert(getVadSilenceMs("650") === 650, "650 allowed");
  assert(getVadSilenceMs("700") === 700, "700 allowed");
  assert(getVadSilenceMs("750") === 750, "750 allowed");
  assert(gemini.includes("silenceDurationMs: this.vadSilenceMs"), "live uses config");
  assert(gemini.includes("END_SENSITIVITY_HIGH"), "faster end-of-speech");
}

{
  assert(
    mergeStreamingTranscript("Yeah", "Yeah, I'm looking for more leads.") ===
      "Yeah, I'm looking for more leads.",
    "merge keeps longest"
  );
  assert(
    mergeStreamingTranscript("Yeah I'm looking", "Yeah") === "Yeah I'm looking",
    "merge keeps longer buffer"
  );
}

// 2. Latency measurement present (no secrets)
{
  assert(handler.includes("logVoiceLatency"), "latency helper");
  const marks = emptyVoiceLatencyMarks();
  assert(marks.leadFinalAt === null, "empty marks");
}

// 3. No artificial response delay
{
  assert(!/sleep\s*\(\s*\d+/.test(handler), "no sleep delay");
  assert(!/debounce/i.test(handler), "no debounce");
  const delayHits = [...handler.matchAll(/setTimeout\(/g)];
  assert(delayHits.length <= 2, `only hangup/max-duration timers, got ${delayHits.length}`);
}

// 4. Deepgram first-byte streaming + cancel
{
  assert(handler.includes("for await (const chunk of session.synthesizeMulaw8k"), "streams chunks");
  assert(handler.includes("firstTwilioFrameMs"), "first twilio frame");
  assert(handler.includes("deepgramFirstAudioAt"), "first audio mark");
  const cfg = loadDeepgramTtsConfig({
    ...process.env,
    DEEPGRAM_API_KEY: "dg-test",
  } as NodeJS.ProcessEnv);
  assert(cfg !== null, "config with test key");
  const session = new DeepgramTtsSession(cfg!);
  session.cancel();
  assert(session.cancelled === true, "cancel flag");
  assert(handler.includes("void finalizer?.persistSpokenAgent"), "tts not blocked on db");
  assert(handler.includes("warmup()"), "warm deepgram socket");
  assert(deepgramLiveSpeakUrl(cfg!).includes("/v2/speak"), "live speak url");
}

// 5. Barge-in cancels Deepgram
{
  assert(handler.includes("cancelDeepgramTts"), "cancel helper");
  assert(handler.includes("onInterrupted"), "interrupt handler");
  const barge = handler.slice(handler.indexOf("onInterrupted"));
  assert(barge.includes("clearOutboundAudio()"), "barge-in clears");
}

// 6–9. Transcript interim → final, no [unclear] from empty, no consecutive [unclear]
{
  assert(finalizeLeadUtterance("", null) === null, "empty ≠ [unclear]");
  assert(finalizeLeadUtterance("   ", "Yes.") === null, "whitespace ≠ [unclear]");
  assert(finalizeLeadUtterance("um", null) === null, "um not persisted");
  assert(finalizeLeadUtterance("[unclear]", "[unclear]") === null, "no dup unclear");
  const final = finalizeLeadUtterance("Yeah, I'm looking for more leads.", "Yeah");
  assert(
    final === "Yeah, I'm looking for more leads.",
    `keep longest final, got ${final}`
  );
}

// 10. Internal events excluded from transcript + Deepgram
{
  assert(isInternalTranscript("[INTERNAL] booking_ok when=Tue"), "internal");
  assert(isInternalTranscript("[EVENT:call_answered]"), "event");
  assert(isInternalTranscript("[system] Call end requested: x"), "system");
  assert(toSpeakableAgentText("[INTERNAL] booking_ok") === null, "not spoken");
  assert(toSpeakableAgentText("[EVENT:appointment_confirmed]") === null, "event not spoken");
  assert(toSpeakableAgentText("SYSTEM: debug") === null, "system prefix stripped");
  assert(prepareSpokenAgentText("[INTERNAL] booking_ok", { hasBooked: false }) === null);
}

// 11–13. Appointment requires confirm; success language only after booked
{
  const tr = new AppointmentIntentTracker();
  tr.noteLead("Can we book tomorrow?");
  assert(tr.isFlowActive, "meeting flow active");
  assert(!detectsEndCallIntent("Can we book tomorrow?"), "meeting ≠ hangup");
  tr.noteLead("Around 5 PM Indian time.");
  assert(!tr.shouldAttemptBooking("Around 5 PM Indian time."), "time is not confirm");
  assert(
    !tr.shouldAttemptBooking("At around 5:00 p.m. Indian time is standard."),
    "standard ≠ confirm"
  );
  const premature =
    "Okay, so 5 PM IST tomorrow? I'll send over an invite. Talk then!";
  assert(claimsPrematureBooking(premature), "detects invite claim");
  const rewritten = prepareSpokenAgentText(premature, {
    hasBooked: false,
    dateHint: tr.dateHint,
    timeHint: tr.timeHint,
  });
  assert(rewritten !== null && /\?/.test(rewritten), "rewrites to confirm question");
  assert(!claimsPrematureBooking(rewritten!), "rewritten has no invite claim");
  tr.noteAgent(rewritten!);
  assert(tr.shouldAttemptBooking("Yes."), "books only after yes");
  assert(
    !claimsPrematureBooking(spokenBookingFailure()),
    "failure has no success language"
  );
  const failPrepared = prepareSpokenAgentText(
    "You're booked. I'll send an invite.",
    { hasBooked: false, dateHint: "tomorrow", timeHint: "5 PM" }
  );
  assert(
    !!failPrepared && !claimsPrematureBooking(failPrepared),
    "strips success before backend ok"
  );
}

// 14. Timezone Asia/Kolkata
{
  assert(
    resolveTimezoneAlias("5:00 p.m. Indian time") === "Asia/Kolkata",
    "Indian time → Kolkata"
  );
  assert(resolveTimezoneAlias("IST") === "Asia/Kolkata", "IST → Kolkata");
  const spoken = spokenBookingSuccess({
    displayWhen: "Tue 5:00 PM",
    timezone: "Asia/Kolkata",
  });
  assert(/IST/i.test(spoken), `confirmation says IST: ${spoken}`);
  assert(/booked/i.test(spoken), "success uses booked after backend");
}

// 15. Meeting intent does not hang up
{
  assert(!detectsEndCallIntent("Tomorrow"), "tomorrow ≠ hangup");
  assert(!detectsEndCallIntent("Five PM"), "time ≠ hangup");
  assert(!detectsEndCallIntent("Sounds good"), "sounds good ≠ hangup");
  assert(!detectsEndCallIntent("Okay"), "okay ≠ hangup");
  assert(!detectsEndCallIntent("Yes"), "yes ≠ hangup");
  assert(handler.includes("isFlowActive") && handler.includes("leadSpokeAfterBooking"), "wait after book");
}

// 16. Successful booking → confirmation from result
{
  assert(handler.includes("spokenBookingSuccess"), "uses booking object speech");
  assert(handler.includes("bookAppointmentFromVoiceCall"), "backend book unchanged");
  assert(handler.includes("result.displayWhen"), "uses returned appointment");
}

// 17. Farewell after booking → hangup still present
{
  assert(detectsEndCallIntent("Thanks, goodbye."), "lead goodbye after book");
  assert(detectsAgentFarewell("You're welcome. Have a great day."), "agent farewell");
  assert(handler.includes("sendFarewellMark"), "farewell mark");
  assert(handler.includes("completeTwilioCall"), "REST hangup");
}

// 18. Stale TTS cannot play after barge-in
{
  assert(handler.includes("session.cancelled"), "drop cancelled chunks");
  assert(handler.includes("outboundBuffer.clear()"), "clear local frames");
}

assert(handler.includes('responseModalities: ["AUDIO"]'), "Deepgram keeps Gemini AUDIO setup");
assert(handler.includes("onGenerationComplete"), "TTS at generation complete");
assert(!handler.includes("112%"), "no speed-up");

console.log("Deepgram conversation polish verification passed.");
