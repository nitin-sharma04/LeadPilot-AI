import { isInternalTranscript, shouldSkipDuplicate } from "../voice-server/src/transcript-cleanup.js";

/**
 * LOCAL VOICE LAB ONLY — strict conversation state machine.
 *
 * Invariant: one finalized user turn → one accepted model response → one TTS playback.
 *
 * Why this exists (measured against gemini-3.1-flash-live-preview, Sept 2026):
 *  - Gemini Live sends `inputTranscription` ONCE per utterance, as the complete text, with
 *    NO `finished` flag, and it can arrive slightly AFTER the model's first output chunk.
 *    So a user turn is finalized by whichever arrives first: the transcript, or the start of
 *    a model generation. There is no reliable "partial" transcript stream from this model.
 *  - `generationComplete` is the single authoritative boundary where AI text becomes speakable.
 *    `turnComplete` is only a recovery path (idempotent by responseId).
 *  - Every barge-in bumps `epoch`; audio tagged with an older epoch is discarded.
 *  - Gemini often emits a SECOND generation after the opening greeting (same sentence).
 *    That echo is dropped by spoken-text identity, not by a sleep.
 */

export const VOICE_LAB_STATES = [
  "idle",
  "listening",
  "user_speaking",
  "user_turn_finalizing",
  "ai_thinking",
  "ai_speaking",
  "barge_in",
  "ended",
] as const;
export type VoiceLabMachineState = (typeof VOICE_LAB_STATES)[number];

/** Explicit allowed transitions. Anything else is a bug and is logged + refused. */
export const VOICE_LAB_TRANSITIONS: Record<VoiceLabMachineState, readonly VoiceLabMachineState[]> = {
  idle: ["listening", "ended"],
  listening: ["user_speaking", "ai_thinking", "ended"],
  user_speaking: ["user_turn_finalizing", "ended"],
  user_turn_finalizing: ["ai_thinking", "user_speaking", "listening", "ended"],
  ai_thinking: ["ai_speaking", "barge_in", "listening", "user_speaking", "ended"],
  ai_speaking: ["listening", "barge_in", "ended"],
  barge_in: ["user_speaking", "listening", "ended"],
  ended: [],
};

export type LabTurnMarks = {
  userSpeechStartAt: number | null;
  userSpeechEndAt: number | null;
  transcriptAt: number | null;
  generationStartedAt: number | null;
  firstResponseTextAt: number | null;
  generationCompleteAt: number | null;
  ttsStartedAt: number | null;
  firstAudioAt: number | null;
  aiEndAt: number | null;
};

export type LabTurnRecord = {
  turnId: number;
  userText: string | null;
  responseId: number | null;
  aiText: string | null;
  spokenText: string | null;
  outcome: "pending" | "spoken" | "interrupted" | "superseded" | "missed" | "unspeakable" | "failed";
  /** A user turn receives at most one model generation. */
  modelGenerationSeen: boolean;
  marks: LabTurnMarks;
};

export type LabFinalizedResponse = {
  responseId: number;
  turnId: number;
  epoch: number;
  text: string;
};

export type LabLogEvent = {
  event: string;
  turn: number;
  response: number | null;
  epoch: number;
  state: VoiceLabMachineState;
  detail?: string;
};

export type LabCounters = {
  userTurns: number;
  responsesFinalized: number;
  responsesSpoken: number;
  duplicateResponsesBlocked: number;
  duplicateTranscriptsBlocked: number;
  duplicateTtsBlocked: number;
  missedResponses: number;
  partialResponseAttempts: number;
  supersededResponses: number;
  bargeIns: number;
  illegalTransitionsRefused: number;
  deferredSpeaks: number;
};

type OpenGeneration = {
  responseId: number;
  turnId: number;
  epoch: number;
  text: string;
  finalized: boolean;
};

const DUPLICATE_TRANSCRIPT_WINDOW_MS = 1500;

function emptyMarks(): LabTurnMarks {
  return {
    userSpeechStartAt: null,
    userSpeechEndAt: null,
    transcriptAt: null,
    generationStartedAt: null,
    firstResponseTextAt: null,
    generationCompleteAt: null,
    ttsStartedAt: null,
    firstAudioAt: null,
    aiEndAt: null,
  };
}

export function makeLabSessionId(): string {
  return `lab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class VoiceLabTurnMachine {
  readonly sessionId: string;
  state: VoiceLabMachineState = "idle";
  turnId = 0;
  epoch = 0;
  micSpeaking = false;
  readonly turns: LabTurnRecord[] = [];
  readonly counters: LabCounters = {
    userTurns: 0,
    responsesFinalized: 0,
    responsesSpoken: 0,
    duplicateResponsesBlocked: 0,
    duplicateTranscriptsBlocked: 0,
    duplicateTtsBlocked: 0,
    missedResponses: 0,
    partialResponseAttempts: 0,
    supersededResponses: 0,
    bargeIns: 0,
    illegalTransitionsRefused: 0,
    deferredSpeaks: 0,
  };
  /** Response currently being spoken (accepted by TTS). */
  speaking: LabFinalizedResponse | null = null;
  /** Finalized response held back because the mic reports the user is still talking. */
  deferred: LabFinalizedResponse | null = null;

  get hasOpenGeneration(): boolean {
    return this.open !== null && !this.open.finalized;
  }

  private responseSeq = 0;
  private open: OpenGeneration | null = null;
  private readonly finalizedResponseIds = new Set<number>();
  private readonly ttsStartedResponseIds = new Set<number>();
  private awaitingOpening = false;
  private lastTranscript: { text: string; at: number } | null = null;
  /** Last text actually handed to TTS — used to drop Gemini's duplicate opening generation. */
  private lastSpokenText: string | null = null;
  private readonly now: () => number;
  private readonly logger: (e: LabLogEvent) => void;

  constructor(opts?: { now?: () => number; log?: (e: LabLogEvent) => void; sessionId?: string }) {
    this.now = opts?.now ?? (() => Date.now());
    this.logger = opts?.log ?? (() => {});
    this.sessionId = opts?.sessionId ?? makeLabSessionId();
  }

  // ---------------------------------------------------------------- helpers

  private log(event: string, detail?: string) {
    this.logger({
      event,
      turn: this.turnId,
      response: this.open?.responseId ?? this.speaking?.responseId ?? null,
      epoch: this.epoch,
      state: this.state,
      detail,
    });
  }

  /** Returns false (and logs) if the transition is not allowed. */
  transition(next: VoiceLabMachineState): boolean {
    if (this.state === next) return true;
    if (!VOICE_LAB_TRANSITIONS[this.state].includes(next)) {
      this.counters.illegalTransitionsRefused += 1;
      this.log("illegal_transition_refused", `${this.state} -> ${next}`);
      return false;
    }
    const prev = this.state;
    this.state = next;
    this.log("state", `${prev} -> ${next}`);
    return true;
  }

  currentTurn(): LabTurnRecord {
    let rec = this.turns.find((t) => t.turnId === this.turnId);
    if (!rec) {
      rec = {
        turnId: this.turnId,
        userText: null,
        responseId: null,
        aiText: null,
        spokenText: null,
        outcome: "pending",
        modelGenerationSeen: false,
        marks: emptyMarks(),
      };
      this.turns.push(rec);
    }
    return rec;
  }

  private beginUserTurn(): LabTurnRecord {
    const prev = this.turns.find((t) => t.turnId === this.turnId);
    if (
      prev &&
      prev.turnId > 0 &&
      prev.userText &&
      prev.outcome === "pending" &&
      prev.responseId === null
    ) {
      prev.outcome = "missed";
      this.counters.missedResponses += 1;
      this.log("missed_response", `turn ${prev.turnId} never got a generation`);
    }
    this.turnId += 1;
    this.counters.userTurns += 1;
    const rec = this.currentTurn();
    return rec;
  }

  // ------------------------------------------------------------- lifecycle

  start() {
    if (this.state !== "idle") {
      this.log("start_ignored", "session already started");
      return false;
    }
    this.transition("listening");
    this.log("session_started");
    return true;
  }

  /** The greeting is turn 0: a generation with no user transcript. */
  openingRequested() {
    this.awaitingOpening = true;
    this.currentTurn();
    this.log("opening_requested");
  }

  end() {
    this.transition("ended");
    this.log("session_ended");
  }

  // ------------------------------------------------------------ microphone

  /** Browser mic energy crossed the speaking threshold. */
  micStart(): { cancelTts: boolean; clearAudio: boolean; epoch: number } {
    this.micSpeaking = true;
    const marks = this.pendingMarksForMic();
    if (marks.userSpeechStartAt === null) marks.userSpeechStartAt = this.now();
    this.log("user_audio_started");
    if (this.state === "ai_speaking") {
      return this.bargeIn("mic");
    }
    if (this.state === "listening" || this.state === "user_turn_finalizing") {
      this.transition("user_speaking");
    }
    // ai_thinking: Gemini already closed the user's turn; we only remember micSpeaking so a
    // finalized response is deferred rather than spoken over the user.
    return { cancelTts: false, clearAudio: false, epoch: this.epoch };
  }

  /** Browser mic energy dropped below threshold for the hangover period. */
  micStop(): { speak: LabFinalizedResponse | null } {
    this.micSpeaking = false;
    const marks = this.pendingMarksForMic();
    if (marks.userSpeechStartAt !== null && marks.userSpeechEndAt === null) {
      marks.userSpeechEndAt = this.now();
    }
    this.log("user_audio_finished");
    if (this.state === "user_speaking") this.transition("user_turn_finalizing");
    if (this.deferred && this.deferred.epoch === this.epoch) {
      const d = this.deferred;
      this.deferred = null;
      this.log("deferred_response_released", `response=${d.responseId}`);
      return { speak: d };
    }
    return { speak: null };
  }

  /**
   * Mic activity is only a hint (Gemini's VAD is authoritative). It is stashed here and
   * adopted by the next user turn when Gemini finalizes it (transcript or generation start).
   */
  private pendingMarks: LabTurnMarks | null = null;

  private pendingMarksForMic(): LabTurnMarks {
    if (!this.pendingMarks) this.pendingMarks = emptyMarks();
    return this.pendingMarks;
  }

  private adoptPendingMarks(rec: LabTurnRecord) {
    if (this.pendingMarks) {
      rec.marks.userSpeechStartAt = this.pendingMarks.userSpeechStartAt;
      rec.marks.userSpeechEndAt = this.pendingMarks.userSpeechEndAt;
      this.pendingMarks = null;
    }
  }

  // ---------------------------------------------------------------- gemini

  /**
   * Complete user utterance text from Gemini (no partials exist for this model).
   * Returns the turn the text was attached to and whether it opened a new turn.
   */
  userTranscript(rawText: string): { turnId: number; newTurn: boolean; duplicate: boolean } {
    const text = rawText.replace(/\s+/g, " ").trim();
    const now = this.now();
    if (!text) return { turnId: this.turnId, newTurn: false, duplicate: true };
    if (isInternalTranscript(text)) {
      this.log("input_transcript_internal_ignored", `"${text}"`);
      return { turnId: this.turnId, newTurn: false, duplicate: true };
    }

    // Case 1: a generation is open for the current turn and has no transcript yet →
    // this is the transcript for that utterance (Gemini sent output first).
    if (this.open && !this.open.finalized && this.open.turnId === this.turnId) {
      const rec = this.currentTurn();
      if (rec.userText === null) {
        rec.userText = text;
        rec.marks.transcriptAt = now;
        this.lastTranscript = { text, at: now };
        this.log("input_transcript_final", `attached to open generation: "${text}"`);
        return { turnId: rec.turnId, newTurn: false, duplicate: false };
      }
    }

    // Case 2: identical text within a short window → duplicate delivery.
    if (
      this.lastTranscript &&
      this.lastTranscript.text.toLowerCase() === text.toLowerCase() &&
      now - this.lastTranscript.at < DUPLICATE_TRANSCRIPT_WINDOW_MS
    ) {
      this.counters.duplicateTranscriptsBlocked += 1;
      this.log("input_transcript_duplicate_ignored", `"${text}"`);
      return { turnId: this.turnId, newTurn: false, duplicate: true };
    }

    // Case 3: new user turn. Gemini finalized it; we move straight to ai_thinking.
    const rec = this.beginUserTurn();
    this.adoptPendingMarks(rec);
    rec.userText = text;
    rec.marks.transcriptAt = now;
    if (rec.marks.userSpeechEndAt === null && rec.marks.userSpeechStartAt !== null) {
      rec.marks.userSpeechEndAt = now;
    }
    this.lastTranscript = { text, at: now };
    this.deferred = null;
    this.log("input_transcript_final", `"${text}"`);
    if (this.state === "user_speaking") this.transition("user_turn_finalizing");
    if (this.state === "barge_in") this.transition("listening");
    this.transition("ai_thinking");
    return { turnId: rec.turnId, newTurn: true, duplicate: false };
  }

  /** First model output (text/audio) for a generation. Idempotent while a generation is open. */
  generationStarted(): { responseId: number; turnId: number; newGeneration: boolean } {
    if (this.open && !this.open.finalized) {
      return { responseId: this.open.responseId, turnId: this.open.turnId, newGeneration: false };
    }
    const now = this.now();
    let rec: LabTurnRecord;
    if (this.awaitingOpening) {
      this.awaitingOpening = false;
      rec = this.currentTurn(); // turn 0
    } else {
      const cur = this.currentTurn();
      if (cur.userText !== null && !cur.modelGenerationSeen) {
        rec = cur; // transcript arrived first (or a system line already spoke for this turn)
      } else {
        rec = this.beginUserTurn(); // output arrived first; transcript will attach later
        this.adoptPendingMarks(rec);
        if (rec.marks.userSpeechEndAt === null && rec.marks.userSpeechStartAt !== null) {
          rec.marks.userSpeechEndAt = now;
        }
      }
    }
    if (this.deferred) {
      this.counters.supersededResponses += 1;
      this.log("deferred_response_superseded", `response=${this.deferred.responseId}`);
      const prev = this.turns.find((t) => t.responseId === this.deferred?.responseId);
      if (prev) prev.outcome = "superseded";
      this.deferred = null;
    }
    this.responseSeq += 1;
    this.open = {
      responseId: this.responseSeq,
      turnId: rec.turnId,
      epoch: this.epoch,
      text: "",
      finalized: false,
    };
    rec.modelGenerationSeen = true;
    // A system line (booking) already owns this turn's spoken response; keep its id.
    if (rec.responseId === null) rec.responseId = this.responseSeq;
    rec.marks.generationStartedAt = rec.marks.generationStartedAt ?? now;
    this.log("gemini_generation_started");
    if (this.state === "user_speaking") this.transition("user_turn_finalizing");
    if (this.state === "barge_in") this.transition("listening");
    this.transition("ai_thinking");
    return { responseId: this.responseSeq, turnId: rec.turnId, newGeneration: true };
  }

  /** Accumulate model text; opens a generation if none is open. */
  generationText(chunkMerged: string) {
    const g = this.generationStarted();
    if (!this.open) return g;
    if (this.open.text === "" && chunkMerged) {
      const rec = this.currentTurnById(this.open.turnId);
      if (rec && rec.marks.firstResponseTextAt === null) rec.marks.firstResponseTextAt = this.now();
    }
    this.open.text = chunkMerged;
    return g;
  }

  private currentTurnById(turnId: number) {
    return this.turns.find((t) => t.turnId === turnId);
  }

  /**
   * Gemini Live frequently re-emits the opening greeting as a second generation after the
   * first TTS finishes. Drop it. Substantial repeats of the last spoken sentence are also
   * dropped so "exactly one playback" holds even when generationComplete fires twice.
   */
  private isEchoOfLastSpoken(text: string, rec: LabTurnRecord | undefined): boolean {
    if (!this.lastSpokenText || !text) return false;
    const words = text.split(/\s+/).filter(Boolean).length;
    const same = shouldSkipDuplicate(this.lastSpokenText, text);
    if (!same) return false;
    if (rec && rec.userText === null) return true;
    if (rec && rec.turnId === 0) return true;
    return words >= 8;
  }

  /**
   * THE single authoritative point where AI text becomes speakable.
   * Returns speak=response when TTS must run now, deferred=true when the user is still
   * talking (released by micStop or the handler's cap timer), or a reason when nothing happens.
   */
  generationComplete(finalText?: string): {
    speak: LabFinalizedResponse | null;
    deferred: boolean;
    reason: string;
  } {
    return this.finalizeResponse("generation_complete", finalText);
  }

  /** Recovery only: if generationComplete never came, finalize on turnComplete (same responseId). */
  turnComplete(finalText?: string): {
    speak: LabFinalizedResponse | null;
    deferred: boolean;
    reason: string;
    recovered: boolean;
  } {
    if (this.open && !this.open.finalized) {
      this.log("VOICE_LAB_WARNING", "turn_complete arrived before generation_complete; finalizing as recovery");
      return { ...this.finalizeResponse("turn_complete_recovery", finalText), recovered: true };
    }
    this.log("gemini_turn_complete");
    return { speak: null, deferred: false, reason: "no_open_generation", recovered: false };
  }

  private finalizeResponse(source: string, finalText?: string) {
    if (!this.open) {
      this.counters.duplicateResponsesBlocked += 1;
      this.log("response_ignored", `${source}: no open generation`);
      return { speak: null, deferred: false, reason: "no_open_generation" };
    }
    const g = this.open;
    if (g.finalized || this.finalizedResponseIds.has(g.responseId)) {
      this.counters.duplicateResponsesBlocked += 1;
      this.log("response_duplicate_ignored", `${source}: response=${g.responseId}`);
      return { speak: null, deferred: false, reason: "response_already_finalized" };
    }
    g.finalized = true;
    this.finalizedResponseIds.add(g.responseId);
    this.counters.responsesFinalized += 1;
    const text = (finalText ?? g.text).replace(/\s+/g, " ").trim();
    const rec = this.currentTurnById(g.turnId);
    if (rec) {
      rec.aiText = text || null;
      rec.marks.generationCompleteAt = this.now();
    }
    this.log("gemini_generation_complete", `${source} response=${g.responseId} chars=${text.length}`);
    this.open = null;
    if (this.suppressedTurnId === g.turnId) {
      this.counters.supersededResponses += 1;
      this.log("response_suppressed_system_speech", `response=${g.responseId}`);
      return { speak: null, deferred: false, reason: "suppressed_by_system_speech" };
    }
    if (this.isEchoOfLastSpoken(text, rec)) {
      this.counters.duplicateResponsesBlocked += 1;
      if (rec && rec.userText === null) rec.outcome = "superseded";
      this.log("response_duplicate_text_ignored", `response=${g.responseId} "${text.slice(0, 80)}"`);
      if (this.state === "ai_thinking") this.transition("listening");
      return { speak: null, deferred: false, reason: "duplicate_spoken_text" };
    }
    if (g.epoch !== this.epoch) {
      // Already counted as a partial attempt when the barge-in happened.
      if (rec) rec.outcome = "interrupted";
      this.log("response_stale_epoch_dropped", `response=${g.responseId} epoch=${g.epoch} current=${this.epoch}`);
      return { speak: null, deferred: false, reason: "stale_epoch" };
    }
    if (!text) {
      if (rec) rec.outcome = "unspeakable";
      this.log("response_empty", `response=${g.responseId}`);
      if (this.state === "ai_thinking") this.transition("listening");
      return { speak: null, deferred: false, reason: "empty_text" };
    }
    const response: LabFinalizedResponse = {
      responseId: g.responseId,
      turnId: g.turnId,
      epoch: this.epoch,
      text,
    };
    if (this.micSpeaking && this.state === "user_speaking") {
      this.deferred = response;
      this.counters.deferredSpeaks += 1;
      this.log("response_deferred_user_speaking", `response=${g.responseId}`);
      return { speak: null, deferred: true, reason: "user_speaking" };
    }
    return { speak: response, deferred: false, reason: source };
  }

  /**
   * System speech (simulated booking confirmation) replaces Gemini's reply for the current
   * turn: returns a finalized response and suppresses the model generation for that turn.
   */
  systemResponse(text: string): LabFinalizedResponse | null {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return null;
    const rec = this.currentTurn();
    // Any Gemini generation for this turn (open now or arriving later) is dropped at finalize.
    this.suppressedTurnId = rec.turnId;
    this.deferred = null;
    this.responseSeq += 1;
    rec.responseId = this.responseSeq;
    rec.aiText = clean;
    rec.marks.generationStartedAt = rec.marks.generationStartedAt ?? this.now();
    rec.marks.generationCompleteAt = this.now();
    this.finalizedResponseIds.add(this.responseSeq);
    this.counters.responsesFinalized += 1;
    this.log("system_response_finalized", `response=${this.responseSeq}`);
    if (this.state === "user_speaking") this.transition("user_turn_finalizing");
    if (this.state === "barge_in") this.transition("listening");
    if (this.state !== "ai_speaking") this.transition("ai_thinking");
    return { responseId: this.responseSeq, turnId: rec.turnId, epoch: this.epoch, text: clean };
  }
  private suppressedTurnId: number | null = null;

  /** Handler cap timer: mic still "speaking" too long → speak anyway (mic may be noisy). */
  releaseDeferred(): LabFinalizedResponse | null {
    if (!this.deferred || this.deferred.epoch !== this.epoch) {
      this.deferred = null;
      return null;
    }
    const d = this.deferred;
    this.deferred = null;
    this.log("VOICE_LAB_WARNING", `deferred response ${d.responseId} released by cap; mic still active`);
    return d;
  }

  /** Gemini reported `interrupted`: the user is talking over the model. */
  interrupted(): { cancelTts: boolean; clearAudio: boolean; epoch: number } {
    return this.bargeIn("gemini");
  }

  private bargeIn(source: "mic" | "gemini") {
    this.counters.bargeIns += 1;
    this.epoch += 1;
    const cancelTts = this.speaking !== null;
    if (this.speaking) {
      const rec = this.currentTurnById(this.speaking.turnId);
      if (rec) {
        rec.outcome = "interrupted";
        rec.marks.aiEndAt = this.now();
      }
      this.speaking = null;
    }
    if (this.open && !this.open.finalized) {
      this.counters.partialResponseAttempts += 1;
      const rec = this.currentTurnById(this.open.turnId);
      if (rec) rec.outcome = "interrupted";
      // Leave it open so a late generationComplete is dropped as stale, not spoken.
    }
    if (this.deferred) {
      const rec = this.currentTurnById(this.deferred.turnId);
      if (rec) rec.outcome = "interrupted";
      this.deferred = null;
    }
    this.log("barge_in", `source=${source} epoch=${this.epoch}`);
    if (this.state === "ai_speaking" || this.state === "ai_thinking") {
      this.transition("barge_in");
      this.transition("user_speaking");
    } else if (this.state === "listening" || this.state === "user_turn_finalizing") {
      this.transition("user_speaking");
    }
    this.micSpeaking = true;
    return { cancelTts, clearAudio: true, epoch: this.epoch };
  }

  // ------------------------------------------------------------------ tts

  /** TTS may begin only for a finalized response of the current epoch, once. */
  ttsStart(response: LabFinalizedResponse): { accepted: boolean; reason: string } {
    if (response.epoch !== this.epoch) {
      this.log("tts_ignored", `stale epoch response=${response.responseId}`);
      return { accepted: false, reason: "stale_epoch" };
    }
    if (this.ttsStartedResponseIds.has(response.responseId)) {
      this.counters.duplicateTtsBlocked += 1;
      this.log("tts_duplicate_ignored", `response=${response.responseId}`);
      return { accepted: false, reason: "tts_already_started_for_response" };
    }
    if (this.speaking) {
      this.counters.duplicateTtsBlocked += 1;
      this.log("tts_ignored", `another TTS in flight response=${this.speaking.responseId}`);
      return { accepted: false, reason: "tts_in_flight" };
    }
    const rec = this.currentTurnById(response.turnId);
    if (this.isEchoOfLastSpoken(response.text, rec)) {
      this.counters.duplicateTtsBlocked += 1;
      this.log("tts_duplicate_text_ignored", `response=${response.responseId}`);
      return { accepted: false, reason: "duplicate_spoken_text" };
    }
    if (this.state === "user_speaking") {
      this.log("tts_ignored", "user_speaking → ai_speaking is not allowed");
      return { accepted: false, reason: "user_speaking" };
    }
    this.ttsStartedResponseIds.add(response.responseId);
    this.speaking = response;
    if (rec) rec.marks.ttsStartedAt = this.now();
    if (this.state === "user_turn_finalizing" || this.state === "listening") this.transition("ai_thinking");
    this.log("tts_started", `response=${response.responseId}`);
    return { accepted: true, reason: "tts_start" };
  }

  ttsAudioStarted(response: LabFinalizedResponse): boolean {
    if (!this.speaking || this.speaking.responseId !== response.responseId || response.epoch !== this.epoch) {
      return false;
    }
    const rec = this.currentTurnById(response.turnId);
    if (rec && rec.marks.firstAudioAt === null) rec.marks.firstAudioAt = this.now();
    this.lastSpokenText = response.text.replace(/\s+/g, " ").trim();
    this.transition("ai_speaking");
    this.log("tts_audio_started", `response=${response.responseId}`);
    return true;
  }

  ttsFinished(
    response: LabFinalizedResponse,
    result: { completed: boolean; spokenText?: string; failed?: boolean }
  ) {
    const rec = this.currentTurnById(response.turnId);
    if (rec) {
      rec.marks.aiEndAt = this.now();
      rec.spokenText = result.spokenText ?? (result.completed ? response.text : rec.spokenText);
      if (result.failed) rec.outcome = "failed";
      else if (result.completed) rec.outcome = "spoken";
      else if (rec.outcome === "pending") rec.outcome = "interrupted";
    }
    if (this.speaking && this.speaking.responseId === response.responseId) {
      this.speaking = null;
      if (result.completed) {
        this.counters.responsesSpoken += 1;
        this.lastSpokenText = response.text.replace(/\s+/g, " ").trim();
      }
      this.log("tts_finished", `response=${response.responseId} completed=${result.completed}`);
      if (response.epoch === this.epoch && (this.state === "ai_speaking" || this.state === "ai_thinking")) {
        this.transition("listening");
      }
    } else {
      this.log("tts_finished_stale", `response=${response.responseId}`);
    }
  }

  isAudioEpochCurrent(epoch: number): boolean {
    return epoch === this.epoch;
  }

  /** Watchdog: user spoke (mic) or transcript arrived, but Gemini never generated. */
  noteGenerationMissing(kind: "after_transcript" | "after_mic_silence"): boolean {
    if (this.open) return false;
    const rec = this.currentTurn();
    if (kind === "after_transcript") {
      if (rec.userText === null || rec.responseId !== null) return false;
      rec.outcome = "missed";
      this.counters.missedResponses += 1;
      this.log("VOICE_LAB_WARNING", `user turn ${rec.turnId} finalized but generation did not start`);
      if (this.state === "ai_thinking" || this.state === "user_turn_finalizing") this.transition("listening");
      return true;
    }
    if (this.state === "user_turn_finalizing") {
      this.log("VOICE_LAB_WARNING", "mic activity ended but no transcript/generation (noise or too quiet?)");
      this.transition("listening");
      this.pendingMarks = null;
      return true;
    }
    return false;
  }
}
