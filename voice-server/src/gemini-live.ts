import WebSocket from "ws";
import { resolveGeminiLiveVoice, type GeminiLiveVoice } from "./config.js";

export type GeminiLiveHandlers = {
  /** PCM audio from Gemini Live; sampleRateHz from mime (usually 24000). */
  onAudioPcm24kBase64: (b64: string, sampleRateHz?: number) => void;
  onInterrupted: () => void;
  /** Interim lead transcription (do not persist). */
  onInputTranscriptInterim?: (text: string) => void;
  /** Final-ish lead transcription chunk (may still be incremental). */
  onInputTranscript?: (text: string) => void;
  onOutputTranscript?: (text: string) => void;
  onTurnComplete?: () => void;
  onGenerationComplete?: () => void;
  onError?: (message: string) => void;
  onSetupComplete?: () => void;
};

export type GeminiLiveSessionOptions = {
  apiKey: string;
  model: string;
  systemInstruction: string;
  voice?: GeminiLiveVoice;
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
  private readonly voice: GeminiLiveVoice;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly systemInstruction: string;
  private readonly handlers: GeminiLiveHandlers;

  constructor(options: GeminiLiveSessionOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.systemInstruction = options.systemInstruction;
    this.handlers = options.handlers;
    this.voice = options.voice || resolveGeminiLiveVoice();
  }

  get selectedVoice(): GeminiLiveVoice {
    return this.voice;
  }

  async connect(): Promise<void> {
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(this.apiKey)}`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;

      const timer = setTimeout(() => {
        reject(new Error("Gemini Live connection timeout"));
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }, 15000);

      ws.on("open", () => {
        const setup = {
          setup: {
            model: `models/${this.model}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: this.voice,
                  },
                },
              },
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
            outputAudioTranscription: {},
            // VAD: barge-in promptly; allow natural pauses so full utterances
            // like "Schedule a meeting with your members" complete before turn end.
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: false,
                startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
                endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
                prefixPaddingMs: 40,
                silenceDurationMs: 950,
              },
            },
          },
        };
        ws.send(JSON.stringify(setup));
      });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.setupComplete) {
            clearTimeout(timer);
            this.handlers.onSetupComplete?.();
            resolve();
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
        clearTimeout(timer);
        this.handlers.onError?.(err.message);
        reject(err);
      });

      ws.on("close", () => {
        this.closed = true;
        clearTimeout(timer);
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
      this.handlers.onInputTranscript?.(serverContent.inputTranscription.text);
    }

    if (serverContent.outputTranscription?.text) {
      this.handlers.onOutputTranscript?.(
        serverContent.outputTranscription.text
      );
    }

    const parts = serverContent.modelTurn?.parts ?? [];
    for (const part of parts) {
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
   * Prefer realtimeInput.text for live turns.
   */
  requestOpening() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        realtimeInput: {
          text: "The call was just answered. Greet them warmly by name if known, say who you are and which company, and ask if they have a quick moment. Sound like a calm human SDR — natural pace, not rushed. One short question only.",
        },
      })
    );
  }

  /** Soft nudge after lead end-intent so model can close briefly. */
  requestClosing() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.closed) return;
    // Closing prompt is allowed even after pauseInput().
    this.ws.send(
      JSON.stringify({
        realtimeInput: {
          text: "The lead wants to end the call. Say a single short goodbye and stop. Do not ask another question.",
        },
      })
    );
  }

  /**
   * Inject a system fact the model must follow (e.g. booking success/failure).
   * Allowed even briefly after pause when we need a truthful booking reply.
   */
  notifySystem(text: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.closed) return;
    this.ws.send(
      JSON.stringify({
        realtimeInput: {
          text: `SYSTEM (follow exactly; do not invent calendar facts): ${text}`,
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
