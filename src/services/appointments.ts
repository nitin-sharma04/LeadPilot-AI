/**
 * Appointment booking service — single source of truth for scheduling.
 */

import {
  AppointmentSource,
  AppointmentStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import type { SessionUser } from "@/lib/session";
import {
  assertTimezone,
  addMinutes,
  formatInTimezone,
  rangesOverlap,
} from "@/lib/calendar/timezone";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarAvailability,
  hasBusyConflict,
  updateCalendarEvent,
} from "@/lib/calendar/google-calendar";

export type BookAppointmentInput = {
  companyId: string;
  leadId: string;
  userId: string;
  title: string;
  startTime: Date;
  durationMinutes?: number;
  timezone: string;
  notes?: string;
  description?: string;
  source?: AppointmentSource;
  assignedToId?: string | null;
  callId?: string | null;
  idempotencyKey?: string | null;
  /** When false, skip Google even if connected (LeadPilot-only). Default true. */
  syncCalendar?: boolean;
};

export type BookAppointmentResult = {
  appointment: Awaited<ReturnType<typeof mapAppointment>>;
  calendarSynced: boolean;
  reusedExisting: boolean;
};

function mapAppointment(
  appt: Prisma.AppointmentGetPayload<{
    include: { lead: true; assignedTo: true };
  }>
) {
  const end = addMinutes(appt.dateTime, appt.duration);
  return {
    id: appt.id,
    companyId: appt.companyId,
    leadId: appt.leadId,
    callId: appt.callId,
    title: appt.title,
    description: appt.description,
    dateTime: appt.dateTime.toISOString(),
    endTime: end.toISOString(),
    duration: appt.duration,
    timezone: appt.timezone,
    status: appt.status,
    source: appt.source,
    notes: appt.notes,
    meetingUrl: appt.meetingUrl,
    externalEventId: appt.externalEventId,
    calendarProvider: appt.calendarProvider,
    calendarSynced: Boolean(appt.externalEventId),
    calendarLabel: appt.externalEventId
      ? "Google Calendar"
      : "LeadPilot appointment",
    assignedToId: appt.assignedToId,
    leadName: appt.lead.name,
    companyName: appt.lead.companyName,
    leadEmail: appt.lead.email,
    ownerName: appt.assignedTo?.name ?? "Unassigned",
    displayWhen: formatInTimezone(appt.dateTime, appt.timezone),
    createdAt: appt.createdAt.toISOString(),
    updatedAt: appt.updatedAt.toISOString(),
  };
}

async function assertLeadInCompany(leadId: string, companyId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId },
  });
  if (!lead) throw new AppError("Lead not found", 404);
  return lead;
}

async function findLocalConflicts(input: {
  companyId: string;
  assignedToId: string | null | undefined;
  start: Date;
  end: Date;
  excludeId?: string;
}) {
  const existing = await prisma.appointment.findMany({
    where: {
      companyId: input.companyId,
      status: AppointmentStatus.SCHEDULED,
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      ...(input.assignedToId
        ? { assignedToId: input.assignedToId }
        : {}),
    },
  });

  return existing.filter((a) => {
    const aEnd = addMinutes(a.dateTime, a.duration);
    return rangesOverlap(input.start, input.end, a.dateTime, aEnd);
  });
}

export async function bookAppointment(
  input: BookAppointmentInput
): Promise<BookAppointmentResult> {
  const timezone = assertTimezone(input.timezone);
  const duration = input.durationMinutes ?? 30;
  if (duration < 15 || duration > 480) {
    throw new AppError("Duration must be between 15 and 480 minutes", 400);
  }
  if (!(input.startTime instanceof Date) || Number.isNaN(input.startTime.getTime())) {
    throw new AppError("Invalid start time", 400);
  }
  if (input.startTime.getTime() < Date.now() - 60_000) {
    throw new AppError("Appointment time must be in the future", 400);
  }

  const end = addMinutes(input.startTime, duration);
  const lead = await assertLeadInCompany(input.leadId, input.companyId);

  const assigneeId =
    input.assignedToId === undefined
      ? input.userId
      : input.assignedToId;

  if (assigneeId) {
    const assignee = await prisma.user.findFirst({
      where: { id: assigneeId, companyId: input.companyId },
    });
    if (!assignee) throw new AppError("Assignee not found in company", 400);
  }

  // Idempotency
  if (input.idempotencyKey) {
    const existing = await prisma.appointment.findFirst({
      where: {
        companyId: input.companyId,
        idempotencyKey: input.idempotencyKey,
      },
      include: { lead: true, assignedTo: true },
    });
    if (existing) {
      return {
        appointment: mapAppointment(existing),
        calendarSynced: Boolean(existing.externalEventId),
        reusedExisting: true,
      };
    }
  }

  const conflicts = await findLocalConflicts({
    companyId: input.companyId,
    assignedToId: assigneeId,
    start: input.startTime,
    end,
  });
  if (conflicts.length > 0) {
    throw new AppError(
      "That time conflicts with an existing LeadPilot appointment.",
      409
    );
  }

  const syncCalendar = input.syncCalendar !== false;
  const connection = syncCalendar
    ? await prisma.googleCalendarConnection.findFirst({
        where: {
          companyId: input.companyId,
          userId: assigneeId || input.userId,
        },
      })
    : null;

  // Fall back to booking user connection
  const calendarUserId = connection
    ? connection.userId
    : syncCalendar
      ? (
          await prisma.googleCalendarConnection.findFirst({
            where: { companyId: input.companyId, userId: input.userId },
          })
        )?.userId
      : undefined;

  if (calendarUserId) {
    const busy = await getCalendarAvailability({
      userId: calendarUserId,
      companyId: input.companyId,
      timeMin: input.startTime,
      timeMax: end,
    });
    if (hasBusyConflict(input.startTime, end, busy)) {
      throw new AppError(
        "That time conflicts with a Google Calendar busy period.",
        409
      );
    }
  }

  let externalEventId: string | null = null;
  let meetingUrl: string | null = null;
  let calendarProvider: string | null = null;

  if (calendarUserId) {
    const created = await createCalendarEvent({
      userId: calendarUserId,
      companyId: input.companyId,
      event: {
        title: input.title,
        description:
          input.description ||
          [
            `Lead: ${lead.name}`,
            `Company: ${lead.companyName}`,
            lead.email ? `Email: ${lead.email}` : null,
            input.notes ? `Notes: ${input.notes}` : null,
            "Booked via LeadPilot AI",
          ]
            .filter(Boolean)
            .join("\n"),
        start: input.startTime,
        end,
        timezone,
        attendeeEmail: lead.email,
      },
    });
    externalEventId = created.externalEventId;
    meetingUrl = created.meetingUrl ?? null;
    calendarProvider = "google";
  }

  const appointment = await prisma.$transaction(async (tx) => {
    const created = await tx.appointment.create({
      data: {
        companyId: input.companyId,
        leadId: input.leadId,
        assignedToId: assigneeId,
        callId: input.callId ?? null,
        title: input.title,
        description: input.description ?? null,
        dateTime: input.startTime,
        duration,
        timezone,
        status: AppointmentStatus.SCHEDULED,
        source: input.source ?? AppointmentSource.MANUAL,
        notes: input.notes ?? null,
        meetingUrl,
        externalEventId,
        calendarProvider,
        idempotencyKey: input.idempotencyKey ?? null,
      },
      include: { lead: true, assignedTo: true },
    });

    await tx.activity.create({
      data: {
        companyId: input.companyId,
        leadId: input.leadId,
        userId: input.userId,
        type: "APPOINTMENT_BOOKED",
        description: `Appointment booked: ${input.title} (${formatInTimezone(input.startTime, timezone)})`,
      },
    });

    // Idempotent notification (one per idempotency key / appointment)
    const notifyUserId = assigneeId || input.userId;
    const existingNotif = await tx.notification.findFirst({
      where: {
        companyId: input.companyId,
        userId: notifyUserId,
        type: "MEETING",
        message: { contains: created.id },
      },
    });
    if (!existingNotif) {
      await tx.notification.create({
        data: {
          companyId: input.companyId,
          userId: notifyUserId,
          type: "MEETING",
          title: "New meeting booked",
          message: `New meeting booked with ${lead.name} — ${formatInTimezone(input.startTime, timezone)}. [${created.id}]`,
        },
      });
    }

    return created;
  });

  // Phase 7: optional appointment confirmation email (non-blocking)
  void import("@/services/email-automation")
    .then(({ maybeSendAppointmentConfirmation }) =>
      maybeSendAppointmentConfirmation({
        companyId: input.companyId,
        leadId: input.leadId,
        userId: input.userId,
        appointmentId: appointment.id,
      })
    )
    .catch((error) => {
      console.error("[appointments] confirmation email failed", {
        appointmentId: appointment.id,
        message: error instanceof Error ? error.message : "unknown",
      });
    });

  return {
    appointment: mapAppointment(appointment),
    calendarSynced: Boolean(externalEventId),
    reusedExisting: false,
  };
}

export async function listCompanyAppointments(user: SessionUser) {
  const rows = await prisma.appointment.findMany({
    where: { companyId: user.companyId },
    include: { lead: true, assignedTo: true },
    orderBy: { dateTime: "asc" },
  });
  return rows.map(mapAppointment);
}

export async function getAppointmentForCompany(
  user: SessionUser,
  id: string
) {
  const row = await prisma.appointment.findFirst({
    where: { id, companyId: user.companyId },
    include: { lead: true, assignedTo: true },
  });
  if (!row) throw new AppError("Appointment not found", 404);
  return mapAppointment(row);
}

export async function rescheduleAppointment(input: {
  user: SessionUser;
  appointmentId: string;
  startTime: Date;
  durationMinutes?: number;
  timezone?: string;
  notes?: string;
}) {
  const existing = await prisma.appointment.findFirst({
    where: { id: input.appointmentId, companyId: input.user.companyId },
    include: { lead: true, assignedTo: true },
  });
  if (!existing) throw new AppError("Appointment not found", 404);
  if (existing.status === AppointmentStatus.CANCELLED) {
    throw new AppError("Cannot reschedule a cancelled appointment", 400);
  }

  const timezone = assertTimezone(input.timezone || existing.timezone);
  const duration = input.durationMinutes ?? existing.duration;
  const end = addMinutes(input.startTime, duration);

  const conflicts = await findLocalConflicts({
    companyId: input.user.companyId,
    assignedToId: existing.assignedToId,
    start: input.startTime,
    end,
    excludeId: existing.id,
  });
  if (conflicts.length > 0) {
    throw new AppError(
      "That time conflicts with an existing LeadPilot appointment.",
      409
    );
  }

  if (existing.externalEventId && existing.assignedToId) {
    const conn = await prisma.googleCalendarConnection.findFirst({
      where: {
        companyId: input.user.companyId,
        OR: [
          { userId: existing.assignedToId },
          { userId: input.user.id },
        ],
      },
    });
    if (conn) {
      const busy = await getCalendarAvailability({
        userId: conn.userId,
        companyId: input.user.companyId,
        timeMin: input.startTime,
        timeMax: end,
      });
      // Ignore the event we're updating by only checking busy — Google freebusy
      // includes our own event; for simplicity we still check local first.
      void busy;
      await updateCalendarEvent({
        userId: conn.userId,
        companyId: input.user.companyId,
        externalEventId: existing.externalEventId,
        event: {
          title: existing.title,
          description: existing.description || undefined,
          start: input.startTime,
          end,
          timezone,
        },
      });
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.appointment.update({
      where: { id: existing.id },
      data: {
        dateTime: input.startTime,
        duration,
        timezone,
        notes: input.notes ?? existing.notes,
        status: AppointmentStatus.SCHEDULED,
      },
      include: { lead: true, assignedTo: true },
    });
    await tx.activity.create({
      data: {
        companyId: input.user.companyId,
        leadId: existing.leadId,
        userId: input.user.id,
        type: "APPOINTMENT_RESCHEDULED",
        description: `Appointment rescheduled to ${formatInTimezone(input.startTime, timezone)}`,
      },
    });
    return row;
  });

  return mapAppointment(updated);
}

export async function cancelAppointment(input: {
  user: SessionUser;
  appointmentId: string;
}) {
  const existing = await prisma.appointment.findFirst({
    where: { id: input.appointmentId, companyId: input.user.companyId },
    include: { lead: true, assignedTo: true },
  });
  if (!existing) throw new AppError("Appointment not found", 404);
  if (existing.status === AppointmentStatus.CANCELLED) {
    return mapAppointment(existing);
  }

  if (existing.externalEventId) {
    const conn = await prisma.googleCalendarConnection.findFirst({
      where: {
        companyId: input.user.companyId,
        OR: [
          ...(existing.assignedToId
            ? [{ userId: existing.assignedToId }]
            : []),
          { userId: input.user.id },
        ],
      },
    });
    if (conn) {
      await deleteCalendarEvent({
        userId: conn.userId,
        companyId: input.user.companyId,
        externalEventId: existing.externalEventId,
      });
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.appointment.update({
      where: { id: existing.id },
      data: { status: AppointmentStatus.CANCELLED },
      include: { lead: true, assignedTo: true },
    });
    await tx.activity.create({
      data: {
        companyId: input.user.companyId,
        leadId: existing.leadId,
        userId: input.user.id,
        type: "APPOINTMENT_CANCELLED",
        description: `Appointment cancelled: ${existing.title}`,
      },
    });
    return row;
  });

  return mapAppointment(updated);
}

export async function getGoogleConnectionStatus(user: SessionUser) {
  const { isGoogleCalendarConfigured, isGoogleCalendarDemoMode } =
    await import("@/lib/calendar/google-config");
  const conn = await prisma.googleCalendarConnection.findFirst({
    where: { userId: user.id, companyId: user.companyId },
    select: {
      googleEmail: true,
      calendarId: true,
      createdAt: true,
      updatedAt: true,
      scope: true,
    },
  });
  const demo = isGoogleCalendarDemoMode();
  return {
    configured: isGoogleCalendarConfigured(),
    connected: Boolean(conn),
    demo,
    googleEmail: conn?.googleEmail ?? null,
    calendarId: conn?.calendarId ?? null,
    connectedAt: conn?.createdAt?.toISOString() ?? null,
  };
}
