/**
 * Local voice lab isolation + turn/TTS/appointment simulation tests.
 * Run: npx tsx scripts/verify-voice-lab.ts
 */
import { readFileSync } from "fs";
import path from "path";
import { AppointmentIntentTracker } from "../voice-server/src/appointment-intent-tracker";
import {
  clampLabTtsSpeed,
  clampLabVadMs,
  isVoiceLabEnabled,
  resolveVoiceLabLatencyPreset,
} from "../voice-lab/config";
import { scoreVoiceLabSession } from "../voice-lab/scoring";
import {
  isFinalizedLeadTranscript,
  VoiceTurnController,
} from "../voice-server/src/voice-turn-state";
import {
  spokenLabBookingSuccess,
  trySimulateLabBooking,
} from "../voice-server/src/voice-lab-booking";
import { detectsEndCallIntent } from "../voice-server/src/end-call-intent";
import { mergeStreamingTranscript } from "../voice-server/src/transcript-cleanup";
import { REALTIME_HUMAN_SDR_PROMPT } from "../voice-server/src/prompts";
import {
  REALTIME_HUMAN_SDR_LAB_PROMPT,
  resolveVoiceLabPromptVariant,
  VOICE_LAB_PROMPT_LABELS,
} from "../voice-lab/lab-prompt";
import { buildVoiceLabSystemInstruction } from "../voice-server/src/voice-lab-prompt";
import { VOICE_LAB_SCENARIOS } from "../voice-lab/scenarios";
import { RepetitionTracker } from "../voice-lab/repetition";

function assert(c: boolean, m: string) {
  if (!c) throw new Error(`FAIL: ${m}`);
}

const labHandler = readFileSync(
  path.join(process.cwd(), "voice-server/src/voice-lab-handler.ts"),
  "utf8"
);
const twilioHandler = readFileSync(
  path.join(process.cwd(), "voice-server/src/twilio-stream-handler.ts"),
  "utf8"
);
const indexSrc = readFileSync(
  path.join(process.cwd(), "voice-server/src/index.ts"),
  "utf8"
);

assert(!/from ["']\.\/twilio/.test(labHandler), "lab does not import twilio modules");
assert(!labHandler.includes("completeTwilioCall"), "lab never hangs up Twilio");
assert(!labHandler.includes("bookAppointmentFromVoiceCall"), "lab never books via API");
assert(!/from ["']\.\/db/.test(labHandler), "lab does not import db/prisma");
assert(!labHandler.includes("appendTranscript"), "lab does not persist transcripts");
assert(labHandler.includes("handleVoiceLabSocket"), "lab socket handler");
assert(indexSrc.includes('pathname === "/media-stream"'), "twilio path preserved");
assert(indexSrc.includes('pathname === "/voice-lab"'), "lab path added");
assert(indexSrc.includes("handleTwilioMediaStream"), "production handler still wired");
assert(twilioHandler.includes("handleTwilioMediaStream") || twilioHandler.includes("Twilio"), "production file intact");

// ---- A/B prompt isolation ----
const promptsSrc = readFileSync(
  path.join(process.cwd(), "voice-server/src/prompts.ts"),
  "utf8"
);
assert(!promptsSrc.includes("REALTIME_HUMAN_SDR_LAB_PROMPT"), "lab prompt not in production prompts.ts");
assert(REALTIME_HUMAN_SDR_PROMPT.includes("ACKNOWLEDGEMENT VARIETY"), "tested listening/ack behavior promoted");
assert(REALTIME_HUMAN_SDR_LAB_PROMPT.includes("ACKNOWLEDGEMENT VARIETY"), "lab prompt content present");
assert(!twilioHandler.includes("voice-lab"), "twilio handler does not import voice-lab modules");
assert(labHandler.includes("buildVoiceLabSystemInstruction(scenario, promptVariant)"), "lab passes prompt variant");
assert(
  REALTIME_HUMAN_SDR_PROMPT === REALTIME_HUMAN_SDR_LAB_PROMPT,
  "production uses tested Prompt B"
);
assert(resolveVoiceLabPromptVariant(undefined) === "lab", "default variant is lab prompt");
assert(resolveVoiceLabPromptVariant("production") === "production", "production variant selectable");
assert(resolveVoiceLabPromptVariant("garbage") === "lab", "unknown falls back to lab");
assert(VOICE_LAB_PROMPT_LABELS.lab.includes("Human SDR Lab"), "lab label");
assert(VOICE_LAB_PROMPT_LABELS.production.includes("Production"), "production label");
{
  const scenario = VOICE_LAB_SCENARIOS[0];
  const a = buildVoiceLabSystemInstruction(scenario, "production");
  const b = buildVoiceLabSystemInstruction(scenario, "lab");
  const d = buildVoiceLabSystemInstruction(scenario);
  assert(a.startsWith(REALTIME_HUMAN_SDR_PROMPT), "A uses production prompt verbatim");
  assert(b.startsWith(REALTIME_HUMAN_SDR_LAB_PROMPT), "B uses lab prompt verbatim");
  assert(d === b, "default build is lab prompt");
  const suffixA = a.slice(REALTIME_HUMAN_SDR_PROMPT.length);
  const suffixB = b.slice(REALTIME_HUMAN_SDR_LAB_PROMPT.length);
  assert(suffixA === suffixB, "scenario/booking suffix identical for A and B");
  assert(a.includes("BOOKING IS SIMULATED") && b.includes("BOOKING IS SIMULATED"), "both simulate booking");
}

// ---- repetition heuristics ----
{
  const rep = new RepetitionTracker();
  assert(rep.noteAgentTurn("Yeah, we can help with that.").length === 0, "first ack ok");
  assert(rep.noteAgentTurn("Okay — what are you mainly trying to improve?").length === 0, "new ack ok");
  const again = rep.noteAgentTurn("Yeah, we can help with that.");
  assert(rep.summary.repeatedSentences === 1, "repeated sentence detected");
  assert(rep.summary.repeatedAcknowledgements === 1, "repeated ack detected");
  assert(again.length >= 2, "observations emitted");
  rep.noteAgentTurn("Yeah, Tuesday works.");
  assert(rep.summary.sameOpenerConsecutive === 1, "same consecutive opener detected");
}

assert(isVoiceLabEnabled({ NODE_ENV: "development" }), "lab on in development");
assert(isVoiceLabEnabled({ NODE_ENV: "development", VOICE_LAB_ENABLED: "true" }), "flag true");
assert(!isVoiceLabEnabled({ NODE_ENV: "production" }), "lab off in production");
assert(
  !isVoiceLabEnabled({ NODE_ENV: "production", VOICE_LAB_ENABLED: "true" }),
  "production cannot enable lab"
);
assert(!isVoiceLabEnabled({ NODE_ENV: "development", VOICE_LAB_ENABLED: "false" }), "can disable locally");

assert(clampLabVadMs(900) === 900, "vad 900");
assert(clampLabVadMs(300) === 400, "vad min");
assert(clampLabVadMs(2000) === 1200, "vad max");
assert(clampLabTtsSpeed(0.8) === 0.8, "speed 0.8 lab-only");
assert(clampLabTtsSpeed(1.2) === 1.2, "speed 1.2 lab-only");
assert(resolveVoiceLabLatencyPreset("normal").inboundMs === 0, "latency normal");
assert(resolveVoiceLabLatencyPreset("700ms").inboundMs === 700, "latency 700");
assert(resolveVoiceLabLatencyPreset("1000ms").outboundMs === 1000, "latency 1000");

{
  const turns = new VoiceTurnController();
  const tracker = new AppointmentIntentTracker();
  let business = 0;
  const onChunk = (text: string, finished?: boolean) => {
    if (!isFinalizedLeadTranscript({ finished })) return;
    const gate = turns.finalizeLeadTurn(text);
    if (!gate.accepted) return;
    tracker.noteLead(text);
    business += 1;
  };
  onChunk("I just", false);
  onChunk("I just want more clients", false);
  assert(business === 0, "partial ignored");
  assert(tracker.appointmentStatus === "none", "partial does not move appt");
  onChunk("I just want more clients", true);
  assert(business === 1, "one final → one business turn");
  onChunk("I just want more clients", true);
  assert(business === 1, "duplicate final ignored");
}

{
  const turns = new VoiceTurnController();
  turns.finalizeLeadTurn("Hello.");
  const a = turns.acceptLiveResponse("Hey — got a minute?");
  const b = turns.tryAcceptModelResponse("generation_complete", "Hey — got a minute?");
  const c = turns.tryAcceptModelResponse("turn_complete_fallback", "Hey — got a minute?");
  assert(a.accepted && !b.accepted && !c.accepted, "one model response");
  const t1 = turns.tryBeginTts();
  const t2 = turns.tryBeginTts();
  assert(t1.accepted && !t2.accepted, "one TTS");
}

{
  const turns = new VoiceTurnController();
  turns.finalizeLeadTurn("Hi.");
  turns.acceptLiveResponse("Hey there.");
  turns.tryBeginTts();
  const barge = turns.onBargeIn();
  assert(barge.cancelTts, "barge-in cancels TTS");
  const stale = turns.tryAcceptModelResponse("generation_complete", "Hey there.");
  assert(!stale.accepted, "stale response cancelled");
  const next = turns.finalizeLeadTurn("Can we talk tomorrow?");
  assert(next.accepted, "new turn after barge-in");
}

{
  const tracker = new AppointmentIntentTracker();
  tracker.noteLead("Can we talk tomorrow?");
  tracker.noteLead("Around 3 PM.");
  tracker.noteAgent("Tomorrow at 3 PM — does that work?");
  const none = trySimulateLabBooking(tracker, "Around 3 PM.");
  assert(none.status === "none", "time offering is not confirm");
  const yes = trySimulateLabBooking(tracker, "Yes.");
  assert(yes.status === "BOOKED_SIMULATED", "yes simulates booking");
  assert(!/\bi('?ll| will) send\b/i.test(yes.spoken), "does not promise to send an invite");
  assert(/test/i.test(spokenLabBookingSuccess("tomorrow 3 PM")), "lab booking copy");
}

assert(detectsEndCallIntent("Okay thanks, bye."), "goodbye");
assert(detectsEndCallIntent("That's all I needed."), "that's all");
assert(detectsEndCallIntent("No, I'm not interested. Goodbye."), "decline goodbye");

{
  const merged = ["I just", "I just want", "I just want more clients"].reduce(
    (b, c) => mergeStreamingTranscript(b, c),
    ""
  );
  assert(merged === "I just want more clients", "merge incremental STT");
}

{
  const report = scoreVoiceLabSession({
    rows: [
      { speaker: "USER", text: "Hi", at: new Date().toISOString() },
      { speaker: "AI", text: "Hey — got a minute?", at: new Date().toISOString() },
    ],
    latency: [],
    interruptions: 0,
    duplicateResponsesBlocked: 1,
    appointmentStatus: "none",
    validation: [],
    estimatedSpeakMs: [1200],
  });
  assert(report.overall >= 0 && report.overall <= 10, "score range");
  assert(report.heuristicLabel.includes("heuristics"), "heuristic label");
  assert(typeof report.breakdown.repetition === "number", "repetition category present");
  assert(Array.isArray(report.observations), "observations present");
}

{
  const t0 = 1_000_000;
  const report = scoreVoiceLabSession({
    rows: [
      { speaker: "USER", text: "Hi", at: new Date().toISOString() },
      { speaker: "AI", text: "Hey Priya, it's Alex from Acme — got a minute?", at: new Date().toISOString() },
      { speaker: "USER", text: "Sure", at: new Date().toISOString() },
      { speaker: "AI", text: "Hey Priya, it's Alex from Acme — got a minute?", at: new Date().toISOString() },
    ],
    latency: [
      {
        userFinishedAt: t0,
        finalTranscriptAt: t0,
        geminiStartedAt: null,
        agentTextAt: null,
        ttsStartedAt: null,
        firstAudioAt: t0 + 310,
        aiFinishedAt: null,
      },
    ],
    interruptions: 2,
    earlyCutoffs: 1,
    repetition: { repeatedSentences: 1, repeatedAcknowledgements: 1, sameOpenerConsecutive: 0, details: [] },
    duplicateResponsesBlocked: 0,
    appointmentStatus: "none",
    validation: [],
    estimatedSpeakMs: [2500, 2500],
  });
  assert(report.observations.some((o) => o.includes("310ms")), "response start observation");
  assert(report.observations.some((o) => /interrupted once/.test(o)), "AI interruption observation");
  assert(report.observations.some((o) => /repeated an acknowledgement/.test(o)), "ack repetition observation");
  assert(report.observations.some((o) => /averaged \d+ words/.test(o)), "avg words observation");
  assert(report.breakdown.repetition < 10, "repetition penalised");
  assert(report.breakdown.turnTaking < 10, "early cutoff penalised");
}

const page = readFileSync(path.join(process.cwd(), "src/app/voice-lab/page.tsx"), "utf8");
assert(page.includes("isVoiceLabEnabled"), "page gated");
assert(page.includes("VoiceLabClient"), "client mounted");

console.log("Voice lab verification passed.");
