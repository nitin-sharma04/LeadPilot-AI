import {
  finalizeLeadUtterance,
  isInternalTranscript,
  mergeStreamingTranscript,
  normalizeTranscriptText,
  shouldSkipDuplicate,
} from "./transcript-cleanup.js";
import { appendTranscript } from "./db.js";

/**
 * Buffers interim STT and only persists finalized user-facing utterances.
 * Internal events and empty/interim-only turns never become transcript rows.
 */
export class TranscriptFinalizer {
  private leadBuf = "";
  private agentBuf = "";
  private lastLead: string | null = null;
  private lastAgent: string | null = null;
  private interimLead = "";

  constructor(private readonly callId: string) {}

  peekAgent(): string {
    return this.agentBuf.trim();
  }

  peekLead(): string {
    return (this.leadBuf.trim() || this.interimLead.trim());
  }

  setInterimLead(text: string) {
    if (isInternalTranscript(text)) return;
    this.interimLead = text;
  }

  /** Gemini often streams incremental/cumulative input transcription. */
  appendLead(text: string) {
    const chunk = text.trim();
    if (!chunk) return;
    if (isInternalTranscript(chunk)) return;
    if (chunk === "[unclear]") return;
    this.leadBuf = mergeStreamingTranscript(this.leadBuf, chunk);
  }

  appendAgent(text: string) {
    const chunk = text.trim();
    if (!chunk) return;
    if (isInternalTranscript(chunk)) return;
    this.agentBuf = mergeStreamingTranscript(this.agentBuf, chunk);
  }

  /** Drop incomplete agent speech after barge-in. */
  discardAgentBuffer() {
    this.agentBuf = "";
  }

  async flushLead(): Promise<string | null> {
    const raw = this.leadBuf.trim() || this.interimLead.trim();
    this.leadBuf = "";
    this.interimLead = "";
    const text = finalizeLeadUtterance(raw, this.lastLead);
    if (!text) return null;
    this.lastLead = text;
    await appendTranscript({
      callId: this.callId,
      speaker: "LEAD",
      message: text,
    });
    return text;
  }

  async flushAgent(): Promise<string | null> {
    const raw = this.agentBuf;
    this.agentBuf = "";
    if (!raw.trim()) return null;
    if (isInternalTranscript(raw)) return null;
    const text = normalizeTranscriptText(raw);
    if (!text || isInternalTranscript(text)) return null;
    if (shouldSkipDuplicate(this.lastAgent, text)) return null;
    this.lastAgent = text;
    await appendTranscript({
      callId: this.callId,
      speaker: "AI",
      message: text,
    });
    return text;
  }

  /**
   * Persist the exact Deepgram/spoken agent text (authoritative),
   * replacing any buffered Gemini output for this turn.
   */
  async persistSpokenAgent(text: string): Promise<string | null> {
    this.agentBuf = "";
    const cleaned = normalizeTranscriptText(text);
    if (!cleaned || isInternalTranscript(cleaned)) return null;
    if (shouldSkipDuplicate(this.lastAgent, cleaned)) return null;
    this.lastAgent = cleaned;
    await appendTranscript({
      callId: this.callId,
      speaker: "AI",
      message: cleaned,
    });
    return cleaned;
  }

  /** Drop incomplete lead speech after a stale/barge-in reset. */
  discardLeadBuffer() {
    this.leadBuf = "";
    this.interimLead = "";
  }

  async flushAll() {
    await this.flushLead();
    await this.flushAgent();
  }
}
