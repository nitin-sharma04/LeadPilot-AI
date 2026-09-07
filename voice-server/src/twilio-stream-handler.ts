import type WebSocket from "ws";
import { mulaw8kToPcm16kBase64, pcm24kBase64ToMulaw8k } from "./audio.js";
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

  const tryBookOnLeadConfirmation = async (leadText: string) => {
    if (!callId || !streamToken || !gemini) return;
    apptTracker.noteLead(leadText);
    if (!apptTracker.shouldAttemptBooking(leadText)) return;

    apptTracker.markBookingAttempted();
    // Stop any premature "invite sent" audio already generating.
    sendClear();
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
          `Booking succeeded for ${when}${
            result.timezone ? ` (${result.timezone})` : ""
          }. Say: they are all set for that time and a calendar invite will be sent. Keep it to 1–2 short sentences. Do not invent a different timezone.`
        );
      } else if (result.reason === "ambiguous_time") {
        gemini.notifySystem(
          `Time is still ambiguous. Ask one short clarification for an exact clock time. Do NOT claim an invite was sent.`
        );
      } else {
        apptTracker.markFailed();
        gemini.notifySystem(
          `Booking failed. Say you could not complete the calendar booking just now and the team will follow up. Do NOT claim an invite was sent.`
        );
      }
    } catch (error) {
      apptTracker.markFailed();
      console.error("[voice-server] mid-call book error", {
        callId,
        message: error instanceof Error ? error.message : "unknown",
      });
      gemini.notifySystem(
        `Booking failed. Say you could not complete the calendar booking just now and the team will follow up. Do NOT claim an invite was sent.`
      );
    }
  };

  const sendClear = () => {
    if (!streamSid || twilioWs.readyState !== twilioWs.OPEN) return;
    twilioWs.send(JSON.stringify({ event: "clear", streamSid }));
  };

  const sendMulawAudio = (mulawB64: string) => {
    if (!streamSid || twilioWs.readyState !== twilioWs.OPEN) return;
    if (endController && !endController.shouldAcceptOutboundAudio) return;
    twilioWs.send(
      JSON.stringify({
        event: "media",
        streamSid,
        media: { payload: mulawB64 },
      })
    );
    markCounter += 1;
    lastMarkName = `m${markCounter}`;
    twilioWs.send(
      JSON.stringify({
        event: "mark",
        streamSid,
        mark: { name: lastMarkName },
      })
    );
    if (endController?.awaitingFarewellMark && lastMarkName) {
      endController.extendFarewellMark(lastMarkName);
    }
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
          endController.notifyFarewellEnqueued(lastMarkName);
        }
      }, 4000);
    }

    // Agent farewell already played — hang up after the last enqueued mark.
    if (input.reason === "agent_farewell" && input.awaitFarewellDelivery) {
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
            onAudioPcm24kBase64: (pcmB64) => {
              if (endController && !endController.shouldAcceptOutboundAudio) {
                return;
              }
              try {
                const mulaw = pcm24kBase64ToMulaw8k(pcmB64);
                sendMulawAudio(mulaw);
              } catch (error) {
                console.error("[voice-server] audio downconvert failed", {
                  message: error instanceof Error ? error.message : "unknown",
                });
              }
            },
            onInterrupted: () => {
              if (endController?.isEnding) return;
              console.info("[voice-server] barge-in", { callId });
              sendClear();
              finalizer?.discardAgentBuffer();
            },
            onInputTranscriptInterim: (text) => {
              if (endController?.isEnding) return;
              finalizer?.setInterimLead(text);
            },
            onInputTranscript: (text) => {
              if (endController?.isEnding) return;
              finalizer?.appendLead(text);
              void tryBookOnLeadConfirmation(text);
            },
            onOutputTranscript: (text) => {
              finalizer?.appendAgent(text);
              apptTracker.noteAgent(text);
            },
            onGenerationComplete: () => {
              void (async () => {
                if (endController?.isEnding) {
                  // Closing/farewell audio enqueued — wait for Twilio mark playback.
                  endController.notifyFarewellEnqueued(lastMarkName);
                }
              })();
            },
            onTurnComplete: () => {
              void (async () => {
                if (endController?.isEnding) {
                  await finalizer?.flushLead();
                  await finalizer?.flushAgent();
                  // Ensure mark wait is armed if generationComplete already fired.
                  endController.notifyFarewellEnqueued(lastMarkName);
                  return;
                }

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
                  beginEndFlow({
                    reason: "agent_farewell",
                    awaitFarewellDelivery: true,
                    sendClosingPrompt: false,
                  });
                  return;
                }

                if (!leadUtterance) return;
                if (isUnclearUtterance(leadUtterance)) return;

                // Backup if confirmation arrived only after flush (idempotent via tracker).
                await tryBookOnLeadConfirmation(leadUtterance);

                if (detectsEndCallIntent(leadUtterance)) {
                  const force = detectsForceHangupIntent(leadUtterance);
                  beginEndFlow({
                    reason: force ? "lead_force_hangup" : "lead_hangup",
                    awaitFarewellDelivery: true,
                    sendClosingPrompt: true,
                  });
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
