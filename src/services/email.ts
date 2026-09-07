/**
 * Tenant-scoped email send / draft persistence.
 */

import {
  EmailDirection,
  EmailMessageStatus,
  EmailProvider,
  EmailTone,
  EmailType,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { sendGmailMessage } from "@/lib/email/gmail-client";

export type SendEmailInput = {
  companyId: string;
  leadId: string;
  userId: string;
  emailAccountId: string;
  to?: string;
  subject: string;
  body: string;
  emailType?: EmailType;
  tone?: EmailTone;
  threadId?: string | null;
  idempotencyKey?: string;
  enrollmentId?: string;
  stepId?: string;
  /** Persist as draft only (human approval). */
  asDraft?: boolean;
};

function mapSafe(row: {
  id: string;
  companyId: string;
  leadId: string;
  direction: EmailDirection;
  emailType: EmailType | null;
  tone: EmailTone | null;
  subject: string;
  bodyText: string;
  toAddress: string;
  status: EmailMessageStatus;
  threadId: string | null;
  providerMessageId: string | null;
  isDemo: boolean;
  sentAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  enrollmentId: string | null;
}) {
  return {
    id: row.id,
    companyId: row.companyId,
    leadId: row.leadId,
    direction: row.direction,
    emailType: row.emailType,
    tone: row.tone,
    subject: row.subject,
    body: row.bodyText,
    to: row.toAddress,
    status: row.status,
    threadId: row.threadId,
    providerMessageId: row.providerMessageId,
    isDemo: row.isDemo,
    sentAt: row.sentAt?.toISOString() ?? null,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    enrollmentId: row.enrollmentId,
  };
}

export async function sendOrDraftEmail(input: SendEmailInput) {
  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, companyId: input.companyId },
  });
  if (!lead) throw new AppError("Lead not found", 404);
  if (lead.emailOptOut && !input.asDraft) {
    throw new AppError("Lead has opted out of email.", 400);
  }

  const account = await prisma.emailAccount.findFirst({
    where: {
      id: input.emailAccountId,
      companyId: input.companyId,
      status: { in: ["CONNECTED", "DEMO"] },
    },
  });
  if (!account) throw new AppError("Email account not connected", 400);

  const to = (input.to || lead.email).trim();
  if (!to || !to.includes("@")) {
    throw new AppError("Lead has no valid email address", 400);
  }

  if (input.idempotencyKey) {
    const existing = await prisma.emailMessage.findFirst({
      where: {
        companyId: input.companyId,
        idempotencyKey: input.idempotencyKey,
      },
    });
    if (existing) {
      return {
        message: mapSafe(existing),
        reusedExisting: true,
        sent: existing.status === EmailMessageStatus.SENT,
      };
    }
  }

  if (input.asDraft) {
    const draft = await prisma.emailMessage.create({
      data: {
        companyId: input.companyId,
        leadId: input.leadId,
        emailAccountId: account.id,
        userId: input.userId,
        direction: EmailDirection.OUTBOUND,
        emailType: input.emailType,
        tone: input.tone,
        toAddress: to,
        subject: input.subject.trim(),
        bodyText: input.body.trim(),
        status: EmailMessageStatus.DRAFT,
        threadId: input.threadId || null,
        idempotencyKey: input.idempotencyKey,
        enrollmentId: input.enrollmentId,
        stepId: input.stepId,
        isDemo: account.provider === EmailProvider.DEMO,
      },
    });
    return { message: mapSafe(draft), reusedExisting: false, sent: false };
  }

  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
  });
  if (company?.emailHumanApprovalRequired && !input.enrollmentId) {
    // Manual composer sends are allowed when user explicitly clicks Send.
    // Automated paths must check settings separately.
  }

  const pending = await prisma.emailMessage.create({
    data: {
      companyId: input.companyId,
      leadId: input.leadId,
      emailAccountId: account.id,
      userId: input.userId,
      direction: EmailDirection.OUTBOUND,
      emailType: input.emailType,
      tone: input.tone,
      toAddress: to,
      subject: input.subject.trim(),
      bodyText: input.body.trim(),
      status: EmailMessageStatus.SENDING,
      threadId: input.threadId || null,
      idempotencyKey: input.idempotencyKey,
      enrollmentId: input.enrollmentId,
      stepId: input.stepId,
      isDemo: account.provider === EmailProvider.DEMO,
    },
  });

  try {
    const result = await sendGmailMessage({
      accountId: account.id,
      companyId: input.companyId,
      to,
      subject: input.subject.trim(),
      bodyText: input.body.trim(),
      threadId: input.threadId,
    });

    const sent = await prisma.emailMessage.update({
      where: { id: pending.id },
      data: {
        status: EmailMessageStatus.SENT,
        providerMessageId: result.providerMessageId,
        threadId: result.threadId,
        sentAt: new Date(),
        isDemo: result.isDemo,
      },
    });

    await prisma.activity.create({
      data: {
        companyId: input.companyId,
        leadId: input.leadId,
        userId: input.userId,
        type: "EMAIL_SENT",
        description: result.isDemo
          ? `Demo email prepared/sent: ${input.subject.trim()}`
          : `Email sent: ${input.subject.trim()}`,
      },
    });

    console.info("[email] sent", {
      companyId: input.companyId,
      leadId: input.leadId,
      messageId: sent.id,
      isDemo: result.isDemo,
      // never log tokens
    });

    return { message: mapSafe(sent), reusedExisting: false, sent: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Send failed";
    await prisma.emailMessage.update({
      where: { id: pending.id },
      data: {
        status: EmailMessageStatus.FAILED,
        errorMessage: msg.slice(0, 500),
      },
    });
    await prisma.activity.create({
      data: {
        companyId: input.companyId,
        leadId: input.leadId,
        userId: input.userId,
        type: "EMAIL_FAILED",
        description: `Email failed: ${input.subject.trim()}`,
      },
    });
    throw error instanceof AppError
      ? error
      : new AppError(msg, 502);
  }
}

export async function listLeadEmails(companyId: string, leadId: string) {
  const rows = await prisma.emailMessage.findMany({
    where: { companyId, leadId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map(mapSafe);
}

export async function getCompanyEmailMetrics(companyId: string) {
  const [sent, failed, received] = await Promise.all([
    prisma.emailMessage.count({
      where: { companyId, status: EmailMessageStatus.SENT },
    }),
    prisma.emailMessage.count({
      where: { companyId, status: EmailMessageStatus.FAILED },
    }),
    prisma.emailMessage.count({
      where: { companyId, direction: EmailDirection.INBOUND },
    }),
  ]);

  const [activeSeq, completedSeq, stoppedSeq, upcoming] = await Promise.all([
    prisma.followUpEnrollment.count({
      where: { companyId, status: "ACTIVE" },
    }),
    prisma.followUpEnrollment.count({
      where: { companyId, status: "COMPLETED" },
    }),
    prisma.followUpEnrollment.count({
      where: { companyId, status: "STOPPED" },
    }),
    prisma.followUpEnrollment.count({
      where: {
        companyId,
        status: "ACTIVE",
        nextRunAt: { gte: new Date() },
      },
    }),
  ]);

  return {
    emailsSent: sent,
    emailsFailed: failed,
    replies: received,
    activeSequences: activeSeq,
    completedSequences: completedSeq,
    stoppedSequences: stoppedSeq,
    upcomingFollowUps: upcoming,
    replyRate: sent > 0 ? Math.round((received / sent) * 1000) / 10 : 0,
  };
}

export type { Prisma };
