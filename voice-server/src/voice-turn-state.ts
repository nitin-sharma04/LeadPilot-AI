/**
 * Per-call turn and TTS gates for the production Twilio path.
 * One finalized lead utterance → one model response → one TTS synthesis.
 *
 * Proven in Voice Lab (not imported from voice-lab/):
 *  - Gemini Live often omits inputTranscription.finished on a complete utterance
 *  - duplicate generationComplete must not TTS the opening twice
 *  - barge-in bumps epoch so stale audio never resumes
 */

export type VoiceTurnAcceptResult = {
  accepted: boolean;
  turnId: number;
  reason: string;
  epoch: number;
};

function normalizeSpoken(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function spokenWordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * `finished === false` is a true partial.
 * `finished === true` is final.
 * Missing `finished` is treated as a complete utterance (this Live model).
 */
export function isFinalizedLeadTranscript(
  meta?: { finished?: boolean } | null
): boolean {
  return meta?.finished !== false;
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
  /** Monotonic; bumped on barge-in. Stale TTS must not play. */
  epoch = 0;
  openingRequested = false;

  requestOpening(): boolean {
    if (this.openingRequested) return false;
    this.openingRequested = true;
    return true;
  }

  finalizeLeadTurn(text: string): VoiceTurnAcceptResult {
    const leadText = text.replace(/\s+/g, " ").trim();
    if (!leadText) {
      return {
        accepted: false,
        turnId: this.currentLeadTurnId,
        reason: "empty_lead",
        epoch: this.epoch,
      };
    }
    if (this.leadTurnFinalized && this.lastFinalizedLead === leadText) {
      return {
        accepted: false,
        turnId: this.currentLeadTurnId,
        reason: "duplicate_final_lead",
        epoch: this.epoch,
      };
    }
    this.currentLeadTurnId += 1;
    this.leadTurnFinalized = true;
    this.lastFinalizedLead = leadText;
    this.responseGenerationInFlight = false;
    this.responseAcceptedForTurn = null;
    this.ttsAcceptedForTurn = null;
    return {
      accepted: true,
      turnId: this.currentLeadTurnId,
      reason: "lead_finalized",
      epoch: this.epoch,
    };
  }

  tryAcceptModelResponse(
    reason: string,
    agentText?: string | null
  ): VoiceTurnAcceptResult {
    const turnId = this.currentLeadTurnId;
    if (this.responseAcceptedForTurn === turnId) {
      return {
        accepted: false,
        turnId,
        reason: "response_already_accepted",
        epoch: this.epoch,
      };
    }
    if (this.responseGenerationInFlight) {
      return { accepted: false, turnId, reason: "response_in_flight", epoch: this.epoch };
    }
    const spoken = (agentText || "").replace(/\s+/g, " ").trim();
    if (this.isEchoOfLastSpoken(spoken)) {
      return {
        accepted: false,
        turnId,
        reason: "duplicate_spoken_text",
        epoch: this.epoch,
      };
    }
    this.responseGenerationInFlight = true;
    this.responseAcceptedForTurn = turnId;
    return { accepted: true, turnId, reason, epoch: this.epoch };
  }

  isEchoOfLastSpoken(text: string): boolean {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean || !this.lastFinalizedAgent) return false;
    if (normalizeSpoken(clean) !== normalizeSpoken(this.lastFinalizedAgent)) {
      return false;
    }
    if (this.lastFinalizedLead === null) return true;
    return spokenWordCount(clean) >= 8;
  }

  tryBeginTts(turnId: number = this.currentLeadTurnId): VoiceTurnAcceptResult {
    if (this.ttsInFlight) {
      const same = this.ttsAcceptedForTurn === turnId;
      return {
        accepted: false,
        turnId,
        reason: same ? "tts_duplicate_same_turn" : "tts_in_flight",
        epoch: this.epoch,
      };
    }
    this.ttsInFlight = true;
    this.ttsAcceptedForTurn = turnId;
    return { accepted: true, turnId, reason: "tts_start", epoch: this.epoch };
  }

  endTts() {
    this.ttsInFlight = false;
    this.responseGenerationInFlight = false;
  }

  get hasOpenGeneration(): boolean {
    return this.responseGenerationInFlight;
  }

  /** Booking / hangup speech that must replace the current Gemini reply. */
  beginReplacementTts(): VoiceTurnAcceptResult {
    this.ttsInFlight = false;
    this.responseGenerationInFlight = false;
    this.responseAcceptedForTurn = this.currentLeadTurnId;
    return this.tryBeginTts(this.currentLeadTurnId);
  }

  /** Closing goodbye is a new model turn after the lead already finalized. */
  allowClosingResponse() {
    this.currentLeadTurnId += 1;
    this.leadTurnFinalized = true;
    this.responseGenerationInFlight = false;
    this.responseAcceptedForTurn = null;
    this.ttsAcceptedForTurn = null;
  }

  onBargeIn(): { cancelTts: boolean; epoch: number } {
    const cancelTts = this.ttsInFlight;
    this.epoch += 1;
    this.ttsInFlight = false;
    this.ttsAcceptedForTurn = null;
    this.responseGenerationInFlight = false;
    this.responseAcceptedForTurn = this.currentLeadTurnId;
    this.leadTurnFinalized = false;
    return { cancelTts, epoch: this.epoch };
  }

  isAudioEpochCurrent(epoch: number): boolean {
    return epoch === this.epoch;
  }

  noteAgentSpoken(text: string) {
    this.lastFinalizedAgent = text.replace(/\s+/g, " ").trim();
  }
}
