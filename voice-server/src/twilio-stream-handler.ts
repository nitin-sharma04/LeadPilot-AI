import type WebSocket from "ws";
import {
  isVoiceAudioDebugEnabled,
  logVoiceAudioStats,
  mulaw8kToPcm16kBase64,
  parsePcmSampleRate,
  StreamingGeminiAudioPipeline,
} from "./audio.js";
import {
  bookAppointmentFromVoiceCall,
  finalizeVoiceAppointment,
} from "./appointment-api.js";
import { AppointmentIntentTracker } from "./appointment-intent-tracker.js";
import { CallEndController } from "./call-end-controller.js";
import { getLiveModel, getMaxCallDurationSeconds, getVadSilenceMs, resolveGeminiLiveVoice } from "./config.js";
import { buildSystemInstruction, noteCallEndReason, validateStreamSession } from "./db.js";
import {
  detectsAgentFarewell,
  detectsEndCallIntent,
  detectsForceHangupIntent,
  isUnclearUtterance,
} from "./end-call-intent.js";
import { GeminiLiveSession } from "./gemini-live.js";
import { OutboundMulawFrameBuffer } from "./outbound-mulaw-buffer.js";
import {
  detectsSlowSpeechRequest,
  slowSpeechSystemNudge,
  type SpeechPace,
} from "./speech-pace.js";
import { TranscriptFinalizer } from "./transcript-finalizer.js";
import { completeTwilioCall } from "./twilio-hangup.js";
import {
  DeepgramTtsError,
  DeepgramTtsSession,
  deepgramTimingLog,
  loadDeepgramTtsConfig,
} from "./tts/deepgram-tts.js";
import { spokenBookingFailure, spokenBookingSuccess } from "./tts/booking-speech.js";
import { prepareSpokenAgentText } from "./tts/spoken-guard.js";
import {
  isLikelyUnsupportedForFluxEnglish,
  shouldSkipDuplicateSynthesis,
  toSpeakableAgentText,
} from "./tts/speakable-text.js";
import { resolveVoiceTtsProvider, type VoiceTtsProvider } from "./tts/tts-provider.js";
import {
  emptyVoiceLatencyMarks,
  logVoiceLatency,
} from "./voice-latency.js";

type TwilioEvent = {
  event?: string;
  streamSid?: string;
  start?: {
    streamSid?: string;
    callSid?: string;
    customParameters?: Record<string, string>;
  };
  media?: { payload?: string; track?: string };
  mark?: { name?: string };
  stop?: { callSid?: string };
};

/**
 * Bridges one Twilio bidirectional Media Stream ↔ Gemini Live session.
 * Call termination: farewell audio → Twilio mark → REST Status=completed.
 */
export async function handleTwilioMediaStream(twilioWs: WebSocket) {
  let streamSid = "";
  let callId = "";
  let streamToken = "";
  let providerCallSid = "";
  let gemini: GeminiLiveSession | null = null;
  let markCounter = 0;
  let lastMarkName: string | null = null;
  let finalizer: TranscriptFinalizer | null = null;
  let endController: CallEndController | null = null;
  let agentTurnCount = 0;
  let maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  let closingPromptSent = false;
  const apptTracker = new AppointmentIntentTracker();
  let finalizeApptSent = false;
  let speechPace: SpeechPace = "normal";
  let lastCoachingHint: string | null = null;
  const audioPipeline = new StreamingGeminiAudioPipeline();
  const outboundBuffer = new OutboundMulawFrameBuffer();
  let audioChunkSeq = 0;
  let ttsProvider: VoiceTtsProvider = "gemini";
  let deepgramSession: DeepgramTtsSession | null = null;
  let lastDeepgramSpoken: string | null = null;
  let deepgramTurnInFlight = false;
  let skipNextAgentSpeak = false;
  let leadSpokeAfterBooking = false;
  let agentSpokenThisTurn = false;
  let latency = emptyVoiceLatencyMarks();

  const tryBookOnLeadConfirmation = async (leadText: string) => {
    if (!callId || !streamToken || !gemini) return;
    apptTracker.noteLead(leadText);
    if (!apptTracker.shouldAttemptBooking(leadText)) return;

    apptTracker.markBookingAttempted();
    // Stop any premature "invite sent" audio already generating.
    clearOutboundAudio();
    finalizer?.discardAgentBuffer();
    skipNextAgentSpeak = true;

    try {
      const result = await bookAppointmentFromVoiceCall({
        callId,
        streamToken,
        preferredTimeText: apptTracker.preferredText,
        explicitConfirmation: true,
      });
      console.info("[voice-server] mid-call book result", {
        callId,
        booked: result.booked,
        appointmentStatus: result.appointmentStatus,
        reason: result.reason ?? null,
        appointmentId: result.appointmentId ?? null,
      });
      if (result.booked) {
        apptTracker.markBooked();
        leadSpokeAfterBooking = false;
        const spoken = spokenBookingSuccess({
          displayWhen: result.displayWhen || result.preferredText,
          timezone: result.timezone,
        });
        gemini.notifySystem(
          `[INTERNAL] booking_ok when=${result.displayWhen || "agreed time"}${
            result.timezone ? ` tz=${result.timezone}` : ""
          }. Already spoken. Do not repeat. Do not goodbye yet.`,
          { generate: false }
        );
        await speakAuthoritativeAgent(spoken);
      } else if (result.reason === "ambiguous_time") {
        apptTracker.resetBookingAttempt();
        gemini.notifySystem(
          "[INTERNAL] booking_fail=ambiguous_time. Ask one clock-time clarification. Do not claim invite sent.",
          { generate: false }
        );
        await speakAuthoritativeAgent(
          "What clock time should I use? For example, five PM."
        );
      } else {
        apptTracker.markFailed();
        gemini.notifySystem(
          "[INTERNAL] booking_fail. Say booking did not complete; offer another time. Do not claim invite sent.",
          { generate: false }
        );
        await speakAuthoritativeAgent(spokenBookingFailure());
      }
    } catch (error) {
      apptTracker.markFailed();
      console.error("[voice-server] mid-call book error", {
        callId,
        message: error instanceof Error ? error.message : "unknown",
      });
      gemini.notifySystem(
        "[INTERNAL] booking_fail. Say booking did not complete; offer another time. Do not claim invite sent.",
        { generate: false }
      );
      await speakAuthoritativeAgent(spokenBookingFailure());
    }
  };

  const sendClear = () => {
    if (!streamSid || twilioWs.readyState !== twilioWs.OPEN) return;
    twilioWs.send(JSON.stringify({ event: "clear", streamSid }));
  };

  /** Send µ-law media only — no mark (marks are farewell sync only). */
  const sendMediaFrame = (mulawChunk: Buffer) => {
    if (!streamSid || twilioWs.readyState !== twilioWs.OPEN) return;
    if (endController && !endController.shouldAcceptOutboundAudio) return;
    if (!mulawChunk.length) return;
    twilioWs.send(
      JSON.stringify({
        event: "media",
        streamSid,
        media: { payload: mulawChunk.toString("base64") },
      })
    );
  };

  const enqueueMulaw = (mulaw: Buffer) => {
    const frames = outboundBuffer.push(mulaw);
    for (const frame of frames) sendMediaFrame(frame);
  };

  /** Flush partial frame + optional farewell mark for hangup sync. */
  const flushOutbound = (opts?: { sendFarewellMark?: boolean }) => {
    const tail = audioPipeline.flush();
    if (tail.length) enqueueMulaw(tail);
    const rem = outboundBuffer.flush();
    if (rem) sendMediaFrame(rem);

    if (opts?.sendFarewellMark) {
      markCounter += 1;
      lastMarkName = `farewell_${markCounter}`;
      if (streamSid && twilioWs.readyState === twilioWs.OPEN) {
        twilioWs.send(
          JSON.stringify({
            event: "mark",
            streamSid,
            mark: { name: lastMarkName },
          })
        );
      }
      if (endController?.awaitingFarewellMark && lastMarkName) {
        endController.extendFarewellMark(lastMarkName);
      }
    }
  };

  const cancelDeepgramTts = () => {
    deepgramSession?.interrupt();
    deepgramTurnInFlight = false;
  };

  const clearOutboundAudio = () => {
    cancelDeepgramTts();
    outboundBuffer.clear();
    audioPipeline.reset();
    sendClear();
  };

  /**
   * Speak one finalized Gemini transcript via Deepgram µ-law.
   * Does not fall back to Gemini native audio mid-turn (that audio was dropped).
   */
  const speakDeepgramTurn = async (agentText: string): Promise<boolean> => {
    const speakable = toSpeakableAgentText(agentText);
    if (!speakable) return false;
    if (shouldSkipDuplicateSynthesis(lastDeepgramSpoken, speakable)) return false;
    if (isLikelyUnsupportedForFluxEnglish(speakable)) {
      console.warn("[deepgram-tts] skipped unsupported language (Flux is English-only)", {
        callId,
        chars: speakable.length,
      });
      return false;
    }

    const cfg = loadDeepgramTtsConfig();
    if (!cfg) {
      console.error("[deepgram-tts] missing config; turn audio skipped");
      return false;
    }

    deepgramSession?.interrupt();
    if (!deepgramSession) {
      deepgramSession = new DeepgramTtsSession(cfg);
      void deepgramSession.warmup();
    }
    const session = deepgramSession;
    deepgramTurnInFlight = true;
    lastDeepgramSpoken = speakable;
    latency.deepgramFirstAudioAt = null;
    latency.twilioFirstAudioAt = null;
    let firstTwilioFrameMs: number | null = null;
    const wallStart = Date.now();

    try {
      for await (const chunk of session.synthesizeMulaw8k(speakable)) {
        if (session.cancelled) return false;
        if (endController && !endController.shouldAcceptOutboundAudio) return false;
        if (latency.deepgramFirstAudioAt === null) {
          latency.deepgramFirstAudioAt = Date.now();
        }
        const framesBefore = outboundBuffer.emittedFrameCount;
        enqueueMulaw(chunk);
        if (
          firstTwilioFrameMs === null &&
          outboundBuffer.emittedFrameCount > framesBefore
        ) {
          firstTwilioFrameMs = Date.now() - wallStart;
          if (latency.twilioFirstAudioAt === null) {
            latency.twilioFirstAudioAt = Date.now();
          }
        }
      }
      if (session.cancelled) return false;
      flushOutbound();
      const timing = session.lastTiming;
      if (
        latency.twilioFirstAudioAt === null &&
        timing &&
        timing.totalAudioBytes > 0
      ) {
        latency.twilioFirstAudioAt = Date.now();
      }
      console.info("[deepgram-tts]", {
        callId,
        ...(timing ? deepgramTimingLog(timing) : {}),
        firstTwilioFrameMs,
      });
      logVoiceLatency(callId, latency);
      return Boolean(timing && timing.totalAudioBytes > 0);
    } catch (error) {
      if (session.cancelled) return false;
      console.error("[deepgram-tts] synthesize failed", {
        callId,
        errorType: error instanceof DeepgramTtsError ? error.name : "error",
        message: error instanceof Error ? error.message : "unknown",
      });
      return false;
    } finally {
      if (deepgramSession === session) {
        deepgramTurnInFlight = false;
      }
    }
  };

  const speakAuthoritativeAgent = async (text: string): Promise<boolean> => {
    const prepared = prepareSpokenAgentText(text, {
      hasBooked: apptTracker.hasBooked,
      dateHint: apptTracker.dateHint,
      timeHint: apptTracker.timeHint,
    });
    if (!prepared) return false;
    latency.agentTextReadyAt = Date.now();
    agentSpokenThisTurn = true;
    agentTurnCount += 1;
    apptTracker.noteAgent(prepared);
    void finalizer?.persistSpokenAgent(prepared);
    if (ttsProvider === "deepgram") {
      return speakDeepgramTurn(prepared);
    }
    // Gemini native audio path: prepared text is already persisted; Live speaks it.
    gemini?.notifySystem(
      `[INTERNAL] speak_this_turn=${prepared.slice(0, 180)}`,
      { generate: true }
    );
    return true;
  };

  const prepareAndSpeakGeminiTurn = async (rawAgent: string | null) => {
    if (skipNextAgentSpeak) {
      skipNextAgentSpeak = false;
      finalizer?.discardAgentBuffer();
      return null;
    }
    if (agentSpokenThisTurn) {
      finalizer?.discardAgentBuffer();
      return null;
    }
    const prepared = prepareSpokenAgentText(rawAgent, {
      hasBooked: apptTracker.hasBooked,
      dateHint: apptTracker.dateHint,
      timeHint: apptTracker.timeHint,
    });
    if (!prepared) {
      finalizer?.discardAgentBuffer();
      return null;
    }
    if (/\[INTERNAL\]|\[EVENT:|booking_ok/i.test(rawAgent || "")) {
      console.info("[voice-server] stripped internal markers from agent speech", {
        callId,
      });
    }
    latency.agentTextReadyAt = Date.now();
    agentSpokenThisTurn = true;
    agentTurnCount += 1;
    apptTracker.noteAgent(prepared);
    void finalizer?.persistSpokenAgent(prepared);
    if (ttsProvider === "deepgram") {
      await speakDeepgramTurn(prepared);
    }
    return prepared;
  };

  const teardownMedia = () => {
    if (maxDurationTimer) {
      clearTimeout(maxDurationTimer);
      maxDurationTimer = null;
    }
    cancelDeepgramTts();
    deepgramSession?.close();
    deepgramSession = null;
    try {
      if (twilioWs.readyState === twilioWs.OPEN) twilioWs.close();
    } catch {
      /* ignore */
    }
    gemini?.close();
    gemini = null;
  };

  const beginEndFlow = (input: {
    reason: "lead_hangup" | "lead_force_hangup" | "agent_farewell" | "max_duration";
    awaitFarewellDelivery: boolean;
    sendClosingPrompt: boolean;
  }) => {
    if (!endController) return;
    const { accepted } = endController.requestEnd({
      reason: input.reason,
      awaitFarewellDelivery: input.awaitFarewellDelivery,
    });
    if (!accepted) return;

    gemini?.pauseInput();

    if (input.reason === "max_duration") {
      void noteCallEndReason({ callId, reason: "max_duration_reached" });
    } else if (input.reason === "lead_force_hangup") {
      void noteCallEndReason({ callId, reason: "lead_force_hangup" });
    }

    if (input.sendClosingPrompt && !closingPromptSent) {
      closingPromptSent = true;
      gemini?.requestClosing();
      // If closing generation never completes, still terminate (cost protection).
      setTimeout(() => {
        if (
          endController &&
          endController.isEnding &&
          !endController.isTerminated &&
          !endController.awaitingFarewellMark
        ) {
          flushOutbound({ sendFarewellMark: true });
          endController.notifyFarewellEnqueued(lastMarkName);
        }
      }, 4000);
    }

    // Agent farewell already played — flush remaining audio then mark for hangup sync.
    if (input.reason === "agent_farewell" && input.awaitFarewellDelivery) {
      flushOutbound({ sendFarewellMark: true });
      endController.notifyFarewellEnqueued(lastMarkName);
    }

    // Max duration: hang up immediately (no farewell wait).
    if (!input.awaitFarewellDelivery) {
      /* requestEnd already started hangup */
    }
  };

  twilioWs.on("message", async (raw) => {
    let msg: TwilioEvent;
    try {
      msg = JSON.parse(raw.toString()) as TwilioEvent;
    } catch {
      return;
    }

    if (msg.event === "connected") return;

    if (msg.event === "mark") {
      const name = msg.mark?.name || "";
      endController?.onTwilioMark(name);
      return;
    }

    if (msg.event === "start") {
      streamSid = msg.start?.streamSid || msg.streamSid || "";
      providerCallSid = msg.start?.callSid || "";
      const params = msg.start?.customParameters || {};
      callId = params.callId || "";
      streamToken = params.streamToken || "";

      if (!callId || !streamToken) {
        console.error("[voice-server] missing callId/streamToken");
        twilioWs.close();
        return;
      }

      const call = await validateStreamSession({ callId, streamToken });
      if (!call) {
        console.error("[voice-server] unauthorized stream session", { callId });
        twilioWs.close();
        return;
      }

      // Prefer live stream CallSid; fall back to DB providerCallId.
      if (!providerCallSid && call.providerCallId) {
        providerCallSid = call.providerCallId;
      }

      const apiKey = process.env.GEMINI_API_KEY?.trim();
      if (!apiKey) {
        console.error("[voice-server] GEMINI_API_KEY missing");
        twilioWs.close();
        return;
      }

      const model = getLiveModel();
      const voice = resolveGeminiLiveVoice();
      ttsProvider = resolveVoiceTtsProvider();
      if (ttsProvider === "deepgram" && !loadDeepgramTtsConfig()) {
        console.warn(
          "[deepgram-tts] VOICE_TTS_PROVIDER=deepgram but DEEPGRAM_API_KEY is missing; using gemini native audio"
        );
        ttsProvider = "gemini";
      }
      lastDeepgramSpoken = null;
      if (ttsProvider === "deepgram") {
        const dgCfg = loadDeepgramTtsConfig();
        if (dgCfg) {
          deepgramSession = new DeepgramTtsSession(dgCfg);
          void deepgramSession.warmup();
        }
      }
      finalizer = new TranscriptFinalizer(callId);

      const runAppointmentFinalize = async () => {
        if (finalizeApptSent || !callId || !streamToken) return;
        finalizeApptSent = true;
        await finalizeVoiceAppointment({
          callId,
          streamToken,
          preferredTimeText: apptTracker.preferredText || undefined,
          explicitConfirmation:
            apptTracker.appointmentStatus === "confirmed" ||
            apptTracker.appointmentStatus === "booked" ||
            apptTracker.hasAttemptedBooking,
        });
      };

      endController = new CallEndController({
        callId,
        getProviderCallSid: () => providerCallSid || call.providerCallId || "",
        hangupTwilio: completeTwilioCall,
        markFallbackMs: 2500,
        onBeforeHangup: async () => {
          await finalizer?.flushAll();
          // Stop generating; do not clear — farewell may still be in Twilio buffer.
          gemini?.pauseInput();
          // Ensure booking runs even if Twilio status webhook is missed.
          await runAppointmentFinalize();
        },
        onAfterHangupAttempt: async ({ ok, reason }) => {
          console.info("[voice-server] twilio hangup result", {
            callId,
            ok,
            reason,
          });
          // Close media after hangup attempt so Connect → Hangup TwiML can finish
          // even if REST temporarily failed (status webhook remains authoritative).
          teardownMedia();
        },
      });

      const maxSeconds = getMaxCallDurationSeconds();
      maxDurationTimer = setTimeout(() => {
        console.info("[voice-server] max call duration reached", {
          callId,
          maxSeconds,
        });
        beginEndFlow({
          reason: "max_duration",
          awaitFarewellDelivery: false,
          sendClosingPrompt: false,
        });
      }, maxSeconds * 1000);

      try {
        gemini = new GeminiLiveSession({
          apiKey,
          model,
          voice,
          systemInstruction: buildSystemInstruction(call),
          // Native-audio Live models require AUDIO. Deepgram still speaks
          // finalized text; Gemini audio is discarded below.
          responseModalities: ["AUDIO"],
          vadSilenceMs: getVadSilenceMs(),
          handlers: {
            onSetupComplete: () => {
              console.info("[voice-server] gemini live ready", {
                callId,
                model,
                voice,
                ttsProvider,
                vadSilenceMs: getVadSilenceMs(),
              });
              gemini?.requestOpening();
            },
            onAudioPcm24kBase64: (pcmB64, sampleRateHz) => {
              if (endController && !endController.shouldAcceptOutboundAudio) {
                return;
              }
              // Deepgram path: drop Gemini native audio; Deepgram speaks the final text.
              if (ttsProvider === "deepgram") return;
              try {
                const rate =
                  typeof sampleRateHz === "number" && sampleRateHz > 0
                    ? sampleRateHz
                    : parsePcmSampleRate(undefined);
                const { mulaw, stats } = audioPipeline.pushPcmBase64(
                  pcmB64,
                  rate
                );
                audioChunkSeq += 1;
                if (
                  isVoiceAudioDebugEnabled() ||
                  audioChunkSeq === 1 ||
                  audioChunkSeq % 40 === 0
                ) {
                  logVoiceAudioStats(stats, {
                    callId,
                    seq: audioChunkSeq,
                    buffered: outboundBuffer.pendingBytes,
                    frames: outboundBuffer.emittedFrameCount,
                  });
                  if (!isVoiceAudioDebugEnabled() && audioChunkSeq === 1) {
                    console.info("[voice-audio]", {
                      callId,
                      geminiRate: stats.geminiRate,
                      inputSamples: stats.inputSamples,
                      outputSamples: stats.outputSamples,
                      durationMs: Math.round(stats.inputDurationMs),
                    });
                  }
                }
                enqueueMulaw(mulaw);
              } catch (error) {
                console.error("[voice-server] audio downconvert failed", {
                  message: error instanceof Error ? error.message : "unknown",
                });
              }
            },
            onInterrupted: () => {
              if (endController?.isEnding) return;
              console.info("[voice-server] barge-in", { callId, ttsProvider });
              clearOutboundAudio();
              finalizer?.discardAgentBuffer();
              agentSpokenThisTurn = false;
              skipNextAgentSpeak = false;
              latency = emptyVoiceLatencyMarks();
            },
            onInputTranscriptInterim: (text) => {
              if (endController?.isEnding) return;
              finalizer?.setInterimLead(text);
            },
            onInputTranscript: (text) => {
              if (endController?.isEnding) return;
              if (agentSpokenThisTurn) {
                agentSpokenThisTurn = false;
                latency = emptyVoiceLatencyMarks();
              }
              latency.leadFinalAt = Date.now();
              finalizer?.appendLead(text);
              if (apptTracker.hasBooked) leadSpokeAfterBooking = true;
              if (detectsSlowSpeechRequest(text) && speechPace !== "slow") {
                speechPace = "slow";
                console.info("[voice-server] speechPace=slow", { callId });
              }
              apptTracker.noteLead(text);
              void tryBookOnLeadConfirmation(text);
            },
            onOutputTranscript: (text, meta) => {
              finalizer?.appendAgent(text);
              apptTracker.noteAgent(text);
              if (
                ttsProvider === "deepgram" &&
                meta?.finished &&
                !endController?.isEnding
              ) {
                void prepareAndSpeakGeminiTurn(finalizer?.peekAgent() || null);
              }
            },
            onGenerationComplete: () => {
              void (async () => {
                if (ttsProvider === "deepgram") {
                  if (endController?.isEnding) return;
                  const peeked = finalizer?.peekAgent() || null;
                  await prepareAndSpeakGeminiTurn(peeked);
                  return;
                }
                // Finish any partial telephony frames for this model turn.
                flushOutbound({
                  sendFarewellMark: Boolean(endController?.isEnding),
                });
                if (endController?.isEnding) {
                  endController.notifyFarewellEnqueued(lastMarkName);
                }
              })();
            },
            onTurnComplete: () => {
              void (async () => {
                latency.geminiTurnCompleteAt = Date.now();
                if (endController?.isEnding) {
                  await finalizer?.flushLead();
                  const endingPeek = finalizer?.peekAgent() || null;
                  const endingAgent =
                    (await prepareAndSpeakGeminiTurn(endingPeek)) ||
                    (await finalizer?.flushAgent());
                  if (ttsProvider === "deepgram" && endingAgent) {
                    /* already spoken in prepareAndSpeakGeminiTurn */
                  }
                  flushOutbound({ sendFarewellMark: true });
                  endController.notifyFarewellEnqueued(lastMarkName);
                  return;
                }

                if (ttsProvider !== "deepgram") {
                  flushOutbound();
                }

                const peeked = finalizer?.peekAgent() || null;
                const [agentText, leadUtterance] = await Promise.all([
                  prepareAndSpeakGeminiTurn(peeked),
                  finalizer?.flushLead() ?? Promise.resolve(null),
                ]);
                const spoken = agentText;

                if (
                  spoken &&
                  agentTurnCount >= 2 &&
                  detectsAgentFarewell(spoken)
                ) {
                  if (apptTracker.isFlowActive && !apptTracker.hasBooked) {
                    const hint =
                      apptTracker.coachingHint() ||
                      "[INTERNAL] appt=continue. Do not end. Collect date/time/confirm. No fake booking.";
                    gemini?.notifySystem(hint, { generate: false });
                    return;
                  }
                  if (apptTracker.hasBooked && !leadSpokeAfterBooking) {
                    return;
                  }
                  beginEndFlow({
                    reason: "agent_farewell",
                    awaitFarewellDelivery: true,
                    sendClosingPrompt: false,
                  });
                  return;
                }

                if (!leadUtterance) return;
                if (isUnclearUtterance(leadUtterance)) return;

                await tryBookOnLeadConfirmation(leadUtterance);

                if (detectsSlowSpeechRequest(leadUtterance) && speechPace !== "slow") {
                  speechPace = "slow";
                  gemini?.notifySystem(slowSpeechSystemNudge(), { generate: false });
                }

                if (detectsEndCallIntent(leadUtterance)) {
                  if (apptTracker.isFlowActive && !apptTracker.hasBooked) {
                    const hint =
                      apptTracker.coachingHint() ||
                      "[INTERNAL] appt=continue. Meeting is not goodbye.";
                    gemini?.notifySystem(hint, { generate: false });
                    return;
                  }
                  const force = detectsForceHangupIntent(leadUtterance);
                  beginEndFlow({
                    reason: force ? "lead_force_hangup" : "lead_hangup",
                    awaitFarewellDelivery: true,
                    sendClosingPrompt: true,
                  });
                } else if (apptTracker.isFlowActive) {
                  const hint = apptTracker.coachingHint();
                  if (hint && hint !== lastCoachingHint) {
                    lastCoachingHint = hint;
                    gemini?.notifySystem(hint, { generate: false });
                  }
                }
              })();
            },
            onError: (message) => {
              console.error("[voice-server] gemini error", { callId, message });
            },
          },
        });
        await gemini.connect();
      } catch (error) {
        console.error("[voice-server] failed to start gemini live", {
          callId,
          message: error instanceof Error ? error.message : "unknown",
        });
        twilioWs.close();
      }
      return;
    }

    if (msg.event === "media") {
      const payload = msg.media?.payload;
      if (!payload || !gemini) return;
      if (msg.media?.track && msg.media.track !== "inbound") return;
      if (endController && !endController.shouldAcceptGeminiInput) return;
      try {
        const pcm16k = mulaw8kToPcm16kBase64(payload);
        gemini.sendPcm16kBase64(pcm16k);
      } catch {
        /* drop bad frames */
      }
      return;
    }

    if (msg.event === "stop") {
      await finalizer?.flushAll();
      if (endController && !endController.isTerminated) {
        await endController.forceHangupNow("stream_stop");
      } else {
        gemini?.close();
        gemini = null;
      }
    }
  });

  twilioWs.on("close", () => {
    if (maxDurationTimer) {
      clearTimeout(maxDurationTimer);
      maxDurationTimer = null;
    }
    void finalizer?.flushAll();
    gemini?.close();
  });
}
