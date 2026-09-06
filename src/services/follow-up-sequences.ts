/**
 * Follow-up sequence enrollment + scheduler.
 */

import {
  EmailTone,
  EmailType,
  SequenceEnrollmentStatus,
  SequenceStopReason,
} from "@prisma/client";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { generateAiEmail } from "@/lib/ai/email-generator";
import { sendOrDraftEmail } from "@/services/email";
import { formatInTimezone } from "@/lib/calendar/timezone";

const EMAIL_TYPE_MAP: Record<EmailType, string> = {
  INTRO: "intro",
  FOLLOW_UP: "follow_up",
  POST_CALL: "post_call",
  APPOINTMENT_CONFIRMATION: "appointment_confirmation",
  APPOINTMENT_REMINDER: "appointment_reminder",
  POST_MEETING: "post_meeting",
  RE_ENGAGEMENT: "re_engagement",
  CUSTOM: "custom",
};

const TONE_MAP: Record<EmailTone, string> = {
  PROFESSIONAL: "professional",
  FRIENDLY: "friendly",
  CONCISE: "concise",
  CONSULTATIVE: "consultative",
};

export async function ensureDefaultSequence(companyId: string) {
  const existing = await prisma.followUpSequence.findFirst({
    where: { companyId, isDefault: true },
    include: { steps: { orderBy: { stepOrder: "asc" } } },
  });
  if (existing) return existing;

  return prisma.followUpSequence.create({
    data: {
      companyId,
      name: "Standard nurture",
      description: "Intro → Day 2 → Day 4 → Day 7",
      isDefault: true,
      isActive: true,
      steps: {
        create: [
          {
            stepOrder: 1,
            delayDays: 0,
            emailType: EmailType.INTRO,
            tone: EmailTone.PROFESSIONAL,
          },
          {
            stepOrder: 2,
            delayDays: 2,
            emailType: EmailType.FOLLOW_UP,
            tone: EmailTone.FRIENDLY,
          },
          {
            stepOrder: 3,
            delayDays: 4,
            emailType: EmailType.FOLLOW_UP,
            tone: EmailTone.CONCISE,
          },
          {
            stepOrder: 4,
            delayDays: 7,
            emailType: EmailType.RE_ENGAGEMENT,
            tone: EmailTone.CONSULTATIVE,
          },
        ],
      },
    },
    include: { steps: { orderBy: { stepOrder: "asc" } } },
  });
}

export async function enrollLeadInSequence(input: {
  companyId: string;
  leadId: string;
  sequenceId?: string;
  userId: string;
}) {
  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, companyId: input.companyId },
  });
  if (!lead) throw new AppError("Lead not found", 404);
  if (lead.emailOptOut) {
    throw new AppError("Lead has opted out of email.", 400);
  }

  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
  });
  if (!company?.emailFollowUpSequencesEnabled && !company?.emailAutomationEnabled) {
    // Allow manual enroll even if automation flag off — sequences can still be managed.
  }

  const sequence = input.sequenceId
    ? await prisma.followUpSequence.findFirst({
        where: { id: input.sequenceId, companyId: input.companyId },
        include: { steps: { orderBy: { stepOrder: "asc" } } },
      })
    : await ensureDefaultSequence(input.companyId);

  if (!sequence) throw new AppError("Sequence not found", 404);

  const active = await prisma.followUpEnrollment.findFirst({
    where: {
      companyId: input.companyId,
      leadId: input.leadId,
      status: SequenceEnrollmentStatus.ACTIVE,
    },
  });
  if (active) {
    return active;
  }

  const first = sequence.steps.find((s) => s.enabled) || sequence.steps[0];
  const nextRunAt = new Date(
    Date.now() + (first?.delayDays || 0) * 24 * 60 * 60 * 1000
  );

  const enrollment = await prisma.followUpEnrollment.create({
    data: {
      companyId: input.companyId,
      leadId: input.leadId,
      sequenceId: sequence.id,
      status: SequenceEnrollmentStatus.ACTIVE,
      currentStepOrder: first?.stepOrder || 1,
      nextRunAt,
    },
  });

  await prisma.activity.create({
    data: {
      companyId: input.companyId,
      leadId: input.leadId,
      userId: input.userId,
      type: "FOLLOWUP_STARTED",
      description: `Follow-up sequence started: ${sequence.name}`,
    },
  });

  return enrollment;
}

export async function stopEnrollment(input: {
  companyId: string;
  enrollmentId: string;
  reason: SequenceStopReason;
  userId?: string;
}) {
  const enrollment = await prisma.followUpEnrollment.findFirst({
    where: { id: input.enrollmentId, companyId: input.companyId },
  });
  if (!enrollment) throw new AppError("Enrollment not found", 404);
  if (
    enrollment.status === SequenceEnrollmentStatus.STOPPED ||
    enrollment.status === SequenceEnrollmentStatus.COMPLETED
  ) {
    return enrollment;
  }

  const updated = await prisma.followUpEnrollment.update({
    where: { id: enrollment.id },
    data: {
      status: SequenceEnrollmentStatus.STOPPED,
      stoppedAt: new Date(),
      stopReason: input.reason,
      nextRunAt: null,
      processingLock: null,
      processingUntil: null,
    },
  });

  await prisma.activity.create({
    data: {
      companyId: input.companyId,
      leadId: enrollment.leadId,
      userId: input.userId,
      type: "FOLLOWUP_STOPPED",
      description: `Follow-up sequence stopped (${input.reason})`,
    },
  });

  return updated;
}

export async function processDueFollowUps(limit = 20): Promise<{
  processed: number;
  sent: number;
  skipped: number;
  errors: number;
}> {
  const now = new Date();
  const due = await prisma.followUpEnrollment.findMany({
    where: {
      status: SequenceEnrollmentStatus.ACTIVE,
      nextRunAt: { lte: now },
      OR: [
        { processingUntil: null },
        { processingUntil: { lt: now } },
      ],
    },
    take: limit,
    orderBy: { nextRunAt: "asc" },
    include: {
      sequence: { include: { steps: { orderBy: { stepOrder: "asc" } } } },
      lead: { include: { analysis: true } },
      company: true,
    },
  });

  let processed = 0;
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const enrollment of due) {
    const lock = randomBytes(8).toString("hex");
    const claimed = await prisma.followUpEnrollment.updateMany({
      where: {
        id: enrollment.id,
        status: SequenceEnrollmentStatus.ACTIVE,
        OR: [
          { processingLock: null },
          { processingUntil: { lt: now } },
        ],
      },
      data: {
        processingLock: lock,
        processingUntil: new Date(Date.now() + 120_000),
      },
    });
    if (claimed.count === 0) {
      skipped += 1;
      continue;
    }

    processed += 1;

    try {
      if (enrollment.lead.emailOptOut) {
        await stopEnrollment({
          companyId: enrollment.companyId,
          enrollmentId: enrollment.id,
          reason: SequenceStopReason.OPTED_OUT,
        });
        skipped += 1;
        continue;
      }

      if (
        !enrollment.company.emailAutomationEnabled ||
        !enrollment.company.emailFollowUpSequencesEnabled
      ) {
        // Leave scheduled but do not send while automation off
        await prisma.followUpEnrollment.update({
          where: { id: enrollment.id },
          data: { processingLock: null, processingUntil: null },
        });
        skipped += 1;
        continue;
      }

      if (
        enrollment.company.emailHumanApprovalRequired ||
        !enrollment.company.emailAutoSendEnabled
      ) {
        // Create draft only
      }

      const step = enrollment.sequence.steps.find(
        (s) => s.stepOrder === enrollment.currentStepOrder && s.enabled
      );
      if (!step) {
        await prisma.followUpEnrollment.update({
          where: { id: enrollment.id },
          data: {
            status: SequenceEnrollmentStatus.COMPLETED,
            completedAt: new Date(),
            nextRunAt: null,
            processingLock: null,
            processingUntil: null,
          },
        });
        await prisma.activity.create({
          data: {
            companyId: enrollment.companyId,
            leadId: enrollment.leadId,
            type: "FOLLOWUP_COMPLETED",
            description: "Follow-up sequence completed",
          },
        });
        continue;
      }

      const account =
        (enrollment.company.defaultEmailAccountId
          ? await prisma.emailAccount.findFirst({
              where: {
                id: enrollment.company.defaultEmailAccountId,
                companyId: enrollment.companyId,
                status: { in: ["CONNECTED", "DEMO"] },
              },
            })
          : null) ||
        (await prisma.emailAccount.findFirst({
          where: {
            companyId: enrollment.companyId,
            status: { in: ["CONNECTED", "DEMO"] },
          },
          orderBy: { createdAt: "asc" },
        }));

      if (!account) {
        await prisma.followUpEnrollment.update({
          where: { id: enrollment.id },
          data: {
            status: SequenceEnrollmentStatus.FAILED,
            stopReason: SequenceStopReason.FAILED,
            stoppedAt: new Date(),
            processingLock: null,
            processingUntil: null,
            nextRunAt: null,
          },
        });
        errors += 1;
        continue;
      }

      const appointment = await prisma.appointment.findFirst({
        where: {
          companyId: enrollment.companyId,
          leadId: enrollment.leadId,
          status: "SCHEDULED",
        },
        orderBy: { dateTime: "asc" },
      });

      const ai = await generateAiEmail({
        emailType: EMAIL_TYPE_MAP[step.emailType] as
          | "intro"
          | "follow_up"
          | "re_engagement",
        tone: TONE_MAP[step.tone] as
          | "professional"
          | "friendly"
          | "concise"
          | "consultative",
        lead: {
          leadName: enrollment.lead.name,
          leadEmail: enrollment.lead.email,
          companyName: enrollment.lead.companyName,
          industry: enrollment.lead.analysis?.industry || enrollment.lead.industry,
          jobTitle: enrollment.lead.jobTitle,
          source: enrollment.lead.source,
          score: enrollment.lead.score,
          buyingStage: enrollment.lead.analysis?.buyingStage,
          requirements: enrollment.lead.analysis?.requirements,
          painPoints: enrollment.lead.analysis?.painPoints,
          objections: enrollment.lead.analysis?.objections,
          recommendation: enrollment.lead.analysis?.recommendation,
          appointmentBooked: Boolean(appointment),
          appointmentWhen: appointment
            ? formatInTimezone(appointment.dateTime, appointment.timezone)
            : null,
          appointmentTimezone: appointment?.timezone || null,
          meetingUrl: appointment?.meetingUrl || null,
          sellerCompanyName: enrollment.company.name,
        },
      });

      const idempotencyKey = `enroll:${enrollment.id}:step:${step.stepOrder}`;
      const asDraft =
        enrollment.company.emailHumanApprovalRequired ||
        !enrollment.company.emailAutoSendEnabled;

      const result = await sendOrDraftEmail({
        companyId: enrollment.companyId,
        leadId: enrollment.leadId,
        userId: account.userId,
        emailAccountId: account.id,
        subject: ai.result.subject,
        body: `${ai.result.body}\n\n${ai.result.callToAction}`,
        emailType: step.emailType,
        tone: step.tone,
        idempotencyKey,
        enrollmentId: enrollment.id,
        stepId: step.id,
        asDraft,
      });

      if (result.sent) sent += 1;

      await prisma.activity.create({
        data: {
          companyId: enrollment.companyId,
          leadId: enrollment.leadId,
          type: "FOLLOWUP_SENT",
          description: asDraft
            ? `Follow-up draft prepared (step ${step.stepOrder})`
            : `Follow-up email sent (step ${step.stepOrder})`,
        },
      });

      const nextStep = enrollment.sequence.steps.find(
        (s) => s.stepOrder > step.stepOrder && s.enabled
      );

      if (!nextStep) {
        await prisma.followUpEnrollment.update({
          where: { id: enrollment.id },
          data: {
            status: SequenceEnrollmentStatus.COMPLETED,
            completedAt: new Date(),
            lastRunAt: new Date(),
            nextRunAt: null,
            processingLock: null,
            processingUntil: null,
            currentStepOrder: step.stepOrder,
          },
        });
        await prisma.activity.create({
          data: {
            companyId: enrollment.companyId,
            leadId: enrollment.leadId,
            type: "FOLLOWUP_COMPLETED",
            description: "Follow-up sequence completed",
          },
        });
      } else {
        await prisma.followUpEnrollment.update({
          where: { id: enrollment.id },
          data: {
            currentStepOrder: nextStep.stepOrder,
            lastRunAt: new Date(),
            nextRunAt: new Date(
              Date.now() + nextStep.delayDays * 24 * 60 * 60 * 1000
            ),
            processingLock: null,
            processingUntil: null,
          },
        });
      }
    } catch (error) {
      errors += 1;
      console.error("[followup] step failed", {
        enrollmentId: enrollment.id,
        message: error instanceof Error ? error.message : "unknown",
      });
      await prisma.followUpEnrollment.update({
        where: { id: enrollment.id },
        data: {
          processingLock: null,
          processingUntil: null,
          // Retry in 1 hour
          nextRunAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
    }
  }

  return { processed, sent, skipped, errors };
}
