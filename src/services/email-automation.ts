/**
 * Optional automation after appointment book / call complete.
 */

import { EmailTone, EmailType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateAiEmail } from "@/lib/ai/email-generator";
import { sendOrDraftEmail } from "@/services/email";
import { formatInTimezone } from "@/lib/calendar/timezone";
import { enrollLeadInSequence } from "@/services/follow-up-sequences";

export async function maybeSendAppointmentConfirmation(input: {
  companyId: string;
  leadId: string;
  userId: string;
  appointmentId: string;
}) {
  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
  });
  if (!company?.emailAutomationEnabled || !company.emailAppointmentConfirmEnabled) {
    return { skipped: true as const, reason: "disabled" };
  }

  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, companyId: input.companyId },
    include: { analysis: true },
  });
  if (!lead || lead.emailOptOut || !lead.email) {
    return { skipped: true as const, reason: "lead" };
  }

  const appointment = await prisma.appointment.findFirst({
    where: {
      id: input.appointmentId,
      companyId: input.companyId,
      leadId: input.leadId,
      status: "SCHEDULED",
    },
  });
  if (!appointment) {
    return { skipped: true as const, reason: "not_booked" };
  }

  const account =
    (company.defaultEmailAccountId
      ? await prisma.emailAccount.findFirst({
          where: {
            id: company.defaultEmailAccountId,
            companyId: input.companyId,
            status: { in: ["CONNECTED", "DEMO"] },
          },
        })
      : null) ||
    (await prisma.emailAccount.findFirst({
      where: {
        companyId: input.companyId,
        status: { in: ["CONNECTED", "DEMO"] },
      },
    }));
  if (!account) return { skipped: true as const, reason: "no_account" };

  const when = formatInTimezone(appointment.dateTime, appointment.timezone);
  const ai = await generateAiEmail({
    emailType: "appointment_confirmation",
    tone: "professional",
    lead: {
      leadName: lead.name,
      leadEmail: lead.email,
      companyName: lead.companyName,
      industry: lead.analysis?.industry || lead.industry,
      appointmentBooked: true,
      appointmentWhen: when,
      appointmentTimezone: appointment.timezone,
      meetingUrl: appointment.meetingUrl,
      sellerCompanyName: company.name,
    },
  });

  const asDraft =
    company.emailHumanApprovalRequired || !company.emailAutoSendEnabled;

  return sendOrDraftEmail({
    companyId: input.companyId,
    leadId: input.leadId,
    userId: input.userId,
    emailAccountId: account.id,
    subject: ai.result.subject,
    body: `${ai.result.body}\n\n${ai.result.callToAction}`,
    emailType: EmailType.APPOINTMENT_CONFIRMATION,
    tone: EmailTone.PROFESSIONAL,
    idempotencyKey: `appt-confirm:${appointment.id}`,
    asDraft,
  });
}

export async function maybeSendPostCallEmail(input: {
  companyId: string;
  leadId: string;
  userId: string;
  callId: string;
  appointmentBooked: boolean;
  appointmentId?: string | null;
}) {
  if (input.appointmentBooked && input.appointmentId) {
    return maybeSendAppointmentConfirmation({
      companyId: input.companyId,
      leadId: input.leadId,
      userId: input.userId,
      appointmentId: input.appointmentId,
    });
  }

  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
  });
  if (!company?.emailAutomationEnabled || !company.emailPostCallEnabled) {
    return { skipped: true as const, reason: "disabled" };
  }

  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, companyId: input.companyId },
    include: { analysis: true },
  });
  if (!lead || lead.emailOptOut) {
    return { skipped: true as const, reason: "lead" };
  }

  const summary = await prisma.callSummary.findUnique({
    where: { callId: input.callId },
  });

  const account =
    (await prisma.emailAccount.findFirst({
      where: {
        companyId: input.companyId,
        status: { in: ["CONNECTED", "DEMO"] },
      },
    }));
  if (!account) return { skipped: true as const, reason: "no_account" };

  const ai = await generateAiEmail({
    emailType: "post_call",
    tone: "friendly",
    lead: {
      leadName: lead.name,
      leadEmail: lead.email,
      companyName: lead.companyName,
      industry: lead.analysis?.industry || lead.industry,
      callSummary: summary?.summary || null,
      appointmentBooked: false,
      sellerCompanyName: company.name,
      requirements: summary?.keyRequirements,
      painPoints: summary?.painPoints,
    },
  });

  const asDraft =
    company.emailHumanApprovalRequired || !company.emailAutoSendEnabled;

  const result = await sendOrDraftEmail({
    companyId: input.companyId,
    leadId: input.leadId,
    userId: input.userId,
    emailAccountId: account.id,
    subject: ai.result.subject,
    body: `${ai.result.body}\n\n${ai.result.callToAction}`,
    emailType: EmailType.POST_CALL,
    tone: EmailTone.FRIENDLY,
    idempotencyKey: `post-call:${input.callId}`,
    asDraft,
  });

  if (company.emailFollowUpSequencesEnabled) {
    await enrollLeadInSequence({
      companyId: input.companyId,
      leadId: input.leadId,
      userId: input.userId,
    }).catch(() => undefined);
  }

  return result;
}
