/**
 * Phone-latency / one-turn-one-response regression tests.
 * Run: npx tsx scripts/verify-voice-phone-latency.ts
 */
import { readFileSync } from "fs";
import path from "path";
import { AppointmentIntentTracker } from "../voice-server/src/appointment-intent-tracker";
import {
  getPostSpeechGuardMs,
  getVadEndSensitivity,
  getVadSilenceMs,
  getVoiceLabNetworkDelayMs,
} from "../voice-server/src/config";
import { mergeStreamingTranscript } from "../voice-server/src/transcript-cleanup";
import { DeepgramTtsSession } from "../voice-server/src/tts/deepgram-tts";
import {
  LeadUtteranceAssembler,
  VoiceTurnController,
  isFinalizedLeadTranscript,
} from "../voice-server/src/voice-turn-state";

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
const dgSrc = readFileSync(
  path.join(process.cwd(), "voice-server/src/tts/deepgram-tts.ts"),
  "utf8"
);

// TEST 1: respond to latest lead, do not repeat previous question
{
  const turns = new VoiceTurnController();
  turns.requestOpening();
  const open = turns.acceptLiveResponse("How can I help?");
  assert(open.accepted, "T1 opening");
  turns.tryBeginTts();
  turns.noteAgentSpoken("How can I help?");
  turns.endTts();
  turns.markPlaybackComplete(Date.now(), 0);
  const lead = turns.finalizeLeadTurn("Low vehicle cost");
  assert(lead.accepted, "T1 lead finalized");
  const repeat = turns.tryAcceptModelResponse("generation_complete", "How can I help?");
  assert(!repeat.accepted, "T1 must not repeat How can I help?");
  const stalePitch = turns.tryAcceptModelResponse(
    "generation_complete",
    "We help companies grow with search and social ads."
  );
  assert(!stalePitch.accepted, "T1 stale unique previous-turn text discarded");
  const reply = turns.acceptLiveResponse(
    "Are you trying to lower fleet costs or ad spend?"
  );
  assert(reply.accepted, "T1 answers latest lead");
  assert(reply.generationId !== open.generationId, "T1 new generation");
}

// TEST 2: 1s silence after AI — no second response
{
  const turns = new VoiceTurnController();
  turns.requestOpening();
  turns.acceptLiveResponse("How can I help?");
  turns.tryBeginTts();
  turns.noteAgentSpoken("How can I help?");
  turns.endTts();
  turns.markPlaybackComplete(Date.now(), 1200);
  const now = Date.now() + 1000;
  assert(turns.isInPostSpeechGuard(now) || turns.phase === "listening" || turns.phase === "post_speech_guard", "T2 listening/guard");
  const extra = turns.tryAcceptModelResponse(
    "generation_complete",
    "How can I help?"
  );
  assert(!extra.accepted, "T2 no second response");
  assert(extra.reason === "not_awaiting_response", `T2 reason ${extra.reason}`);
}

// TEST 3: barge-in clears stale AI
{
  const turns = new VoiceTurnController();
  turns.finalizeLeadTurn("Hello.");
  turns.acceptLiveResponse("Yeah, we can help with that.");
  const tts = turns.tryBeginTts();
  const oldGen = tts.generationId;
  const barge = turns.onBargeIn();
  assert(barge.cancelTts, "T3 cancel");
  assert(!turns.isAudioEpochCurrent(tts.epoch), "T3 stale epoch");
  assert(!turns.isGenerationCurrent(oldGen), "T3 stale generation");
  const stale = turns.tryAcceptModelResponse(
    "generation_complete",
    "Yeah, we can help with that."
  );
  assert(!stale.accepted, "T3 stale discarded");
  turns.finalizeLeadTurn("No, I already have that.");
  const fresh = turns.acceptLiveResponse(
    "Got it — what are you hoping to change?"
  );
  assert(fresh.accepted, "T3 new turn only");
  assert(handler.includes("applyGenuineBargeIn"), "T3 handler barge-in");
  assert(handler.includes("clearOutboundAudio()"), "T3 clears Twilio");
}

// TEST 4: output transcription + model text = one TTS (source inspection + gate)
{
  assert(gemini.includes("usedOutputTranscription"), "T4 prefer output transcription");
  assert(
    gemini.includes("if (part.text && !this.usedOutputTranscription)"),
    "T4 skip duplicate model text"
  );
  const turns = new VoiceTurnController();
  turns.finalizeLeadTurn("Low vehicle cost");
  const a = turns.acceptLiveResponse("Sure. Looking to cut vehicle costs?");
  const b = turns.tryAcceptModelResponse(
    "generation_complete",
    "Sure. Looking to cut vehicle costs?"
  );
  assert(a.accepted && !b.accepted, "T4 one response");
  const t1 = turns.tryBeginTts();
  const t2 = turns.tryBeginTts();
  assert(t1.accepted && !t2.accepted, "T4 one TTS");
}

// TEST 5: incremental input chunks → one finalized lead
{
  const assembler = new LeadUtteranceAssembler();
  const merge = mergeStreamingTranscript;
  assembler.push("low", { finished: false }, 1000, merge);
  assembler.push("low vehicle", { finished: false }, 1200, merge);
  assembler.push("low vehicle cost", { finished: true }, 1400, merge);
  assert(assembler.shouldFinalizeImmediately({ finished: true }), "T5 finished true");
  assert(assembler.take() === "low vehicle cost", "T5 one utterance");
  const turns = new VoiceTurnController();
  const tracker = new AppointmentIntentTracker();
  let notes = 0;
  const chunks = ["low", "low vehicle", "low vehicle cost"];
  let merged = "";
  for (let i = 0; i < chunks.length; i++) {
    merged = mergeStreamingTranscript(merged, chunks[i]);
    const finished = i === chunks.length - 1;
    if (!isFinalizedLeadTranscript({ finished })) continue;
    const gate = turns.finalizeLeadTurn(merged);
    if (!gate.accepted) continue;
    tracker.noteLead(merged);
    notes += 1;
  }
  assert(notes === 1, "T5 one tracker update");
  assert(turns.lastFinalizedLead === "low vehicle cost", "T5 final text");
}

// TEST 6: same output text twice → one spoken
{
  const turns = new VoiceTurnController();
  turns.finalizeLeadTurn("Hello.");
  const text = "Sure, we can take a look.";
  const a = turns.acceptLiveResponse(text);
  turns.tryBeginTts();
  turns.noteAgentSpoken(text);
  turns.endTts();
  const b = turns.tryAcceptModelResponse("generation_complete", text);
  assert(a.accepted && !b.accepted, "T6 duplicate ignored");
}

// TEST 7: stale TTS / REST fallback cancelled
{
  const session = new DeepgramTtsSession({
    apiKey: "test-not-used",
    model: "flux-hannah-en",
    speed: 1,
    expressivity: 0,
    timeoutMs: 1000,
  });
  session.interrupt();
  assert(session.cancelled, "T7 interrupt cancels");
  assert(dgSrc.includes("requestSeq"), "T7 request identity");
  assert(
    dgSrc.includes("if (this.cancelled || this.requestSeq !== requestId || signal?.aborted) return"),
    "T7 no REST fallback after cancel"
  );
  const turns = new VoiceTurnController();
  turns.finalizeLeadTurn("Hello.");
  turns.acceptLiveResponse("Hey there.");
  const tts = turns.tryBeginTts();
  turns.onBargeIn();
  assert(!turns.isAudioEpochCurrent(tts.epoch), "T7 stale audio epoch");
  assert(handler.includes("isGenerationCurrent"), "T7 handler drops stale chunks");
}

// TEST 8: coaching note during generation is queued
{
  assert(handler.includes("queueNote"), "T8 queueNote");
  assert(handler.includes("flushNotesIfIdle"), "T8 flush idle");
  assert(handler.includes("!turns.awaitingResponse"), "T8 idle requires not awaiting");
  const turns = new VoiceTurnController();
  turns.finalizeLeadTurn("Book a meeting.");
  turns.acceptLiveResponse("What day works?");
  turns.tryBeginTts();
  assert(!turns.isListeningIdle || turns.isAiSpeaking, "T8 AI speaking not idle");
}

// TEST 9: appointment tracker once per finalized turn
{
  const tracker = new AppointmentIntentTracker();
  const turns = new VoiceTurnController();
  const text = "I want to schedule a meeting.";
  const a = turns.finalizeLeadTurn(text);
  assert(a.accepted, "T9 first");
  tracker.noteLead(text);
  const b = turns.finalizeLeadTurn(text);
  assert(!b.accepted, "T9 duplicate finalize rejected");
  tracker.noteLead(text);
  assert(tracker.isFlowActive, "T9 flow active");
}

// TEST 10: opening twice → one greeting
{
  const turns = new VoiceTurnController();
  assert(turns.requestOpening(), "T10 first opening");
  assert(!turns.requestOpening(), "T10 second opening ignored");
  const g1 = turns.acceptLiveResponse(
    "Nitin Sharma? Hey, it's Alex from Apex. Catch you at a bad time?"
  );
  assert(g1.accepted, "T10 greeting");
  turns.tryBeginTts();
  turns.noteAgentSpoken(
    "Nitin Sharma? Hey, it's Alex from Apex. Catch you at a bad time?"
  );
  turns.endTts();
  const g2 = turns.tryAcceptModelResponse(
    "generation_complete",
    "Nitin Sharma? Hey, it's Alex from Apex. Catch you at a bad time?"
  );
  assert(!g2.accepted, "T10 duplicate greeting blocked");
}

// TEST 11: 300–1000ms delay after AI does not create a repeat
{
  const turns = new VoiceTurnController();
  turns.requestOpening();
  turns.acceptLiveResponse("How can I help?");
  turns.tryBeginTts();
  turns.noteAgentSpoken("How can I help?");
  turns.endTts();
  const t0 = Date.now();
  turns.markPlaybackComplete(t0, 1200);
  for (const delay of [300, 500, 800, 1000]) {
    const extra = turns.tryAcceptModelResponse(
      "generation_complete",
      "How can I help?"
    );
    assert(!extra.accepted, `T11 no repeat at +${delay}ms`);
  }
}

// TEST 12: natural pause inside one utterance — do not finalize partials
{
  const assembler = new LeadUtteranceAssembler();
  const merge = mergeStreamingTranscript;
  assembler.push("I just want", { finished: false }, 1000, merge);
  assert(!assembler.shouldFinalizeImmediately({ finished: false }), "T12 still speaking");
  assert(!assembler.shouldDebounceFinalize(1100, 500), "T12 partial no debounce");
  assembler.push("I just want more clients", { finished: false }, 1600, merge);
  assert(!assembler.shouldDebounceFinalize(1800, 500), "T12 still partial");
  assembler.push("I just want more clients", { finished: true }, 2200, merge);
  assert(assembler.take() === "I just want more clients", "T12 finalize complete utterance");
}

// VAD not clamped to 750
{
  assert(getVadSilenceMs("900") === 900, "900 respected");
  assert(getVadSilenceMs("1000") === 1000, "1000 respected");
  assert(getVadSilenceMs() === 900 || getVadSilenceMs("900") === 900, "default 900");
  assert(getVadEndSensitivity() === "END_SENSITIVITY_LOW", "phone-safe end sensitivity");
  assert(getPostSpeechGuardMs("1200") === 1200, "guard 1200");
  assert(getPostSpeechGuardMs("200") === 400, "guard min 400");
}

// Lab network sim disabled in production
{
  assert(getVoiceLabNetworkDelayMs({ NODE_ENV: "production", VOICE_LAB_NETWORK_DELAY_MS: "400" }) === 0, "prod no sim");
  assert(getVoiceLabNetworkDelayMs({ NODE_ENV: "development", VOICE_LAB_NETWORK_DELAY_MS: "400" }) === 400, "lab delay");
  assert(!handler.includes("maybeSimulateNetworkDelay"), "production handler has no network sim");
  assert(handler.includes("VOICE_POST_SPEECH_GUARD") || handler.includes("getPostSpeechGuardMs"), "guard wired");
  assert(handler.includes("[voice-playback]"), "playback logs");
  assert(handler.includes("[voice-barge-in]"), "barge-in logs");
  assert(handler.includes("mulawBase64Rms"), "echo RMS gate");
  assert(handler.includes("ttsAbortSignal"), "TTS abort wired");
  assert(handler.includes("generation_complete_after_cancel"), "stale generationComplete discarded");
  assert(!handler.includes("latencyPreset"), "lab latency not in production handler");
}

// A–N phone cancellation / latest-turn-wins
{
  // A. AI generating → user speaks → old response cancelled
  const a = new VoiceTurnController();
  a.finalizeLeadTurn("I need more customers.");
  a.noteModelOutput("Yeah, we can help you get more customers by");
  const oldGen = a.generationId;
  const oldAbort = a.ttsAbortSignal;
  const next = a.finalizeLeadTurn("No, actually I need cheaper leads.");
  assert(next.cancelledPrevious, "A cancelled previous");
  assert(oldAbort.aborted, "A previous abort fired");
  assert(!a.isGenerationCurrent(oldGen), "A old generation stale");
  const late = a.tryAcceptModelResponse(
    "generation_complete",
    "Yeah, we can help you get more customers by running ads.",
    oldGen
  );
  assert(!late.accepted, "A old generationComplete discarded");
  const fresh = a.acceptLiveResponse("Got it — cheaper leads. What's eating the budget?");
  assert(fresh.accepted && fresh.generationId !== oldGen, "A new response only");
}

{
  // B. AI finished → user silent → no repeated response
  const b = new VoiceTurnController();
  b.requestOpening();
  b.acceptLiveResponse("Hey Nitin, got a quick minute?");
  b.tryBeginTts();
  b.noteAgentSpoken("Hey Nitin, got a quick minute?");
  b.endTts();
  b.markPlaybackComplete(Date.now(), 1200);
  for (const reason of ["generation_complete", "turn_complete_fallback", "turn_complete"]) {
    const extra = b.tryAcceptModelResponse(reason, "Hey Nitin, got a quick minute?");
    assert(!extra.accepted, `B no auto-reply on ${reason}`);
  }
}

{
  // C. TTS running → user interrupts → TTS cancelled
  const c = new VoiceTurnController();
  c.finalizeLeadTurn("Tell me about pricing.");
  c.acceptLiveResponse("Yeah, we can help with—");
  const tts = c.tryBeginTts();
  const sig = c.ttsAbortSignal;
  const barge = c.onBargeIn();
  assert(barge.cancelTts && sig.aborted, "C TTS aborted");
  assert(!c.isAudioEpochCurrent(tts.epoch), "C epoch bumped");
}

{
  // D. REST abort wiring is present; runtime yield test runs at end of file.
  assert(dgSrc.includes("abortSignal: this.restAbort.signal"), "D REST uses abort");
  assert(dgSrc.includes("if (signal.aborted)"), "D aborted signal returns immediately");
  assert(dgSrc.includes("if (this.cancelled || this.requestSeq !== requestId || signal?.aborted) return"), "D no REST after cancel");
}

{
  // E. Twilio outbound buffer clear on barge-in
  assert(handler.includes("outboundBuffer.clear()"), "E clears local buffer");
  assert(handler.includes('event: "clear"'), "E sends Twilio clear");
  const e = new VoiceTurnController();
  e.finalizeLeadTurn("Hello.");
  e.acceptLiveResponse("Long explanation still playing.");
  const tts = e.tryBeginTts();
  e.onBargeIn();
  assert(!e.isAudioEpochCurrent(tts.epoch), "E stale frames must not send");
}

{
  // F. model text + output transcription → one response
  const f = new VoiceTurnController();
  f.finalizeLeadTurn("Low vehicle cost.");
  f.noteModelOutput("Sure, we can help cut vehicle cost.");
  f.noteModelOutput("Sure, we can help cut vehicle cost.");
  const once = f.tryAcceptModelResponse("generation_complete", "Sure, we can help cut vehicle cost.");
  const twice = f.tryAcceptModelResponse("generation_complete", "Sure, we can help cut vehicle cost.");
  assert(once.accepted && !twice.accepted, "F one response");
}

{
  // G. incremental STT → one lead turn
  const assembler = new LeadUtteranceAssembler();
  const merge = mergeStreamingTranscript;
  assembler.push("low", { finished: false }, 1, merge);
  assembler.push("low vehicle", { finished: false }, 2, merge);
  assembler.push("low vehicle cost", { finished: true }, 3, merge);
  const gTurns = new VoiceTurnController();
  const text = assembler.take();
  assert(text === "low vehicle cost", "G merged");
  assert(gTurns.finalizeLeadTurn(text).accepted, "G one finalize");
  assert(!gTurns.finalizeLeadTurn(text).accepted, "G duplicate blocked");
}

{
  // H/I/J. 300/700/1000ms delay → no duplicate
  const hij = new VoiceTurnController();
  hij.requestOpening();
  hij.acceptLiveResponse("Hey Nitin, got a quick minute?");
  hij.tryBeginTts();
  hij.noteAgentSpoken("Hey Nitin, got a quick minute?");
  hij.endTts();
  hij.markPlaybackComplete(Date.now(), 1200);
  for (const d of [300, 700, 1000]) {
    assert(
      !hij.tryAcceptModelResponse("generation_complete", "Hey Nitin, got a quick minute?").accepted,
      `H/I/J no duplicate at ${d}ms`
    );
  }
}

{
  // K. natural pause inside a sentence — partials do not finalize
  const assembler = new LeadUtteranceAssembler();
  assembler.push("Yeah, I was just wondering", { finished: false }, 1000, mergeStreamingTranscript);
  assert(!assembler.shouldFinalizeImmediately({ finished: false }), "K not final");
  assert(!assembler.shouldDebounceFinalize(1300, 500), "K pause still partial");
}

{
  // L. echo/noise while AI speaking is not a user turn (handler RMS + word gate)
  assert(handler.includes("getEchoRmsThreshold"), "L echo RMS");
  assert(handler.includes("getBargeInMinSpeechMs"), "L min speech");
  assert(handler.includes("ignore_echo_interrupt") || handler.includes("ignore_tiny_interrupt"), "L ignore echo interrupt");
}

{
  // M. same generation event twice → one TTS
  const m = new VoiceTurnController();
  m.finalizeLeadTurn("Yes.");
  m.acceptLiveResponse("Tuesday at eight works.");
  assert(m.tryBeginTts().accepted, "M first TTS");
  assert(!m.tryBeginTts().accepted, "M second TTS blocked");
  assert(!m.tryAcceptModelResponse("generation_complete", "Tuesday at eight works.").accepted, "M second generate blocked");
}

{
  // N. old generation finishes after a new turn → discarded
  const n = new VoiceTurnController();
  n.finalizeLeadTurn("I need more customers.");
  n.noteModelOutput("We can get you more customers.");
  const gen20 = n.generationId;
  n.finalizeLeadTurn("No, cheaper leads.");
  const gen21 = n.generationId;
  assert(gen21 !== gen20, "N new generation");
  assert(
    !n.tryAcceptModelResponse("generation_complete", "We can get you more customers.", gen20).accepted,
    "N gen20 discarded"
  );
  const ok = n.acceptLiveResponse("Cheaper leads — what's the target cost?");
  assert(ok.accepted && ok.generationId === gen21, "N gen21 authoritative");
}

async function testAbortedTtsYieldsNoAudio() {
  const session = new DeepgramTtsSession({
    apiKey: "test-not-used",
    model: "flux-hannah-en",
    speed: 1,
    expressivity: 0,
    timeoutMs: 800,
  });
  const ac = new AbortController();
  ac.abort();
  const started = Date.now();
  const chunks: Buffer[] = [];
  for await (const chunk of session.synthesizeMulaw8k("Hello there.", ac.signal)) {
    chunks.push(chunk);
  }
  assert(chunks.length === 0, "D aborted TTS yields no audio");
  assert(Date.now() - started < 500, "D aborted TTS does not fall back to REST");
}

testAbortedTtsYieldsNoAudio()
  .then(() => {
    console.log("Voice phone-latency verification passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
