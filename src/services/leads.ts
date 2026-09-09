/**
 * Canonical lead creation — all sources (manual, public API, webhook, CSV, CRM)
 * must go through createLeadRecord / createLead.
 */

import { LeadSource, LeadStatus, Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { AppError, DuplicateLeadError } from "@/lib/errors";
import { mapLeadToUi } from "@/lib/mappers";
import type { CreateLeadInput, UpdateLeadInput } from "@/lib/validations";
import type { SessionUser } from "@/lib/session";

export type LeadListFilters = {
  q?: string;
  status?: LeadStatus | "ALL" | "HOT";
  source?: string;
  score?: "all" | "hot" | "warm" | "cold";
};

export type CreateLeadRecordInput = {
  companyId: string;
  name: string;
  email: string;
  phone?: string | null;
  companyName: string;
  jobTitle?: string | null;
  industry?: string | null;
  source?: LeadSource;
  message?: string | null;
  budget?: string | null;
  timeline?: string | null;
  website?: string | null;
  assignedToId?: string | null;
  actorUserId?: string | null;
  actorName?: string | null;
  activityType?: string;
  activityDescription?: string;
  /** Skip duplicate-by-email and return existing */
  dedupeByEmail?: boolean;
  /**
   * Dashboard manual create: throw DuplicateLeadError (HTTP 409) instead of
   * returning the existing record. Capture/CSV/CRM keep silent dedupe.
   */
  rejectDuplicates?: boolean;
  external?: {
    provider: "HUBSPOT" | "SALESFORCE" | "DEMO";
    externalId: string;
  };
  metadata?: Record<string, unknown>;
  /** Override automation (e.g. CSV bulk may defer) */
  runAutomation?: boolean;
};

export function normalizeLeadEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizeLeadPhone(phone?: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "").trim();
  return digits || null;
}

/** Dashboard create throws 409; capture/CSV/CRM return the existing record. */
export function maybeRejectDuplicateLead(
  rejectDuplicates: boolean | undefined,
  existingLeadId: string,
  field: "email" | "phone"
) {
  if (rejectDuplicates) {
    throw new DuplicateLeadError(existingLeadId, field);
  }
}

export async function createLeadRecord(input: CreateLeadRecordInput) {
  const email = normalizeLeadEmail(input.email);
  const phone = normalizeLeadPhone(input.phone);
  const source = input.source ?? LeadSource.MANUAL;

  if (input.external) {
    const byExt = await prisma.leadExternalIdentity.findUnique({
      where: {
        companyId_provider_externalId: {
          companyId: input.companyId,
          provider: input.external.provider,
          externalId: input.external.externalId,
        },
      },
      include: { lead: { include: { analysis: true } } },
    });
    if (byExt?.lead) {
      return {
        lead: byExt.lead,
        created: false,
        duplicate: true,
        reason: "external_id" as const,
      };
    }
  }

  if (input.dedupeByEmail !== false) {
    const existing = await prisma.lead.findFirst({
      where: { companyId: input.companyId, email },
      include: { analysis: true },
    });
    if (existing) {
      maybeRejectDuplicateLead(input.rejectDuplicates, existing.id, "email");
      await prisma.activity.create({
        data: {
          companyId: input.companyId,
          leadId: existing.id,
          userId: input.actorUserId ?? undefined,
          type: "DUPLICATE_DETECTED",
          description: `Duplicate lead capture for ${email} (existing ${existing.name}).`,
        },
      });
      return {
        lead: existing,
        created: false,
        duplicate: true,
        reason: "email" as const,
      };
    }
  }

  if (phone) {
    const byPhone = await prisma.lead.findFirst({
      where: { companyId: input.companyId, phone },
      include: { analysis: true },
    });
    if (byPhone) {
      maybeRejectDuplicateLead(input.rejectDuplicates, byPhone.id, "phone");
      await prisma.activity.create({
        data: {
          companyId: input.companyId,
          leadId: byPhone.id,
          userId: input.actorUserId ?? undefined,
          type: "DUPLICATE_DETECTED",
          description: `Duplicate lead capture for phone ${phone} (existing ${byPhone.name}).`,
        },
      });
      return {
        lead: byPhone,
        created: false,
        duplicate: true,
        reason: "phone" as const,
      };
    }
  }

  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
  });
  if (!company) throw new AppError("Company not found", 404);

  let assignedToId = input.assignedToId ?? null;
  if (!assignedToId && company.leadAutoAssignEnabled && company.defaultLeadOwnerId) {
    assignedToId = company.defaultLeadOwnerId;
  }

  const messageParts = [input.message?.trim()].filter(Boolean);
  if (input.website?.trim()) {
    messageParts.push(`Website: ${input.website.trim()}`);
  }
  if (input.metadata && Object.keys(input.metadata).length) {
    messageParts.push(`Meta: ${JSON.stringify(input.metadata).slice(0, 500)}`);
  }

  const lead = await prisma.lead.create({
    data: {
      companyId: input.companyId,
      assignedToId,
      name: input.name.trim(),
      email,
      phone,
      companyName: input.companyName.trim() || "Unknown",
      jobTitle: input.jobTitle?.trim() || null,
      industry: input.industry?.trim() || null,
      source,
      message: messageParts.join("\n") || null,
      budget: input.budget ?? null,
      timeline: input.timeline ?? null,
      score: 50,
      intent: "Medium",
      urgency: "Medium",
      status: LeadStatus.NEW,
      dealValue: 0,
      activities: {
        create: {
          companyId: input.companyId,
          userId: input.actorUserId ?? undefined,
          type: input.activityType || "LEAD_CREATED",
          description:
            input.activityDescription ||
            `${input.actorName || "System"} created lead ${input.name.trim()}.`,
        },
      },
    },
    include: { analysis: true },
  });

  if (input.external) {
    await prisma.leadExternalIdentity.create({
      data: {
        companyId: input.companyId,
        leadId: lead.id,
        provider: input.external.provider,
        externalId: input.external.externalId,
        syncStatus: "SYNCED",
        lastSyncedAt: new Date(),
      },
    });
  }

  // Hot-lead notification for owners when score will be analyzed later
  const owners = await prisma.user.findMany({
    where: {
      companyId: input.companyId,
      role: { in: ["OWNER", "ADMIN"] },
    },
    take: 3,
    select: { id: true },
  });
  if (owners.length) {
    await prisma.notification.createMany({
      data: owners.map((o) => ({
        companyId: input.companyId,
        userId: o.id,
        type: "HOT_LEAD",
        title: "New lead captured",
        message: `${lead.name} (${lead.email}) via ${source}`,
        read: false,
      })),
    });
  }

  if (input.runAutomation !== false) {
    void runNewLeadAutomation({
      companyId: input.companyId,
      leadId: lead.id,
      actorUserId: input.actorUserId,
    }).catch((error) => {
      console.error("[leads] automation failed", {
        leadId: lead.id,
        message: error instanceof Error ? error.message : "unknown",
      });
    });
  }

  return {
    lead,
    created: true,
    duplicate: false,
    reason: null,
  };
}

async function runNewLeadAutomation(input: {
  companyId: string;
  leadId: string;
  actorUserId?: string | null;
}) {
  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
  });
  if (!company) return;

  if (company.leadAutoAnalyzeEnabled) {
    try {
      const { analyzeAndPersistLead } = await import("@/services/ai-analysis");
      const user =
        input.actorUserId
          ? await prisma.user.findFirst({
              where: { id: input.actorUserId, companyId: input.companyId },
            })
          : await prisma.user.findFirst({
              where: { companyId: input.companyId, role: "OWNER" },
            });
      if (user) {
        await analyzeAndPersistLead({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          companyId: user.companyId,
        }, input.leadId);
      }
    } catch (error) {
      console.error("[leads] auto-analyze failed", {
        leadId: input.leadId,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  if (company.leadAutoFollowUpEnabled) {
    try {
      const { enrollLeadInSequence } = await import(
        "@/services/follow-up-sequences"
      );
      const userId =
        input.actorUserId ||
        company.defaultLeadOwnerId ||
        (
          await prisma.user.findFirst({
            where: { companyId: input.companyId },
            select: { id: true },
          })
        )?.id;
      if (userId) {
        await enrollLeadInSequence({
          companyId: input.companyId,
          leadId: input.leadId,
          sequenceId: company.defaultFollowUpSequenceId || undefined,
          userId,
        });
      }
    } catch {
      /* ignore enroll errors */
    }
  }

  // Auto-email / auto-call remain OFF unless explicitly enabled — and still
  // respect human approval / Gmail connection via existing services.
  if (company.leadAutoEmailEnabled && company.emailAutomationEnabled) {
    // Intentionally minimal: enroll/follow-up is the primary path.
    // Direct auto-email without approval is blocked unless auto-send is on.
  }
}

/** Session-authenticated create (dashboard / API). */
export async function createLead(user: SessionUser, input: CreateLeadInput) {
  const result = await createLeadRecord({
    companyId: user.companyId,
    name: input.name,
    email: input.email,
    phone: input.phone,
    companyName: input.companyName,
    jobTitle: input.jobTitle,
    industry: input.industry,
    source: input.source,
    message: input.message,
    budget: input.budget,
    timeline: input.timeline,
    assignedToId: input.assignedToId ?? user.id,
    actorUserId: user.id,
    actorName: user.name,
    activityType: "LEAD_CREATED",
    dedupeByEmail: true,
    rejectDuplicates: true,
    runAutomation: true,
  });

  if (result.duplicate) {
    throw new DuplicateLeadError(
      result.lead.id,
      result.reason === "phone" ? "phone" : "email"
    );
  }

  // Allow optional score overrides from manual form only after create
  if (
    input.score !== undefined ||
    input.intent ||
    input.urgency ||
    input.status ||
    input.dealValue !== undefined
  ) {
    const updated = await prisma.lead.update({
      where: { id: result.lead.id },
      data: {
        score: input.score,
        intent: input.intent,
        urgency: input.urgency,
        status: input.status,
        dealValue: input.dealValue,
      },
      include: { analysis: true },
    });
    return mapLeadToUi(updated);
  }

  return mapLeadToUi(result.lead);
}

export async function listLeads(user: SessionUser, filters: LeadListFilters = {}) {
  const where: Prisma.LeadWhereInput = {
    companyId: user.companyId,
  };

  if (filters.q?.trim()) {
    const q = filters.q.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { companyName: { contains: q, mode: "insensitive" } },
    ];
  }

  if (filters.status && filters.status !== "ALL") {
    if (filters.status === "HOT") {
      where.score = { gte: 90 };
    } else {
      where.status = filters.status;
    }
  }

  if (filters.source && filters.source !== "ALL") {
    where.source = filters.source as Prisma.EnumLeadSourceFilter["equals"];
  }

  if (filters.score && filters.score !== "all") {
    if (filters.score === "hot") where.score = { gte: 90 };
    if (filters.score === "warm") where.score = { gte: 70, lte: 89 };
    if (filters.score === "cold") where.score = { lt: 70 };
  }

  const leads = await prisma.lead.findMany({
    where,
    include: { analysis: true, assignedTo: true },
    orderBy: { createdAt: "desc" },
  });

  return leads.map(mapLeadToUi);
}

export async function getLeadById(user: SessionUser, id: string) {
  const { cancelStaleCallsForLead } = await import("@/services/voice-calls");
  await cancelStaleCallsForLead({
    companyId: user.companyId,
    leadId: id,
  });

  const lead = await prisma.lead.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      analysis: true,
      assignedTo: true,
      calls: {
        include: {
          summary: true,
          transcripts: { orderBy: { timestamp: "asc" } },
        },
        orderBy: { createdAt: "desc" },
      },
      followUps: { orderBy: { sequenceDay: "asc" } },
      appointments: {
        orderBy: { dateTime: "asc" },
        include: { assignedTo: true },
      },
      activities: {
        include: { user: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      generatedResponses: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      externalIdentities: true,
    },
  });

  if (!lead) throw new AppError("Lead not found", 404);
  return lead;
}

export async function updateLead(
  user: SessionUser,
  id: string,
  input: UpdateLeadInput
) {
  const existing = await prisma.lead.findFirst({
    where: { id, companyId: user.companyId },
  });
  if (!existing) throw new AppError("Lead not found", 404);

  const lead = await prisma.lead.update({
    where: { id },
    data: {
      name: input.name,
      email: input.email?.toLowerCase(),
      phone: input.phone,
      companyName: input.companyName,
      jobTitle: input.jobTitle,
      industry: input.industry,
      source: input.source,
      message: input.message,
      budget: input.budget,
      timeline: input.timeline,
      score: input.score,
      intent: input.intent,
      urgency: input.urgency,
      status: input.status,
      dealValue: input.dealValue,
      assignedToId:
        input.assignedToId === undefined ? undefined : input.assignedToId,
    },
    include: { analysis: true },
  });

  await prisma.activity.create({
    data: {
      companyId: user.companyId,
      leadId: id,
      userId: user.id,
      type: "LEAD_UPDATED",
      description: `${user.name} updated lead ${lead.name}.`,
    },
  });

  // Optional HubSpot push (non-blocking)
  void import("@/services/hubspot")
    .then(({ maybePushLeadToHubSpot }) =>
      maybePushLeadToHubSpot({
        companyId: user.companyId,
        leadId: id,
      })
    )
    .catch(() => undefined);

  return mapLeadToUi(lead);
}

export async function updateLeadStatus(
  user: SessionUser,
  id: string,
  status: LeadStatus
) {
  const existing = await prisma.lead.findFirst({
    where: { id, companyId: user.companyId },
  });
  if (!existing) throw new AppError("Lead not found", 404);

  const lead = await prisma.lead.update({
    where: { id },
    data: { status },
    include: { analysis: true },
  });

  await prisma.activity.create({
    data: {
      companyId: user.companyId,
      leadId: id,
      userId: user.id,
      type: "STATUS_CHANGED",
      description: `${existing.name} moved from ${titleCase(existing.status)} to ${titleCase(status)}.`,
    },
  });

  return mapLeadToUi(lead);
}

export async function deleteLead(user: SessionUser, id: string) {
  const existing = await prisma.lead.findFirst({
    where: { id, companyId: user.companyId },
  });
  if (!existing) throw new AppError("Lead not found", 404);

  await prisma.lead.delete({ where: { id } });
  return { ok: true };
}

export function hashCaptureKey(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

function titleCase(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
