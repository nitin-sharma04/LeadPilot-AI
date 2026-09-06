/**
 * Idempotent realtime call-end state machine.
 * Waits for Twilio media-stream mark delivery of the farewell before
 * issuing the REST hangup — without inventing long artificial delays.
 */

export type CallEndReason =
  | "lead_hangup"
  | "lead_force_hangup"
  | "agent_farewell"
  | "max_duration"
  | "stream_stop";

export type HangupResult = {
  ok: boolean;
  status?: number;
  errorType?: string;
};

export type CallEndControllerOptions = {
  callId: string;
  /** Resolve the Twilio Call SID at hangup time (may come from stream or DB). */
  getProviderCallSid: () => string;
  hangupTwilio: (providerCallSid: string) => Promise<HangupResult>;
  /** Short fallback only if Twilio never echoes the farewell mark. */
  markFallbackMs?: number;
  onBeforeHangup?: () => void | Promise<void>;
  onAfterHangupAttempt?: (result: HangupResult & { reason: CallEndReason }) => void | Promise<void>;
  log?: (level: "info" | "error", message: string, meta?: Record<string, unknown>) => void;
};

export class CallEndController {
  private phase: "active" | "ending" | "terminating" | "terminated" =
    "active";
  private reason: CallEndReason | null = null;
  private hangupAfterMark: string | null = null;
  private hangupInFlight: Promise<HangupResult> | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHangupResult: HangupResult | null = null;
  private readonly markFallbackMs: number;
  private readonly log: NonNullable<CallEndControllerOptions["log"]>;

  constructor(private readonly options: CallEndControllerOptions) {
    this.markFallbackMs = options.markFallbackMs ?? 2500;
    this.log =
      options.log ??
      ((level, message, meta) => {
        const line = `[voice-server] ${message}`;
        if (level === "error") console.error(line, meta ?? {});
        else console.info(line, meta ?? {});
      });
  }

  get callId() {
    return this.options.callId;
  }

  get endReason() {
    return this.reason;
  }

  /** True once end has been requested (farewell may still be playing). */
  get isEnding() {
    return this.phase !== "active";
  }

  get isTerminated() {
    return this.phase === "terminated";
  }

  /** Block further Gemini turns / inbound audio. */
  get shouldAcceptGeminiInput() {
    return this.phase === "active";
  }

  /** Allow farewell TTS while ending; stop once hangup begins. */
  get shouldAcceptOutboundAudio() {
    return this.phase === "active" || this.phase === "ending";
  }

  get awaitingFarewellMark() {
    return this.hangupAfterMark !== null && this.phase === "ending";
  }

  /**
   * If more farewell audio is enqueued after we started waiting, wait for the newest mark.
   */
  extendFarewellMark(markName: string) {
    if (this.phase !== "ending" || !this.hangupAfterMark || !markName) return;
    this.hangupAfterMark = markName;
  }

  /**
   * Request call end. Safe to call repeatedly — only the first request wins.
   */
  requestEnd(input: {
    reason: CallEndReason;
    /** When true, wait for farewell mark (or short fallback) before Twilio hangup. */
    awaitFarewellDelivery: boolean;
  }): { accepted: boolean } {
    if (this.phase !== "active") {
      return { accepted: false };
    }

    this.phase = "ending";
    this.reason = input.reason;
    this.log("info", "call end requested", {
      callId: this.options.callId,
      reason: input.reason,
      awaitFarewellDelivery: input.awaitFarewellDelivery,
    });

    if (!input.awaitFarewellDelivery) {
      void this.beginHangup();
    }

    return { accepted: true };
  }

  /**
   * Farewell audio (and its Twilio mark) has been fully enqueued.
   * Hang up when Twilio reports that mark as played.
   */
  notifyFarewellEnqueued(lastMarkName: string | null) {
    if (this.phase !== "ending") return;
    if (this.hangupInFlight) return;
    if (this.hangupAfterMark) return;

    if (!lastMarkName) {
      void this.beginHangup();
      return;
    }

    this.hangupAfterMark = lastMarkName;
    this.armMarkFallback();
    this.log("info", "awaiting farewell mark before hangup", {
      callId: this.options.callId,
      mark: lastMarkName,
    });
  }

  /** Twilio media-stream mark event — farewell playback checkpoint. */
  onTwilioMark(markName: string) {
    if (!markName || this.phase !== "ending") return;
    if (this.hangupAfterMark && markName === this.hangupAfterMark) {
      this.log("info", "farewell mark received", {
        callId: this.options.callId,
        mark: markName,
      });
      void this.beginHangup();
    }
  }

  /** Force hangup path (stream stop / hard teardown). Idempotent. */
  forceHangupNow(reason: CallEndReason = "stream_stop") {
    if (this.phase === "active") {
      this.reason = reason;
      this.phase = "ending";
    }
    return this.beginHangup();
  }

  private armMarkFallback() {
    if (this.fallbackTimer) return;
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = null;
      if (this.phase === "ending") {
        this.log("info", "farewell mark fallback — hanging up", {
          callId: this.options.callId,
          awaitedMark: this.hangupAfterMark,
        });
        void this.beginHangup();
      }
    }, this.markFallbackMs);
  }

  private clearFallback() {
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  private beginHangup(): Promise<HangupResult> {
    if (this.hangupInFlight) return this.hangupInFlight;
    if (this.phase === "terminated" && this.lastHangupResult) {
      return Promise.resolve(this.lastHangupResult);
    }

    this.phase = "terminating";
    this.clearFallback();
    this.hangupAfterMark = null;

    this.hangupInFlight = this.executeHangup();
    return this.hangupInFlight;
  }

  private async executeHangup(): Promise<HangupResult> {
    const reason = this.reason || "stream_stop";
    try {
      await this.options.onBeforeHangup?.();
    } catch {
      /* never block hangup on cleanup errors */
    }

    const sid = this.options.getProviderCallSid().trim();
    let result: HangupResult = {
      ok: false,
      errorType: sid ? "unknown" : "missing_provider_call_sid",
    };

    if (sid) {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        result = await this.options.hangupTwilio(sid);
        if (result.ok) break;
        this.log("error", "twilio hangup failed", {
          callId: this.options.callId,
          attempt,
          status: result.status,
          errorType: result.errorType,
          // never log credentials or full SID — last 4 only
          providerCallIdSuffix: sid.slice(-4),
        });
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 350));
        }
      }
    } else {
      this.log("error", "twilio hangup skipped — missing call SID", {
        callId: this.options.callId,
        reason,
      });
    }

    this.lastHangupResult = result;
    this.phase = "terminated";
    this.log("info", "hangup attempt finished", {
      callId: this.options.callId,
      reason,
      ok: result.ok,
      status: result.status,
    });

    try {
      await this.options.onAfterHangupAttempt?.({ ...result, reason });
    } catch {
      /* ignore */
    }

    return result;
  }
}
