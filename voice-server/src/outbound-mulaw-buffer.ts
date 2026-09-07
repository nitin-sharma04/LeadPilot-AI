/**
 * Outbound Twilio µ-law frame buffer.
 * Accumulates arbitrary Gemini chunk sizes into stable ~20 ms telephony frames.
 */

import { MULAW_FRAME_BYTES } from "./audio.js";

export class OutboundMulawFrameBuffer {
  static readonly FRAME_BYTES = MULAW_FRAME_BYTES;

  private buf: Buffer = Buffer.alloc(0);
  private framesEmitted = 0;
  private bytesBufferedPeak = 0;

  get pendingBytes() {
    return this.buf.length;
  }

  get emittedFrameCount() {
    return this.framesEmitted;
  }

  clear() {
    this.buf = Buffer.alloc(0);
  }

  /** Append µ-law bytes; return complete 160-byte frames ready to send. */
  push(mulaw: Buffer): Buffer[] {
    if (!mulaw.length) return [];
    this.buf = Buffer.concat([this.buf, mulaw]);
    if (this.buf.length > this.bytesBufferedPeak) {
      this.bytesBufferedPeak = this.buf.length;
    }
    const frames: Buffer[] = [];
    while (this.buf.length >= MULAW_FRAME_BYTES) {
      frames.push(Buffer.from(this.buf.subarray(0, MULAW_FRAME_BYTES)));
      this.buf = this.buf.subarray(MULAW_FRAME_BYTES);
      this.framesEmitted += 1;
    }
    return frames;
  }

  /**
   * Flush remainder (turn end / farewell). May be < 160 bytes.
   * Pads nothing — Twilio accepts short final payloads.
   */
  flush(): Buffer | null {
    if (this.buf.length === 0) return null;
    const out = this.buf;
    this.buf = Buffer.alloc(0);
    this.framesEmitted += 1;
    return out;
  }
}
