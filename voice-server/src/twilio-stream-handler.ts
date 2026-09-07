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
import { getLiveModel, getMaxCallDurationSeconds, resolveGeminiLiveVoice } from "./config.js";
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

  const tryBookOnLeadConfirmation = async (leadText: string) => {
    if (!callId || !streamToken || !gemini) return;
    apptTracker.noteLead(leadText);
    if (!apptTracker.shouldAttemptBooking(leadText)) return;

    apptTracker.markBookingAttempted();
    // Stop any premature "invite sent" audio already generating.
    clearOutboundAudio();
    finalizer?.discardAgentBuffer();

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
        const when =
          result.displayWhen || result.preferredText || "the agreed time";
        gemini.notifySystem(
          `[INTERNAL] booking_ok when=${when}${
            result.timezone ? ` tz=${result.timezone}` : ""
          }. Confirm briefly; invite will be sent. 1–2 sentences.`
        );
      } else if (result.reason === "ambiguous_time") {
        gemini.notifySystem(
          "[INTERNAL] booking_fail=ambiguous_time. Ask one clock-time clarification. Do not claim invite sent."
        );
      } else {
        apptTracker.markFailed();
        gemini.notifySystem(
          "[INTERNAL] booking_fail. Say booking did not complete; offer another time. Do not claim invite sent."
        );
      }
    } catch (error) {
      apptTracker.markFailed();
      console.error("[voice-server] mid-call book error", {
        callId,
        message: error instanceof Error ? error.message : "unknown",
      });
      gemini.notifySystem(
        "[INTERNAL] booking_fail. Say booking did not complete; offer another time. Do not claim invite sent."
      );
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

  const clearOutboundAudio = () => {
    outboundBuffer.clear();
    audioPipeline.reset();
    sendClear();
  };

  const teardownMedia = () => {
    if (maxDurationTimer) {
      clearTimeout(maxDurationTimer);
      maxDurationTimer = null;
    }
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
          handlers: {
            onSetupComplete: () => {
              console.info("[voice-server] gemini live ready", {
                callId,
                model,
                voice,
              });
              gemini?.requestOpening();
            },
            onAudioPcm24kBase64: (pcmB64, sampleRateHz) => {
              if (endController && !endController.shouldAcceptOutboundAudio) {
                return;
              }
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
              console.info("[voice-server] barge-in", { callId });
              clearOutboundAudio();
              finalizer?.discardAgentBuffer();
            },
            onInputTranscriptInterim: (text) => {
              if (endController?.isEnding) return;
              finalizer?.setInterimLead(text);
            },
            onInputTranscript: (text) => {
              if (endController?.isEnding) return;
              finalizer?.appendLead(text);
              if (detectsSlowSpeechRequest(text) && speechPace !== "slow") {
                speechPace = "slow";
                console.info("[voice-server] speechPace=slow", { callId });
                gemini?.notifySystem(slowSpeechSystemNudge());
              }
              apptTracker.noteLead(text);
              const hint = apptTracker.coachingHint();
              if (hint && hint !== lastCoachingHint) {
                lastCoachingHint = hint;
                gemini?.notifySystem(hint);
              }
              void tryBookOnLeadConfirmation(text);
            },
            onOutputTranscript: (text) => {
              finalizer?.appendAgent(text);
              apptTracker.noteAgent(text);
            },
            onGenerationComplete: () => {
              void (async () => {
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
                if (endController?.isEnding) {
                  await finalizer?.flushLead();
                  await finalizer?.flushAgent();
                  flushOutbound({ sendFarewellMark: true });
                  endController.notifyFarewellEnqueued(lastMarkName);
                  return;
                }

                // Normal turn: flush remainder without a mark.
                flushOutbound();

                const leadUtterance = await finalizer?.flushLead();
                const agentText = await finalizer?.flushAgent();
                if (agentText) {
                  agentTurnCount += 1;
                  apptTracker.noteAgent(agentText);
                }

                if (
                  agentText &&
                  agentTurnCount >= 2 &&
                  detectsAgentFarewell(agentText)
                ) {
                  if (apptTracker.isFlowActive && !apptTracker.hasBooked) {
                    const hint =
                      apptTracker.coachingHint() ||
                      "[INTERNAL] appt=continue. Do not end. Collect date/time/confirm. No fake booking.";
                    gemini?.notifySystem(hint);
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
                  gemini?.notifySystem(slowSpeechSystemNudge());
                }

                if (detectsEndCallIntent(leadUtterance)) {
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
                    gemini?.notifySystem(hint);
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
