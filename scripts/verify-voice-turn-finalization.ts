/**
 * Finalized-lead turns, single model response, single TTS flight.
 * Run: npx tsx scripts/verify-voice-turn-finalization.ts
 */
import { readFileSync } from "fs";
import path from "path";
import { AppointmentIntentTracker } from "../voice-server/src/appointment-intent-tracker";
import {
  detectsAgentFarewell,
  detectsEndCallIntent,
} from "../voice-server/src/end-call-intent";
import { mergeStreamingTranscript } from "../voice-server/src/transcript-cleanup";
import {
  isFinalizedLeadTranscript,
  VoiceTurnController,
} from "../voice-server/src/voice-turn-state";

function assert(c: boolean, m: string) {
  if (!c) throw new Error(`FAIL: ${m}`);
}

const handler = readFileSync(
  path.join(process.cwd(), "voice-server/src/twilio-stream-handler.ts"),
  "utf8"
);

function applyLeadChunks(
  tracker: AppointmentIntentTracker,
  turns: VoiceTurnController,
  chunks: Array<{ text: string; finished?: boolean }>
) {
  let merged = "";
  const finals: string[] = [];
  const noteLeadCalls: string[] = [];
  for (const chunk of chunks) {
    merged = mergeStreamingTranscript(merged, chunk.text);
    if (!isFinalizedLeadTranscript(chunk)) continue;
    const gate = turns.finalizeLeadTurn(merged);
    if (!gate.accepted) continue;
    tracker.noteLead(merged);
    noteLeadCalls.push(merged);
    finals.push(merged);
  }
  return { finals, noteLeadCalls, merged };
}

// 1. finished=false does not call appointment logic
{
  const tracker = new AppointmentIntentTracker();
  const turns = new VoiceTurnController();
  const { finals, noteLeadCalls } = applyLeadChunks(tracker, turns, [
    { text: "I want to schedule a meeting", finished: false },
  ]);
  assert(finals.length === 0, "T1 no final turn");
  assert(noteLeadCalls.length === 0, "T1 no noteLead");
  assert(tracker.appointmentStatus === "none", "T1 tracker unchanged");
  assert(!tracker.isFlowActive, "T1 flow inactive");
}

// 2. finished=true calls appointment logic exactly once
{
  const tracker = new AppointmentIntentTracker();
  const turns = new VoiceTurnController();
  const { finals, noteLeadCalls } = applyLeadChunks(tracker, turns, [
    { text: "I want to schedule a meeting.", finished: true },
  ]);
  assert(finals.length === 1, "T2 one final");
  assert(noteLeadCalls.length === 1, "T2 noteLead once");
  assert(tracker.isFlowActive, "T2 flow active");
}

// 3. Incremental chunks collapse to one finalized lead turn
{
  const tracker = new AppointmentIntentTracker();
  const turns = new VoiceTurnController();
  const { finals, noteLeadCalls } = applyLeadChunks(tracker, turns, [
    { text: "I just", finished: false },
    { text: "I just want", finished: false },
    { text: "I just want more", finished: false },
    { text: "I just want more clients", finished: true },
  ]);
  assert(finals.length === 1, "T3 one business turn");
  assert(noteLeadCalls.length === 1, "T3 noteLead once");
  assert(finals[0] === "I just want more clients", `T3 got ${finals[0]}`);
  assert(tracker.appointmentStatus === "none", "T3 discovery stays none");
  assert(!tracker.isFlowActive, "T3 does not jump to booking");
}

// 4. One finalized lead turn produces exactly one model response
{
  const turns = new VoiceTurnController();
  turns.finalizeLeadTurn("I just want more clients.");
  const first = turns.tryAcceptModelResponse("generation_complete");
  const second = turns.tryAcceptModelResponse("generation_complete");
  const third = turns.tryAcceptModelResponse("turn_complete_fallback");
  assert(first.accepted, "T4 first response accepted");
  assert(!second.accepted, "T4 duplicate generationComplete rejected");
  assert(!third.accepted, "T4 turnComplete does not start a second response");
  assert(second.reason === "response_already_accepted", "T4 reason");
}

// 5–6. Duplicate output transcription / generationComplete does not produce duplicate TTS
{
  const turns = new VoiceTurnController();
  turns.finalizeLeadTurn("Tuesday.");
  const gen = turns.tryAcceptModelResponse("generation_complete");
  assert(gen.accepted, "T5 accept generation");
  const tts1 = turns.tryBeginTts();
  const tts2 = turns.tryBeginTts();
  const outFinished = turns.tryAcceptModelResponse("output_transcript_finished");
  assert(tts1.accepted, "T5 first TTS");
  assert(!tts2.accepted, "T5 second TTS blocked");
  assert(!outFinished.accepted, "T6 output finished does not accept another response");
}

// 7. Deepgram synthesis is single-flight
{
  const turns = new VoiceTurnController();
  turns.finalizeLeadTurn("Around 8 PM.");
  turns.tryAcceptModelResponse("generation_complete");
  const a = turns.tryBeginTts();
  const b = turns.tryBeginTts();
  assert(a.accepted && a.reason === "tts_start", "T7 start");
  assert(!b.accepted, "T7 single-flight");
  assert(
    b.reason === "tts_duplicate_same_turn" || b.reason === "tts_in_flight",
    `T7 reason ${b.reason}`
  );
}

// 8. Actual barge-in cancels current TTS
{
  const turns = new VoiceTurnController();
  turns.finalizeLeadTurn("Hello.");
  turns.tryAcceptModelResponse("generation_complete");
  turns.tryBeginTts();
  const barge = turns.onBargeIn();
  assert(barge.cancelTts, "T8 cancel TTS");
  assert(!turns.ttsInFlight, "T8 tts not in flight");
  const stale = turns.tryAcceptModelResponse("generation_complete");
  assert(!stale.accepted, "T8 stale Gemini callback ignored");
  const next = turns.finalizeLeadTurn("I just want more clients.");
  assert(next.accepted, "T8 new lead turn after barge-in");
  const fresh = turns.tryAcceptModelResponse("generation_complete");
  assert(fresh.accepted, "T8 new response after new lead");
  assert(handler.includes("onInterrupted"), "T8 interrupt handler");
  const bargeSrc = handler.slice(handler.indexOf("onInterrupted"));
  assert(bargeSrc.includes("clearOutboundAudio()"), "T8 clears Twilio audio");
  assert(bargeSrc.includes("turns.onBargeIn()"), "T8 uses barge-in gate");
}

// 9. Partial tomorrow / partial time does not advance appointment state
{
  const tracker = new AppointmentIntentTracker();
  const turns = new VoiceTurnController();
  applyLeadChunks(tracker, turns, [
    { text: "tomor", finished: false },
    { text: "tomorrow at fiv", finished: false },
  ]);
  assert(tracker.appointmentStatus === "none", "T9 partial no advance");
  assert(!tracker.dateHint, "T9 no date from partial");
  assert(!tracker.timeHint, "T9 no time from partial");
}

// 10. Ambiguous speech does not create a booking
{
  const tracker = new AppointmentIntentTracker();
  tracker.noteLead("I want to schedule a meeting.");
  tracker.noteLead("sometime in the morning");
  assert(!tracker.shouldAttemptBooking("sometime in the morning"), "T10 no book");
  assert(!tracker.shouldAttemptBooking("maybe"), "T10 maybe no book");
}

// 11. Existing booking confirmation still works
{
  const tracker = new AppointmentIntentTracker();
  const turns = new VoiceTurnController();
  applyLeadChunks(tracker, turns, [
    { text: "I want to schedule a meeting.", finished: true },
  ]);
  applyLeadChunks(tracker, turns, [{ text: "Tuesday.", finished: true }]);
  applyLeadChunks(tracker, turns, [{ text: "Around 8 PM.", finished: true }]);
  tracker.noteAgent("Does Tuesday around 8 PM work for you?");
  assert(tracker.shouldAttemptBooking("Yes."), "T11 confirm books");
}

// 12. Existing farewell/hangup still works
{
  assert(detectsEndCallIntent("Goodbye."), "T12 lead goodbye");
  assert(detectsAgentFarewell("You're welcome. Have a great day."), "T12 agent farewell");
  assert(handler.includes("sendFarewellMark"), "T12 farewell mark");
  assert(handler.includes("completeTwilioCall"), "T12 REST hangup");
  assert(handler.includes("beginEndFlow"), "T12 end flow");
}

// Handler wiring: finished gate, no duplicate noteLead, one TTS path
{
  assert(handler.includes("isFinalizedLeadTranscript(meta)"), "finished meta used");
  assert(handler.includes("processFinalLeadTurn"), "final lead processor");
  const tryBook = handler.slice(
    handler.indexOf("const tryBookOnLeadConfirmation"),
    handler.indexOf("const sendClear")
  );
  assert(!tryBook.includes("apptTracker.noteLead"), "tryBook does not noteLead");
  const outputBlock = handler.slice(
    handler.indexOf("onOutputTranscript"),
    handler.indexOf("onGenerationComplete")
  );
  assert(
    !outputBlock.includes("prepareAndSpeakGeminiTurn"),
    "output transcript does not start TTS"
  );
  assert(handler.includes('tryAcceptModelResponse("generation_complete")'), "TTS from generationComplete");
  assert(handler.includes("deepgramTurnInFlight"), "deepgram flight flag");
  assert(handler.includes("tts_duplicate_ignored") || handler.includes("tryBeginTts"), "TTS gate");
  assert(handler.includes("[voice-turn]"), "turn logs");
  assert(!/sleep\s*\(\s*\d+/.test(handler), "no response sleep");
}

console.log("Voice turn finalization verification passed.");
