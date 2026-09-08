import WebSocket from "ws";
import {
  getVadSilenceMs,
  resolveGeminiLiveVoice,
  type GeminiLiveVoice,
} from "./config.js";

export type GeminiLiveHandlers = {
  /** PCM audio from Gemini Live; sampleRateHz from mime (usually 24000). */
  onAudioPcm24kBase64: (b64: string, sampleRateHz?: number) => void;
  onInterrupted: () => void;
  /** Interim lead transcription (do not persist). */
  onInputTranscriptInterim?: (text: string) => void;
  /** Final-ish lead transcription chunk (may still be incremental). */
  onInputTranscript?: (text: string, meta?: { finished?: boolean }) => void;
  onOutputTranscript?: (text: string, meta?: { finished?: boolean }) => void;
  onTurnComplete?: () => void;
  onGenerationComplete?: () => void;
  onError?: (message: string) => void;
  onSetupComplete?: () => void;
};

export type GeminiLiveResponseModality = "AUDIO" | "TEXT";

export type GeminiLiveSessionOptions = {
  apiKey: string;
  model: string;
  systemInstruction: string;
  voice?: GeminiLiveVoice;
  /** AUDIO (default) or TEXT when an external TTS provider speaks. */
  responseModalities?: GeminiLiveResponseModality[];
  vadSilenceMs?: number;
  handlers: GeminiLiveHandlers;
};

/**
 * Gemini Live API over raw WebSockets (BidiGenerateContent).
 * @see https://ai.google.dev/api/live
 * @see https://ai.google.dev/gemini-api/docs/live-api/capabilities
 */
export class GeminiLiveSession {
  private ws: WebSocket | null = null;
  private closed = false;
  /** After barge-in, drop stale outbound audio until a fresh model turn starts. */
  private dropOutboundAudio = false;
  /** True after interrupt until the first non-interrupted model audio arrives. */
  private awaitingFreshAudio = false;
  /** After end-call: ignore inbound mic audio and block new non-closing prompts. */
  private acceptInput = true;
  private openingSent = false;
  private readonly voice: GeminiLiveVoice;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly systemInstruction: string;
  private readonly handlers: GeminiLiveHandlers;
  private readonly responseModalities: GeminiLiveResponseModality[];
  private readonly vadSilenceMs: number;

  constructor(options: GeminiLiveSessionOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.systemInstruction = options.systemInstruction;
    this.handlers = options.handlers;
    this.voice = options.voice || resolveGeminiLiveVoice();
    this.responseModalities = options.responseModalities?.length
      ? options.responseModalities
      : ["AUDIO"];
    this.vadSilenceMs = options.vadSilenceMs ?? getVadSilenceMs();
  }

  get selectedVoice(): GeminiLiveVoice {
    return this.voice;
  }

  async connect(): Promise<void> {
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(this.apiKey)}`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        fn();
      };

      timer = setTimeout(() => {
        finish(() => {
          reject(new Error("Gemini Live connection timeout"));
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        });
      }, 15000);

      ws.on("open", () => {
        const useAudio = this.responseModalities.includes("AUDIO");
        const setup = {
          setup: {
            model: `models/${this.model}`,
            generationConfig: {
              responseModalities: this.responseModalities,
              ...(useAudio
                ? {
                    speechConfig: {
                      voiceConfig: {
                        prebuiltVoiceConfig: {
                          voiceName: this.voice,
                        },
                      },
                    },
                  }
                : {}),
              thinkingConfig: {
                thinkingLevel: "minimal",
              },
            },
            systemInstruction: {
              parts: [{ text: this.systemInstruction }],
            },
            // Prefer SMART cleanup when supported by the Live model.
            inputAudioTranscription: {
              mode: "SMART",
            },
            ...(useAudio ? { outputAudioTranscription: {} } : {}),
            // VAD: barge-in promptly; allow natural pauses so full utterances
            // like "Schedule a meeting with your members" complete before turn end.
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: false,
                startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
                endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
                prefixPaddingMs: 20,
                silenceDurationMs: this.vadSilenceMs,
              },
            },
          },
        };
        ws.send(JSON.stringify(setup));
      });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.error) {
            const errObj = msg.error as { message?: string; code?: number };
            const message = (errObj.message || "gemini live error").slice(0, 200);
            this.handlers.onError?.(message);
            finish(() => reject(new Error(message)));
            return;
          }
          if (msg.setupComplete) {
            finish(() => {
              this.handlers.onSetupComplete?.();
              resolve();
            });
            return;
          }
          this.handleServerMessage(msg);
        } catch (error) {
          this.handlers.onError?.(
            error instanceof Error ? error.message : "parse error"
          );
        }
      });

      ws.on("error", (err) => {
        this.handlers.onError?.(err.message);
        finish(() => reject(err));
      });

      ws.on("close", () => {
        this.closed = true;
        finish(() =>
          reject(new Error("Gemini Live closed before setup complete"))
        );
      });
    });
  }

  private handleServerMessage(msg: Record<string, unknown>) {
    const serverContent = msg.serverContent as
      | {
          interrupted?: boolean;
          turnComplete?: boolean;
          generationComplete?: boolean;
          modelTurn?: {
            parts?: Array<{
              inlineData?: { data?: string; mimeType?: string };
              text?: string;
            }>;
          };
          inputTranscription?: { text?: string; finished?: boolean };
          outputTranscription?: { text?: string; finished?: boolean };
          interimInputTranscription?: { text?: string };
        }
      | undefined;

    if (!serverContent) return;

    const wasInterrupted = Boolean(serverContent.interrupted);
    if (wasInterrupted) {
      this.dropOutboundAudio = true;
      this.awaitingFreshAudio = true;
      this.handlers.onInterrupted();
    }

    if (serverContent.interimInputTranscription?.text) {
      this.handlers.onInputTranscriptInterim?.(
        serverContent.interimInputTranscription.text
      );
    }

    if (serverContent.inputTranscription?.text) {
      this.handlers.onInputTranscript?.(
        serverContent.inputTranscription.text,
        { finished: serverContent.inputTranscription.finished }
      );
    }

    if (serverContent.outputTranscription?.text) {
      this.handlers.onOutputTranscript?.(
        serverContent.outputTranscription.text,
        { finished: serverContent.outputTranscription.finished }
      );
    }

    const parts = serverContent.modelTurn?.parts ?? [];
    for (const part of parts) {
      if (part.text) {
        this.handlers.onOutputTranscript?.(part.text);
      }
      const data = part.inlineData?.data;
      const mime = part.inlineData?.mimeType || "";
      if (!(data && mime.includes("audio"))) continue;

      // Drop any audio packaged with the interrupt signal (stale).
      if (wasInterrupted) continue;

      // After barge-in, the next model audio without interrupt is the fresh turn.
      if (this.dropOutboundAudio) {
        if (this.awaitingFreshAudio) {
          this.dropOutboundAudio = false;
          this.awaitingFreshAudio = false;
        } else {
          continue;
        }
      }

      const rateMatch = mime.match(/rate\s*=\s*(\d+)/i);
      const sampleRateHz = rateMatch
        ? Number.parseInt(rateMatch[1], 10)
        : 24000;
      this.handlers.onAudioPcm24kBase64(data, sampleRateHz);
    }

    if (serverContent.generationComplete) {
      this.handlers.onGenerationComplete?.();
    }
    if (serverContent.turnComplete) {
      this.handlers.onTurnComplete?.();
    }
  }

  /** Stop accepting lead audio / new turns (call-end guard). */
  pauseInput() {
    this.acceptInput = false;
  }

  get isAcceptingInput() {
    return this.acceptInput && !this.closed;
  }

  sendPcm16kBase64(b64: string) {
    if (
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN ||
      this.closed ||
      !this.acceptInput
    ) {
      return;
    }
    this.ws.send(
      JSON.stringify({
        realtimeInput: {
          audio: {
            data: b64,
            mimeType: "audio/pcm;rate=16000",
          },
        },
      })
    );
  }

  /**
   * Kick off the agent greeting after setup.
   * Uses a non-conversational event token; opening behavior lives in systemInstruction.
   */
  requestOpening() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.openingSent) return;
    this.openingSent = true;
    this.ws.send(
      JSON.stringify({
        clientContent: {
          turns: [
            {
              role: "user",
              parts: [{ text: "[EVENT:call_answered]" }],
            },
          ],
          turnComplete: true,
        },
      })
    );
  }

  /** Soft nudge after lead end-intent so model can close briefly. */
  requestClosing() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.closed) return;
    this.ws.send(
      JSON.stringify({
        clientContent: {
          turns: [
            {
              role: "user",
              parts: [{ text: "[EVENT:lead_end] Say one short goodbye. Stop. No question." }],
            },
          ],
          turnComplete: true,
        },
      })
    );
  }

  /**
   * Inject a concise internal runtime fact (booking result, pace, appt stage).
   * Must not be spoken verbatim.
   * generate=false: do not start a new model turn (avoids [INTERNAL] speech).
   */
  notifySystem(text: string, opts?: { generate?: boolean }) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.closed) return;
    const compact = text.replace(/\s+/g, " ").trim().slice(0, 280);
    const payload = compact.startsWith("[INTERNAL]")
      ? compact
      : `[INTERNAL] ${compact}`;
    this.ws.send(
      JSON.stringify({
        clientContent: {
          turns: [
            {
              role: "user",
              parts: [
                {
                  text: `${payload} (Do not read this tag aloud. Follow the fact.)`,
                },
              ],
            },
          ],
          turnComplete: opts?.generate === true,
        },
      })
    );
  }

  close() {
    this.closed = true;
    this.acceptInput = false;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}
