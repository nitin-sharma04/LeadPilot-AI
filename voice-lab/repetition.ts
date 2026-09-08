/**
 * Deterministic repetition heuristics for lab AI turns.
 * Production does not use this.
 */

const ACK_OPENERS = [
  "yeah",
  "right",
  "okay",
  "ok",
  "sure",
  "makes sense",
  "fair enough",
  "i hear you",
  "got it",
  "absolutely",
  "perfect",
  "great",
  "certainly",
  "thanks for sharing",
  "i completely understand",
];

export function normalizeSentence(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+|—/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function leadingAcknowledgement(text: string): string | null {
  const norm = normalizeSentence(text);
  for (const ack of ACK_OPENERS) {
    if (norm === ack || norm.startsWith(`${ack} `)) return ack;
  }
  return null;
}

export type RepetitionSummary = {
  repeatedSentences: number;
  repeatedAcknowledgements: number;
  sameOpenerConsecutive: number;
  details: string[];
};

export class RepetitionTracker {
  private sentences = new Set<string>();
  private acks: string[] = [];
  private lastOpener: string | null = null;
  readonly summary: RepetitionSummary = {
    repeatedSentences: 0,
    repeatedAcknowledgements: 0,
    sameOpenerConsecutive: 0,
    details: [],
  };

  noteAgentTurn(text: string): string[] {
    const found: string[] = [];
    for (const sentence of splitSentences(text)) {
      const norm = normalizeSentence(sentence);
      if (norm.split(" ").length < 4) continue;
      if (this.sentences.has(norm)) {
        this.summary.repeatedSentences += 1;
        found.push(`AI repeated a sentence: "${sentence}"`);
      } else {
        this.sentences.add(norm);
      }
    }
    const ack = leadingAcknowledgement(text);
    if (ack) {
      if (this.acks.includes(ack)) {
        this.summary.repeatedAcknowledgements += 1;
        found.push(`AI repeated an acknowledgement: "${ack}"`);
      }
      this.acks.push(ack);
    }
    const opener = normalizeSentence(text).split(" ")[0] || null;
    if (opener && opener === this.lastOpener) {
      this.summary.sameOpenerConsecutive += 1;
      found.push(`Consecutive AI turns started with "${opener}"`);
    }
    this.lastOpener = opener;
    this.summary.details.push(...found);
    return found;
  }
}
