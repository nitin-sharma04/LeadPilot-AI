/**
 * Per-call turn and TTS gates.
 * One finalized lead utterance → one model response → one TTS synthesis.
 */

export type VoiceTurnAcceptResult = {
  accepted: boolean;
  turnId: number;
  reason: string;
};

export function isFinalizedLeadTranscript(
  meta?: { finished?: boolean } | null
): boolean {
  return meta?.finished === true;
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

  finalizeLeadTurn(text: string): VoiceTurnAcceptResult {
    const leadText = text.replace(/\s+/g, " ").trim();
    if (!leadText) {
      return {
        accepted: false,
        turnId: this.currentLeadTurnId,
        reason: "empty_lead",
      };
    }
    if (this.leadTurnFinalized && this.lastFinalizedLead === leadText) {
      return {
        accepted: false,
        turnId: this.currentLeadTurnId,
        reason: "duplicate_final_lead",
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
    };
  }

  tryAcceptModelResponse(reason: string): VoiceTurnAcceptResult {
    const turnId = this.currentLeadTurnId;
    if (this.responseAcceptedForTurn === turnId) {
      return { accepted: false, turnId, reason: "response_already_accepted" };
    }
    if (this.responseGenerationInFlight) {
      return { accepted: false, turnId, reason: "response_in_flight" };
    }
    this.responseGenerationInFlight = true;
    this.responseAcceptedForTurn = turnId;
    return { accepted: true, turnId, reason };
  }

  tryBeginTts(turnId: number = this.currentLeadTurnId): VoiceTurnAcceptResult {
    if (this.ttsInFlight) {
      const same = this.ttsAcceptedForTurn === turnId;
      return {
        accepted: false,
        turnId,
        reason: same ? "tts_duplicate_same_turn" : "tts_in_flight",
      };
    }
    this.ttsInFlight = true;
    this.ttsAcceptedForTurn = turnId;
    return { accepted: true, turnId, reason: "tts_start" };
  }

  endTts() {
    this.ttsInFlight = false;
    this.responseGenerationInFlight = false;
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

  onBargeIn(): { cancelTts: boolean } {
    const cancelTts = this.ttsInFlight;
    this.ttsInFlight = false;
    this.ttsAcceptedForTurn = null;
    this.responseGenerationInFlight = false;
    this.responseAcceptedForTurn = this.currentLeadTurnId;
    this.leadTurnFinalized = false;
    return { cancelTts };
  }

  noteAgentSpoken(text: string) {
    this.lastFinalizedAgent = text.replace(/\s+/g, " ").trim();
  }
}
