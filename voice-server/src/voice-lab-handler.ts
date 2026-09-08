import type WebSocket from "ws";
import { AppointmentIntentTracker } from "./appointment-intent-tracker.js";
import { int16ToBuffer, mulawDecode, upsample8kTo16k } from "./audio.js";
import { getLiveModel, resolveGeminiLiveVoice } from "./config.js";
import { applyLabLatencyMs, labInboundDelayMs, maybeSimulateNetworkDelay } from "./voice-network-sim.js";
import { detectsAgentFarewell, detectsEndCallIntent } from "./end-call-intent.js";
import { GeminiLiveSession } from "./gemini-live.js";
import {
  isInternalTranscript,
  mergeStreamingTranscript,
} from "./transcript-cleanup.js";
import {
  detectsSlowSpeechRequest,
  slowSpeechSystemNudge,
  type SpeechPace,
} from "./speech-pace.js";
import { loadDeepgramTtsConfig, type DeepgramTtsConfig } from "./tts/deepgram-tts.js";
import { prepareSpokenAgentText } from "./tts/spoken-guard.js";
import { isLikelyUnsupportedForFluxEnglish, toSpeakableAgentText } from "./tts/speakable-text.js";
import { trySimulateLabBooking } from "./voice-lab-booking.js";
import { buildVoiceLabSystemInstruction } from "./voice-lab-prompt.js";
import { LabDeepgramTts } from "./voice-lab-tts.js";
import {
  resolveVoiceLabPromptVariant,
  VOICE_LAB_PROMPT_LABELS,
  type VoiceLabPromptVariant,
} from "../../voice-lab/lab-prompt.js";
import { RepetitionTracker } from "../../voice-lab/repetition.js";
import {
  VoiceLabTurnMachine,
  type LabFinalizedResponse,
  type LabLogEvent,
  type LabTurnRecord,
} from "../../voice-lab/turn-machine.js";
import {
  clampLabTtsSpeed,
  clampLabVadMs,
  countWords,
  isVoiceLabEnabled,
  resolveVoiceLabLatencyPreset,
  type VoiceLabLatencyProfile,
} from "../../voice-lab/config.js";
import { getVoiceLabScenario } from "../../voice-lab/scenarios.js";
import { scoreVoiceLabSession } from "../../voice-lab/scoring.js";
import type {
  VoiceLabAppointmentStatus,
  VoiceLabLatencyMarks,
  VoiceLabStructuredLog,
  VoiceLabTimelineEvent,
  VoiceLabTranscriptRow,
  VoiceLabTurnSummary,
} from "../../voice-lab/types.js";
import { validateLabAgentReply } from "../../voice-lab/validation.js";

type LabClientMsg = {
  type?: string;
  scenarioId?: string;
  promptVariant?: string;
  vadSilenceMs?: number;
  ttsSpeed?: number;
  latencyPreset?: string;
  pcm16kBase64?: string;
  speaking?: boolean;
  level?: number;
};

/** Barge-in this soon after AI audio started most likely means the AI cut the user off. */
const EARLY_CUTOFF_WINDOW_MS = 1500;
/** Transcript arrived but Gemini never started generating. */
const GENERATION_WATCHDOG_MS = 2500;
/** Mic went silent but neither transcript nor generation arrived (beyond VAD). */
const MIC_SILENCE_WATCHDOG_EXTRA_MS = 3000;
/** Finalized response held while the mic still reports speech — cap, then speak anyway. */
const DEFERRED_SPEAK_CAP_MS = 1200;
/** Generation finalized but TTS produced no audio. */
const TTS_START_WATCHDOG_MS = 4000;

function labDeepgramConfig(speed: number): DeepgramTtsConfig | null {
  const base = loadDeepgramTtsConfig();
  if (!base) return null;
  return { ...base, speed: clampLabTtsSpeed(speed) };
}

function isoNow() {
  return new Date().toISOString();
}

function marksToLatency(rec: LabTurnRecord): VoiceLabLatencyMarks {
  const m = rec.marks;
  return {
    userSpeechStartAt: m.userSpeechStartAt,
    userFinishedAt: m.userSpeechEndAt ?? m.transcriptAt,
    finalTranscriptAt: m.transcriptAt,
    geminiStartedAt: m.generationStartedAt,
    firstResponseTextAt: m.firstResponseTextAt,
    agentTextAt: m.generationCompleteAt,
    ttsStartedAt: m.ttsStartedAt,
    firstAudioAt: m.firstAudioAt,
    aiFinishedAt: m.aiEndAt,
  };
}

function summarizeTurn(rec: LabTurnRecord): VoiceLabTurnSummary {
  const m = rec.marks;
  return {
    turnId: rec.turnId,
    userText: rec.userText,
    aiText: rec.aiText,
    spokenText: rec.spokenText,
    outcome: rec.outcome,
    transcriptToFirstAudioMs:
      m.transcriptAt && m.firstAudioAt ? m.firstAudioAt - m.transcriptAt : null,
    micEndToFirstAudioMs:
      m.userSpeechEndAt && m.firstAudioAt ? m.firstAudioAt - m.userSpeechEndAt : null,
    aiSpeakingMs: m.firstAudioAt && m.aiEndAt ? m.aiEndAt - m.firstAudioAt : null,
  };
}

/**
 * Local microphone lab. No Twilio, no Prisma, no calendar, no CRM.
 *
 * Authoritative flow (see voice-lab/turn-machine.ts):
 *   mic → PCM16k → Gemini realtimeInput
 *   Gemini inputTranscription (complete text, no `finished` flag) → user turn finalized
 *   Gemini outputTranscription chunks → accumulated (never spoken per chunk)
 *   Gemini generationComplete → ONE finalized response → ONE Deepgram speak → epoch-tagged audio
 *   turnComplete → recovery only (idempotent by responseId)
 */
export async function handleVoiceLabSocket(ws: WebSocket) {
  if (!isVoiceLabEnabled()) {
    ws.close(1008, "voice lab disabled");
    return;
  }

  const startedAt = Date.now();
  const machine = new VoiceLabTurnMachine({ log: (e) => onMachineLog(e) });
  const appt = new AppointmentIntentTracker();
  const repetition = new RepetitionTracker();
  const rows: VoiceLabTranscriptRow[] = [];
  const timeline: VoiceLabTimelineEvent[] = [];
  const logs: VoiceLabStructuredLog[] = [];
  const validation: string[] = [];
  const estimatedSpeakMs: number[] = [];

  let gemini: GeminiLiveSession | null = null;
  let tts: LabDeepgramTts | null = null;
  let closed = false;
  let started = false;
  let openingRequested = false;
  let agentBuf = "";
  let leadPartial = "";
  let speechPace: SpeechPace = "normal";
  let appointmentStatus: VoiceLabAppointmentStatus = "none";
  let vadSilenceMs = 900;
  let ttsSpeed = 1;
  let latencyProfile: VoiceLabLatencyProfile = resolveVoiceLabLatencyPreset("normal");
  let promptVariant: VoiceLabPromptVariant = "lab";
  let scenario = getVoiceLabScenario("general_sdr");
  let earlyCutoffs = 0;
  let staleAudioDropped = 0;
  let lastCoaching: string | null = null;
  let framesReceived = 0;
  let bytesReceived = 0;
  let lastFrameAt = 0;
  let recoveryNudgedTurn: number | null = null;
  let spokenWordTotal = 0;
  /**
   * [INTERNAL] notes for Gemini (coaching, booking result, pace). Sending clientContent while
   * Gemini is generating aborts that generation (surfaces as `interrupted`) and, with
   * turnComplete=false, makes the server wait for more input → missed responses. So notes are
   * queued here and flushed only when the model is idle.
   */
  const pendingNotes: string[] = [];

  let generationWatchdog: ReturnType<typeof setTimeout> | null = null;
  let micWatchdog: ReturnType<typeof setTimeout> | null = null;
  let deferredCap: ReturnType<typeof setTimeout> | null = null;
  let ttsWatchdog: ReturnType<typeof setTimeout> | null = null;
  let statsTimer: ReturnType<typeof setInterval> | null = null;

  // ------------------------------------------------------------------ io

  const send = (payload: Record<string, unknown>) => {
    if (closed || ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(payload));
  };

  const event = (label: string) => {
    const item: VoiceLabTimelineEvent = { at: isoNow(), t: Date.now() - startedAt, label };
    timeline.push(item);
    send({ type: "timeline", event: item });
  };

  function onMachineLog(e: LabLogEvent) {
    const entry: VoiceLabStructuredLog = {
      t: Date.now() - startedAt,
      session: machine.sessionId,
      turn: e.turn,
      response: e.response,
      epoch: e.epoch,
      state: e.state,
      event: e.event,
      detail: e.detail,
    };
    logs.push(entry);
    console.info(
      `[VOICE_LAB] session=${entry.session} turn=${entry.turn} response=${entry.response ?? "-"} epoch=${entry.epoch} state=${entry.state} event=${entry.event} t=${entry.t}${entry.detail ? ` detail=${JSON.stringify(entry.detail)}` : ""}`
    );
    send({ type: "log", log: entry });
    if (e.event === "state") {
      send({ type: "state", turnState: machine.state, epoch: machine.epoch, turnId: machine.turnId });
    }
    if (e.event === "VOICE_LAB_WARNING") event(`⚠ ${e.detail}`);
  }

  const labLog = (eventName: string, detail?: string) =>
    onMachineLog({
      event: eventName,
      turn: machine.turnId,
      response: null,
      epoch: machine.epoch,
      state: machine.state,
      detail,
    });

  const pushRow = (row: VoiceLabTranscriptRow) => {
    if (!row.interim) rows.push(row);
    send({ type: "transcript", row });
  };

  const connections = (extra?: Record<string, unknown>) => {
    send({
      type: "connections",
      microphone: framesReceived > 0,
      websocket: ws.readyState === ws.OPEN,
      gemini: Boolean(gemini),
      deepgram: Boolean(tts),
      playback: true,
      ...extra,
    });
  };

  const clearTimer = (t: ReturnType<typeof setTimeout> | null) => {
    if (t) clearTimeout(t);
    return null;
  };

  const geminiIdle = () =>
    machine.state === "listening" && machine.speaking === null && !machine.hasOpenGeneration;

  const queueNote = (text: string) => {
    if (!text) return;
    if (pendingNotes[pendingNotes.length - 1] === text) return;
    pendingNotes.push(text);
    labLog("system_note_queued", text.slice(0, 80));
    flushNotesIfIdle();
  };

  const flushNotesIfIdle = () => {
    if (closed || !gemini || !pendingNotes.length || !geminiIdle()) return;
    const note = pendingNotes.join(" ");
    pendingNotes.length = 0;
    labLog("system_note_sent", note.slice(0, 120));
    gemini.notifySystem(note, { generate: false });
  };

  // ------------------------------------------------------------ teardown

  const teardown = () => {
    if (closed) return;
    closed = true;
    generationWatchdog = clearTimer(generationWatchdog);
    micWatchdog = clearTimer(micWatchdog);
    deferredCap = clearTimer(deferredCap);
    ttsWatchdog = clearTimer(ttsWatchdog);
    if (statsTimer) clearInterval(statsTimer);
    tts?.close();
    tts = null;
    gemini?.close();
    gemini = null;
    try {
      if (ws.readyState === ws.OPEN) ws.close();
    } catch {
      /* ignore */
    }
  };

  const finishReport = () => {
    machine.end();
    const aiFinals = rows.filter((r) => r.kind === "AI_GENERATED");
    const speakTotal = estimatedSpeakMs.reduce((a, b) => a + b, 0);
    const wordTotal = aiFinals.reduce((n, r) => n + countWords(r.text), 0);
    const latency = machine.turns.filter((t) => t.turnId > 0 || t.responseId !== null).map(marksToLatency);
    const score = scoreVoiceLabSession({
      rows,
      latency,
      interruptions: machine.counters.bargeIns,
      earlyCutoffs,
      repetition: repetition.summary,
      missedResponses: machine.counters.missedResponses,
      duplicateResponsesBlocked:
        machine.counters.duplicateResponsesBlocked + machine.counters.duplicateTtsBlocked,
      appointmentStatus,
      validation,
      estimatedSpeakMs,
    });
    send({
      type: "ended",
      report: {
        timestamp: isoNow(),
        sessionId: machine.sessionId,
        scenario: scenario.id,
        promptVariant,
        promptLabel: VOICE_LAB_PROMPT_LABELS[promptVariant],
        vadSilenceMs,
        ttsSpeed,
        userTranscript: rows.filter((r) => r.kind === "USER_FINAL").map((r) => r.text),
        aiTranscript: aiFinals.map((r) => r.text),
        turns: machine.turns.map(summarizeTurn),
        timeline,
        logs,
        latency,
        speech: {
          responseWordCounts: aiFinals.map((r) => countWords(r.text)),
          estimatedWpm:
            wordTotal > 0 && speakTotal > 200 ? Math.round((wordTotal / speakTotal) * 60000) : null,
          estimatedSpeakMs,
        },
        interruptions: machine.counters.bargeIns,
        earlyCutoffs,
        repetition: repetition.summary,
        counters: { ...machine.counters, staleAudioDroppedByServer: staleAudioDropped },
        duplicateResponsesBlocked:
          machine.counters.duplicateResponsesBlocked + machine.counters.duplicateTtsBlocked,
        appointmentStatus,
        validation,
        score,
      },
    });
  };

  // ------------------------------------------------------------ barge-in

  /** Run a machine barge-in and apply its side effects (cancel TTS, clear browser audio). */
  const bargeIn = (
    source: "mic" | "gemini",
    run: () => { cancelTts: boolean; clearAudio: boolean; epoch: number }
  ) => {
    const speakingBefore = machine.speaking;
    const firstAudioAt = speakingBefore
      ? machine.turns.find((t) => t.turnId === speakingBefore.turnId)?.marks.firstAudioAt ?? null
      : null;
    const result = run();
    if (result.cancelTts) {
      tts?.interrupt();
      agentBuf = "";
      leadPartial = "";
      if (firstAudioAt !== null && Date.now() - firstAudioAt < EARLY_CUTOFF_WINDOW_MS) {
        earlyCutoffs += 1;
        event(`Barge-in ${Date.now() - firstAudioAt}ms after AI audio started (${source}) — likely AI cut user off`);
      } else {
        event(`Barge-in (${source}) — AI audio cancelled`);
      }
    }
    if (result.clearAudio) {
      deferredCap = clearTimer(deferredCap);
      agentBuf = "";
      leadPartial = "";
      send({ type: "clear-audio", epoch: result.epoch, count: machine.counters.bargeIns });
      send({ type: "bargein", epoch: result.epoch, cancelTts: result.cancelTts, count: machine.counters.bargeIns });
    }
    return result;
  };

  // ----------------------------------------------------------------- tts

  const speakResponse = async (response: LabFinalizedResponse, opts?: { system?: boolean }) => {
    deferredCap = clearTimer(deferredCap);
    const speakable = toSpeakableAgentText(response.text);
    if (!speakable || isLikelyUnsupportedForFluxEnglish(speakable)) {
      labLog("response_unspeakable", `response=${response.responseId}`);
      machine.ttsFinished(response, { completed: false, failed: true });
      return;
    }
    const prepared = opts?.system
      ? speakable
      : prepareSpokenAgentText(speakable, {
          hasBooked: appointmentStatus === "BOOKED_SIMULATED",
          dateHint: appt.dateHint,
          timeHint: appt.timeHint,
        });
    if (!prepared) {
      labLog("response_unspeakable", `response=${response.responseId} (spoken guard)`);
      machine.ttsFinished(response, { completed: false, failed: true });
      return;
    }

    const gate = machine.ttsStart(response);
    if (!gate.accepted) {
      event(`TTS ignored: ${gate.reason}`);
      return;
    }

    let finishedTts = false;
    const finishTts = (result: { completed: boolean; spokenText?: string; failed?: boolean; audioDurationMs?: number }) => {
      if (finishedTts) return;
      finishedTts = true;
      machine.ttsFinished(response, result);
    };

    appt.noteAgent(prepared);
    for (const found of repetition.noteAgentTurn(prepared)) {
      event(found);
      validation.push(`heuristic: ${found}`);
    }
    pushRow({
      speaker: "AI",
      kind: "AI_GENERATED",
      text: prepared,
      at: isoNow(),
      turnId: response.turnId,
      responseId: response.responseId,
    });
    const rec = machine.turns.find((t) => t.turnId === response.turnId);
    const lastUser = rec?.userText || "";
    validation.push(
      ...validateLabAgentReply({
        userText: lastUser,
        agentText: prepared,
        hasSimulatedBook: appointmentStatus === "BOOKED_SIMULATED",
      }).map((issue) => `heuristic: ${issue}`)
    );
    send({ type: "metrics", wordCount: countWords(prepared), turnId: response.turnId });

    try {
      if (!tts) {
        const cfg = labDeepgramConfig(ttsSpeed);
        if (!cfg) {
          send({ type: "error", source: "deepgram", message: "Deepgram failed (missing API key)" });
          finishTts({ completed: false, failed: true });
          return;
        }
        tts = new LabDeepgramTts(cfg);
      }
      const session = tts;
      const epoch = response.epoch;
      const isCancelled = () => closed || !machine.isAudioEpochCurrent(epoch);
      let gotFirstAudio = false;
      const ttsStartedAt = Date.now();
      ttsWatchdog = clearTimer(ttsWatchdog);
      ttsWatchdog = setTimeout(() => {
        if (!gotFirstAudio && !isCancelled()) {
          labLog("VOICE_LAB_WARNING", `tts produced no audio within ${TTS_START_WATCHDOG_MS}ms for response ${response.responseId}`);
        }
      }, TTS_START_WATCHDOG_MS);

      await applyLabLatencyMs(latencyProfile.ttsMs);
      if (isCancelled()) {
        staleAudioDropped += 1;
        finishTts({ completed: false, spokenText: prepared });
        return;
      }

      const result = await session.speak(
        prepared,
        (mulaw) => {
          if (isCancelled()) {
            staleAudioDropped += 1;
            return;
          }
          if (!gotFirstAudio) {
            gotFirstAudio = true;
            machine.ttsAudioStarted(response);
            const m = rec?.marks;
            send({
              type: "latency",
              turnId: response.turnId,
              userFinishedToAudioMs:
                m?.transcriptAt && m.firstAudioAt ? m.firstAudioAt - m.transcriptAt : null,
              micEndToAudioMs:
                m?.userSpeechEndAt && m.firstAudioAt ? m.firstAudioAt - m.userSpeechEndAt : null,
              geminiMs:
                m?.transcriptAt && m.generationCompleteAt ? m.generationCompleteAt - m.transcriptAt : null,
              ttsMs: m?.ttsStartedAt && m.firstAudioAt ? m.firstAudioAt - m.ttsStartedAt : null,
              firstByteMs: Date.now() - ttsStartedAt,
            });
          }
          const pcm16k = upsample8kTo16k(mulawDecode(mulaw));
          const payload = {
            type: "audio" as const,
            epoch,
            responseId: response.responseId,
            pcm16kBase64: int16ToBuffer(pcm16k).toString("base64"),
          };
          const outDelay = latencyProfile.outboundMs;
          if (outDelay > 0) {
            setTimeout(() => send(payload), outDelay);
          } else {
            send(payload);
          }
        },
        isCancelled
      );
      ttsWatchdog = clearTimer(ttsWatchdog);

      if (result.status === "failed") {
        send({ type: "error", source: "deepgram", message: `Deepgram failed: ${result.error || "unknown"}` });
        finishTts({ completed: false, failed: true });
        return;
      }
      const completed = result.status === "completed" && !isCancelled();
      const spokenText = completed
        ? prepared
        : `${prepared} — interrupted after ${result.audioDurationMs}ms`;
      if (completed) {
        estimatedSpeakMs.push(result.audioDurationMs);
        spokenWordTotal += countWords(prepared);
      }
      pushRow({
        speaker: "AI",
        kind: "AI_SPOKEN",
        text: spokenText,
        at: isoNow(),
        turnId: response.turnId,
        responseId: response.responseId,
        interim: !completed,
      });
      send({
        type: "deepgram-timing",
        transport: result.transport,
        firstAudioMs: result.firstAudioMs,
        audioDurationMs: result.audioDurationMs,
        status: result.status,
        speakMs: result.audioDurationMs,
      });
      finishTts({ completed, spokenText, audioDurationMs: result.audioDurationMs });
      send({ type: "audio-end", epoch, responseId: response.responseId, audioDurationMs: result.audioDurationMs });
      flushNotesIfIdle();

      if (completed && detectsAgentFarewell(prepared) && rec?.userText && detectsEndCallIntent(rec.userText)) {
        event("Agent farewell after user goodbye — ending session");
        setTimeout(() => {
          if (closed) return;
          finishReport();
          teardown();
        }, Math.min(6000, result.audioDurationMs + 400));
      }
    } catch (error) {
      labLog("VOICE_LAB_WARNING", `tts threw: ${error instanceof Error ? error.message : "unknown"}`);
      finishTts({ completed: false, failed: true });
    } finally {
      ttsWatchdog = clearTimer(ttsWatchdog);
      if (!finishedTts) finishTts({ completed: false, failed: true });
    }
  };

  const speakOrDefer = (
    outcome: { speak: LabFinalizedResponse | null; deferred: boolean; reason: string },
    source: string
  ) => {
    generationWatchdog = clearTimer(generationWatchdog);
    if (outcome.speak) {
      void speakResponse(outcome.speak);
      return;
    }
    if (outcome.deferred) {
      event("AI reply held: user still speaking");
      deferredCap = clearTimer(deferredCap);
      deferredCap = setTimeout(() => {
        const r = machine.releaseDeferred();
        if (r) void speakResponse(r);
      }, DEFERRED_SPEAK_CAP_MS);
      return;
    }
    if (outcome.reason !== "no_open_generation") event(`Model event ignored (${source}): ${outcome.reason}`);
  };

  // ------------------------------------------------------- user turn logic

  const onUserFinal = (leadText: string, turnId: number) => {
    pushRow({ speaker: "USER", kind: "USER_FINAL", text: leadText, at: isoNow(), turnId });
    event(`USER_FINAL: "${leadText}"`);
    micWatchdog = clearTimer(micWatchdog);
    generationWatchdog = clearTimer(generationWatchdog);
    generationWatchdog = setTimeout(() => {
      if (closed) return;
      if (machine.noteGenerationMissing("after_transcript")) {
        send({ type: "warning", message: "user turn finalized but generation did not start" });
        if (gemini && recoveryNudgedTurn !== turnId) {
          recoveryNudgedTurn = turnId;
          labLog("recovery_nudge", `asking Gemini to reply to turn ${turnId}`);
          gemini.notifySystem(
            "The lead just spoke and is waiting. Reply now in one short sentence.",
            { generate: true }
          );
        }
      }
    }, GENERATION_WATCHDOG_MS);

    if (detectsSlowSpeechRequest(leadText) && speechPace !== "slow") {
      speechPace = "slow";
      queueNote(slowSpeechSystemNudge());
    }

    appt.noteLead(leadText);
    if (appt.isFlowActive) appointmentStatus = "collecting";
    if (appt.appointmentStatus === "awaiting_confirmation") appointmentStatus = "confirming";

    const booked = trySimulateLabBooking(appt, leadText);
    if (booked.status === "BOOKED_SIMULATED") {
      appointmentStatus = "BOOKED_SIMULATED";
      queueNote(
        "[INTERNAL] booking_ok. Simulated local test only. Already spoken. Do not claim a real invite."
      );
      const sys = machine.systemResponse(booked.spoken);
      if (sys) void speakResponse(sys, { system: true });
    }
    send({ type: "appointment", status: appointmentStatus, simulated: true });

    if (detectsEndCallIntent(leadText)) {
      if (appt.isFlowActive && appointmentStatus !== "BOOKED_SIMULATED") {
        queueNote(appt.coachingHint() || "[INTERNAL] appt=continue. Meeting is not goodbye.");
      } else {
        event("Goodbye detected — waiting for AI farewell");
      }
      return;
    }
    if (appt.isFlowActive) {
      const hint = appt.coachingHint();
      if (hint && hint !== lastCoaching) {
        lastCoaching = hint;
        queueNote(hint);
      }
    }
  };

  // ---------------------------------------------------------------- gemini

  const startGemini = async () => {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      send({ type: "error", source: "gemini", message: "Gemini disconnected (missing API key)" });
      return;
    }
    const dgCfg = labDeepgramConfig(ttsSpeed);
    if (dgCfg) {
      tts = new LabDeepgramTts(dgCfg);
      void tts.warmup();
    } else {
      send({ type: "error", source: "deepgram", message: "Deepgram failed (missing API key)" });
    }
    labLog("gemini_connecting", `model=${getLiveModel()} vadSilenceMs=${vadSilenceMs}`);

    gemini = new GeminiLiveSession({
      apiKey,
      model: getLiveModel(),
      voice: resolveGeminiLiveVoice(),
      // Only the base prompt differs between A/B variants; everything else is identical.
      systemInstruction: buildVoiceLabSystemInstruction(scenario, promptVariant),
      responseModalities: ["AUDIO"],
      vadSilenceMs,
      handlers: {
        onSetupComplete: () => {
          event(`Gemini connected (vadSilenceMs=${vadSilenceMs})`);
          connections({ gemini: true });
          if (openingRequested) {
            labLog("opening_ignored", "already requested for this session");
            return;
          }
          openingRequested = true;
          machine.openingRequested();
          gemini?.requestOpening();
          labLog("opening_sent", "[EVENT:call_answered] once");
        },
        onAudioPcm24kBase64: () => {
          /* Deepgram speaks; Gemini native audio is dropped */
        },
        onInterrupted: () => {
          bargeIn("gemini", () => machine.interrupted());
        },
        onInputTranscriptInterim: (text) => {
          if (isInternalTranscript(text)) return;
          leadPartial = mergeStreamingTranscript(leadPartial, text);
          pushRow({ speaker: "USER", kind: "USER_PARTIAL", text: leadPartial, interim: true, at: isoNow() });
          labLog("input_transcript_partial", `"${leadPartial}"`);
          event(`USER_PARTIAL: "${leadPartial}"`);
        },
        onInputTranscript: (text, meta) => {
          if (isInternalTranscript(text)) {
            labLog("input_transcript_internal_ignored", `"${text}"`);
            return;
          }
          const merged = mergeStreamingTranscript(leadPartial, text);
          leadPartial = merged;
          labLog(
            "input_transcript_received",
            `finished=${String(meta?.finished)} "${text}"`
          );
          // This Live model usually omits `finished`. Treat undefined as a complete utterance.
          // finished === false is a true partial and must not start a turn.
          if (meta?.finished === false) {
            pushRow({ speaker: "USER", kind: "USER_PARTIAL", text: merged, interim: true, at: isoNow() });
            labLog("input_transcript_partial", `"${merged}"`);
            event(`USER_PARTIAL: "${merged}"`);
            return;
          }
          leadPartial = "";
          const r = machine.userTranscript(merged);
          if (r.duplicate) return;
          onUserFinal(merged.replace(/\s+/g, " ").trim(), r.turnId);
        },
        onOutputTranscript: (text) => {
          // Merge cumulative AND incremental chunks. Never speak per chunk.
          // gemini-live also forwards modelTurn.parts[].text here — merge drops duplicates.
          agentBuf = mergeStreamingTranscript(agentBuf, text);
          const merged = agentBuf;
          const g = machine.generationText(merged);
          if (g.newGeneration) {
            generationWatchdog = clearTimer(generationWatchdog);
            micWatchdog = clearTimer(micWatchdog);
            labLog("gemini_generation_started", `response=${g.responseId}`);
          }
          pushRow({
            speaker: "AI",
            kind: "AI_GENERATING",
            text: merged,
            interim: true,
            at: isoNow(),
            turnId: g.turnId,
            responseId: g.responseId,
          });
        },
        onGenerationComplete: () => {
          const text = agentBuf.replace(/\s+/g, " ").trim();
          agentBuf = "";
          speakOrDefer(machine.generationComplete(text), "generation_complete");
        },
        onTurnComplete: () => {
          const text = agentBuf.replace(/\s+/g, " ").trim();
          const r = machine.turnComplete(text);
          if (r.recovered) {
            agentBuf = "";
            speakOrDefer(r, "turn_complete_recovery");
          }
        },
        onError: (message) => {
          send({ type: "error", source: "gemini", message: `Gemini disconnected: ${message}` });
          labLog("gemini_error", message);
        },
      },
    });
    await gemini.connect();
  };

  // ------------------------------------------------------------- messages

  ws.on("message", (raw) => {
    let msg: LabClientMsg;
    try {
      msg = JSON.parse(raw.toString()) as LabClientMsg;
    } catch {
      return;
    }

    if (msg.type === "start") {
      if (started) {
        labLog("start_ignored", "session already started on this socket");
        send({ type: "warning", message: "start ignored: session already active" });
        return;
      }
      started = true;
      scenario = getVoiceLabScenario(msg.scenarioId);
      promptVariant = resolveVoiceLabPromptVariant(msg.promptVariant);
      vadSilenceMs = clampLabVadMs(Number(msg.vadSilenceMs ?? 900));
      ttsSpeed = clampLabTtsSpeed(Number(msg.ttsSpeed ?? 1));
      latencyProfile = resolveVoiceLabLatencyPreset(msg.latencyPreset);
      machine.start();
      send({
        type: "ready",
        sessionId: machine.sessionId,
        scenario: scenario.id,
        promptVariant,
        promptLabel: VOICE_LAB_PROMPT_LABELS[promptVariant],
        vadSilenceMs,
        ttsSpeed,
        latencyPreset: latencyProfile.id,
        lab: "LOCAL VOICE LAB — NO TWILIO",
      });
      connections();
      event(`Session ${machine.sessionId} started — prompt: ${VOICE_LAB_PROMPT_LABELS[promptVariant]} — vadSilenceMs=${vadSilenceMs}`);
      statsTimer = setInterval(() => {
        send({
          type: "audio-stats",
          framesReceived,
          bytesReceived,
          lastFrameAgoMs: lastFrameAt ? Date.now() - lastFrameAt : null,
          forwardingToGemini: Boolean(gemini?.isAcceptingInput),
        });
      }, 1000);
      void startGemini().catch((error) => {
        send({
          type: "error",
          source: "gemini",
          message: error instanceof Error ? `Gemini disconnected: ${error.message}` : "Gemini disconnected",
        });
      });
      return;
    }

    if (msg.type === "audio" && msg.pcm16kBase64) {
      const pcm = msg.pcm16kBase64;
      framesReceived += 1;
      bytesReceived += pcm.length;
      lastFrameAt = Date.now();
      if (framesReceived === 1) {
        labLog("mic_audio_first_frame");
        connections();
      }
      void (async () => {
        await applyLabLatencyMs(labInboundDelayMs(latencyProfile));
        const delayed = await maybeSimulateNetworkDelay();
        if ((delayed > 0 || latencyProfile.inboundMs > 0) && framesReceived === 1) {
          event(
            `network sim inbound~${latencyProfile.inboundMs}ms jitter~${latencyProfile.jitterMs}ms envDelay=${delayed}ms (local only)`
          );
        }
        gemini?.sendPcm16kBase64(pcm);
      })();
      return;
    }

    if (msg.type === "mic") {
      if (msg.speaking) {
        bargeIn("mic", () => machine.micStart());
        micWatchdog = clearTimer(micWatchdog);
      } else {
        const r = machine.micStop();
        if (r.speak) void speakResponse(r.speak);
        micWatchdog = clearTimer(micWatchdog);
        micWatchdog = setTimeout(() => {
          if (closed) return;
          if (machine.noteGenerationMissing("after_mic_silence")) {
            send({ type: "warning", message: "mic activity ended but Gemini produced no transcript" });
          }
        }, vadSilenceMs + MIC_SILENCE_WATCHDOG_EXTRA_MS);
      }
      return;
    }

    if (msg.type === "bargein") {
      // Legacy client message: equivalent to mic speaking=true while AI is talking.
      bargeIn("mic", () => machine.micStart());
      return;
    }

    if (msg.type === "stop") {
      event("Session ended by user");
      finishReport();
      teardown();
    }
  });

  ws.on("close", () => {
    labLog("socket_closed");
    teardown();
  });
}
