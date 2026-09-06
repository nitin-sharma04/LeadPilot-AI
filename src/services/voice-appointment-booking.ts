/**
 * Shared voice → appointment booking. Used by finalize, from-call API, and replay.
 */

import { AppointmentSource, CallStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { bookAppointment } from "@/services/appointments";
import { resolveAppointmentIntent } from "@/lib/calendar/appointment-intent";
import { formatInTimezone } from "@/lib/calendar/timezone";

async function syncCallSummaryAppointment(
  callId: string,
  booking: VoiceBookResult
) {
  const existing = await prisma.callSummary.findUnique({ where: { callId } });
  if (!existing) return;

  await prisma.callSummary.update({
    where: { callId },
    data: {
      appointmentStatus: booking.appointmentStatus,
      preferredMeetingTime:
        booking.preferredText || existing.preferredMeetingTime,
      appointmentDateTime: booking.parsedStart
        ? new Date(booking.parsedStart)
        : existing.appointmentDateTime,
      appointmentTimezone: booking.timezone || existing.appointmentTimezone,
      appointmentId: booking.appointmentId || existing.appointmentId,
    },
  });
}

export type VoiceBookResult = {
  booked: boolean;
  reason?: string;
  appointmentStatus:
    | "none"
    | "proposed"
    | "awaiting_confirmation"
    | "confirmed"
    | "booked"
    | "declined"
    | "failed";
  appointmentId?: string;
  externalEventId?: string | null;
  calendarSynced?: boolean;
  preferredText?: string;
  timezone?: string;
  parsedStart?: string;
  displayWhen?: string;
  reusedExisting?: boolean;
};

export async function attemptBookAppointmentFromCall(input: {
  callId: string;
  /** Force booking even if confirmation heuristics are weak (structured mid-call confirm). */
  forceConfirmed?: boolean;
  preferredTimeText?: string;
  timezoneOverride?: string;
}): Promise<VoiceBookResult> {
  const call = await prisma.call.findUnique({
    where: { id: input.callId },
    include: {
      lead: true,
      company: true,
      summary: true,
      transcripts: { orderBy: { timestamp: "asc" } },
      appointments: {
        where: { idempotencyKey: `call:${input.callId}` },
        take: 1,
      },
    },
  });
  if (!call) throw new AppError("Call not found", 404);

  // Idempotent: already booked for this call
  if (call.appointments[0]) {
    const existing = call.appointments[0];
    console.info("[voice:appointment] reuse existing", {
      callId: call.id,
      appointmentId: existing.id,
      externalEventIdPresent: Boolean(existing.externalEventId),
    });
    return {
      booked: true,
      appointmentStatus: "booked",
      appointmentId: existing.id,
      externalEventId: existing.externalEventId,
      calendarSynced: Boolean(existing.externalEventId),
      timezone: existing.timezone,
      parsedStart: existing.dateTime.toISOString(),
      displayWhen: formatInTimezone(existing.dateTime, existing.timezone),
      reusedExisting: true,
    };
  }

  const transcripts = call.transcripts.map((t) => ({
    speaker: t.speaker,
    text: t.message,
  }));

  // Inject preferred override into a synthetic lead line for extraction
  if (input.preferredTimeText?.trim()) {
    transcripts.push({
      speaker: "LEAD",
      text: input.preferredTimeText.trim(),
    });
  }

  const intent = resolveAppointmentIntent({
    transcripts,
    companyTimezone: input.timezoneOverride || call.company.timezone,
    summaryPreferredTime: call.summary?.preferredMeetingTime,
  });

  console.info("[voice:appointment] intent resolved", {
    callId: call.id,
    companyId: call.companyId,
    leadId: call.leadId,
    appointmentStatus:
      !intent.ambiguous && (intent.confirmed || input.forceConfirmed)
        ? "confirmed"
        : intent.status,
    preferredMeetingTime: intent.preferredText,
    appointmentTimezone: intent.timezone,
    ambiguous: intent.ambiguous,
    confirmed: intent.confirmed || Boolean(input.forceConfirmed),
    source: intent.source,
    localDate: intent.parsed?.local
      ? `${intent.parsed.local.year}-${intent.parsed.local.month}-${intent.parsed.local.day}`
      : null,
    localTime: intent.parsed?.local
      ? `${intent.parsed.local.hour}:${String(intent.parsed.local.minute).padStart(2, "0")}`
      : null,
    parsedStart: intent.parsed?.start?.toISOString() ?? null,
  });

  if (!intent.preferredText || intent.ambiguous || !intent.parsed) {
    const ambiguousResult: VoiceBookResult = {
      booked: false,
      reason: "ambiguous_time",
      appointmentStatus: intent.preferredText ? "proposed" : "none",
      preferredText: intent.preferredText,
      timezone: intent.timezone,
    };
    await syncCallSummaryAppointment(call.id, ambiguousResult);
    return ambiguousResult;
  }

  const confirmed = Boolean(input.forceConfirmed) || intent.confirmed;
  if (!confirmed) {
    const awaiting: VoiceBookResult = {
      booked: false,
      reason: "not_confirmed",
      appointmentStatus: "awaiting_confirmation",
      preferredText: intent.preferredText,
      timezone: intent.timezone,
      parsedStart: intent.parsed.start.toISOString(),
      displayWhen: formatInTimezone(intent.parsed.start, intent.timezone),
    };
    await syncCallSummaryAppointment(call.id, awaiting);
    return awaiting;
  }

  const userId = call.agentId || call.lead.assignedToId;
  if (!userId) {
    console.error("[voice:appointment] no assignee", { callId: call.id });
    const failed: VoiceBookResult = {
      booked: false,
      reason: "no_assignee",
      appointmentStatus: "failed",
      preferredText: intent.preferredText,
      timezone: intent.timezone,
      parsedStart: intent.parsed.start.toISOString(),
    };
    await syncCallSummaryAppointment(call.id, failed);
    return failed;
  }

  try {
    const result = await bookAppointment({
      companyId: call.companyId,
      leadId: call.leadId,
      userId,
      assignedToId: call.lead.assignedToId || userId,
      title: `Discovery call — ${call.lead.name}`,
      startTime: intent.parsed.start,
      durationMinutes: 30,
      timezone: intent.timezone,
      notes: `Booked from AI voice call. Phrase: ${intent.preferredText}`,
      source: AppointmentSource.AI_CALL,
      callId: call.id,
      idempotencyKey: `call:${call.id}`,
      syncCalendar: true,
    });

    console.info("[voice:appointment] booked", {
      callId: call.id,
      appointmentId: result.appointment.id,
      calendarSynced: result.calendarSynced,
      externalEventIdPresent: Boolean(result.appointment.externalEventId),
      timezone: result.appointment.timezone,
      dateTime: result.appointment.dateTime,
      reusedExisting: result.reusedExisting,
    });

    const booked: VoiceBookResult = {
      booked: true,
      appointmentStatus: "booked",
      appointmentId: result.appointment.id,
      externalEventId: result.appointment.externalEventId,
      calendarSynced: result.calendarSynced,
      preferredText: intent.preferredText,
      timezone: result.appointment.timezone,
      parsedStart: result.appointment.dateTime,
      displayWhen: result.appointment.displayWhen,
      reusedExisting: result.reusedExisting,
    };
    await syncCallSummaryAppointment(call.id, booked);
    return booked;
  } catch (error) {
    console.error("[voice:appointment] book failed", {
      callId: call.id,
      errorType: "book_failed",
      message: error instanceof Error ? error.message : "unknown",
    });
    const failed: VoiceBookResult = {
      booked: false,
      reason: "book_failed",
      appointmentStatus: "failed",
      preferredText: intent.preferredText,
      timezone: intent.timezone,
      parsedStart: intent.parsed.start.toISOString(),
    };
    await syncCallSummaryAppointment(call.id, failed);
    return failed;
  }
}

/** Mark call completed (if still active) and run finalize booking path. */
export async function finalizeCallForAppointments(callId: string): Promise<{
  callStatus: string;
  booking: VoiceBookResult;
}> {
  const call = await prisma.call.findUnique({ where: { id: callId } });
  if (!call) throw new AppError("Call not found", 404);

  if (
    call.status === CallStatus.INITIATING ||
    call.status === CallStatus.RINGING ||
    call.status === CallStatus.IN_PROGRESS ||
    call.status === CallStatus.CONNECTED
  ) {
    await prisma.call.update({
      where: { id: callId },
      data: {
        status: CallStatus.COMPLETED,
        endedAt: call.endedAt ?? new Date(),
      },
    });
  }

  const booking = await attemptBookAppointmentFromCall({ callId });
  return { callStatus: "COMPLETED", booking };
}
