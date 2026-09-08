import { detectsEndCallIntent } from "../voice-server/src/end-call-intent.js";
import { countWords, estimateWpm } from "./config.js";
import type { RepetitionSummary } from "./repetition.js";
import type {
  VoiceLabAppointmentStatus,
  VoiceLabLatencyMarks,
  VoiceLabScoreBreakdown,
  VoiceLabSessionReport,
  VoiceLabTranscriptRow,
} from "./types.js";

function clamp10(n: number): number {
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export type ScoreInput = {
  rows: VoiceLabTranscriptRow[];
  latency: VoiceLabLatencyMarks[];
  interruptions: number;
  /** User barge-ins that happened within ~1.5s of AI starting — AI likely cut the user off. */
  earlyCutoffs?: number;
  repetition?: RepetitionSummary;
  missedResponses?: number;
  duplicateResponsesBlocked: number;
  appointmentStatus: VoiceLabAppointmentStatus;
  validation: string[];
  estimatedSpeakMs: number[];
};

export function scoreVoiceLabSession(input: ScoreInput): VoiceLabSessionReport {
  const deductions: string[] = [];
  const observations: string[] = [];
  const notes: string[] = [
    "Scores are internal engineering heuristics, not a scientific human-likeness study.",
  ];
  const earlyCutoffs = input.earlyCutoffs ?? 0;
  const rep = input.repetition ?? {
    repeatedSentences: 0,
    repeatedAcknowledgements: 0,
    sameOpenerConsecutive: 0,
    details: [],
  };

  const userFinals = input.rows.filter((r) =>
    r.kind ? r.kind === "USER_FINAL" : r.speaker === "USER" && !r.interim
  );
  const aiFinals = input.rows.filter((r) =>
    r.kind ? r.kind === "AI_GENERATED" : r.speaker === "AI" && !r.interim
  );
  const missed = input.missedResponses ?? 0;
  if (missed > 0) {
    deductions.push(`${missed} finalized user turn(s) never received an AI response.`);
    observations.push(`AI failed to respond ${missed} time(s) after the user finished.`);
  }
  if ((input.duplicateResponsesBlocked ?? 0) > 0) {
    observations.push(
      `${input.duplicateResponsesBlocked} duplicate model event(s) were blocked before TTS.`
    );
  }

  // Listening
  let listeningAccuracy = 10;
  if (userFinals.length > 0 && aiFinals.length === 0) {
    listeningAccuracy = 2;
    deductions.push("User spoke but the AI never replied.");
  } else if (missed > 0) {
    listeningAccuracy = clamp10(10 - missed * 2);
  }

  // Turn taking: penalize likely AI cut-offs harder than ordinary user barge-ins
  let turnTaking = 10;
  if (earlyCutoffs > 0) {
    turnTaking -= earlyCutoffs * 2;
    deductions.push(`AI likely interrupted the user ${earlyCutoffs} time(s) (barge-in <1.5s after AI started).`);
    observations.push(`AI interrupted ${earlyCutoffs === 1 ? "once" : `${earlyCutoffs} times`} during a user turn (heuristic).`);
  }
  const ordinaryBargeIns = Math.max(0, input.interruptions - earlyCutoffs);
  if (ordinaryBargeIns > 0) {
    turnTaking -= ordinaryBargeIns * 0.5;
    observations.push(`User barged in ${ordinaryBargeIns} time(s) while the AI was speaking.`);
  }
  turnTaking = clamp10(turnTaking);

  // Response speed: user finished → first audio
  const delays = input.latency
    .map((m) => {
      const from = m.finalTranscriptAt ?? m.userFinishedAt;
      return from && m.firstAudioAt ? m.firstAudioAt - from : null;
    })
    .filter((n): n is number => n !== null);
  const micDelays = input.latency
    .map((m) =>
      m.userFinishedAt && m.finalTranscriptAt && m.userFinishedAt !== m.finalTranscriptAt && m.firstAudioAt
        ? m.firstAudioAt - m.userFinishedAt
        : null
    )
    .filter((n): n is number => n !== null && n > 0);
  let responseSpeed = 8;
  const medDelay = median(delays);
  if (medDelay !== null) {
    if (medDelay <= 900) responseSpeed = 10;
    else if (medDelay <= 1400) responseSpeed = 8;
    else if (medDelay <= 2000) responseSpeed = 6;
    else responseSpeed = 4;
    observations.push(`AI began speaking ${medDelay}ms (median) after the final user transcript.`);
    if (medDelay > 1400) deductions.push(`Median response start was ${medDelay}ms after the final transcript.`);
    const slowest = Math.max(...delays);
    const slowIdx = delays.indexOf(slowest) + 1;
    if (slowest > 1600) deductions.push(`Response ${slowIdx} started ${slowest}ms after the final transcript.`);
  }
  const medMic = median(micDelays);
  if (medMic !== null) {
    observations.push(
      `AI began speaking ${medMic}ms (median) after the mic went silent (includes Gemini VAD wait).`
    );
  }

  // Speech pace
  const words = aiFinals.reduce((n, r) => n + countWords(r.text), 0);
  const speakMs = input.estimatedSpeakMs.reduce((a, b) => a + b, 0);
  const wpm = estimateWpm(words, speakMs);
  let speechPace = 8;
  if (wpm !== null) {
    observations.push(`Speech pace averaged ${wpm} WPM.`);
    if (wpm >= 135 && wpm <= 165) speechPace = 10;
    else if (wpm >= 120 && wpm <= 180) speechPace = 8;
    else if (wpm > 180) {
      speechPace = 5;
      deductions.push(`Speech pace averaged ${wpm} WPM (target ~150).`);
    } else {
      speechPace = 6;
      deductions.push(`Speech pace averaged ${wpm} WPM (a bit slow).`);
    }
  }

  // Naturalness: response length
  let naturalness = 10;
  if (aiFinals.length) {
    const avg = Math.round(words / aiFinals.length);
    observations.push(`AI response averaged ${avg} words over ${aiFinals.length} turn(s).`);
    const long = aiFinals.filter((r) => countWords(r.text) > 20).length;
    if (long) {
      naturalness = clamp10(10 - long);
      deductions.push(`${long} AI turn(s) were longer than ~20 words.`);
    }
    const fillers = aiFinals.filter((r) =>
      /^(got it|absolutely|perfect|great|certainly)\b/i.test(r.text.trim())
    ).length;
    if (fillers) {
      naturalness = clamp10(naturalness - fillers * 0.5);
      observations.push(`${fillers} AI turn(s) opened with a canned filler.`);
    }
  }

  // Repetition
  let repetition = 10;
  if (rep.repeatedSentences) {
    repetition -= rep.repeatedSentences * 2;
    deductions.push(`AI repeated ${rep.repeatedSentences} sentence(s) it had already said.`);
  }
  if (rep.repeatedAcknowledgements) {
    repetition -= rep.repeatedAcknowledgements;
    observations.push(`AI repeated an acknowledgement ${rep.repeatedAcknowledgements} time(s).`);
  }
  if (rep.sameOpenerConsecutive) {
    repetition -= rep.sameOpenerConsecutive * 0.5;
    observations.push(`${rep.sameOpenerConsecutive} consecutive AI turn(s) started with the same word.`);
  }
  repetition = clamp10(repetition);

  // Interruption handling (how it recovered, not how often)
  let interruptionHandling = 9;
  if (input.interruptions > 0) interruptionHandling = earlyCutoffs > 0 ? 6 : 8;
  if (input.interruptions > 2) interruptionHandling = clamp10(interruptionHandling - 1);

  // Relevance
  let responseRelevance = 9;
  const multiQ = aiFinals.filter((r) => (r.text.match(/\?/g) || []).length > 1).length;
  if (multiQ) {
    responseRelevance = clamp10(9 - multiQ);
    deductions.push(`${multiQ} turn(s) asked more than one question.`);
  }

  const conversationMemory = userFinals.length >= 2 && aiFinals.length >= 2 ? 8 : 7;

  // Appointment
  let appointmentHandling = 8;
  if (input.appointmentStatus === "BOOKED_SIMULATED") {
    appointmentHandling = 10;
    observations.push("Appointment confirmation handled (simulated booking reached).");
  }
  if (input.appointmentStatus === "BOOKING_SIMULATED") appointmentHandling = 9;
  if (input.validation.some((v) => /invite|booked without/i.test(v))) {
    appointmentHandling = 3;
    deductions.push("AI claimed a booking/invite before confirmation.");
  }

  // Ending
  const lastUser = userFinals[userFinals.length - 1]?.text || "";
  let endingBehavior = 8;
  if (detectsEndCallIntent(lastUser)) {
    const lastAi = aiFinals[aiFinals.length - 1]?.text || "";
    if (/\?/.test(lastAi)) {
      endingBehavior = 4;
      deductions.push("AI asked a question after a goodbye.");
    } else {
      endingBehavior = 9;
      observations.push("Goodbye recognised; AI closed without a follow-up question.");
    }
  }

  // Duplicate safety: the pipeline blocked duplicates (good) — penalise only if the user heard one.
  let duplicateResponseSafety = 10;
  if (input.duplicateResponsesBlocked > 0) {
    notes.push(`Blocked ${input.duplicateResponsesBlocked} duplicate response/TTS attempt(s) at runtime.`);
  }
  const spokenTexts = input.rows
    .filter((r) => r.kind === "AI_SPOKEN")
    .map((r) => r.text.replace(/\s+/g, " ").trim().toLowerCase());
  const heardTwice = spokenTexts.filter((t, i) => t && spokenTexts[i - 1] === t).length;
  if (heardTwice > 0) {
    duplicateResponseSafety = clamp10(10 - heardTwice * 4);
    deductions.push(`The same AI sentence was spoken twice in a row ${heardTwice} time(s).`);
  }

  const breakdown: VoiceLabScoreBreakdown = {
    listeningAccuracy: clamp10(listeningAccuracy),
    turnTaking,
    responseSpeed: clamp10(responseSpeed),
    speechPace: clamp10(speechPace),
    naturalness: clamp10(naturalness),
    repetition,
    interruptionHandling: clamp10(interruptionHandling),
    responseRelevance: clamp10(responseRelevance),
    conversationMemory: clamp10(conversationMemory),
    appointmentHandling: clamp10(appointmentHandling),
    endingBehavior: clamp10(endingBehavior),
    duplicateResponseSafety: clamp10(duplicateResponseSafety),
  };
  const values = Object.values(breakdown);
  const overall = clamp10(values.reduce((a, b) => a + b, 0) / values.length);
  return {
    heuristicLabel: "internal engineering heuristics — not a scientific score",
    overall,
    breakdown,
    deductions,
    observations,
    notes,
  };
}
