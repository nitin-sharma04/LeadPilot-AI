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
  evaluateLeadTranscript,
  isNearDuplicateAgentSpeech,
  isValidShortHumanTurn,
} from "../voice-server/src/transcript-sanity";
import { buildPreferredPhraseFromTranscript } from "../src/lib/calendar/appointment-intent";
import {
  isFinalizedLeadTranscript,
  VoiceTurnController,
} from "../voice-server/src/voice-turn-state";
import {
  getBargeInMinSpeechMs,
  getInputFinalizeDebounceMs,
  getPostSpeechGuardMs,
  isVoiceFillerEnabled,
} from "../voice-server/src/config";

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
  const first = turns.acceptLiveResponse("What are you hoping to improve?");
  const second = turns.tryAcceptModelResponse("generation_complete");
  const third = turns.tryAcceptModelResponse("turn_complete_fallback");
  assert(first.accepted, "T4 first response accepted");
  assert(!second.accepted, "T4 duplicate generationComplete rejected");
  assert(!third.accepted, "T4 turnComplete does not start a second response");
  assert(second.reason === "response_already_accepted" || second.reason === "not_awaiting_response", "T4 reason");
}

// 5–6. Duplicate output transcription / generationComplete does not produce duplicate TTS
{
  const turns = new VoiceTurnController();
  turns.finalizeLeadTurn("Tuesday.");
  const gen = turns.acceptLiveResponse("Tuesday works.");
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
  turns.acceptLiveResponse("Eight works.");
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
  turns.acceptLiveResponse("Hey — got a minute?");
  turns.tryBeginTts();
  const barge = turns.onBargeIn();
  assert(barge.cancelTts, "T8 cancel TTS");
  assert(!turns.ttsInFlight, "T8 tts not in flight");
  const stale = turns.tryAcceptModelResponse("generation_complete", "Hey — got a minute?");
  assert(!stale.accepted, "T8 stale Gemini callback ignored");
  const next = turns.finalizeLeadTurn("I just want more clients.");
  assert(next.accepted, "T8 new lead turn after barge-in");
  const fresh = turns.acceptLiveResponse("We can help you get more clients.");
  assert(fresh.accepted, "T8 new response after new lead");
  assert(handler.includes("onInterrupted"), "T8 interrupt handler");
  assert(handler.includes("applyGenuineBargeIn"), "T8 genuine barge-in helper");
  assert(handler.includes("clearOutboundAudio()"), "T8 clears Twilio audio");
  const bargeSrc = handler.slice(handler.indexOf("onInterrupted"));
  assert(bargeSrc.includes("applyGenuineBargeIn"), "T8 uses barge-in helper");
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

// 13. Missing `finished` is NOT immediately final (debounce in handler / assembler)
{
  const tracker = new AppointmentIntentTracker();
  const turns = new VoiceTurnController();
  const { finals, noteLeadCalls } = applyLeadChunks(tracker, turns, [
    { text: "Yeah, what's this about?" },
  ]);
  assert(finals.length === 0, "T13 undefined finished is not immediate");
  assert(noteLeadCalls.length === 0, "T13 no noteLead until debounce/true");
  assert(!isFinalizedLeadTranscript(undefined), "T13 undefined meta is not immediate final");
  assert(!isFinalizedLeadTranscript({}), "T13 empty meta is not immediate final");
  assert(isFinalizedLeadTranscript({ finished: true }), "T13 true is final");
  assert(!isFinalizedLeadTranscript({ finished: false }), "T13 false is partial");
}

// 14. Duplicate opening greeting is not spoken twice
{
  const turns = new VoiceTurnController();
  assert(turns.requestOpening(), "T14 first opening accepted");
  assert(!turns.requestOpening(), "T14 second opening ignored");
  const greeting = "Hey Nitin, it's John from ABC. Got a quick minute?";
  const first = turns.acceptLiveResponse(greeting);
  assert(first.accepted, "T14 first greeting accepted");
  turns.tryBeginTts();
  turns.noteAgentSpoken(greeting);
  turns.endTts();
  const dup = turns.tryAcceptModelResponse("generation_complete", greeting);
  assert(!dup.accepted, "T14 duplicate greeting rejected");
  assert(
    dup.reason === "response_already_accepted" ||
      dup.reason === "duplicate_spoken_text" ||
      dup.reason === "not_awaiting_response",
    `T14 reason ${dup.reason}`
  );
  const next = turns.finalizeLeadTurn("Yeah, what's this about?");
  assert(next.accepted, "T14 user turn after greeting");
  const echo = turns.acceptLiveResponse(greeting);
  assert(!echo.accepted && echo.reason === "duplicate_spoken_text", "T14 greeting echo on new turn dropped");
  const reply = turns.acceptLiveResponse(
    "We help teams follow up on leads automatically."
  );
  assert(reply.accepted, "T14 real reply accepted");
}

// 15. Barge-in bumps epoch; stale response never plays
{
  const turns = new VoiceTurnController();
  turns.finalizeLeadTurn("Hello.");
  turns.acceptLiveResponse("Here is a long explanation.");
  const tts = turns.tryBeginTts();
  const oldEpoch = tts.epoch;
  const barge = turns.onBargeIn();
  assert(barge.epoch === oldEpoch + 1, "T15 epoch bumped");
  assert(!turns.isAudioEpochCurrent(oldEpoch), "T15 old epoch stale");
  assert(turns.isAudioEpochCurrent(barge.epoch), "T15 new epoch current");
}

// 16. Duplicate finalized transcript does not update appointment twice
{
  const tracker = new AppointmentIntentTracker();
  const turns = new VoiceTurnController();
  applyLeadChunks(tracker, turns, [
    { text: "I want to schedule a meeting.", finished: true },
    { text: "I want to schedule a meeting.", finished: true },
  ]);
  assert(tracker.isFlowActive, "T16 flow active");
  const firstStatus = tracker.appointmentStatus;
  applyLeadChunks(tracker, turns, [
    { text: "I want to schedule a meeting.", finished: true },
  ]);
  assert(tracker.appointmentStatus === firstStatus, "T16 duplicate transcript ignored");
}

// 17. 10-turn conversation remains single-flight
{
  const turns = new VoiceTurnController();
  turns.requestOpening();
  const g0 = turns.acceptLiveResponse(
    "Hey Nitin, it's John from ABC. Got a quick minute?"
  );
  assert(g0.accepted, "T17 greeting");
  turns.tryBeginTts();
  turns.noteAgentSpoken("Hey Nitin, it's John from ABC. Got a quick minute?");
  turns.endTts();
  for (let i = 1; i <= 10; i++) {
    const f = turns.finalizeLeadTurn(`User line number ${i} with some words.`);
    assert(f.accepted, `T17 turn ${i} finalized`);
    const r = turns.acceptLiveResponse(`AI reply number ${i}, short and clear.`);
    assert(r.accepted, `T17 turn ${i} one response`);
    const dup = turns.tryAcceptModelResponse("generation_complete", `AI reply number ${i}, short and clear.`);
    assert(!dup.accepted, `T17 turn ${i} duplicate blocked`);
    const t1 = turns.tryBeginTts();
    const t2 = turns.tryBeginTts();
    assert(t1.accepted && !t2.accepted, `T17 turn ${i} one TTS`);
    turns.noteAgentSpoken(`AI reply number ${i}, short and clear.`);
    turns.endTts();
  }
  assert(turns.currentLeadTurnId === 10, "T17 ten user turns");
}

const geminiSrc = readFileSync(
  path.join(process.cwd(), "voice-server/src/gemini-live.ts"),
  "utf8"
);

// Handler wiring: finished gate, no duplicate noteLead, one TTS path
{
  assert(handler.includes("ingestLeadTranscript"), "ingest path");
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
  assert(handler.includes("generation_complete"), "TTS from generationComplete");
  assert(handler.includes("deepgramTurnInFlight"), "deepgram flight flag");
  assert(handler.includes("tts_duplicate_ignored") || handler.includes("tryBeginTts"), "TTS gate");
  assert(handler.includes("getPostSpeechGuardMs"), "post-speech guard");
  assert(handler.includes("not_awaiting_response") || handler.includes("awaitingResponse"), "no auto reply");
  assert(!/sleep\s*\(\s*\d+/.test(handler), "no response sleep");
  assert(handler.includes("queueNote"), "coaching notes queued");
  assert(handler.includes("flushNotesIfIdle"), "notes flushed when idle");
  assert(handler.includes("turns.requestOpening()"), "opening gated");
  assert(handler.includes("outputSeenForGeneration"), "live Gemini output required before TTS");
  assert(handler.includes("generation_complete_after_cancel"), "stale generationComplete discarded");
  assert(!/from ["'].*voice-lab/.test(handler), "production handler does not import voice-lab");
  assert(geminiSrc.includes("openingSent"), "Gemini opening is idempotent");
  assert(
    geminiSrc.includes("{ finished: serverContent.inputTranscription.finished }"),
    "finished flag is not coerced with Boolean()"
  );
  assert(!geminiSrc.includes("Boolean(serverContent.inputTranscription.finished)"), "no Boolean finished");
  assert(handler.includes("evaluateLeadTranscript") || handler.includes("authorizeFinalLead"), "garbage filter wired");
  assert(handler.includes("syncEchoInterrupt"), "echo interrupt syncs generation identity");
  assert(handler.includes("void tryBookOnLeadConfirmation"), "appointment does not block the turn");
  assert(!handler.includes("Mm, one sec"), "no filler utterance in production path");
  const processLead = handler.slice(
    handler.indexOf("const processFinalLeadTurn"),
    handler.indexOf("const teardownMedia")
  );
  assert(!processLead.includes("await tryBookOnLeadConfirmation"), "booking is not awaited on the live turn");
}

const deepgramSrc = readFileSync(
  path.join(process.cwd(), "voice-server/src/tts/deepgram-tts.ts"),
  "utf8"
);
assert(deepgramSrc.includes("stale_rest_fallback"), "N cancelled REST fallback discarded");
assert(deepgramSrc.includes("stale_or_cancelled_before_rest"), "N cancelled before REST");

assert(getPostSpeechGuardMs("650") === 650, "guard default target");
assert(getBargeInMinSpeechMs("170") === 170, "barge-in min 170");
assert(getInputFinalizeDebounceMs("350") === 350, "debounce 350");
assert(!isVoiceFillerEnabled("false"), "filler off");
assert(!isVoiceFillerEnabled(""), "filler default off");

// A. AI finishes → 2 seconds silence → NO second AI response
{
  const turns = new VoiceTurnController();
  turns.requestOpening();
  turns.acceptLiveResponse("Hey, got a minute?");
  turns.tryBeginTts();
  turns.noteAgentSpoken("Hey, got a minute?");
  const t0 = Date.now();
  turns.markPlaybackComplete(t0, 650);
  turns.enterListeningIfGuardElapsed(t0 + 2000);
  const extra = turns.tryAcceptModelResponse(
    "generation_complete",
    "Hey, got a minute?"
  );
  assert(!extra.accepted, "A no second response after silence");
  assert(
    extra.reason === "not_awaiting_response" ||
      extra.reason === "duplicate_spoken_text" ||
      extra.reason === "ignoreModelOutputUntilLead" ||
      extra.reason === "stale_output_before_lead" ||
      extra.reason === "stale_or_no_output",
    `A reason ${extra.reason}`
  );
  const garbage = evaluateLeadTranscript({
    text: "Movie Film Talk",
    silenceMs: 2000,
    inboundLoudMs: 0,
  });
  assert(!garbage.accept, "A garbage after pause is not a user turn");
}

// B. AI finishes → user says yeah after 1.5s → ONE AI response
{
  const turns = new VoiceTurnController();
  turns.requestOpening();
  turns.acceptLiveResponse("Hey, got a minute?");
  turns.tryBeginTts();
  turns.noteAgentSpoken("Hey, got a minute?");
  turns.endTts();
  turns.markPlaybackComplete(Date.now(), 650);
  const decision = evaluateLeadTranscript({
    text: "Yeah, that makes sense.",
    silenceMs: 1500,
    inboundLoudMs: 180,
  });
  assert(decision.accept, "B yeah after pause is a user turn");
  const f = turns.finalizeLeadTurn("Yeah, that makes sense.");
  assert(f.accepted, "B finalize");
  const r1 = turns.acceptLiveResponse("Great — we help with follow-up.");
  const r2 = turns.tryAcceptModelResponse("turn_complete_fallback");
  assert(r1.accepted && !r2.accepted, "B exactly one response");
}

// C. AI speaking → user says wait → AI stops → ONE new response
{
  const turns = new VoiceTurnController();
  turns.finalizeLeadTurn("Tell me about pricing.");
  turns.acceptLiveResponse("Pricing depends on several long factors.");
  turns.tryBeginTts();
  assert(isValidShortHumanTurn("wait"), "C wait is a valid barge-in");
  const barge = turns.onBargeIn();
  assert(barge.cancelTts, "C cancel TTS");
  const next = turns.finalizeLeadTurn("Wait, what about pricing?");
  assert(next.accepted, "C new turn");
  const fresh = turns.acceptLiveResponse("Pricing starts at two thousand.");
  const dup = turns.tryAcceptModelResponse("generation_complete");
  assert(fresh.accepted && !dup.accepted, "C one new response");
}

// D. tiny echo interrupt does not cancel TTS; generation identity stays synced
{
  const turns = new VoiceTurnController();
  turns.finalizeLeadTurn("Hello.");
  turns.acceptLiveResponse("Hey — got a minute?");
  turns.tryBeginTts();
  const gen = turns.generationId;
  const sync = turns.syncEchoInterrupt();
  assert(sync.cancelAudio === false, "D does not cancel audio");
  assert(sync.generationId === gen, "D local generation id stays");
  assert(turns.ttsInFlight, "D TTS still in flight");
  const leftover = turns.tryAcceptModelResponse(
    "generation_complete",
    "Unsolicited continuation."
  );
  assert(!leftover.accepted, "D unsolicited output discarded");
}

// E. One user turn → multiple Gemini completion events → ONE TTS only
{
  const turns = new VoiceTurnController();
  turns.finalizeLeadTurn("I just want more clients.");
  const first = turns.acceptLiveResponse("What are you hoping to improve?");
  const second = turns.tryAcceptModelResponse("generation_complete");
  const third = turns.tryAcceptModelResponse("turn_complete_fallback");
  assert(first.accepted && !second.accepted && !third.accepted, "E one accept");
  const tts1 = turns.tryBeginTts();
  const tts2 = turns.tryBeginTts();
  assert(tts1.accepted && !tts2.accepted, "E one TTS");
}

// F. Duplicate Gemini text → TTS suppressed
{
  const turns = new VoiceTurnController();
  turns.finalizeLeadTurn("Go on.");
  const spoken = "We help teams follow up automatically.";
  turns.acceptLiveResponse(spoken);
  turns.tryBeginTts();
  turns.noteAgentSpoken(spoken);
  turns.endTts();
  turns.finalizeLeadTurn("Okay.");
  const echo = turns.acceptLiveResponse(spoken);
  assert(!echo.accepted, "F duplicate suppressed");
  assert(echo.reason === "duplicate_spoken_text", `F reason ${echo.reason}`);
}

// G. Appointment analysis running slowly does not block realtime (wiring)
{
  assert(handler.includes("void tryBookOnLeadConfirmation"), "G async book");
  const processLead = handler.slice(
    handler.indexOf("const processFinalLeadTurn"),
    handler.indexOf("const teardownMedia")
  );
  assert(!processLead.includes("await tryBookOnLeadConfirmation"), "G not awaited");
  assert(!processLead.includes("generateContent"), "G no REST generateContent on turn");
}

// H. Appointment analyzer receives only finalized user text / extracted hints
{
  const phrase = buildPreferredPhraseFromTranscript([
    { speaker: "LEAD", text: "No, we can talk." },
    { speaker: "LEAD", text: "Movie Film Talk" },
    { speaker: "LEAD", text: "Yes, ma'am." },
    { speaker: "LEAD", text: "영감님, 기운을" },
  ]);
  assert(phrase === "", "H garbage lines are not merged into preferred time");
  const tracker = new AppointmentIntentTracker();
  tracker.noteLead("No, we can talk.");
  tracker.noteLead("Movie Film Talk");
  tracker.noteLead("영감님, 기운을");
  assert(tracker.preferredText === "", "H tracker ignores garbage preferred phrase");
}

// I. Garbage transcript after silence → no hallucinated response
{
  const g = evaluateLeadTranscript({
    text: "영감님, 기운을",
    silenceMs: 3500,
    inboundLoudMs: 0,
  });
  assert(!g.accept && g.reason === "rejectedGarbage", "I hangul garbage rejected");
}

// J / K. yes / no remain valid turns
{
  assert(evaluateLeadTranscript({ text: "yes", silenceMs: 1500, inboundLoudMs: 0 }).accept, "J yes");
  assert(evaluateLeadTranscript({ text: "no", silenceMs: 1500, inboundLoudMs: 0 }).accept, "K no");
  assert(isValidShortHumanTurn("yeah"), "J yeah");
  assert(isValidShortHumanTurn("wait"), "C wait short");
}

// L. Two legitimate turns with overlapping common words are not duplicate-suppressed
{
  assert(
    !isNearDuplicateAgentSpeech(
      "We can help you get more clients.",
      "Tuesday at four works on our side."
    ),
    "L different replies"
  );
}

// M. Stale generation output discarded
{
  const turns = new VoiceTurnController();
  turns.finalizeLeadTurn("Hello.");
  const firstGen = turns.generationId;
  turns.acceptLiveResponse("Hey there.");
  turns.tryBeginTts();
  turns.onBargeIn();
  turns.finalizeLeadTurn("I just want more clients.");
  const stale = turns.tryAcceptModelResponse("generation_complete", "Hey there.", firstGen);
  assert(!stale.accepted, "M stale generation discarded");
}

console.log("Voice turn finalization verification passed.");
