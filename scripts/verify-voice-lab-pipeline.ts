/**
 * LOCAL VOICE LAB pipeline regression tests (no network).
 * Run: npx tsx scripts/verify-voice-lab-pipeline.ts
 *
 * Covers the invariant: one finalized user turn → one AI response → one TTS playback,
 * plus the two production-observed failures (duplicate first sentence, missing responses).
 */
import { EventEmitter } from "events";
import { readFileSync } from "fs";
import path from "path";
import {
  VoiceLabTurnMachine,
  VOICE_LAB_TRANSITIONS,
  type LabFinalizedResponse,
} from "../voice-lab/turn-machine";
import {
  classifyDeepgramFrame,
  LabDeepgramTts,
  type LabTtsSocket,
} from "../voice-server/src/voice-lab-tts";

function assert(c: boolean, m: string) {
  if (!c) throw new Error(`FAIL: ${m}`);
}

async function main() {
let clock = 1_000_000;
const now = () => clock;
const tick = (ms: number) => {
  clock += ms;
};

function newMachine() {
  const events: string[] = [];
  const m = new VoiceLabTurnMachine({ now, log: (e) => events.push(e.event), sessionId: "test" });
  return { m, events };
}

/** Drive a full AI response: generation chunks → generationComplete → TTS → finished. */
function aiTurn(m: VoiceLabTurnMachine, text: string, opts?: { skipTts?: boolean }) {
  m.generationText(text.slice(0, Math.ceil(text.length / 2)));
  tick(50);
  m.generationText(text);
  tick(50);
  const r = m.generationComplete(text);
  if (opts?.skipTts) return r;
  if (r.speak) {
    const g = m.ttsStart(r.speak);
    assert(g.accepted, `tts accepted for "${text}"`);
    tick(300);
    m.ttsAudioStarted(r.speak);
    tick(1500);
    m.ttsFinished(r.speak, { completed: true });
  }
  return r;
}

// ------------------------------------------------------------ state table
{
  assert(!VOICE_LAB_TRANSITIONS.user_speaking.includes("ai_speaking"), "USER_SPEAKING → AI_SPEAKING forbidden");
  assert(!VOICE_LAB_TRANSITIONS.listening.includes("ai_speaking"), "LISTENING → AI_SPEAKING forbidden (must think first)");
  assert(VOICE_LAB_TRANSITIONS.ai_speaking.includes("barge_in"), "AI_SPEAKING → BARGE_IN allowed");
  assert(VOICE_LAB_TRANSITIONS.ended.length === 0, "ENDED is terminal");
  const { m } = newMachine();
  m.start();
  assert(!m.transition("ai_speaking"), "illegal transition refused");
  assert(m.counters.illegalTransitionsRefused === 1, "illegal transition counted");
  assert(m.state === "listening", "state unchanged after refusal");
}

// ------------------------------------------------ start session exactly once
{
  const { m } = newMachine();
  assert(m.start(), "first start ok");
  assert(!m.start(), "second start ignored");
  assert(m.state === "listening", "still listening");
}

// ------------------------------------------------- first greeting exactly once
{
  const { m, events } = newMachine();
  m.start();
  m.openingRequested();
  const r = aiTurn(m, "Hey Nitin, it's John from ABC. Got a quick minute?", { skipTts: true });
  assert(r.speak !== null && r.speak.turnId === 0 && r.speak.responseId === 1, "greeting is response 1 of turn 0");
  // Gemini re-emits: turnComplete after generationComplete, and a duplicate generationComplete.
  const tc = m.turnComplete();
  assert(tc.speak === null && !tc.recovered, "turnComplete after generationComplete does not speak");
  const dup = m.generationComplete("Hey Nitin, it's John from ABC. Got a quick minute?");
  assert(dup.speak === null, "duplicate generationComplete ignored");
  assert(m.counters.duplicateResponsesBlocked >= 1, "duplicate counted");
  // Exactly one TTS for that response.
  const g1 = m.ttsStart(r.speak!);
  const g2 = m.ttsStart(r.speak!);
  assert(g1.accepted && !g2.accepted, "TTS starts once per response");
  assert(m.counters.duplicateTtsBlocked === 1, "duplicate TTS counted");
  m.ttsAudioStarted(r.speak!);
  assert(m.state === "ai_speaking", "ai_speaking during greeting");
  m.ttsFinished(r.speak!, { completed: true });
  assert(m.state === "listening", "back to listening after greeting");
  assert(m.counters.responsesSpoken === 1, "one spoken response");
  assert(events.filter((e) => e === "tts_started").length === 1, "tts_started logged once");
}

// ------------------- second opening generation (same sentence) is never spoken
{
  const { m } = newMachine();
  m.start();
  m.openingRequested();
  aiTurn(m, "Hey Nitin, it's John from ABC. Got a quick minute?");
  assert(m.state === "listening" && m.counters.responsesSpoken === 1, "greeting spoken once");
  m.generationText("Hey Nitin, it's John from ABC. Got a quick minute?");
  const echo = m.generationComplete("Hey Nitin, it's John from ABC. Got a quick minute?");
  assert(echo.speak === null && echo.reason === "duplicate_spoken_text", "echo greeting not speakable");
  assert(m.counters.responsesSpoken === 1, "still exactly one spoken greeting");
  assert(m.state === "listening", "echo does not leave the machine thinking");
}

// ------------------- quiet user / output-first after greeting still speaks (not treated as echo)
{
  const { m } = newMachine();
  m.start();
  m.openingRequested();
  aiTurn(m, "Hey Nitin, it's John from ABC. Got a quick minute?");
  m.generationText("We help teams follow up automatically.");
  const t = m.userTranscript("Yeah, what's this about?");
  assert(!t.newTurn && t.turnId === 1, "late transcript attaches to output-first turn");
  const r = m.generationComplete("We help teams follow up automatically.");
  assert(r.speak !== null, "real reply after greeting is not dropped as an echo");
  m.ttsStart(r.speak!);
  m.ttsAudioStarted(r.speak!);
  m.ttsFinished(r.speak!, { completed: true });
  assert(m.counters.responsesSpoken === 2, "greeting + one reply");
}

// ------------------- [EVENT:call_answered] must not become a user turn
{
  const { m } = newMachine();
  m.start();
  const ign = m.userTranscript("[EVENT:call_answered]");
  assert(ign.duplicate, "internal event transcript ignored");
  assert(m.turnId === 0 && m.counters.userTurns === 0, "no user turn for event token");
}

// ------------------- hasOpenGeneration tracks in-flight model output
{
  const { m } = newMachine();
  m.start();
  assert(!m.hasOpenGeneration, "idle has no open generation");
  m.userTranscript("Hi.");
  m.generationText("Hello.");
  assert(m.hasOpenGeneration, "open while generating");
  m.generationComplete("Hello.");
  assert(!m.hasOpenGeneration, "closed after generationComplete");
}

// ----------------------------- partial / mic activity does not generate anything
{
  const { m } = newMachine();
  m.start();
  m.micStart();
  assert(m.state === "user_speaking", "mic → user_speaking");
  tick(800);
  m.micStop();
  assert(m.state === "user_turn_finalizing", "mic silence → user_turn_finalizing");
  assert(m.counters.userTurns === 0 && m.turnId === 0, "no user turn without a Gemini transcript");
  const r = m.generationComplete("nothing");
  assert(r.speak === null && r.reason === "no_open_generation", "generationComplete without generation ignored");
  assert(m.userTranscript("   ").duplicate, "empty transcript ignored");
  tick(5000);
  assert(m.noteGenerationMissing("after_mic_silence"), "mic silence watchdog resets");
  assert(m.state === "listening", "back to listening after noise");
}

// -------------------- final transcript (no `finished` flag) generates exactly once
{
  const { m } = newMachine();
  m.start();
  const t = m.userTranscript("Yeah, what's this about?");
  assert(t.newTurn && t.turnId === 1, "transcript opens turn 1");
  assert(m.state === "ai_thinking", "Gemini finalized the turn → ai_thinking");
  const r = aiTurn(m, "We help teams follow up on leads faster. What are you using today?");
  assert(r.speak !== null && r.speak.turnId === 1, "one response for turn 1");
  assert(m.counters.responsesSpoken === 1 && m.counters.missedResponses === 0, "spoken, not missed");
  assert(m.state === "listening", "listening again");
}

// ---------------------------------------- transcript arriving AFTER output chunks
{
  const { m } = newMachine();
  m.start();
  m.generationText("I understand,");
  assert(m.turnId === 1 && m.state === "ai_thinking", "output-first opens turn 1");
  const t = m.userTranscript("Yeah, I've got a minute.");
  assert(!t.newTurn && t.turnId === 1, "late transcript attaches to turn 1, no new turn");
  const r = aiTurn(m, "I understand, we have solutions for that.");
  assert(r.speak !== null && r.speak.turnId === 1, "still one response");
  assert(m.turns.find((x) => x.turnId === 1)?.userText === "Yeah, I've got a minute.", "user text recorded");
}

// ------------------------------------------------ duplicate final transcript ignored
{
  const { m } = newMachine();
  m.start();
  m.userTranscript("Yes.");
  tick(200);
  const dup = m.userTranscript("Yes.");
  assert(dup.duplicate, "identical transcript within window is a duplicate");
  assert(m.counters.duplicateTranscriptsBlocked === 1, "duplicate transcript counted");
  assert(m.turnId === 1, "duplicate did not open a turn");
  aiTurn(m, "Great, what day works?");
  tick(3000);
  const again = m.userTranscript("Yes.");
  assert(again.newTurn, "same words later is a legitimate new turn");
}

// ------------------------------- AI cannot speak while the user is speaking (deferral)
{
  const { m } = newMachine();
  m.start();
  m.userTranscript("Tell me more.");
  m.generationText("Sure — we automate");
  // User keeps talking (mic) after Gemini already finalized their turn.
  m.micStart();
  assert(m.state === "ai_thinking", "mic during ai_thinking keeps thinking (no barge-in yet)");
  const r = m.generationComplete("Sure — we automate follow-ups.");
  // Not in user_speaking state (Gemini already closed the turn) → speaks. Now the strict case:
  assert(r.speak !== null, "response speakable when Gemini closed the turn");
  m.ttsStart(r.speak!);
  m.ttsAudioStarted(r.speak!);
  m.ttsFinished(r.speak!, { completed: true });
  m.micStop();
  // Strict case: user is in user_speaking (listening → mic) when a response finalizes.
  m.micStart();
  assert(m.state === "user_speaking", "user speaking");
  m.userTranscript("And one more thing"); // Gemini finalizes → ai_thinking
  m.micStart(); // still talking per mic (state ai_thinking now)
  const hold = (() => {
    // force user_speaking state to model "mic active while response finalizes"
    m.state = "user_speaking";
    m.micSpeaking = true;
    m.generationText("Of course.");
    m.state = "user_speaking";
    return m.generationComplete("Of course.");
  })();
  assert(hold.deferred && hold.speak === null, "response deferred while user_speaking");
  const bad: LabFinalizedResponse = { responseId: 99, turnId: m.turnId, epoch: m.epoch, text: "x" };
  assert(!m.ttsStart(bad).accepted, "ttsStart refused in user_speaking");
  const rel = m.micStop();
  assert(rel.speak !== null && rel.speak.text === "Of course.", "deferred response released on mic silence");
  assert(m.counters.deferredSpeaks === 1, "deferral counted");
}

// --------------------------------------- barge-in cancels old response, epoch bumps
{
  const { m } = newMachine();
  m.start();
  m.userTranscript("Okay.");
  const r = aiTurn(m, "Here is a long explanation about everything we do.", { skipTts: true });
  m.ttsStart(r.speak!);
  m.ttsAudioStarted(r.speak!);
  const oldEpoch = m.epoch;
  tick(400);
  const b = m.micStart();
  assert(b.cancelTts && b.clearAudio && b.epoch === oldEpoch + 1, "barge-in cancels TTS and bumps epoch");
  assert(m.state === "user_speaking", "barge_in → user_speaking");
  assert(!m.isAudioEpochCurrent(oldEpoch), "old epoch audio is stale");
  assert(m.isAudioEpochCurrent(b.epoch), "new epoch is current");
  m.ttsFinished(r.speak!, { completed: false });
  assert(m.turns.find((t) => t.turnId === 1)?.outcome === "interrupted", "turn marked interrupted");
  assert(m.state === "user_speaking", "TTS finish of stale response does not change state");
  // Old response must never resume.
  assert(!m.ttsStart(r.speak!).accepted, "stale response cannot restart TTS");
  // New user turn works.
  m.micStop();
  m.userTranscript("Wait, hold on.");
  const r2 = aiTurn(m, "Sure, go ahead.");
  assert(r2.speak !== null && r2.speak.epoch === b.epoch, "new response on new epoch");
  assert(m.counters.bargeIns === 1 && m.counters.responsesSpoken === 1, "one barge-in, one completed response");
}

// ----------------------------- Gemini `interrupted` mid-generation drops late completion
{
  const { m } = newMachine();
  m.start();
  m.userTranscript("Hi.");
  m.generationText("Hello there,");
  const i = m.interrupted();
  assert(i.epoch === 1 && m.state === "user_speaking", "gemini interrupted → user_speaking, epoch 1");
  const late = m.generationComplete("Hello there, how are you?");
  assert(late.speak === null && late.reason === "stale_epoch", "late completion of interrupted generation dropped");
  assert(m.counters.partialResponseAttempts === 1, "partial response attempt counted");
}

// -------------------------------------------- recovery: turnComplete without generationComplete
{
  const { m } = newMachine();
  m.start();
  m.userTranscript("Hello?");
  m.generationText("Hi, yes.");
  const tc = m.turnComplete("Hi, yes.");
  assert(tc.recovered && tc.speak !== null, "turnComplete recovers a missing generationComplete");
  const dup = m.generationComplete("Hi, yes.");
  assert(dup.speak === null, "late generationComplete after recovery is ignored (same responseId)");
}

// --------------------------------------------------- missed response watchdog
{
  const { m } = newMachine();
  m.start();
  m.userTranscript("Are you there?");
  tick(3000);
  assert(m.noteGenerationMissing("after_transcript"), "watchdog flags missing generation");
  assert(m.counters.missedResponses === 1 && m.state === "listening", "missed counted, back to listening");
}

// ------------------------------------------ system (booking) speech replaces model reply
{
  const { m } = newMachine();
  m.start();
  m.userTranscript("Yes, Tuesday 3 PM works.");
  const sys = m.systemResponse("Okay, Tuesday 3 PM is locked in for this test. No calendar invite was sent.");
  assert(sys !== null && m.ttsStart(sys).accepted, "system response speaks");
  m.ttsAudioStarted(sys!);
  m.ttsFinished(sys!, { completed: true });
  m.generationText("Great, you're booked!");
  const r = m.generationComplete("Great, you're booked!");
  assert(r.speak === null && r.reason === "suppressed_by_system_speech", "model reply for that turn suppressed");
  assert(m.counters.responsesSpoken === 1, "only the system line was spoken");
}

// ------------------------------------------------------ 10-turn conversation
{
  const { m, events } = newMachine();
  m.start();
  m.openingRequested();
  aiTurn(m, "Hey Nitin, it's John from ABC. Got a quick minute?");
  for (let i = 1; i <= 10; i++) {
    tick(2000);
    m.micStart();
    tick(1500);
    m.micStop();
    tick(400);
    const t = m.userTranscript(`User line number ${i} with some words.`);
    assert(t.newTurn && t.turnId === i, `turn ${i} opened`);
    const r = aiTurn(m, `AI reply number ${i}, short and clear.`);
    assert(r.speak !== null, `turn ${i} spoken`);
    m.turnComplete();
    assert(m.state === "listening", `listening after turn ${i}`);
  }
  assert(m.counters.userTurns === 10, "10 user turns");
  assert(m.counters.responsesSpoken === 11, "11 spoken responses (greeting + 10)");
  assert(m.counters.missedResponses === 0, "no missed responses");
  assert(m.counters.duplicateTtsBlocked === 0, "no duplicate TTS");
  assert(events.filter((e) => e === "tts_started").length === 11, "tts_started exactly 11 times");
  const spoken = m.turns.filter((t) => t.outcome === "spoken");
  assert(spoken.length === 11, "11 turns marked spoken");
  assert(spoken.every((t) => t.marks.firstAudioAt !== null && t.marks.transcriptAt !== null || t.turnId === 0), "timing marks recorded");
  const t5 = m.turns.find((t) => t.turnId === 5)!;
  assert(t5.marks.userSpeechStartAt !== null && t5.marks.userSpeechEndAt !== null, "mic marks adopted by turn");
  assert(t5.marks.firstAudioAt! - t5.marks.transcriptAt! === 400, "transcript→first audio measured");
  // user can still speak after the last response
  m.micStart();
  assert(m.state === "user_speaking", "mic still active after 10 turns");
  m.end();
  assert(m.state === "ended" && !m.transition("listening"), "ended is terminal");
}

// ------------------------------------------------------ Deepgram frame handling
{
  // `ws` delivers TEXT frames as Buffer with isBinary=false — the production bug treated these as audio.
  const flushed = classifyDeepgramFrame(Buffer.from('{"type":"Flushed","speech_id":"x"}'), false);
  assert(flushed.kind === "control" && flushed.msg.type === "Flushed", "text frame (Buffer) is control, not audio");
  const audio = classifyDeepgramFrame(Buffer.from([1, 2, 3, 4]), true);
  assert(audio.kind === "audio" && audio.data.length === 4, "binary frame is audio");
  const str = classifyDeepgramFrame('{"type":"SpeechMetadata","audio_duration_ms":1200}', false);
  assert(str.kind === "control" && str.msg.audio_duration_ms === 1200, "string frame parsed");
}

// --------------------------------------- LabDeepgramTts against a fake v2 socket
{
  class FakeSocket extends EventEmitter {
    readyState = 1; // OPEN
    sent: string[] = [];
    closed = false;
    send(raw: string) {
      this.sent.push(raw);
      const msg = JSON.parse(raw) as { type: string };
      if (msg.type === "Flush") {
        // Real ordering observed: SpeechStarted, Flushed, audio..., SpeechMetadata
        setTimeout(() => this.text({ type: "SpeechStarted", speech_id: "s1" }), 5);
        setTimeout(() => this.text({ type: "Flushed", speech_id: "s1" }), 6);
        for (let i = 0; i < 5; i++) {
          setTimeout(() => this.emit("message", Buffer.alloc(160, 0xff), true), 20 + i * 10);
        }
        setTimeout(() => this.text({ type: "SpeechMetadata", speech_id: "s1", audio_duration_ms: 100 }), 90);
      }
      if (msg.type === "Interrupt") {
        // in-flight bytes still arrive, then SpeechInterrupted
        setTimeout(() => this.emit("message", Buffer.alloc(160, 0xff), true), 2);
        setTimeout(() => this.text({ type: "SpeechInterrupted", audio_played_ms: 40 }), 5);
      }
    }
    text(obj: Record<string, unknown>) {
      this.emit("message", Buffer.from(JSON.stringify(obj)), false); // text frame as Buffer!
    }
    close() {
      this.closed = true;
    }
  }
  const cfg = { apiKey: "x", model: "flux-hannah-en", speed: 1, expressivity: 0, timeoutMs: 2000 };

  await (async () => {
    const sock = new FakeSocket();
    const tts = new LabDeepgramTts(cfg, { connect: () => sock as unknown as LabTtsSocket, disableRest: true });
    let bytes = 0;
    let calls = 0;
    const res = await tts.speak("Hello there.", (b) => {
      bytes += b.length;
      calls += 1;
    });
    assert(res.status === "completed", `ws speak completes (got ${res.status} ${res.error ?? ""})`);
    assert(bytes === 800 && calls === 5, `exactly the 5 audio chunks, no JSON bytes as audio (bytes=${bytes})`);
    assert(res.audioDurationMs === 100 && res.transport === "websocket", "duration from SpeechMetadata, no REST");
    assert(sock.sent.filter((s) => s.includes('"Speak"')).length === 1, "exactly one Speak sent");

    // Second speak on the same socket must not replay the first one.
    let bytes2 = 0;
    const res2 = await tts.speak("Second.", (b) => {
      bytes2 += b.length;
    });
    assert(res2.status === "completed" && bytes2 === 800, "second speak independent");
    assert(sock.sent.filter((s) => s.includes('"Speak"')).length === 2, "two Speaks total");
  })();

  await (async () => {
    const sock = new FakeSocket();
    const tts = new LabDeepgramTts(cfg, { connect: () => sock as unknown as LabTtsSocket, disableRest: true });
    let bytes = 0;
    let cancelled = false;
    const p = tts.speak(
      "Long sentence to interrupt.",
      (b) => {
        bytes += b.length;
        if (bytes >= 320) cancelled = true; // caller's epoch changed after 2 chunks
      },
      () => cancelled
    );
    const res = await p;
    assert(res.status === "cancelled", `cancelled status (got ${res.status})`);
    assert(bytes <= 480, `audio stops immediately after cancel (bytes=${bytes})`);
    assert(sock.sent.some((s) => s.includes('"Interrupt"')), "Interrupt sent to Deepgram");
    assert(res.transport === "websocket", "never falls back to REST after audio was produced");
  })();
}

// ------------------------------------------------------------ static isolation
{
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
  const handler = read("voice-server/src/voice-lab-handler.ts");
  const tts = read("voice-server/src/voice-lab-tts.ts");
  const machine = read("voice-lab/turn-machine.ts");
  for (const [name, src] of [["handler", handler], ["tts", tts], ["machine", machine]] as const) {
    assert(!/from ["']\.\/twilio/.test(src) && !/twilio-stream-handler/.test(src), `${name}: no Twilio imports`);
    assert(!/from ["'][^"']*(prisma|\/db(\.js)?)["']/i.test(src) && !/prisma\.\w+\.(create|update|upsert|delete)/i.test(src), `${name}: no Prisma imports or writes`);
    assert(!/completeTwilioCall|bookAppointmentFromVoiceCall|appendTranscript/.test(src), `${name}: no production side effects`);
  }
  assert(
    handler.includes("gemini?.sendPcm16kBase64(pcm)") ||
      handler.includes("gemini?.sendPcm16kBase64(msg.pcm16kBase64)"),
    "mic audio forwarded continuously"
  );
  assert(!/if \(machine\.state[^\n]*sendPcm16kBase64/.test(handler), "audio forwarding is never gated on turn state");
  assert(handler.includes("machine.generationComplete("), "generationComplete is the authoritative output path");
  assert(handler.includes("mergeStreamingTranscript(agentBuf, text)"), "output chunks are merged, not blindly concatenated");
  assert(handler.includes("queueNote("), "system notes are queued so they cannot abort Gemini");
  assert(handler.includes("meta?.finished === false"), "partial transcripts (finished=false) do not finalize");
  assert(handler.includes("resolveVoiceLabLatencyPreset"), "lab latency presets");
  assert(handler.includes("applyLabLatencyMs"), "lab delay helper");
  assert(!handler.includes("speakAgent(agentBuf") , "no per-chunk / per-event speak paths remain");
  assert(handler.includes("vadSilenceMs,") && handler.includes("vadSilenceMs=${vadSilenceMs}"), "VAD passed to Gemini and logged");
  assert(!handler.includes("DeepgramTtsSession"), "lab does not use the shared TTS session with the REST re-speak fallback");
  assert(handler.includes("`[VOICE_LAB] session=${entry.session} turn=${entry.turn} response="), "structured [VOICE_LAB] logs");
  const client = read("src/app/voice-lab/voice-lab-client.tsx");
  assert(client.includes("if (startingRef.current || wsRef.current) return;"), "start is idempotent");
  assert(client.includes("audioEpoch < epochRef.current"), "browser discards stale-epoch audio");
  assert(client.includes('type: "mic", speaking: true') && client.includes('type: "mic", speaking: false'), "mic activity reported");
  assert(client.includes("USER PARTIAL") && client.includes("AI_SPOKEN") && client.includes("AI GENERATING"), "transcript kinds shown");
  const prod = read("voice-server/src/twilio-stream-handler.ts");
  assert(!prod.includes("voice-lab") && !prod.includes("turn-machine"), "production handler untouched by lab modules");
}

console.log("Voice lab pipeline verification passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
