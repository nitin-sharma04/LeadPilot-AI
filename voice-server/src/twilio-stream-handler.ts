import type WebSocket from "ws";
import {
  isVoiceAudioDebugEnabled,
  logVoiceAudioStats,
  mulaw8kToPcm16kBase64,
  mulawBase64Rms,
  parsePcmSampleRate,
  StreamingGeminiAudioPipeline,
} from "./audio.js";
import {
  bookAppointmentFromVoiceCall,
  finalizeVoiceAppointment,
} from "./appointment-api.js";
import { AppointmentIntentTracker } from "./appointment-intent-tracker.js";
import { CallEndController } from "./call-end-controller.js";
import { getLiveModel, getMaxCallDurationSeconds, getVadSilenceMs, getVadEndSensitivity, getVadPrefixPaddingMs, getPostSpeechGuardMs, getBargeInMinSpeechMs, getInputFinalizeDebounceMs, getEchoRmsThreshold, resolveGeminiLiveVoice } from "./config.js";
import { buildSystemInstruction, noteCallEndReason, validateStreamSession } from "./db.js";
import {
  detectsAgentFarewell,
  detectsEndCallIntent,
  detectsForceHangupIntent,
} from "./end-call-intent.js";
import { GeminiLiveSession } from "./gemini-live.js";
import { OutboundMulawFrameBuffer } from "./outbound-mulaw-buffer.js";
import {
  detectsSlowSpeechRequest,
  slowSpeechSystemNudge,
  type SpeechPace,
} from "./speech-pace.js";
import { TranscriptFinalizer } from "./transcript-finalizer.js";
import { isInternalTranscript, mergeStreamingTranscript } from "./transcript-cleanup.js";
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
import {
  isAmbiguousLeadFinished,
  isFinalizedLeadTranscript,
  LeadUtteranceAssembler,
  VoiceTurnController,
} from "./voice-turn-state.js";
import {
  evaluateLeadTranscript,
  isValidShortHumanTurn,
} from "./transcript-sanity.js";

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
  let ttsEpoch = 0;
  let skipNextAgentSpeak = false;
  let leadSpokeAfterBooking = false;
  let agentSpokenThisTurn = false;
  let latency = emptyVoiceLatencyMarks();
  const turns = new VoiceTurnController();
  const leadAssembler = new LeadUtteranceAssembler();
  let inputFinalizeTimer: ReturnType<typeof setTimeout> | null = null;
  let playbackWatchdog: ReturnType<typeof setTimeout> | null = null;
  let playbackMarkName: string | null = null;
  let inboundLoudMs = 0;
  let lastPlaybackGenerationId: number | null = null;
  let lastAiFinishedAt = 0;
  let lastInboundSpeechAt = 0;
  /**
   * [INTERNAL] coaching / booking / pace notes. Sending clientContent while Gemini is
   * generating aborts that generation (surfaces as interrupted) and can stall the turn.
   * Queue until the model is idle.
   */
  const pendingNotes: string[] = [];
  // TODO(silence-reengagement): at most one gentle nudge after prolonged user silence,
  // never while USER_SPEAKING or AI_SPEAKING, never looping. Do not add until it can
  // be proven not to fight Gemini VAD.

  const logVoiceTurn = (input: {
    turnId: number;
    leadText: string | null;
    responseStarted: boolean;
    reason: string;
    generationId?: number;
    state?: string;
  }) => {
    console.info("[voice-turn]", {
      callId,
      turnId: input.turnId,
      generationId: input.generationId ?? turns.generationId,
      state: input.state ?? turns.phase,
      leadText: input.leadText,
      responseStarted: input.responseStarted,
      reason: input.reason,
      epoch: turns.epoch,
    });
    console.info("[turn]", {
      callId,
      turnId: input.turnId,
      generationId: input.generationId ?? turns.generationId,
      state: input.state ?? turns.phase,
    });
  };

  const geminiIdle = () => {
    const now = Date.now();
    turns.enterListeningIfGuardElapsed(now);
    return (
      !turns.awaitingResponse &&
      !turns.responseGenerationInFlight &&
      !turns.ttsInFlight &&
      !deepgramTurnInFlight &&
      !turns.isAiSpeaking &&
      !turns.isInPostSpeechGuard(now)
    );
  };

  const flushNotesIfIdle = () => {
    if (!gemini || !pendingNotes.length || !geminiIdle()) return;
    const note = pendingNotes.join(" ");
    pendingNotes.length = 0;
    gemini.notifySystem(note, { generate: false });
  };

  const queueNote = (text: string) => {
    const compact = text.replace(/\s+/g, " ").trim();
    if (!compact) return;
    if (pendingNotes[pendingNotes.length - 1] === compact) return;
    pendingNotes.push(compact);
    flushNotesIfIdle();
  };

  const clearInputFinalizeTimer = () => {
    if (inputFinalizeTimer) {
      clearTimeout(inputFinalizeTimer);
      inputFinalizeTimer = null;
    }
  };

  const clearPlaybackWatchdog = () => {
    if (playbackWatchdog) {
      clearTimeout(playbackWatchdog);
      playbackWatchdog = null;
    }
  };

  const completePlayback = (generationId: number, why: string) => {
    if (lastPlaybackGenerationId === generationId) return;
    if (!turns.isGenerationCurrent(generationId)) {
      console.info("[voice-stale]", {
        callId,
        generationId,
        action: "discard",
        reason: `stale_playback_${why}`,
      });
      return;
    }
    lastPlaybackGenerationId = generationId;
    clearPlaybackWatchdog();
    const guardMs = getPostSpeechGuardMs();
    turns.markPlaybackComplete(Date.now(), guardMs, generationId);
    lastAiFinishedAt = Date.now();
    if (inboundLoudMs < getBargeInMinSpeechMs()) {
      leadAssembler.clear();
      clearInputFinalizeTimer();
      finalizer?.discardLeadBuffer();
    }
    console.info("[tts]", {
      callId,
      userTurnId: turns.currentLeadTurnId,
      generationId,
      completed: true,
      durationMs: Date.now() - (latency.twilioFirstAudioAt || lastAiFinishedAt),
    });
    console.info("[voice-playback]", {
      callId,
      generationId,
      playbackCompleted: true,
      reason: why,
      guardMs,
    });
    console.info("[playback]", {
      callId,
      generationId,
      markReceived: why === "twilio_mark",
      completed: true,
    });
    setTimeout(() => {
      turns.enterListeningIfGuardElapsed(Date.now());
      flushNotesIfIdle();
    }, guardMs + 10);
  };

  const sendPlaybackMark = (generationId: number) => {
    if (!streamSid || twilioWs.readyState !== twilioWs.OPEN) return null;
    markCounter += 1;
    const name = `play_${generationId}_${markCounter}`;
    playbackMarkName = name;
    twilioWs.send(
      JSON.stringify({
        event: "mark",
        streamSid,
        mark: { name },
      })
    );
    console.info("[voice-playback]", {
      callId,
      generationId,
      playbackStarted: true,
      mark: name,
    });
    console.info("[playback]", {
      callId,
      generationId,
      started: true,
    });
    return name;
  };

  const applyGenuineBargeIn = (why: string) => {
    const oldGenerationId = turns.generationId;
    const barge = turns.onBargeIn();
    console.info("[voice-barge-in]", {
      callId,
      generationId: barge.generationId,
      epoch: barge.epoch,
      cancelTts: barge.cancelTts,
      reason: why,
    });
    console.info("[barge-in]", {
      callId,
      detected: true,
      userTurnId: turns.currentLeadTurnId,
      generationId: barge.generationId,
      inboundLoudMs,
      cancelled: true,
    });
    console.info("[generation]", {
      callId,
      generationId: oldGenerationId,
      cancelled: true,
      reason: why,
    });
    logVoiceTurn({
      turnId: turns.currentLeadTurnId,
      leadText: leadAssembler.peek() || null,
      responseStarted: false,
      reason: "barge_in",
      generationId: barge.generationId,
      state: "user_speaking",
    });
    clearPlaybackWatchdog();
    lastPlaybackGenerationId = null;
    clearOutboundAudio();
    finalizer?.discardAgentBuffer();
    lastDeepgramSpoken = null;
    agentSpokenThisTurn = false;
    skipNextAgentSpeak = false;
    latency = emptyVoiceLatencyMarks();
    inboundLoudMs = 0;
    return barge;
  };

  const silenceSinceAiMs = (now: number) => {
    if (turns.isAiSpeaking) return 0;
    if (lastAiFinishedAt <= 0) return 0;
    return Math.max(0, now - lastAiFinishedAt);
  };

  const authorizeFinalLead = (text: string, now: number): boolean => {
    const decision = evaluateLeadTranscript({
      text,
      silenceMs: silenceSinceAiMs(now),
      inboundLoudMs,
    });
    if (!decision.accept) {
      console.info("[transcript]", {
        callId,
        rejectedGarbage: true,
        text: text.slice(0, 160),
        reason: decision.reason,
        silenceMs: silenceSinceAiMs(now),
      });
      return false;
    }
    return true;
  };

  const scheduleLeadDebounce = () => {
    clearInputFinalizeTimer();
    const wait = getInputFinalizeDebounceMs();
    inputFinalizeTimer = setTimeout(() => {
      inputFinalizeTimer = null;
      const now = Date.now();
      turns.enterListeningIfGuardElapsed(now);
      if (turns.isAiSpeaking || turns.isInPostSpeechGuard(now)) return;
      if (!leadAssembler.shouldDebounceFinalize(now, wait)) return;
      const text = leadAssembler.peek();
      if (!text) return;
      if (!authorizeFinalLead(text, now)) {
        leadAssembler.clear();
        return;
      }
      const taken = leadAssembler.take();
      if (!taken) return;
      processFinalLeadTurn(taken);
    }, wait);
  };

  const ingestLeadTranscript = (
    text: string,
    meta?: { finished?: boolean }
  ) => {
    if (endController?.isEnding) return;
    if (isInternalTranscript(text)) return;
    const now = Date.now();
    turns.enterListeningIfGuardElapsed(now);
    leadAssembler.push(text, meta, now, mergeStreamingTranscript);
    turns.noteLeadActivity();
    finalizer?.appendLead(text);

    const peeked = leadAssembler.peek();
    const minSpeech = getBargeInMinSpeechMs();
    const shortHuman = isValidShortHumanTurn(peeked);

    if (turns.isAiSpeaking || turns.isInPostSpeechGuard(now)) {
      const substantial =
        shortHuman ||
        inboundLoudMs >= minSpeech ||
        (isFinalizedLeadTranscript(meta) &&
          peeked.length > 0 &&
          authorizeFinalLead(peeked, now));
      if (!substantial) {
        if (turns.isInPostSpeechGuard(now)) {
          scheduleLeadDebounce();
          return;
        }
        scheduleLeadDebounce();
        return;
      }
      if (turns.isAiSpeaking || turns.isInPostSpeechGuard(now)) {
        applyGenuineBargeIn("lead_speech_during_playback");
      }
    }

    if (isFinalizedLeadTranscript(meta)) {
      clearInputFinalizeTimer();
      const candidate = leadAssembler.peek();
      if (!candidate || !authorizeFinalLead(candidate, now)) {
        leadAssembler.clear();
        return;
      }
      const finalText = leadAssembler.take();
      if (finalText) processFinalLeadTurn(finalText);
      return;
    }
    if (isAmbiguousLeadFinished(meta)) {
      scheduleLeadDebounce();
    } else {
      clearInputFinalizeTimer();
    }
  };

  const tryBookOnLeadConfirmation = async (leadText: string, userTurnId: number) => {
    if (!callId || !streamToken || !gemini) return;
    if (!apptTracker.shouldAttemptBooking(leadText)) return;

    apptTracker.markBookingAttempted();
    console.info("[appointment]", {
      callId,
      analysisQueued: true,
      userTurnId,
    });
    const analysisStarted = Date.now();

    try {
      const result = await bookAppointmentFromVoiceCall({
        callId,
        streamToken,
        preferredTimeText: apptTracker.preferredText,
        explicitConfirmation: true,
      });
      console.info("[appointment]", {
        callId,
        analysisCompleted: true,
        durationMs: Date.now() - analysisStarted,
        userTurnId,
      });
      console.info("[voice-server] mid-call book result", {
        callId,
        booked: result.booked,
        appointmentStatus: result.appointmentStatus,
        reason: result.reason ?? null,
        appointmentId: result.appointmentId ?? null,
      });
      if (turns.currentLeadTurnId !== userTurnId) {
        return;
      }
      if (result.booked) {
        apptTracker.markBooked();
        leadSpokeAfterBooking = false;
        const spoken = spokenBookingSuccess({
          displayWhen: result.displayWhen || result.preferredText,
          timezone: result.timezone,
        });
        queueNote(
          `[INTERNAL] booking_ok when=${result.displayWhen || "agreed time"}${
            result.timezone ? ` tz=${result.timezone}` : ""
          }. Already spoken. Do not repeat. Do not goodbye yet.`
        );
        if (!agentSpokenThisTurn) skipNextAgentSpeak = true;
        await speakAuthoritativeAgent(spoken);
      } else if (result.reason === "ambiguous_time") {
        apptTracker.resetBookingAttempt();
        queueNote(
          "[INTERNAL] booking_fail=ambiguous_time. Ask one clock-time clarification. Do not claim invite sent."
        );
        if (!agentSpokenThisTurn) {
          skipNextAgentSpeak = true;
          await speakAuthoritativeAgent(
            "What clock time should I use? For example, five PM."
          );
        }
      } else {
        apptTracker.markFailed();
        queueNote(
          "[INTERNAL] booking_fail. Say booking did not complete; offer another time. Do not claim invite sent."
        );
        if (!agentSpokenThisTurn) {
          skipNextAgentSpeak = true;
          await speakAuthoritativeAgent(spokenBookingFailure());
        }
      }
    } catch (error) {
      apptTracker.markFailed();
      console.error("[voice-server] mid-call book error", {
        callId,
        message: error instanceof Error ? error.message : "unknown",
      });
      console.info("[appointment]", {
        callId,
        analysisCompleted: true,
        durationMs: Date.now() - analysisStarted,
        userTurnId,
      });
      queueNote(
        "[INTERNAL] booking_fail. Say booking did not complete; offer another time. Do not claim invite sent."
      );
      if (turns.currentLeadTurnId !== userTurnId) return;
      if (!agentSpokenThisTurn) {
        skipNextAgentSpeak = true;
        await speakAuthoritativeAgent(spokenBookingFailure());
      }
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
    ttsEpoch += 1;
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
  const speakDeepgramTurn = async (
    agentText: string,
    opts?: { replace?: boolean }
  ): Promise<boolean> => {
    const speakable = toSpeakableAgentText(agentText);
    if (!speakable) return false;
    if (shouldSkipDuplicateSynthesis(lastDeepgramSpoken, speakable)) {
      console.info("[voice-turn]", {
        callId,
        duplicateSuppressed: true,
        similarity: 1,
        currentText: speakable.slice(0, 120),
        previousTurnId: turns.currentLeadTurnId,
      });
      return false;
    }
    if (isLikelyUnsupportedForFluxEnglish(speakable)) {
      console.warn("[deepgram-tts] skipped unsupported language (Flux is English-only)", {
        callId,
        chars: speakable.length,
      });
      return false;
    }

    if (!opts?.replace && deepgramTurnInFlight) {
      logVoiceTurn({
        turnId: turns.currentLeadTurnId,
        leadText: turns.lastFinalizedLead,
        responseStarted: false,
        reason: "tts_duplicate_ignored",
      });
      return false;
    }

    const ttsGate = opts?.replace
      ? turns.beginReplacementTts()
      : turns.tryBeginTts();
    if (!ttsGate.accepted) {
      logVoiceTurn({
        turnId: ttsGate.turnId,
        leadText: turns.lastFinalizedLead,
        responseStarted: false,
        reason: ttsGate.reason,
        generationId: ttsGate.generationId,
      });
      return false;
    }
    console.info("[voice-tts]", {
      callId,
      generationId: ttsGate.generationId,
      ttsStarted: true,
      turnId: ttsGate.turnId,
    });
    console.info("[tts]", {
      callId,
      generationId: ttsGate.generationId,
      started: true,
    });
    if (opts?.replace && deepgramTurnInFlight) {
      deepgramSession?.interrupt();
      deepgramTurnInFlight = false;
    }

    const cfg = loadDeepgramTtsConfig();
    if (!cfg) {
      console.error("[deepgram-tts] missing config; turn audio skipped");
      turns.endTts();
      return false;
    }

    if (!deepgramSession) {
      deepgramSession = new DeepgramTtsSession(cfg);
      void deepgramSession.warmup();
    }
    const session = deepgramSession;
    ttsEpoch += 1;
    const myEpoch = ttsEpoch;
    const audioEpoch = ttsGate.epoch;
    const myGenerationId = ttsGate.generationId;
    deepgramTurnInFlight = true;
    lastDeepgramSpoken = speakable;
    latency.deepgramFirstAudioAt = null;
    latency.twilioFirstAudioAt = null;
    let firstTwilioFrameMs: number | null = null;
    const wallStart = Date.now();

    try {
      for await (const chunk of session.synthesizeMulaw8k(
        speakable,
        turns.ttsAbortSignal
      )) {
        if (session.cancelled || turns.ttsAbortSignal.aborted) {
          console.info("[tts]", {
            callId,
            generationId: myGenerationId,
            cancelled: true,
            discarded: true,
          });
          return false;
        }
        if (!turns.isAudioEpochCurrent(audioEpoch)) return false;
        if (!turns.isGenerationCurrent(myGenerationId)) return false;
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
      const played = Boolean(timing && timing.totalAudioBytes > 0);
      if (played && myEpoch === ttsEpoch && turns.isGenerationCurrent(myGenerationId)) {
        sendPlaybackMark(myGenerationId);
        const durationMs = Math.round((timing?.totalAudioBytes || 0) / 8);
        clearPlaybackWatchdog();
        playbackWatchdog = setTimeout(() => {
          completePlayback(myGenerationId, "watchdog");
        }, Math.max(400, durationMs + 300));
      } else if (
        !session.cancelled &&
        turns.isGenerationCurrent(myGenerationId)
      ) {
        completePlayback(myGenerationId, "tts_empty");
      }
      console.info("[voice-tts]", {
        callId,
        generationId: myGenerationId,
        ttsCompleted: played,
      });
      return played;
    } catch (error) {
      if (session.cancelled) return false;
      console.error("[deepgram-tts] synthesize failed", {
        callId,
        errorType: error instanceof DeepgramTtsError ? error.name : "error",
        message: error instanceof Error ? error.message : "unknown",
      });
      if (turns.isGenerationCurrent(myGenerationId)) {
        completePlayback(myGenerationId, "tts_error");
      }
      return false;
    } finally {
      if (myEpoch === ttsEpoch) {
        deepgramTurnInFlight = false;
        turns.endTts();
        if (!turns.isAiSpeaking) {
          flushNotesIfIdle();
        }
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
    turns.noteAgentSpoken(prepared);
    void finalizer?.persistSpokenAgent(prepared);
    if (ttsProvider === "deepgram") {
      return speakDeepgramTurn(prepared, { replace: true });
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
    turns.noteAgentSpoken(prepared);
    void finalizer?.persistSpokenAgent(prepared);
    if (ttsProvider === "deepgram") {
      await speakDeepgramTurn(prepared);
    }
    return prepared;
  };

  const processFinalLeadTurn = (rawText: string) => {
    if (endController?.isEnding) return;
    const leadText = rawText.replace(/\s+/g, " ").trim();
    const finalized = turns.finalizeLeadTurn(leadText);
    if (!finalized.accepted) {
      logVoiceTurn({
        turnId: finalized.turnId,
        leadText: turns.lastFinalizedLead,
        responseStarted: false,
        reason: finalized.reason,
        generationId: finalized.generationId,
      });
      return;
    }

    if (finalized.cancelledPrevious) {
      cancelDeepgramTts();
      clearOutboundAudio();
      gemini?.discardStaleOutput();
      console.info("[generation]", {
        callId,
        generationId: finalized.cancelledGenerationId,
        cancelled: true,
        stale: true,
        reason: "latest_turn_wins",
      });
      console.info("[barge-in]", {
        callId,
        oldGenerationId: finalized.cancelledGenerationId,
        newTurnId: finalized.turnId,
        generationId: finalized.generationId,
      });
    }

    finalizer?.discardAgentBuffer();
    agentSpokenThisTurn = false;
    latency = emptyVoiceLatencyMarks();
    latency.leadFinalAt = Date.now();
    if (apptTracker.hasBooked) leadSpokeAfterBooking = true;

    logVoiceTurn({
      turnId: finalized.turnId,
      leadText: turns.lastFinalizedLead,
      responseStarted: false,
      reason: "lead_finalized",
      generationId: finalized.generationId,
      state: "user_turn_ended",
    });
    console.info("[voice-turn]", {
      callId,
      userTurnStarted: true,
      userTurnId: finalized.turnId,
      generationId: finalized.generationId,
    });
    console.info("[voice-turn]", {
      callId,
      userTurnFinalized: true,
      userTurnId: finalized.turnId,
      text: turns.lastFinalizedLead,
      durationMs: 0,
      generationId: finalized.generationId,
      inputFinalized: turns.lastFinalizedLead,
    });
    console.info("[generation]", {
      callId,
      started: true,
      userTurnId: finalized.turnId,
      generationId: finalized.generationId,
      geminiGenerationStarted: true,
      localGenerationId: finalized.generationId,
      state: turns.phase,
    });
    console.info("[input]", {
      callId,
      turnId: finalized.turnId,
      final: turns.lastFinalizedLead,
    });

    if (detectsSlowSpeechRequest(leadText) && speechPace !== "slow") {
      speechPace = "slow";
      console.info("[voice-server] speechPace=slow", { callId });
      queueNote(slowSpeechSystemNudge());
    }

    apptTracker.noteLead(leadText);
    void tryBookOnLeadConfirmation(leadText, finalized.turnId);
    void finalizer?.flushLead();

    if (detectsEndCallIntent(leadText)) {
      if (apptTracker.isFlowActive && !apptTracker.hasBooked) {
        const hint =
          apptTracker.coachingHint() ||
          "[INTERNAL] appt=continue. Meeting is not goodbye.";
        queueNote(hint);
        return;
      }
      const force = detectsForceHangupIntent(leadText);
      beginEndFlow({
        reason: force ? "lead_force_hangup" : "lead_hangup",
        awaitFarewellDelivery: true,
        sendClosingPrompt: true,
      });
      return;
    }

    if (apptTracker.isFlowActive) {
      const hint = apptTracker.coachingHint();
      if (hint && hint !== lastCoachingHint) {
        lastCoachingHint = hint;
        queueNote(hint);
      }
    }
  };

  const teardownMedia = () => {
    if (maxDurationTimer) {
      clearTimeout(maxDurationTimer);
      maxDurationTimer = null;
    }
    clearInputFinalizeTimer();
    clearPlaybackWatchdog();
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

  function beginEndFlow(input: {
    reason: "lead_hangup" | "lead_force_hangup" | "agent_farewell" | "max_duration";
    awaitFarewellDelivery: boolean;
    sendClosingPrompt: boolean;
  }) {
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
      turns.allowClosingResponse();
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
  }

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
      if (name.startsWith("play_")) {
        const gen = Number.parseInt(name.split("_")[1] || "", 10);
        if (Number.isFinite(gen)) completePlayback(gen, "twilio_mark");
        return;
      }
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
          vadPrefixPaddingMs: getVadPrefixPaddingMs(),
          vadEndSensitivity: getVadEndSensitivity(),
          handlers: {
            onSetupComplete: () => {
              console.info("[voice-server] gemini live ready", {
                callId,
                model,
                voice,
                ttsProvider,
                vadSilenceMs: getVadSilenceMs(),
                vadEndSensitivity: getVadEndSensitivity(),
                postSpeechGuardMs: getPostSpeechGuardMs(),
              });
              if (turns.requestOpening()) {
                gemini?.requestOpening();
                console.info("[generation]", {
                  callId,
                  generationId: turns.generationId,
                  started: true,
                  reason: "opening",
                });
              }
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
              const now = Date.now();
              turns.enterListeningIfGuardElapsed(now);
              const peeked = leadAssembler.peek();
              const minSpeech = getBargeInMinSpeechMs();
              const shortHuman = isValidShortHumanTurn(peeked);
              const confidentSpeech =
                shortHuman || inboundLoudMs >= minSpeech;
              if (
                (turns.isInPostSpeechGuard(now) || turns.isAiSpeaking) &&
                !confidentSpeech
              ) {
                const sync = turns.syncEchoInterrupt();
                console.info("[voice-stale]", {
                  callId,
                  generationId: sync.generationId,
                  interruptSeq: sync.interruptSeq,
                  action: turns.isInPostSpeechGuard(now)
                    ? "ignore_echo_interrupt"
                    : "ignore_tiny_interrupt",
                });
                console.info("[generation]", {
                  callId,
                  generationId: sync.generationId,
                  geminiGenerationStarted: true,
                  localGenerationId: turns.generationId,
                  userTurnId: turns.authorizedUserTurnId,
                  state: turns.phase,
                  reason: "echo_interrupt_synced",
                });
                return;
              }
              if (!turns.isAiSpeaking && !turns.isInPostSpeechGuard(now)) {
                turns.syncEchoInterrupt();
                turns.noteLeadActivity();
                return;
              }
              applyGenuineBargeIn("gemini_interrupted");
            },
            onInputTranscriptInterim: (text) => {
              if (endController?.isEnding) return;
              if (isInternalTranscript(text)) return;
              finalizer?.setInterimLead(text);
              turns.noteLeadActivity();
            },
            onInputTranscript: (text, meta) => {
              ingestLeadTranscript(text, meta);
            },
            onOutputTranscript: (text) => {
              const note = turns.noteModelOutput(text);
              if (!note.accepted) {
                console.info("[voice-stale]", {
                  callId,
                  generationId: turns.generationId,
                  action: "discard",
                  reason: note.reason,
                });
                return;
              }
              finalizer?.appendAgent(text);
            },
            onGenerationComplete: () => {
              const generationId = turns.generationId;
              void (async () => {
                if (ttsProvider === "deepgram") {
                  if (endController?.isEnding && skipNextAgentSpeak) return;
                  if (!turns.isGenerationCurrent(generationId)) {
                    console.info("[generation]", {
                      callId,
                      generationId,
                      stale: true,
                      reason: "generation_complete_after_cancel",
                    });
                    return;
                  }
                  if (!turns.outputSeenForGeneration) {
                    console.info("[generation]", {
                      callId,
                      generationId,
                      stale: true,
                      reason: "generation_complete_no_output",
                    });
                    return;
                  }
                  const peeked =
                    (turns.aggregator?.text || finalizer?.peekAgent() || "").trim() ||
                    null;
                  if (!toSpeakableAgentText(peeked)) return;
                  const gate = turns.tryAcceptModelResponse(
                    "generation_complete",
                    peeked,
                    generationId
                  );
                  logVoiceTurn({
                    turnId: gate.turnId,
                    leadText: turns.lastFinalizedLead,
                    responseStarted: gate.accepted,
                    reason: gate.reason,
                    generationId: gate.generationId,
                  });
                  if (!gate.accepted) {
                    console.info("[generation]", {
                      callId,
                      generationRejected: true,
                      reason: gate.reason,
                      userTurnId: gate.turnId,
                      generationId: gate.generationId,
                    });
                    if (gate.reason === "duplicate_spoken_text") {
                      console.info("[voice-turn]", {
                        callId,
                        duplicateSuppressed: true,
                        similarity: 0.8,
                        currentText: (peeked || "").slice(0, 120),
                        previousTurnId: gate.turnId,
                        generationId: gate.generationId,
                      });
                    }
                    if (gate.reason !== "response_already_accepted") {
                      console.info("[voice-stale]", {
                        callId,
                        generationId: gate.generationId,
                        action: "discard",
                        reason: gate.reason,
                      });
                    }
                    return;
                  }
                  console.info("[generation]", {
                    callId,
                    generationAccepted: true,
                    userTurnId: gate.turnId,
                    generationId: gate.generationId,
                  });
                  console.info("[voice-turn]", {
                    callId,
                    turnId: gate.turnId,
                    generationId: gate.generationId,
                    generationCompleted: true,
                  });
                  await prepareAndSpeakGeminiTurn(peeked);
                  return;
                }
                flushOutbound({
                  sendFarewellMark: Boolean(endController?.isEnding),
                });
                if (endController?.isEnding) {
                  endController.notifyFarewellEnqueued(lastMarkName);
                }
              })();
            },
            onTurnComplete: () => {
              const generationId = turns.generationId;
              void (async () => {
                latency.geminiTurnCompleteAt = Date.now();
                if (endController?.isEnding) {
                  await finalizer?.flushLead();
                  if (ttsProvider === "deepgram") {
                    const peeked =
                      (turns.aggregator?.text || finalizer?.peekAgent() || "").trim() ||
                      null;
                    if (
                      toSpeakableAgentText(peeked) &&
                      turns.outputSeenForGeneration &&
                      turns.isGenerationCurrent(generationId)
                    ) {
                      const endingGate = turns.tryAcceptModelResponse(
                        "turn_complete_ending",
                        peeked,
                        generationId
                      );
                      if (endingGate.accepted) {
                        logVoiceTurn({
                          turnId: endingGate.turnId,
                          leadText: turns.lastFinalizedLead,
                          responseStarted: true,
                          reason: endingGate.reason,
                        });
                        await prepareAndSpeakGeminiTurn(peeked);
                      }
                    }
                  } else {
                    await finalizer?.flushAgent();
                  }
                  flushOutbound({ sendFarewellMark: true });
                  endController.notifyFarewellEnqueued(lastMarkName);
                  return;
                }

                if (ttsProvider !== "deepgram") {
                  flushOutbound();
                }

                if (ttsProvider === "deepgram") {
                  if (!turns.isGenerationCurrent(generationId) || !turns.outputSeenForGeneration) {
                    logVoiceTurn({
                      turnId: turns.currentLeadTurnId,
                      leadText: turns.lastFinalizedLead,
                      responseStarted: false,
                      reason: !turns.outputSeenForGeneration
                        ? "turn_complete_no_output"
                        : "turn_complete_stale",
                      generationId,
                    });
                  } else {
                    const peeked =
                      (turns.aggregator?.text || finalizer?.peekAgent() || "").trim() ||
                      null;
                    if (toSpeakableAgentText(peeked)) {
                      const fallback = turns.tryAcceptModelResponse(
                        "turn_complete_fallback",
                        peeked,
                        generationId
                      );
                      if (fallback.accepted) {
                        console.info("[generation]", {
                          callId,
                          generationAccepted: true,
                          userTurnId: fallback.turnId,
                          generationId: fallback.generationId,
                        });
                        logVoiceTurn({
                          turnId: fallback.turnId,
                          leadText: turns.lastFinalizedLead,
                          responseStarted: true,
                          reason: fallback.reason,
                        });
                        await prepareAndSpeakGeminiTurn(peeked);
                      } else {
                        console.info("[generation]", {
                          callId,
                          generationRejected: true,
                          reason: fallback.reason,
                          userTurnId: fallback.turnId,
                          generationId: fallback.generationId,
                        });
                        logVoiceTurn({
                          turnId: fallback.turnId,
                          leadText: turns.lastFinalizedLead,
                          responseStarted: false,
                          reason: fallback.reason,
                        });
                      }
                    }
                  }
                } else {
                  await finalizer?.flushAgent();
                }

                flushNotesIfIdle();

                const spoken = turns.lastFinalizedAgent;
                if (
                  spoken &&
                  agentTurnCount >= 2 &&
                  detectsAgentFarewell(spoken)
                ) {
                  if (apptTracker.isFlowActive && !apptTracker.hasBooked) {
                    const hint =
                      apptTracker.coachingHint() ||
                      "[INTERNAL] appt=continue. Do not end. Collect date/time/confirm. No fake booking.";
                    queueNote(hint);
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
      const now = Date.now();
      turns.enterListeningIfGuardElapsed(now);
      try {
        const rms = mulawBase64Rms(payload);
        if (rms >= getEchoRmsThreshold()) {
          inboundLoudMs += 20;
          lastInboundSpeechAt = now;
        } else {
          inboundLoudMs = Math.max(0, inboundLoudMs - 20);
        }
        if (turns.isAiSpeaking || turns.isInPostSpeechGuard(now)) {
          if (rms < getEchoRmsThreshold()) {
            return;
          }
        } else if (now - lastInboundSpeechAt > 400) {
          inboundLoudMs = Math.max(0, inboundLoudMs - 40);
        }
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
    clearInputFinalizeTimer();
    clearPlaybackWatchdog();
    void finalizer?.flushAll();
    gemini?.close();
  });
}
