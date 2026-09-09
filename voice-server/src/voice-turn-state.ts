/**
 * Production Twilio turn machine.
 *
 * IDLE/LISTENING → USER_SPEAKING → USER_TURN_ENDED → AI_THINKING → AI_SPEAKING
 * → POST_SPEECH_GUARD → LISTENING
 *
 * One finalized lead turn → one generation id → one TTS → one playback.
 * Completion events never authorize a new response. Only finalizeLeadTurn
 * (or the opening/closing exceptions) may call beginGeneration.
 */

import { isNearDuplicateAgentSpeech } from "./transcript-sanity.js";

export type VoiceTurnPhase =
  | "idle"
  | "listening"
  | "user_speaking"
  | "user_turn_ended"
  | "ai_thinking"
  | "ai_speaking"
  | "post_speech_guard";

export type VoiceTurnAcceptResult = {
  accepted: boolean;
  turnId: number;
  reason: string;
  epoch: number;
  generationId: number;
  cancelledPrevious?: boolean;
  cancelledGenerationId?: number | null;
};

export type ResponseStatus =
  | "generating"
  | "finalized"
  | "tts_started"
  | "playing"
  | "completed"
  | "cancelled";

/** One Gemini generation → one aggregated response. Latest turn wins. */
export class ResponseAggregator {
  status: ResponseStatus = "generating";
  text = "";
  readonly generationId: number;
  readonly turnId: number;
  ttsRequestId: number | null = null;

  constructor(generationId: number, turnId: number) {
    this.generationId = generationId;
    this.turnId = turnId;
  }

  append(chunk: string) {
    if (this.status === "cancelled") return;
    const next = chunk.replace(/\s+/g, " ").trim();
    if (!next) return;
    if (!this.text) this.text = next;
    else if (next.startsWith(this.text) || next.includes(this.text)) this.text = next;
    else if (this.text.includes(next)) return;
    else this.text = `${this.text} ${next}`.trim();
  }

  finalize(): string | null {
    if (this.status === "cancelled") return null;
    const spoken = this.text.replace(/\s+/g, " ").trim();
    if (!spoken) return null;
    this.status = "finalized";
    return spoken;
  }

  markTtsStarted(ttsRequestId: number) {
    if (this.status === "cancelled") return false;
    if (this.status === "tts_started" || this.status === "playing" || this.status === "completed") {
      return false;
    }
    this.status = "tts_started";
    this.ttsRequestId = ttsRequestId;
    return true;
  }

  markPlaying() {
    if (this.status === "cancelled") return false;
    this.status = "playing";
    return true;
  }

  markCompleted() {
    if (this.status === "cancelled") return false;
    this.status = "completed";
    return true;
  }

  cancel() {
    this.status = "cancelled";
  }

  get canEnterTts() {
    return this.status === "finalized" || this.status === "generating";
  }
}

function normalizeSpoken(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function responseTextHash(text: string): string {
  return normalizeSpoken(text);
}

/**
 * Immediate finalize only when Gemini explicitly marks finished.
 * `finished === false` is a partial.
 * Missing `finished` is NOT immediately final — debounce in the handler.
 */
export function isFinalizedLeadTranscript(
  meta?: { finished?: boolean } | null
): boolean {
  return meta?.finished === true;
}

export function isPartialLeadTranscript(
  meta?: { finished?: boolean } | null
): boolean {
  return meta?.finished === false;
}

export function isAmbiguousLeadFinished(
  meta?: { finished?: boolean } | null
): boolean {
  return meta?.finished !== true && meta?.finished !== false;
}

/** Merge + debounce helper for Gemini input transcription (finished is unreliable). */
export class LeadUtteranceAssembler {
  buffer = "";
  lastChunkAt = 0;
  private lastPartial = false;

  push(
    text: string,
    meta: { finished?: boolean } | undefined,
    now: number,
    merge: (buffer: string, chunk: string) => string
  ) {
    const chunk = text.replace(/\s+/g, " ").trim();
    if (!chunk) return;
    this.buffer = merge(this.buffer, chunk);
    this.lastChunkAt = now;
    this.lastPartial = isPartialLeadTranscript(meta);
  }

  peek(): string {
    return this.buffer.replace(/\s+/g, " ").trim();
  }

  shouldFinalizeImmediately(meta?: { finished?: boolean } | null): boolean {
    return isFinalizedLeadTranscript(meta) && Boolean(this.peek());
  }

  shouldDebounceFinalize(now: number, debounceMs: number): boolean {
    if (this.lastPartial) return false;
    const text = this.peek();
    if (!text) return false;
    if (now - this.lastChunkAt < debounceMs) return false;
    return true;
  }

  take(): string {
    const text = this.peek();
    this.buffer = "";
    this.lastPartial = false;
    this.lastChunkAt = 0;
    return text;
  }

  clear() {
    this.buffer = "";
    this.lastPartial = false;
    this.lastChunkAt = 0;
  }
}

export class VoiceTurnController {
  currentLeadTurnId = 0;
  leadTurnFinalized = false;
  responseGenerationInFlight = false;
  responseAcceptedForTurn: number | null = null;
  ttsInFlight = false;
  ttsAcceptedForTurn: number | null = null;
  lastFinalizedLead: string | null = null;
  lastFinalizedAgent: string | null = null;
  lastSpokenAgentTurns: string[] = [];
  /** Set only by finalizeLeadTurn / opening / closing. Completion events cannot set this. */
  authorizedUserTurnId: number | null = null;
  geminiInterruptSeq = 0;
  /** Bumped on barge-in / stale invalidate. Stale TTS must not play. */
  epoch = 0;
  openingRequested = false;
  generationId = 0;
  phase: VoiceTurnPhase = "idle";
  awaitingResponse = false;
  outputSeenForGeneration = false;
  acceptedGenerationId: number | null = null;
  spokenGenerationId: number | null = null;
  ttsGenerationId: number | null = null;
  playbackGenerationId: number | null = null;
  responseHashForGeneration: string | null = null;
  ignoreModelOutputUntilLead = false;
  postSpeechGuardUntil = 0;
  aiSpeaking = false;
  responseAbort: AbortController = new AbortController();
  ttsAbort: AbortController = new AbortController();
  aggregator: ResponseAggregator | null = null;
  ttsRequestSeq = 0;

  requestOpening(): boolean {
    if (this.openingRequested) return false;
    this.openingRequested = true;
    this.beginGeneration("opening");
    this.phase = "ai_thinking";
    return true;
  }

  private beginGeneration(_reason: "opening" | "lead" | "closing") {
    this.generationId += 1;
    this.awaitingResponse = true;
    this.outputSeenForGeneration = false;
    this.acceptedGenerationId = null;
    this.spokenGenerationId = null;
    this.ttsGenerationId = null;
    this.playbackGenerationId = null;
    this.responseHashForGeneration = null;
    this.responseGenerationInFlight = false;
    this.responseAcceptedForTurn = null;
    this.ttsAcceptedForTurn = null;
    this.ttsInFlight = false;
    this.ignoreModelOutputUntilLead = false;
    this.authorizedUserTurnId = this.currentLeadTurnId;
    this.responseAbort = new AbortController();
    this.ttsAbort = new AbortController();
    this.aggregator = new ResponseAggregator(this.generationId, this.currentLeadTurnId);
  }

  /**
   * ElevenLabs-style: a newer authoritative turn cancels in-flight response/TTS.
   * AbortControllers fire so async LLM/TTS work cannot emit after this.
   */
  cancelActiveResponse(reason: string): {
    cancelled: boolean;
    oldGenerationId: number;
    epoch: number;
    reason: string;
  } {
    const oldGenerationId = this.generationId;
    const cancelled = Boolean(
      this.ttsInFlight ||
        this.aiSpeaking ||
        this.awaitingResponse ||
        this.responseGenerationInFlight ||
        (this.aggregator &&
          this.aggregator.status !== "completed" &&
          this.aggregator.status !== "cancelled")
    );
    try {
      this.responseAbort.abort();
    } catch {
      /* ignore */
    }
    try {
      this.ttsAbort.abort();
    } catch {
      /* ignore */
    }
    this.aggregator?.cancel();
    this.epoch += 1;
    this.ttsInFlight = false;
    this.ttsAcceptedForTurn = null;
    this.responseGenerationInFlight = false;
    this.awaitingResponse = false;
    this.outputSeenForGeneration = false;
    this.aiSpeaking = false;
    this.postSpeechGuardUntil = 0;
    return { cancelled, oldGenerationId, epoch: this.epoch, reason };
  }

  get ttsAbortSignal(): AbortSignal {
    return this.ttsAbort.signal;
  }

  get responseAbortSignal(): AbortSignal {
    return this.responseAbort.signal;
  }

  get hasActiveResponseWork(): boolean {
    return (
      this.ttsInFlight ||
      this.aiSpeaking ||
      this.awaitingResponse ||
      this.responseGenerationInFlight
    );
  }

  noteLeadActivity() {
    if (this.phase === "listening" || this.phase === "idle" || this.phase === "post_speech_guard") {
      this.phase = "user_speaking";
    }
    if (this.ignoreModelOutputUntilLead) {
      this.ignoreModelOutputUntilLead = false;
    }
  }

  noteModelOutput(chunk?: string): { accepted: boolean; reason: string } {
    if (this.ignoreModelOutputUntilLead) {
      return { accepted: false, reason: "stale_output_before_lead" };
    }
    if (this.authorizedUserTurnId === null) {
      return { accepted: false, reason: "no_authorized_user_turn" };
    }
    if (!this.awaitingResponse) {
      return { accepted: false, reason: "not_awaiting_response" };
    }
    this.outputSeenForGeneration = true;
    if (chunk) this.aggregator?.append(chunk);
    return { accepted: true, reason: "output_chunk" };
  }

  finalizeLeadTurn(text: string): VoiceTurnAcceptResult {
    const leadText = text.replace(/\s+/g, " ").trim();
    if (!leadText) {
      return this.reject("empty_lead");
    }
    if (this.leadTurnFinalized && this.lastFinalizedLead === leadText) {
      return this.reject("duplicate_final_lead");
    }
    const previous = this.hasActiveResponseWork
      ? this.cancelActiveResponse("latest_turn_wins")
      : null;
    this.currentLeadTurnId += 1;
    this.leadTurnFinalized = true;
    this.lastFinalizedLead = leadText;
    this.beginGeneration("lead");
    this.phase = "user_turn_ended";
    return {
      accepted: true,
      turnId: this.currentLeadTurnId,
      reason: "lead_finalized",
      epoch: this.epoch,
      generationId: this.generationId,
      cancelledPrevious: Boolean(previous?.cancelled),
      cancelledGenerationId: previous?.oldGenerationId ?? null,
    };
  }

  /**
   * Accept the current generation once. `agentText` is optional polish;
   * live Gemini chunks must already have been noted via noteModelOutput.
   * Passing leftover text from a previous generation is not enough.
   */
  tryAcceptModelResponse(
    reason: string,
    agentText?: string | null,
    observedGenerationId?: number
  ): VoiceTurnAcceptResult {
    const turnId = this.currentLeadTurnId;
    const spoken = (agentText || this.aggregator?.text || "").replace(/\s+/g, " ").trim();

    if (observedGenerationId != null && observedGenerationId !== this.generationId) {
      return this.reject("stale_generation");
    }
    if (this.authorizedUserTurnId === null) {
      return this.reject("no_authorized_user_turn");
    }
    if (this.authorizedUserTurnId !== this.currentLeadTurnId) {
      return this.reject("stale_user_turn");
    }
    if (!this.awaitingResponse) {
      return this.reject("not_awaiting_response");
    }
    if (this.ignoreModelOutputUntilLead) {
      return this.reject("stale_generation");
    }
    if (!this.outputSeenForGeneration) {
      return this.reject("stale_or_no_output");
    }
    if (!spoken) {
      return this.reject("stale_or_no_output");
    }
    if (this.acceptedGenerationId === this.generationId) {
      return this.reject("response_already_accepted");
    }
    if (this.responseAcceptedForTurn === turnId && this.spokenGenerationId === this.generationId) {
      return this.reject("response_already_accepted");
    }
    if (this.responseGenerationInFlight) {
      return this.reject("response_in_flight");
    }
    if (this.isNearDuplicateSpoken(spoken)) {
      return this.reject("duplicate_spoken_text");
    }
    if (spoken) {
      const hash = responseTextHash(spoken);
      if (
        this.responseHashForGeneration === hash &&
        this.acceptedGenerationId === this.generationId
      ) {
        return this.reject("duplicate_generation_hash");
      }
    }

    this.responseGenerationInFlight = true;
    this.responseAcceptedForTurn = turnId;
    this.acceptedGenerationId = this.generationId;
    this.spokenGenerationId = this.generationId;
    this.awaitingResponse = false;
    this.phase = "ai_thinking";
    if (spoken) this.responseHashForGeneration = responseTextHash(spoken);
    this.aggregator?.append(spoken);
    this.aggregator?.finalize();
    return {
      accepted: true,
      turnId,
      reason,
      epoch: this.epoch,
      generationId: this.generationId,
    };
  }

  /** Test/helper: record live model text, then accept this generation once. */
  acceptLiveResponse(
    text: string,
    reason = "generation_complete"
  ): VoiceTurnAcceptResult {
    this.noteModelOutput(text);
    return this.tryAcceptModelResponse(reason, text, this.generationId);
  }

  isEchoOfLastSpoken(text: string): boolean {
    return this.isNearDuplicateSpoken(text);
  }

  isNearDuplicateSpoken(text: string): boolean {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return false;
    if (isNearDuplicateAgentSpeech(this.lastFinalizedAgent, clean)) return true;
    return this.lastSpokenAgentTurns.some((prev) =>
      isNearDuplicateAgentSpeech(prev, clean)
    );
  }

  tryBeginTts(turnId: number = this.currentLeadTurnId): VoiceTurnAcceptResult {
    if (this.authorizedUserTurnId === null) {
      return this.reject("no_authorized_user_turn");
    }
    if (this.authorizedUserTurnId !== turnId) {
      return this.reject("stale_user_turn");
    }
    if (this.ttsInFlight) {
      const same = this.ttsAcceptedForTurn === turnId;
      return this.reject(same ? "tts_duplicate_same_turn" : "tts_in_flight");
    }
    if (
      this.ttsGenerationId === this.generationId &&
      this.spokenGenerationId === this.generationId
    ) {
      return this.reject("tts_duplicate_same_generation");
    }
    this.ttsInFlight = true;
    this.ttsAcceptedForTurn = turnId;
    this.ttsGenerationId = this.generationId;
    this.aiSpeaking = true;
    this.phase = "ai_speaking";
    this.ttsRequestSeq += 1;
    if (this.aggregator && !this.aggregator.markTtsStarted(this.ttsRequestSeq)) {
      this.ttsInFlight = false;
      this.aiSpeaking = false;
      return this.reject("tts_duplicate_or_cancelled");
    }
    return {
      accepted: true,
      turnId,
      reason: "tts_start",
      epoch: this.epoch,
      generationId: this.generationId,
    };
  }

  endTts() {
    this.ttsInFlight = false;
    this.responseGenerationInFlight = false;
  }

  markPlaybackComplete(now: number, guardMs: number, generationId?: number) {
    if (generationId != null && generationId !== this.generationId) return;
    if (this.aggregator?.status === "cancelled") return;
    this.playbackGenerationId = this.generationId;
    this.aiSpeaking = false;
    this.ttsInFlight = false;
    this.responseGenerationInFlight = false;
    this.awaitingResponse = false;
    this.postSpeechGuardUntil = now + Math.max(0, guardMs);
    this.phase = guardMs > 0 ? "post_speech_guard" : "listening";
    this.aggregator?.markCompleted();
  }

  isInPostSpeechGuard(now: number): boolean {
    if (this.phase !== "post_speech_guard") return false;
    if (now >= this.postSpeechGuardUntil) {
      this.phase = "listening";
      return false;
    }
    return true;
  }

  enterListeningIfGuardElapsed(now: number) {
    if (this.phase === "post_speech_guard" && now >= this.postSpeechGuardUntil) {
      this.phase = "listening";
    }
  }

  get isAiSpeaking(): boolean {
    return this.aiSpeaking || this.phase === "ai_speaking";
  }

  get hasOpenGeneration(): boolean {
    return this.responseGenerationInFlight;
  }

  get isListeningIdle(): boolean {
    return (
      this.phase === "listening" ||
      this.phase === "idle" ||
      this.phase === "post_speech_guard"
    );
  }

  /** Booking / hangup speech that must replace the current Gemini reply. */
  beginReplacementTts(): VoiceTurnAcceptResult {
    this.ttsInFlight = false;
    this.responseGenerationInFlight = false;
    this.ttsGenerationId = null;
    this.responseAcceptedForTurn = this.currentLeadTurnId;
    this.acceptedGenerationId = this.generationId;
    this.spokenGenerationId = this.generationId;
    this.awaitingResponse = false;
    this.authorizedUserTurnId = this.currentLeadTurnId;
    this.aggregator = new ResponseAggregator(this.generationId, this.currentLeadTurnId);
    this.aggregator.status = "finalized";
    return this.tryBeginTts(this.currentLeadTurnId);
  }

  /** Closing goodbye is a new model turn after the lead already finalized. */
  allowClosingResponse() {
    this.currentLeadTurnId += 1;
    this.leadTurnFinalized = true;
    this.beginGeneration("closing");
    this.phase = "ai_thinking";
  }

  onBargeIn(): { cancelTts: boolean; epoch: number; generationId: number } {
    const cancelTts = this.ttsInFlight || this.aiSpeaking;
    this.cancelActiveResponse("barge_in");
    this.generationId += 1;
    this.responseAbort = new AbortController();
    this.ttsAbort = new AbortController();
    this.aggregator = new ResponseAggregator(this.generationId, this.currentLeadTurnId);
    this.responseAcceptedForTurn = this.currentLeadTurnId;
    this.leadTurnFinalized = false;
    this.authorizedUserTurnId = null;
    this.ignoreModelOutputUntilLead = true;
    this.phase = "user_speaking";
    return { cancelTts, epoch: this.epoch, generationId: this.generationId };
  }

  isAudioEpochCurrent(epoch: number): boolean {
    return epoch === this.epoch;
  }

  isGenerationCurrent(generationId: number): boolean {
    return generationId === this.generationId;
  }

  /**
   * Gemini fired `interrupted`. Always advance interrupt identity so local
   * generation tracking cannot go stale. Echo/tiny interrupts must NOT cancel
   * TTS and must NOT authorize a new response.
   */
  syncEchoInterrupt(): {
    cancelAudio: false;
    generationId: number;
    interruptSeq: number;
  } {
    this.geminiInterruptSeq += 1;
    if (
      this.spokenGenerationId === this.generationId ||
      this.acceptedGenerationId === this.generationId ||
      this.ttsInFlight ||
      this.aiSpeaking
    ) {
      this.awaitingResponse = false;
      this.ignoreModelOutputUntilLead = true;
    } else if (this.awaitingResponse) {
      this.outputSeenForGeneration = false;
      this.aggregator = new ResponseAggregator(
        this.generationId,
        this.currentLeadTurnId
      );
    }
    return {
      cancelAudio: false,
      generationId: this.generationId,
      interruptSeq: this.geminiInterruptSeq,
    };
  }

  noteAgentSpoken(text: string) {
    const clean = text.replace(/\s+/g, " ").trim();
    this.lastFinalizedAgent = clean;
    if (!clean) return;
    this.lastSpokenAgentTurns = [...this.lastSpokenAgentTurns, clean].slice(-2);
  }

  private reject(reason: string): VoiceTurnAcceptResult {
    return {
      accepted: false,
      turnId: this.currentLeadTurnId,
      reason,
      epoch: this.epoch,
      generationId: this.generationId,
    };
  }
}
