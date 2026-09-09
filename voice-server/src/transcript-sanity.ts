/**
 * Conservative lead-transcript sanity for English/Hinglish phone calls.
 * Rejects only clearly corrupted STT — never short human replies.
 */

const VALID_SHORT = new Set([
  "yes",
  "yeah",
  "yep",
  "yup",
  "no",
  "nope",
  "nah",
  "ok",
  "okay",
  "sure",
  "right",
  "wait",
  "hmm",
  "mm",
  "mhm",
  "uhhuh",
  "uh-huh",
  "holdon",
  "onesec",
  "onesecond",
  "notnow",
  "goon",
  "goahead",
]);

const HANGUL_RE = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/;
const CJK_RE = /[\u3040-\u30FF\u4E00-\u9FFF]/;
const CYRILLIC_RE = /[\u0400-\u04FF]/;
const ARABIC_RE = /[\u0600-\u06FF]/;
const CONVERSATIONAL_RE =
  /\b(i|you|we|me|my|the|a|to|for|and|yes|yeah|no|ok|okay|sure|wait|right|meeting|call|book|tomorrow|today|time|please|thanks|thank|can|will|just|that|this|what|about|pricing|price|okay)\b/i;

export function normalizeAckKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function isValidShortHumanTurn(text: string): boolean {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return false;
  const key = normalizeAckKey(raw);
  if (VALID_SHORT.has(key)) return true;
  if (/^(yes|yeah|yep|no|nope|ok|okay|sure|wait|right|hold on|one sec|one second|not now)[.!?]*$/i.test(raw)) {
    return true;
  }
  return false;
}

function letterCounts(text: string) {
  let hangul = 0;
  let cjk = 0;
  let cyrillic = 0;
  let arabic = 0;
  let latin = 0;
  for (const ch of text) {
    if (HANGUL_RE.test(ch)) hangul += 1;
    else if (CJK_RE.test(ch)) cjk += 1;
    else if (CYRILLIC_RE.test(ch)) cyrillic += 1;
    else if (ARABIC_RE.test(ch)) arabic += 1;
    else if (/[A-Za-z]/.test(ch)) latin += 1;
  }
  return { hangul, cjk, cyrillic, arabic, latin };
}

export function isIsolatedForeignScript(text: string): boolean {
  const counts = letterCounts(text);
  const foreign = counts.hangul + counts.cjk + counts.cyrillic + counts.arabic;
  if (foreign === 0) return false;
  if (counts.latin >= 3) return false;
  return foreign >= 2 && foreign > counts.latin;
}

export function looksLikeSttHallucination(text: string): boolean {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return true;
  if (isValidShortHumanTurn(raw)) return false;
  if (isIsolatedForeignScript(raw)) return true;
  if (HANGUL_RE.test(raw) || CJK_RE.test(raw)) return true;
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.length <= 5 && !CONVERSATIONAL_RE.test(raw)) {
    const titleCase = words.filter((w) => /^[A-Z][a-z]{2,}$/.test(w.replace(/[.,!?]/g, ""))).length;
    if (titleCase === words.length) return true;
  }
  const collapsed = words.join(" ").toLowerCase();
  if (/^(.{2,12})\s+\1(\s+\1)+$/.test(collapsed)) return true;
  return false;
}

export type LeadTranscriptDecision = {
  accept: boolean;
  reason: string;
};

/**
 * Decide whether a candidate finalized transcript may authorize a user turn.
 * Debounce expiry alone is never enough — this still requires a real utterance.
 */
export function evaluateLeadTranscript(input: {
  text: string;
  silenceMs: number;
  inboundLoudMs: number;
}): LeadTranscriptDecision {
  const text = input.text.replace(/\s+/g, " ").trim();
  if (!text) return { accept: false, reason: "empty" };
  if (isValidShortHumanTurn(text)) {
    return { accept: true, reason: "short_human_turn" };
  }
  if (isIsolatedForeignScript(text) || looksLikeSttHallucination(text)) {
    return { accept: false, reason: "rejectedGarbage" };
  }
  if (input.silenceMs >= 3000 && input.inboundLoudMs < 80) {
    return { accept: false, reason: "rejectedGarbage" };
  }
  return { accept: true, reason: "ok" };
}

export function normalizeAgentSpeech(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Meaningful overlap for duplicate-speech suppression. Short replies use near-exact match. */
export function agentSpeechSimilarity(a: string, b: string): number {
  const na = normalizeAgentSpeech(a);
  const nb = normalizeAgentSpeech(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const aw = na.split(" ").filter((w) => w.length > 1 || /^\d+$/.test(w));
  const bw = nb.split(" ").filter((w) => w.length > 1 || /^\d+$/.test(w));
  if (!aw.length || !bw.length) return 0;
  if (aw.length <= 8 || bw.length <= 8) {
    if (na === nb) return 1;
    if (na.includes(nb) || nb.includes(na)) {
      const lengthRatio =
        Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
      return lengthRatio >= 0.85 ? lengthRatio : 0;
    }
    return 0;
  }
  const setA = new Set(aw);
  const overlap = bw.filter((w) => setA.has(w)).length;
  const coverage = overlap / Math.min(aw.length, bw.length);
  const lengthRatio =
    Math.min(aw.length, bw.length) / Math.max(aw.length, bw.length);
  if (lengthRatio < 0.75) return coverage * lengthRatio;
  return coverage;
}

export function isNearDuplicateAgentSpeech(
  previous: string | null | undefined,
  current: string,
  threshold = 0.8
): boolean {
  if (!previous) return false;
  return agentSpeechSimilarity(previous, current) >= threshold;
}
