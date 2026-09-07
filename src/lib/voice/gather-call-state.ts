/**
 * In-memory per-call state for turn-based Gather fallback.
 * Critical booking/end decisions must not rely on prompt history alone.
 */

import {
  advanceAppointmentFromLead,
  claimsFalseTeamSchedule,
  createAppointmentConversationState,
  detectsMeetingIntent,
  isAppointmentFlowActive,
  markAppointmentBooked,
  markMeetingConfirmed,
  nextAgentPromptForStage,
  type AppointmentConversationState,
} from "@/lib/voice/appointment-conversation";
import {
  detectsSlowSpeechRequest,
  type SpeechPace,
} from "@/lib/voice/speech-pace";
import { detectsEndCallIntent } from "@/lib/voice/end-call-intent";
import { isClearAppointmentConfirmation } from "@/lib/voice/end-call-intent";

export type GatherCallState = {
  speechPace: SpeechPace;
  appointment: AppointmentConversationState;
  lastUserIntent: string;
  callEndingRequested: boolean;
};

const gatherStates = new Map<string, GatherCallState>();

export function getGatherCallState(callId: string): GatherCallState {
  let state = gatherStates.get(callId);
  if (!state) {
    state = {
      speechPace: "normal",
      appointment: createAppointmentConversationState(),
      lastUserIntent: "",
      callEndingRequested: false,
    };
    gatherStates.set(callId, state);
  }
  return state;
}

export function clearGatherCallState(callId: string) {
  gatherStates.delete(callId);
}

export type GatherTurnResult = {
  reply: string;
  endCall: boolean;
  handoffRequested: boolean;
  appointmentRequested: boolean;
  optOut: boolean;
  speechPace: SpeechPace;
  /** When true, gather handler should invoke bookAppointment before confirming. */
  shouldBook: boolean;
  preferredTimeText: string;
};

/**
 * Deterministic Gather fallback / sanitizer — never ends on bare meeting intent.
 */
export function heuristicGatherTurn(
  callId: string,
  utterance: string
): GatherTurnResult {
  const state = getGatherCallState(callId);
  const text = utterance.replace(/\s+/g, " ").trim();
  state.lastUserIntent = text.slice(0, 240);

  if (!text) {
    return {
      reply: "Sorry, I did not catch that. Could you say that one more time?",
      endCall: false,
      handoffRequested: false,
      appointmentRequested: isAppointmentFlowActive(state.appointment),
      optOut: false,
      speechPace: state.speechPace,
      shouldBook: false,
      preferredTimeText: "",
    };
  }

  if (
    /don'?t call|do not call|stop calling|remove me|unsubscribe|not interested/.test(
      text.toLowerCase()
    ) &&
    !detectsMeetingIntent(text)
  ) {
    // "not interested" alone can be decline; still allow opt-out phrases.
    if (/don'?t call|do not call|stop calling|remove me|unsubscribe/.test(text.toLowerCase())) {
      state.callEndingRequested = true;
      state.appointment.stage = "GOODBYE";
      return {
        reply: "Understood. I will make sure we do not call again. Thank you, goodbye.",
        endCall: true,
        handoffRequested: false,
        appointmentRequested: false,
        optOut: true,
        speechPace: state.speechPace,
        shouldBook: false,
        preferredTimeText: "",
      };
    }
  }

  if (detectsSlowSpeechRequest(text)) {
    state.speechPace = "slow";
    state.appointment = advanceAppointmentFromLead(state.appointment, text);
    const followUp = isAppointmentFlowActive(state.appointment)
      ? nextAgentPromptForStage(state.appointment)
      : "What would be most helpful to cover today?";
    return {
      reply: `Of course. I'll slow down. ${followUp}`,
      endCall: false,
      handoffRequested: false,
      appointmentRequested: isAppointmentFlowActive(state.appointment),
      optOut: false,
      speechPace: state.speechPace,
      shouldBook: false,
      preferredTimeText: "",
    };
  }

  if (detectsEndCallIntent(text) && !detectsMeetingIntent(text)) {
    state.callEndingRequested = true;
    state.appointment.stage = "GOODBYE";
    return {
      reply: "Of course. Thanks for your time. Have a great day.",
      endCall: true,
      handoffRequested: false,
      appointmentRequested: false,
      optOut: false,
      speechPace: state.speechPace,
      shouldBook: false,
      preferredTimeText: "",
    };
  }

  state.appointment = advanceAppointmentFromLead(state.appointment, text);

  if (state.appointment.stage === "DECLINED") {
    state.callEndingRequested = true;
    return {
      reply: nextAgentPromptForStage(state.appointment),
      endCall: true,
      handoffRequested: false,
      appointmentRequested: false,
      optOut: false,
      speechPace: state.speechPace,
      shouldBook: false,
      preferredTimeText: "",
    };
  }

  // Confirmation after date+time collected → attempt booking (caller runs bookAppointment).
  if (
    state.appointment.stage === "CONFIRM_TIME" &&
    isClearAppointmentConfirmation(text) &&
    state.appointment.meetingDate &&
    state.appointment.meetingTime
  ) {
    state.appointment = markMeetingConfirmed(state.appointment);
    const preferred = `${state.appointment.meetingDate} at ${state.appointment.meetingTime}`;
    return {
      reply: nextAgentPromptForStage(state.appointment),
      endCall: false,
      handoffRequested: false,
      appointmentRequested: true,
      optOut: false,
      speechPace: state.speechPace,
      shouldBook: true,
      preferredTimeText: preferred,
    };
  }

  if (isAppointmentFlowActive(state.appointment) || detectsMeetingIntent(text)) {
    if (state.appointment.stage === "NONE" || state.appointment.stage === "MEETING_INTENT") {
      state.appointment.stage = "COLLECT_DATE";
    }
    return {
      reply: nextAgentPromptForStage(state.appointment),
      endCall: false,
      handoffRequested: false,
      appointmentRequested: true,
      optOut: false,
      speechPace: state.speechPace,
      shouldBook: false,
      preferredTimeText: "",
    };
  }

  if (/human|person|representative|connect (me )?directly/.test(text.toLowerCase())) {
    // "team" / "members" often means meeting — only handoff if not meeting intent.
    return {
      reply:
        "I can have a teammate follow up with you. Meanwhile, what day would work for a short call?",
      endCall: false,
      handoffRequested: true,
      appointmentRequested: false,
      optOut: false,
      speechPace: state.speechPace,
      shouldBook: false,
      preferredTimeText: "",
    };
  }

  // Bare acknowledgements must NOT end the call.
  if (/^(okay|ok|sure|yes|yeah|yep|alright|right)\.?$/i.test(text)) {
    return {
      reply: "What is the main goal you are hoping to achieve with this right now?",
      endCall: false,
      handoffRequested: false,
      appointmentRequested: false,
      optOut: false,
      speechPace: state.speechPace,
      shouldBook: false,
      preferredTimeText: "",
    };
  }

  return {
    reply: "What is the main goal you are hoping to achieve with this right now?",
    endCall: false,
    handoffRequested: false,
    appointmentRequested: false,
    optOut: false,
    speechPace: state.speechPace,
    shouldBook: false,
    preferredTimeText: "",
  };
}

/**
 * Sanitize model Gather turns so they cannot regress to premature goodbye / fake booking.
 */
export function sanitizeGatherModelTurn(
  callId: string,
  utterance: string,
  turn: {
    reply: string;
    endCall: boolean;
    handoffRequested: boolean;
    appointmentRequested: boolean;
    optOut: boolean;
  }
): GatherTurnResult {
  const state = getGatherCallState(callId);

  if (detectsSlowSpeechRequest(utterance)) {
    state.speechPace = "slow";
  }
  state.appointment = advanceAppointmentFromLead(state.appointment, utterance);

  let reply = turn.reply.replace(/\s+/g, " ").trim();
  let endCall = turn.endCall;
  let appointmentRequested =
    turn.appointmentRequested || isAppointmentFlowActive(state.appointment);
  let handoffRequested = turn.handoffRequested;
  let optOut = turn.optOut;
  let shouldBook = false;
  let preferredTimeText = "";

  if (detectsSlowSpeechRequest(utterance)) {
    if (!/slow/i.test(reply)) {
      reply = `Of course. I'll slow down. ${reply}`;
    }
    endCall = false;
  }

  if (
    detectsMeetingIntent(utterance) ||
    isAppointmentFlowActive(state.appointment)
  ) {
    appointmentRequested = true;
    // Never end solely because the lead asked to schedule.
    if (!optOut && !detectsEndCallIntent(utterance)) {
      endCall = false;
    }
    if (
      claimsFalseTeamSchedule(reply) ||
      (/\bgoodbye\b/i.test(reply) && !state.appointment.appointmentBooked)
    ) {
      reply = nextAgentPromptForStage(
        state.appointment.stage === "NONE"
          ? { ...state.appointment, stage: "COLLECT_DATE" }
          : state.appointment
      );
      endCall = false;
    }
  }

  if (
    state.appointment.stage === "CONFIRM_TIME" &&
    isClearAppointmentConfirmation(utterance) &&
    state.appointment.meetingDate &&
    state.appointment.meetingTime
  ) {
    state.appointment = markMeetingConfirmed(state.appointment);
    shouldBook = true;
    preferredTimeText = `${state.appointment.meetingDate} at ${state.appointment.meetingTime}`;
    endCall = false;
    if (!/confirm|book|calendar|moment/i.test(reply)) {
      reply = nextAgentPromptForStage(state.appointment);
    }
  }

  // "Okay" alone is not goodbye.
  if (/^(okay|ok|sure|yes|yeah)\.?$/i.test(utterance.trim()) && !optOut) {
    endCall = false;
  }

  if (optOut) {
    endCall = true;
    state.callEndingRequested = true;
  }

  return {
    reply: reply.slice(0, 500),
    endCall,
    handoffRequested,
    appointmentRequested,
    optOut,
    speechPace: state.speechPace,
    shouldBook,
    preferredTimeText,
  };
}

export function noteGatherBookingResult(
  callId: string,
  booked: boolean
): string {
  const state = getGatherCallState(callId);
  if (booked) {
    state.appointment = markAppointmentBooked(state.appointment);
    state.appointment.stage = "BOOKED";
    return nextAgentPromptForStage(state.appointment);
  }
  state.appointment.stage = "CONFIRM_TIME";
  state.appointment.meetingConfirmed = false;
  return "Looks like I couldn't complete the booking just yet. I don't want to tell you it's booked when it isn't. Would you like me to try another time?";
}
