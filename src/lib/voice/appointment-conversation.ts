/**
 * Appointment conversation state machine for voice calls.
 * Meeting intent ≠ permission to end the call or claim a booking.
 */

export type AppointmentFlowStage =
  | "NONE"
  | "MEETING_INTENT"
  | "COLLECT_DATE"
  | "COLLECT_TIME"
  | "CONFIRM_TIME"
  | "BOOKING"
  | "BOOKED"
  | "DECLINED"
  | "GOODBYE";

const CLOCK_RE = /\b\d{1,2}(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)\b/i;
const DAY_RE =
  /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

const MEETING_INTENT_RE =
  /\b(schedule|meeting|appointment|book(?:ing)?|calendar|set\s+up\s+a\s+(?:call|meeting)|talk\s+to\s+(?:your\s+)?(?:team|members)|speak\s+(?:to|with)\s+(?:your\s+)?(?:team|members))\b/i;

const DECLINED_MEETING_RE =
  /\b(not\s+interested|no\s+(?:thanks|thank\s+you)|don'?t\s+want\s+(?:a\s+)?(?:meeting|call|appointment)|maybe\s+later|not\s+right\s+now|no\s+meeting)\b/i;

const FALSE_TEAM_SCHEDULE_RE =
  /\b(have\s+our\s+team\s+schedule|team\s+will\s+schedule|someone\s+will\s+schedule|send\s+the\s+details\s+shortly)\b/i;

export function detectsMeetingIntent(utterance: string): boolean {
  const text = utterance.replace(/\s+/g, " ").trim();
  if (!text) return false;
  return MEETING_INTENT_RE.test(text);
}

export function detectsMeetingDecline(utterance: string): boolean {
  const text = utterance.replace(/\s+/g, " ").trim();
  if (!text) return false;
  return DECLINED_MEETING_RE.test(text);
}

export function extractDayHint(utterance: string): string | null {
  const m = utterance.match(DAY_RE);
  return m ? m[0] : null;
}

export function extractTimeHint(utterance: string): string | null {
  const m = utterance.match(CLOCK_RE);
  return m ? m[0] : null;
}

export function hasDayAndTime(text: string): boolean {
  return CLOCK_RE.test(text) && DAY_RE.test(text);
}

export function claimsFalseTeamSchedule(reply: string): boolean {
  return FALSE_TEAM_SCHEDULE_RE.test(reply);
}

export type AppointmentConversationState = {
  stage: AppointmentFlowStage;
  meetingDate: string | null;
  meetingTime: string | null;
  meetingConfirmed: boolean;
  appointmentBooked: boolean;
};

export function createAppointmentConversationState(): AppointmentConversationState {
  return {
    stage: "NONE",
    meetingDate: null,
    meetingTime: null,
    meetingConfirmed: false,
    appointmentBooked: false,
  };
}

/**
 * Advance state from a lead utterance. Does not book — only tracks collection.
 */
export function advanceAppointmentFromLead(
  state: AppointmentConversationState,
  utterance: string
): AppointmentConversationState {
  const next = { ...state };
  if (next.stage === "BOOKED" || next.stage === "GOODBYE") return next;

  if (detectsMeetingDecline(utterance)) {
    next.stage = "DECLINED";
    return next;
  }

  const day = extractDayHint(utterance);
  const time = extractTimeHint(utterance);
  if (day) next.meetingDate = day;
  if (time) next.meetingTime = time;

  if (detectsMeetingIntent(utterance) && next.stage === "NONE") {
    next.stage = "MEETING_INTENT";
  }

  if (
    next.stage === "NONE" ||
    next.stage === "MEETING_INTENT" ||
    next.stage === "COLLECT_DATE" ||
    next.stage === "COLLECT_TIME" ||
    next.stage === "CONFIRM_TIME"
  ) {
    if (!next.meetingDate) {
      if (next.stage === "MEETING_INTENT" || detectsMeetingIntent(utterance)) {
        next.stage = "COLLECT_DATE";
      }
    } else if (!next.meetingTime) {
      next.stage = "COLLECT_TIME";
    } else if (!next.meetingConfirmed) {
      next.stage = "CONFIRM_TIME";
    }
  }

  return next;
}

export function markMeetingConfirmed(
  state: AppointmentConversationState
): AppointmentConversationState {
  return {
    ...state,
    meetingConfirmed: true,
    stage: "BOOKING",
  };
}

export function markAppointmentBooked(
  state: AppointmentConversationState
): AppointmentConversationState {
  return {
    ...state,
    appointmentBooked: true,
    meetingConfirmed: true,
    stage: "BOOKED",
  };
}

/** True while we still owe the lead date/time/confirm/booking work. */
export function isAppointmentFlowActive(
  state: AppointmentConversationState
): boolean {
  return (
    state.stage === "MEETING_INTENT" ||
    state.stage === "COLLECT_DATE" ||
    state.stage === "COLLECT_TIME" ||
    state.stage === "CONFIRM_TIME" ||
    state.stage === "BOOKING"
  );
}

export function nextAgentPromptForStage(
  state: AppointmentConversationState
): string {
  switch (state.stage) {
    case "MEETING_INTENT":
    case "COLLECT_DATE":
      return "What day works best for you?";
    case "COLLECT_TIME":
      return state.meetingDate
        ? `What time on ${state.meetingDate} works for you?`
        : "What time works best for you?";
    case "CONFIRM_TIME":
      return `Just to confirm, ${state.meetingDate} at ${state.meetingTime} — is that right?`;
    case "BOOKING":
      return "One moment while I get that on the calendar.";
    case "BOOKED":
      return `You're all set. I've booked ${state.meetingDate} at ${state.meetingTime}. You'll receive the details shortly.`;
    case "DECLINED":
      return "No problem at all. Thanks for your time. Goodbye.";
    default:
      return "What is the main goal you are hoping to achieve with this right now?";
  }
}
