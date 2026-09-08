/**
 * LOCAL VOICE LAB ONLY — Deepgram v2 speak WebSocket client.
 *
 * Why a separate client: the shared tts/deepgram-tts.ts treats every `ws` frame that is a
 * Buffer as audio. The `ws` library delivers TEXT frames as Buffers too, so the JSON control
 * messages (Connected / SpeechStarted / Flushed / SpeechMetadata) were appended to the audio
 * and `Flushed` was never recognised → 8 s timeout → REST fallback re-synthesised the SAME
 * sentence → the first sentence was heard twice. This client:
 *   - classifies frames by `isBinary` (text JSON = control, binary = µ-law audio),
 *   - treats `SpeechMetadata` (or `SpeechInterrupted`) as end-of-speech (Flushed arrives BEFORE audio),
 *   - drops in-flight bytes after Interrupt until the next `SpeechStarted`,
 *   - NEVER re-speaks: REST fallback is used only if zero audio was produced.
 * Production (Twilio) keeps using tts/deepgram-tts.ts unchanged.
 */

import WebSocket from "ws";
import {
  createDeepgramClient,
  deepgramLiveSpeakUrl,
  type DeepgramTtsConfig,
} from "./tts/deepgram-tts.js";

export type LabTtsControl = {
  type: string;
  speech_id?: string;
  audio_duration_ms?: number;
  audio_played_ms?: number;
  message?: string;
  metadata?: { speech_id?: string; audio_duration_ms?: number };
};

export type LabTtsFrame =
  | { kind: "control"; msg: LabTtsControl }
  | { kind: "audio"; data: Buffer }
  | { kind: "unknown"; raw: string };

/** Pure: how a raw `ws` message must be interpreted. Text frames are Buffers too. */
export function classifyDeepgramFrame(data: WebSocket.RawData | string, isBinary: boolean): LabTtsFrame {
  if (isBinary) {
    const buf = Buffer.isBuffer(data)
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data as ArrayBuffer);
    return { kind: "audio", data: buf };
  }
  const raw =
    typeof data === "string"
      ? data
      : Buffer.isBuffer(data)
        ? data.toString("utf8")
        : Array.isArray(data)
          ? Buffer.concat(data).toString("utf8")
          : Buffer.from(data as ArrayBuffer).toString("utf8");
  try {
    const msg = JSON.parse(raw) as LabTtsControl;
    if (msg && typeof msg.type === "string") return { kind: "control", msg };
    return { kind: "unknown", raw };
  } catch {
    return { kind: "unknown", raw };
  }
}

export type LabTtsResult = {
  status: "completed" | "interrupted" | "cancelled" | "failed";
  audioBytes: number;
  /** From SpeechMetadata / SpeechInterrupted when available, else derived from bytes. */
  audioDurationMs: number;
  firstAudioMs: number | null;
  transport: "websocket" | "rest";
  error?: string;
};

type ActiveSpeak = {
  seq: number;
  started: boolean; // SpeechStarted seen for this speak
  done: boolean;
  status: LabTtsResult["status"];
  error?: string;
  audioBytes: number;
  audioDurationMs: number | null;
  firstAudioAt: number | null;
  chunks: Buffer[];
  wake: (() => void) | null;
};

/** Minimal socket surface so tests can inject a fake. */
export type LabTtsSocket = Pick<WebSocket, "readyState" | "send" | "on" | "close">;

export class LabDeepgramTts {
  private readonly config: DeepgramTtsConfig;
  private ws: LabTtsSocket | null = null;
  private ready: Promise<boolean> | null = null;
  private active: ActiveSpeak | null = null;
  private seq = 0;
  private readonly connect: () => LabTtsSocket;
  /** Sent control messages (for diagnostics/tests). */
  readonly sent: string[] = [];

  private readonly restDisabled: boolean;

  constructor(config: DeepgramTtsConfig, opts?: { connect?: () => LabTtsSocket; disableRest?: boolean }) {
    this.config = config;
    this.restDisabled = opts?.disableRest ?? false;
    this.connect =
      opts?.connect ??
      (() =>
        new WebSocket(deepgramLiveSpeakUrl(this.config), {
          headers: { Authorization: `Token ${this.config.apiKey}` },
        }));
  }

  private sendJson(payload: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const raw = JSON.stringify(payload);
    this.sent.push(raw);
    this.ws.send(raw);
  }

  warmup(): Promise<boolean> {
    return this.ensureSocket();
  }

  private ensureSocket(): Promise<boolean> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve(true);
    if (this.ready) return this.ready;
    this.ready = new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (!ok) {
          this.ws = null;
          this.ready = null;
        }
        resolve(ok);
      };
      let ws: LabTtsSocket;
      try {
        ws = this.connect();
      } catch {
        finish(false);
        return;
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        finish(false);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }, 5000);
      if (ws.readyState === WebSocket.OPEN) {
        clearTimeout(timer);
        finish(true);
      }
      ws.on("open", () => {
        clearTimeout(timer);
        finish(true);
      });
      ws.on("message", (data, isBinary) => this.onFrame(classifyDeepgramFrame(data, isBinary)));
      ws.on("error", (err) => {
        clearTimeout(timer);
        if (this.active && !this.active.done) {
          this.active.done = true;
          this.active.status = "failed";
          this.active.error = err.message;
          this.active.wake?.();
        }
        finish(false);
      });
      ws.on("close", () => {
        clearTimeout(timer);
        if (this.ws === ws) {
          this.ws = null;
          this.ready = null;
        }
        if (this.active && !this.active.done) {
          this.active.done = true;
          this.active.status = "failed";
          this.active.error = this.active.error || "deepgram socket closed";
          this.active.wake?.();
        }
        finish(false);
      });
    });
    return this.ready;
  }

  private onFrame(frame: LabTtsFrame) {
    const a = this.active;
    if (!a || a.done) return;
    if (frame.kind === "audio") {
      // Audio before SpeechStarted belongs to a previous (interrupted) speech → drop.
      if (!a.started) return;
      if (!frame.data.length) return;
      if (a.firstAudioAt === null) a.firstAudioAt = Date.now();
      a.audioBytes += frame.data.length;
      a.chunks.push(frame.data);
      a.wake?.();
      return;
    }
    if (frame.kind !== "control") return;
    const m = frame.msg;
    switch (m.type) {
      case "Connected":
      case "Flushed":
      case "Warning":
        return;
      case "SpeechStarted":
        a.started = true;
        return;
      case "SpeechMetadata":
        a.audioDurationMs = m.audio_duration_ms ?? null;
        a.done = true;
        a.status = "completed";
        a.wake?.();
        return;
      case "SpeechInterrupted":
        a.audioDurationMs = m.audio_played_ms ?? m.metadata?.audio_duration_ms ?? null;
        a.done = true;
        a.status = a.status === "cancelled" ? "cancelled" : "interrupted";
        a.wake?.();
        return;
      case "Error":
        a.done = true;
        a.status = "failed";
        a.error = m.message || "deepgram error";
        a.wake?.();
        return;
      default:
        return;
    }
  }

  /** Stop the active speech. Remaining in-flight audio is discarded. */
  interrupt() {
    const a = this.active;
    if (!a || a.done) return;
    a.status = "cancelled";
    a.done = true;
    a.wake?.();
    try {
      this.sendJson({ type: "Interrupt" });
    } catch {
      /* ignore */
    }
  }

  close() {
    this.interrupt();
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.ready = null;
  }

  /**
   * Synthesize one utterance. Exactly one Speak+Flush; audio is delivered via onAudio.
   * `isCancelled()` is polled so the caller's epoch can stop delivery immediately.
   */
  async speak(
    text: string,
    onAudio: (mulaw8k: Buffer) => void,
    isCancelled: () => boolean = () => false
  ): Promise<LabTtsResult> {
    if (this.active && !this.active.done) this.interrupt();
    const ok = await this.ensureSocket();
    const startedAt = Date.now();
    if (ok && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const a: ActiveSpeak = {
        seq: ++this.seq,
        started: false,
        done: false,
        status: "failed",
        audioBytes: 0,
        audioDurationMs: null,
        firstAudioAt: null,
        chunks: [],
        wake: null,
      };
      this.active = a;
      try {
        this.sendJson({ type: "Speak", text });
        this.sendJson({ type: "Flush" });
      } catch (error) {
        a.done = true;
        a.status = "failed";
        a.error = error instanceof Error ? error.message : "send failed";
      }
      const deadline = startedAt + this.config.timeoutMs;
      while (true) {
        while (a.chunks.length) {
          const buf = a.chunks.shift();
          if (buf && !isCancelled()) onAudio(buf);
        }
        if (isCancelled() && !a.done) this.interrupt();
        if (a.done) break;
        if (a.firstAudioAt === null && Date.now() > deadline) {
          a.done = true;
          a.status = "failed";
          a.error = "deepgram live speak timeout (no audio)";
          break;
        }
        await new Promise<void>((resolve) => {
          a.wake = resolve;
          setTimeout(resolve, 40);
        });
        a.wake = null;
      }
      // Drain whatever arrived before done.
      while (a.chunks.length) {
        const buf = a.chunks.shift();
        if (buf && !isCancelled() && a.status === "completed") onAudio(buf);
      }
      if (this.active === a) this.active = null;
      const derivedMs = Math.round((a.audioBytes / 8000) * 1000);
      if (a.status !== "failed" || a.audioBytes > 0) {
        // NEVER fall back to REST once any audio was produced (that is how the duplicate happened).
        return {
          status: a.status,
          audioBytes: a.audioBytes,
          audioDurationMs: a.audioDurationMs ?? derivedMs,
          firstAudioMs: a.firstAudioAt ? a.firstAudioAt - startedAt : null,
          transport: "websocket",
          error: a.error,
        };
      }
      if (isCancelled()) {
        return { status: "cancelled", audioBytes: 0, audioDurationMs: 0, firstAudioMs: null, transport: "websocket" };
      }
      // Socket produced nothing at all → one REST attempt.
      this.ws = null;
      this.ready = null;
    }
    if (this.restDisabled) {
      return { status: "failed", audioBytes: 0, audioDurationMs: 0, firstAudioMs: null, transport: "websocket", error: "no audio and REST fallback disabled" };
    }
    return this.speakViaRest(text, onAudio, isCancelled, startedAt);
  }

  private async speakViaRest(
    text: string,
    onAudio: (mulaw8k: Buffer) => void,
    isCancelled: () => boolean,
    startedAt: number
  ): Promise<LabTtsResult> {
    try {
      const client = createDeepgramClient(this.config.apiKey);
      const result = await client.speak.v2.audio.generate(
        {
          text,
          model: this.config.model,
          speed: this.config.speed,
          expressivity: this.config.expressivity,
          encoding: "mulaw",
          sample_rate: 8000,
          container: "none",
        },
        { timeoutInSeconds: Math.ceil(this.config.timeoutMs / 1000), maxRetries: 0 }
      );
      const bytes = Buffer.from(await result.arrayBuffer());
      if (isCancelled()) {
        return { status: "cancelled", audioBytes: 0, audioDurationMs: 0, firstAudioMs: null, transport: "rest" };
      }
      const firstAudioMs = Date.now() - startedAt;
      // Deliver in 20 ms frames so the browser queue behaves like the streaming path.
      for (let i = 0; i < bytes.length; i += 160) {
        if (isCancelled()) {
          return {
            status: "cancelled",
            audioBytes: i,
            audioDurationMs: Math.round((i / 8000) * 1000),
            firstAudioMs,
            transport: "rest",
          };
        }
        onAudio(bytes.subarray(i, Math.min(bytes.length, i + 160)));
      }
      return {
        status: bytes.length ? "completed" : "failed",
        audioBytes: bytes.length,
        audioDurationMs: Math.round((bytes.length / 8000) * 1000),
        firstAudioMs,
        transport: "rest",
        error: bytes.length ? undefined : "deepgram rest returned empty audio",
      };
    } catch (error) {
      return {
        status: "failed",
        audioBytes: 0,
        audioDurationMs: 0,
        firstAudioMs: null,
        transport: "rest",
        error: error instanceof Error ? error.message : "deepgram rest failed",
      };
    }
  }
}
