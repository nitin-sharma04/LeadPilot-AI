export const VOICE_LAB_SCENARIO_IDS = [
  "general_sdr",
  "real_estate",
  "digital_agency",
  "service_business",
  "appointment_booking",
  "objection_handling",
  "angry_impatient",
  "short_answer",
  "talkative",
  "interrupting",
] as const;

export type VoiceLabScenarioId = (typeof VOICE_LAB_SCENARIO_IDS)[number];

/** Mirrors voice-lab/turn-machine.ts states. */
export type VoiceLabTurnState =
  | "idle"
  | "listening"
  | "user_speaking"
  | "user_turn_finalizing"
  | "ai_thinking"
  | "ai_speaking"
  | "barge_in"
  | "ended";

export type VoiceLabAppointmentStatus =
  | "none"
  | "collecting"
  | "confirming"
  | "BOOKING_SIMULATED"
  | "BOOKED_SIMULATED"
  | "declined";

export type VoiceLabTimelineEvent = {
  at: string;
  t: number;
  label: string;
};

export type VoiceLabTranscriptKind =
  | "USER_PARTIAL"
  | "USER_FINAL"
  | "AI_GENERATING"
  | "AI_GENERATED"
  | "AI_SPOKEN";

export type VoiceLabTranscriptRow = {
  speaker: "USER" | "AI";
  text: string;
  /** Live/partial rows are replaced in the UI; final rows are appended. */
  interim?: boolean;
  kind?: VoiceLabTranscriptKind;
  at: string;
  turnId?: number;
  responseId?: number;
};

export type VoiceLabLatencyMarks = {
  /** Mic energy start/end (browser heuristic). */
  userSpeechStartAt?: number | null;
  /** Mic end if known, else final transcript time. */
  userFinishedAt: number | null;
  finalTranscriptAt: number | null;
  geminiStartedAt: number | null;
  firstResponseTextAt?: number | null;
  /** Generation complete = AI text finalized. */
  agentTextAt: number | null;
  ttsStartedAt: number | null;
  firstAudioAt: number | null;
  aiFinishedAt: number | null;
};

export type VoiceLabScoreBreakdown = {
  listeningAccuracy: number;
  turnTaking: number;
  responseSpeed: number;
  speechPace: number;
  naturalness: number;
  repetition: number;
  interruptionHandling: number;
  responseRelevance: number;
  conversationMemory: number;
  appointmentHandling: number;
  endingBehavior: number;
  duplicateResponseSafety: number;
};

export type VoiceLabSessionReport = {
  heuristicLabel: "internal engineering heuristics — not a scientific score";
  overall: number;
  breakdown: VoiceLabScoreBreakdown;
  deductions: string[];
  observations: string[];
  notes: string[];
};

export type VoiceLabPromptVariantId = "production" | "lab";

export type VoiceLabStructuredLog = {
  t: number;
  session: string;
  turn: number;
  response: number | null;
  epoch: number;
  state: VoiceLabTurnState;
  event: string;
  detail?: string;
};

export type VoiceLabTurnOutcome =
  | "pending"
  | "spoken"
  | "interrupted"
  | "superseded"
  | "missed"
  | "unspeakable"
  | "failed";

export type VoiceLabTurnSummary = {
  turnId: number;
  userText: string | null;
  aiText: string | null;
  spokenText: string | null;
  outcome: VoiceLabTurnOutcome;
  /** Final user transcript → first AI audio (ms). */
  transcriptToFirstAudioMs: number | null;
  /** Mic silence → first AI audio (ms), includes Gemini VAD wait. */
  micEndToFirstAudioMs: number | null;
  aiSpeakingMs: number | null;
};

export type VoiceLabSessionJson = {
  timestamp: string;
  sessionId: string;
  scenario: VoiceLabScenarioId;
  promptVariant: VoiceLabPromptVariantId;
  vadSilenceMs: number;
  ttsSpeed: number;
  userTranscript: string[];
  aiTranscript: string[];
  turns: VoiceLabTurnSummary[];
  timeline: VoiceLabTimelineEvent[];
  logs: VoiceLabStructuredLog[];
  latency: VoiceLabLatencyMarks[];
  speech: {
    responseWordCounts: number[];
    estimatedWpm: number | null;
    estimatedSpeakMs: number[];
  };
  interruptions: number;
  earlyCutoffs: number;
  repetition: {
    repeatedSentences: number;
    repeatedAcknowledgements: number;
    sameOpenerConsecutive: number;
    details: string[];
  };
  counters: {
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
    staleAudioDroppedByServer: number;
  };
  duplicateResponsesBlocked: number;
  appointmentStatus: VoiceLabAppointmentStatus;
  validation: string[];
  score: VoiceLabSessionReport;
};
