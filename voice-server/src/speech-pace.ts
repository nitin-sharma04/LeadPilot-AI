/**
 * Per-call speech pacing preference.
 * Keep in sync with src/lib/voice/speech-pace.ts
 */

export type SpeechPace = "normal" | "slow";

const SLOW_SPEECH_PATTERNS: RegExp[] = [
  /\btoo\s+fast\b/i,
  /\bspeak(ing)?\s+(too\s+)?fast\b/i,
  /\btalk(ing)?\s+(too\s+)?fast\b/i,
  /\bspeak\s+(more\s+)?slow(ly|er)?\b/i,
  /\btalk\s+(more\s+)?slow(ly|er)?\b/i,
  /\bslow\s+down\b/i,
  /\bslower\b/i,
  /\bcan\s+you\s+speak\s+slow/i,
  /\bi\s+can'?t\s+understand\b/i,
  /\bcannot\s+understand\b/i,
  /\bhard\s+to\s+(hear|understand|follow)\b/i,
  /\bthoda\s+slow\b/i,
  /\bslow\s+bolo\b/i,
  /\bdheere\s+(bolo|bol|baat)\b/i,
  /\bslow\s+(volume|tone|pace)\b/i,
  /\bslow\s+tone\b/i,
];

export function detectsSlowSpeechRequest(utterance: string): boolean {
  const text = utterance.replace(/\s+/g, " ").trim();
  if (!text) return false;
  return SLOW_SPEECH_PATTERNS.some((re) => re.test(text));
}

export function slowSpeechSystemNudge(): string {
  return "[INTERNAL] speech_pace=slow. Acknowledge briefly, then use shorter clearer sentences for the rest of the call. Do not rush.";
}
