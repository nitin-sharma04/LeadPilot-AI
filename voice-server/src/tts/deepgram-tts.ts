/**
 * Deepgram Flux TTS adapter.
 * Same flux-hannah-en voice; WebSocket streaming with REST fallback.
 * Never logs API keys or audio content.
 */

import { Readable } from "stream";
import WebSocket from "ws";
import { DeepgramClient } from "@deepgram/sdk";

export type DeepgramTtsConfig = {
  apiKey: string;
  model: string;
  speed: number;
  expressivity: number;
  timeoutMs: number;
};

export type DeepgramTtsTiming = {
  textChars: number;
  ttsStartMs: number;
  firstAudioMs: number | null;
  totalAudioBytes: number;
  transport?: "websocket" | "rest";
};

export class DeepgramTtsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeepgramTtsError";
  }
}

export function loadDeepgramTtsConfig(
  env: NodeJS.ProcessEnv = process.env
): DeepgramTtsConfig | null {
  const apiKey = env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) return null;
  const speedRaw = Number.parseFloat(env.DEEPGRAM_TTS_SPEED || "1");
  const expressivityRaw = Number.parseInt(
    env.DEEPGRAM_TTS_EXPRESSIVITY || "0",
    10
  );
  const timeoutRaw = Number.parseInt(env.DEEPGRAM_TTS_TIMEOUT_MS || "8000", 10);
  const speed = Number.isFinite(speedRaw) ? speedRaw : 1;
  const clampedSpeed = Math.min(1.15, Math.max(0.85, speed));
  const expressivity = Number.isFinite(expressivityRaw) ? expressivityRaw : 0;
  const clampedExpressivity = Math.min(2, Math.max(-2, expressivity));
  return {
    apiKey,
    model: env.DEEPGRAM_TTS_MODEL?.trim() || "flux-hannah-en",
    speed: clampedSpeed,
    expressivity: clampedExpressivity,
    timeoutMs:
      Number.isFinite(timeoutRaw) && timeoutRaw >= 1000 ? timeoutRaw : 8000,
  };
}

export function createDeepgramClient(apiKey: string): DeepgramClient {
  return new DeepgramClient({ apiKey });
}

export function deepgramLiveSpeakUrl(config: DeepgramTtsConfig): string {
  const q = new URLSearchParams({
    model: config.model,
    encoding: "mulaw",
    sample_rate: "8000",
    speed: String(config.speed),
    expressivity: String(config.expressivity),
  });
  return `wss://api.deepgram.com/v2/speak?${q.toString()}`;
}

export class DeepgramTtsSession {
  cancelled = false;
  lastTiming: DeepgramTtsTiming | null = null;
  private restAbort: AbortController | null = null;
  private readonly config: DeepgramTtsConfig;
  private readonly client: DeepgramClient;
  private live: WebSocket | null = null;
  private liveReady: Promise<boolean> | null = null;
  private turnSeq = 0;

  constructor(config: DeepgramTtsConfig, client?: DeepgramClient) {
    this.config = config;
    this.client = client ?? createDeepgramClient(config.apiKey);
  }

  /** Open the streaming speak socket early (does not change voice/model). */
  warmup(): Promise<boolean> {
    return this.ensureLive();
  }

  interrupt() {
    this.cancelled = true;
    this.turnSeq += 1;
    try {
      this.restAbort?.abort();
    } catch {
      /* ignore */
    }
    try {
      if (this.live && this.live.readyState === WebSocket.OPEN) {
        this.live.send(JSON.stringify({ type: "Interrupt" }));
      }
    } catch {
      /* ignore */
    }
  }

  cancel() {
    this.interrupt();
  }

  close() {
    this.interrupt();
    try {
      this.live?.close();
    } catch {
      /* ignore */
    }
    this.live = null;
    this.liveReady = null;
  }

  private ensureLive(): Promise<boolean> {
    if (this.live && this.live.readyState === WebSocket.OPEN) {
      return Promise.resolve(true);
    }
    if (this.liveReady) return this.liveReady;
    this.liveReady = new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (!ok) {
          this.live = null;
          this.liveReady = null;
        }
        resolve(ok);
      };
      try {
        const ws = new WebSocket(deepgramLiveSpeakUrl(this.config), {
          headers: { Authorization: `Token ${this.config.apiKey}` },
        });
        this.live = ws;
        const timer = setTimeout(() => {
          finish(false);
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        }, 4000);
        ws.on("open", () => {
          /* wait for Connected JSON if it arrives; socket open is enough to Speak */
          clearTimeout(timer);
          finish(true);
        });
        ws.on("error", () => {
          clearTimeout(timer);
          finish(false);
        });
        ws.on("close", () => {
          if (this.live === ws) {
            this.live = null;
            this.liveReady = null;
          }
          clearTimeout(timer);
          finish(false);
        });
      } catch {
        finish(false);
      }
    });
    return this.liveReady;
  }

  /**
   * Stream raw µ-law 8 kHz from Flux TTS.
   * WebSocket first; REST batch if the live socket is unavailable.
   */
  async *synthesizeMulaw8k(text: string): AsyncGenerator<Buffer> {
    this.cancelled = false;
    const liveOk = await this.ensureLive();
    if (liveOk && this.live && this.live.readyState === WebSocket.OPEN) {
      try {
        yield* this.synthesizeViaWebsocket(text);
        return;
      } catch (error) {
        if (this.cancelled) return;
        console.warn("[deepgram-tts] websocket speak failed; falling back to REST", {
          errorType: error instanceof Error ? error.name : "error",
        });
        this.live = null;
        this.liveReady = null;
      }
    }
    yield* this.synthesizeViaRest(text);
  }

  private async *synthesizeViaWebsocket(text: string): AsyncGenerator<Buffer> {
    const ws = this.live;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new DeepgramTtsError("deepgram live socket not open");
    }
    const timing: DeepgramTtsTiming = {
      textChars: text.length,
      ttsStartMs: Date.now(),
      firstAudioMs: null,
      totalAudioBytes: 0,
      transport: "websocket",
    };
    this.lastTiming = timing;
    const myTurn = ++this.turnSeq;
    const chunks: Buffer[] = [];
    let done = false;
    let failed: Error | null = null;
    let notify: (() => void) | null = null;
    const wait = () =>
      new Promise<void>((resolve) => {
        notify = resolve;
      });
    const kick = () => {
      notify?.();
      notify = null;
    };

    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      if (this.turnSeq !== myTurn) return;
      if (isBinary || Buffer.isBuffer(data)) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (!buf.length) return;
        chunks.push(buf);
        kick();
        return;
      }
      const raw = typeof data === "string" ? data : data.toString();
      try {
        const msg = JSON.parse(raw) as { type?: string; message?: string };
        if (msg.type === "Error" || msg.type === "Warning") {
          if (msg.type === "Error") {
            failed = new DeepgramTtsError(msg.message || "deepgram live error");
            done = true;
            kick();
          }
          return;
        }
        if (msg.type === "Flushed" || msg.type === "SpeechInterrupted") {
          done = true;
          kick();
        }
      } catch {
        const buf = Buffer.from(raw);
        if (buf.length) chunks.push(buf);
        kick();
      }
    };

    ws.on("message", onMessage);
    try {
      ws.send(JSON.stringify({ type: "Speak", text }));
      ws.send(JSON.stringify({ type: "Flush" }));
      const deadline = Date.now() + this.config.timeoutMs;
      while (!this.cancelled && this.turnSeq === myTurn) {
        while (chunks.length) {
          const buf = chunks.shift();
          if (!buf) continue;
          if (timing.firstAudioMs === null) {
            timing.firstAudioMs = Date.now() - timing.ttsStartMs;
          }
          timing.totalAudioBytes += buf.length;
          yield buf;
        }
        if (done || failed) break;
        if (Date.now() > deadline) {
          throw new DeepgramTtsError("deepgram live speak timeout");
        }
        await Promise.race([
          wait(),
          new Promise((r) => setTimeout(r, 50)),
        ]);
      }
      if (failed) throw failed;
      if (!this.cancelled && timing.totalAudioBytes === 0) {
        throw new DeepgramTtsError("deepgram live returned empty audio");
      }
    } finally {
      ws.off("message", onMessage);
    }
  }

  private async *synthesizeViaRest(text: string): AsyncGenerator<Buffer> {
    const timing: DeepgramTtsTiming = {
      textChars: text.length,
      ttsStartMs: Date.now(),
      firstAudioMs: null,
      totalAudioBytes: 0,
      transport: "rest",
    };
    this.lastTiming = timing;
    if (this.cancelled) {
      return;
    }

    let result;
    this.restAbort = new AbortController();
    try {
      result = await this.client.speak.v2.audio.generate(
        {
          text,
          model: this.config.model,
          speed: this.config.speed,
          expressivity: this.config.expressivity,
          encoding: "mulaw",
          sample_rate: 8000,
          container: "none",
        },
        {
          timeoutInSeconds: Math.ceil(this.config.timeoutMs / 1000),
          abortSignal: this.restAbort.signal,
          maxRetries: 0,
        }
      );
    } catch (error) {
      throw new DeepgramTtsError(
        error instanceof Error ? error.message : "deepgram generate failed"
      );
    }

    const webStream = result.stream();
    if (!webStream) {
      throw new DeepgramTtsError("deepgram returned empty stream");
    }

    const nodeStream = Readable.fromWeb(
      webStream as import("stream/web").ReadableStream
    );

    try {
      for await (const chunk of nodeStream) {
        if (this.cancelled) break;
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (!buf.length) continue;
        if (timing.firstAudioMs === null) {
          timing.firstAudioMs = Date.now() - timing.ttsStartMs;
        }
        timing.totalAudioBytes += buf.length;
        yield buf;
      }
    } catch (error) {
      if (this.cancelled) return;
      throw new DeepgramTtsError(
        error instanceof Error ? error.message : "deepgram stream failed"
      );
    }

    if (!this.cancelled && timing.totalAudioBytes === 0) {
      throw new DeepgramTtsError("deepgram returned empty audio");
    }
  }

  /** MP3 for local listening tests (not used on the Twilio path). */
  async synthesizeMp3(text: string): Promise<Buffer> {
    const result = await this.client.speak.v2.audio.generate(
      {
        text,
        model: this.config.model,
        speed: this.config.speed,
        expressivity: this.config.expressivity,
      },
      {
        timeoutInSeconds: Math.ceil(this.config.timeoutMs / 1000),
        maxRetries: 0,
      }
    );
    const bytes = await result.arrayBuffer();
    const buf = Buffer.from(bytes);
    if (!buf.length) throw new DeepgramTtsError("deepgram mp3 was empty");
    return buf;
  }
}

/** Safe log payload — no secrets, no text content. */
export function deepgramTimingLog(
  timing: DeepgramTtsTiming,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  return {
    textChars: timing.textChars,
    ttsStartMs: timing.ttsStartMs,
    firstAudioMs: timing.firstAudioMs,
    totalAudioBytes: timing.totalAudioBytes,
    transport: timing.transport || "rest",
    ...extra,
  };
}
