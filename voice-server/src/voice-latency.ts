import { isVoiceLatencyDebugEnabled } from "./config.js";

export type VoiceLatencyMarks = {
  leadFinalAt: number | null;
  geminiTurnCompleteAt: number | null;
  agentTextReadyAt: number | null;
  deepgramFirstAudioAt: number | null;
  twilioFirstAudioAt: number | null;
};

export function emptyVoiceLatencyMarks(): VoiceLatencyMarks {
  return {
    leadFinalAt: null,
    geminiTurnCompleteAt: null,
    agentTextReadyAt: null,
    deepgramFirstAudioAt: null,
    twilioFirstAudioAt: null,
  };
}

function rel(base: number | null, t: number | null): number | null {
  if (!base || !t) return null;
  return t - base;
}

/** Temporary debug — no secrets, no transcript text. */
export function logVoiceLatency(callId: string, marks: VoiceLatencyMarks) {
  if (!isVoiceLatencyDebugEnabled()) return;
  const base = marks.leadFinalAt;
  console.info("[voice-latency]", {
    callId,
    leadFinalTranscriptMs: base ? 0 : null,
    geminiTurnCompleteMs: rel(base, marks.geminiTurnCompleteAt),
    agentTextReadyMs: rel(base, marks.agentTextReadyAt),
    deepgramFirstAudioMs: rel(base, marks.deepgramFirstAudioAt),
    twilioFirstAudioMs: rel(base, marks.twilioFirstAudioAt),
    totalResponseLatencyMs: rel(base, marks.twilioFirstAudioAt),
  });
}
