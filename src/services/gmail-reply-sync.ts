/**
 * Poll Gmail for replies on LeadPilot outbound threads; stop enrollments.
 */

import { EmailDirection, EmailMessageStatus, SequenceStopReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { listRecentInboxMessages } from "@/lib/email/gmail-client";
import { stopEnrollment } from "@/services/follow-up-sequences";

const OPT_OUT_RE =
  /\b(unsubscribe|stop (emailing|contacting)|remove me|opt[ -]?out|do not contact)\b/i;

export async function syncGmailRepliesForCompany(companyId: string): Promise<{
  replies: number;
  optOuts: number;
}> {
  const accounts = await prisma.emailAccount.findMany({
    where: { companyId, status: { in: ["CONNECTED", "DEMO"] } },
  });

  let replies = 0;
  let optOuts = 0;

  for (const account of accounts) {
    if (account.provider === "DEMO" || account.accessToken.startsWith("demo-")) {
      continue;
    }

    let inbox: Awaited<ReturnType<typeof listRecentInboxMessages>> = [];
    try {
      inbox = await listRecentInboxMessages({
        accountId: account.id,
        companyId,
        maxResults: 30,
      });
    } catch (error) {
      console.error("[gmail:sync] list failed", {
        accountId: account.id,
        message: error instanceof Error ? error.message : "unknown",
      });
      continue;
    }

    for (const msg of inbox) {
      if (!msg.threadId) continue;

      const outbound = await prisma.emailMessage.findFirst({
        where: {
          companyId,
          threadId: msg.threadId,
          direction: EmailDirection.OUTBOUND,
          status: EmailMessageStatus.SENT,
        },
        orderBy: { sentAt: "asc" },
      });
      if (!outbound) continue;

      const already = await prisma.emailMessage.findFirst({
        where: {
          companyId,
          providerMessageId: msg.id,
        },
      });
      if (already) continue;

      await prisma.emailMessage.create({
        data: {
          companyId,
          leadId: outbound.leadId,
          emailAccountId: account.id,
          direction: EmailDirection.INBOUND,
          providerMessageId: msg.id,
          threadId: msg.threadId,
          toAddress: account.emailAddress,
          subject: msg.subject || "(no subject)",
          bodyText: msg.snippet || "",
          status: EmailMessageStatus.RECEIVED,
          sentAt: msg.internalDate
            ? new Date(msg.internalDate)
            : new Date(),
        },
      });

      await prisma.emailMessage.update({
        where: { id: outbound.id },
        data: { repliedAt: new Date() },
      });

      await prisma.activity.create({
        data: {
          companyId,
          leadId: outbound.leadId,
          type: "EMAIL_RECEIVED",
          description: `Reply received: ${msg.subject || "email"}`,
        },
      });

      replies += 1;

      const text = `${msg.subject}\n${msg.snippet}`;
      if (OPT_OUT_RE.test(text)) {
        await prisma.lead.update({
          where: { id: outbound.leadId },
          data: { emailOptOut: true, emailOptOutAt: new Date() },
        });
        await prisma.activity.create({
          data: {
            companyId,
            leadId: outbound.leadId,
            type: "EMAIL_OPT_OUT",
            description: "Lead opted out of email (detected in reply)",
          },
        });
        optOuts += 1;
      }

      const enrollments = await prisma.followUpEnrollment.findMany({
        where: {
          companyId,
          leadId: outbound.leadId,
          status: "ACTIVE",
        },
      });
      for (const en of enrollments) {
        await stopEnrollment({
          companyId,
          enrollmentId: en.id,
          reason: OPT_OUT_RE.test(text)
            ? SequenceStopReason.UNSUBSCRIBED
            : SequenceStopReason.REPLIED,
        });
      }
    }
  }

  return { replies, optOuts };
}
