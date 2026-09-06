import {
  markUnclearIfEmpty,
  normalizeTranscriptText,
  shouldSkipDuplicate,
} from "./transcript-cleanup.js";
import { appendTranscript } from "./db.js";

/**
 * Buffers interim STT and only persists finalized utterances.
 */
export class TranscriptFinalizer {
  private leadBuf = "";
  private agentBuf = "";
  private lastLead: string | null = null;
  private lastAgent: string | null = null;
  private interimLead = "";

  constructor(private readonly callId: string) {}

  setInterimLead(text: string) {
    this.interimLead = text;
  }

  /** Gemini often streams incremental/cumulative input transcription. */
  appendLead(text: string) {
    const chunk = text.trim();
    if (!chunk) return;
    // If cumulative (new starts with old), replace; else append.
    if (this.leadBuf && chunk.startsWith(this.leadBuf.trim())) {
      this.leadBuf = chunk;
    } else if (this.leadBuf && this.leadBuf.includes(chunk)) {
      return;
    } else {
      this.leadBuf = `${this.leadBuf} ${chunk}`.trim();
    }
  }

  appendAgent(text: string) {
    const chunk = text.trim();
    if (!chunk) return;
    if (this.agentBuf && chunk.startsWith(this.agentBuf.trim())) {
      this.agentBuf = chunk;
    } else if (this.agentBuf && this.agentBuf.includes(chunk)) {
      return;
    } else {
      this.agentBuf = `${this.agentBuf} ${chunk}`.trim();
    }
  }

  /** Drop incomplete agent speech after barge-in. */
  discardAgentBuffer() {
    this.agentBuf = "";
  }

  async flushLead(): Promise<string | null> {
    const raw = this.leadBuf || this.interimLead;
    this.leadBuf = "";
    this.interimLead = "";
    let text = normalizeTranscriptText(raw);
    text = markUnclearIfEmpty(text);
    if (shouldSkipDuplicate(this.lastLead, text)) return null;
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
    const text = normalizeTranscriptText(raw);
    if (!text) return null;
    if (shouldSkipDuplicate(this.lastAgent, text)) return null;
    this.lastAgent = text;
    await appendTranscript({
      callId: this.callId,
      speaker: "AI",
      message: text,
    });
    return text;
  }

  async flushAll() {
    await this.flushLead();
    await this.flushAgent();
  }
}
