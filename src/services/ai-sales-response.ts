import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { generateSalesResponseDraft } from "@/lib/ai/sales-response-generator";
import type { SessionUser } from "@/lib/session";
import {
  fromPrismaChannel,
  fromPrismaResponseType,
  fromPrismaTone,
  toPrismaChannel,
  toPrismaResponseType,
  toPrismaTone,
  type SalesResponseChannel,
  type SalesResponseTone,
  type SalesResponseType,
} from "@/types/sales-response";

const inFlight = new Set<string>();
const lastRunAt = new Map<string, number>();
const COOLDOWN_MS = 12_000;

function guardKey(companyId: string, leadId: string) {
  return `sales-response:${companyId}:${leadId}`;
}

export type GeneratedResponseView = {
  id: string;
  leadId: string;
  channel: SalesResponseChannel;
  responseType: SalesResponseType;
  tone: SalesResponseTone;
  subject: string | null;
  body: string;
  callToAction: string;
  personalizationNotes: string[];
  provider: string;
  model: string;
  createdAt: string;
  updatedAt: string;
};

function mapGeneratedResponse(row: {
  id: string;
  leadId: string;
  channel: string;
  responseType: string;
  tone: string;
  subject: string | null;
  body: string;
  callToAction: string;
  personalizationNotes: string[];
  provider: string;
  model: string;
  createdAt: Date;
  updatedAt: Date;
}): GeneratedResponseView {
  const channel = fromPrismaChannel(row.channel);
  const responseType = fromPrismaResponseType(row.responseType);
  const tone = fromPrismaTone(row.tone);
  if (!channel || !responseType || !tone) {
    throw new AppError("Stored response has invalid metadata.", 500);
  }

  return {
    id: row.id,
    leadId: row.leadId,
    channel,
    responseType,
    tone,
    subject: row.subject,
    body: row.body,
    callToAction: row.callToAction,
    personalizationNotes: row.personalizationNotes,
    provider: row.provider,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listGeneratedResponsesForLead(
  user: SessionUser,
  leadId: string,
  limit = 20
): Promise<GeneratedResponseView[]> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId: user.companyId },
    select: { id: true },
  });
  if (!lead) throw new AppError("Lead not found", 404);

  const rows = await prisma.generatedResponse.findMany({
    where: { leadId, companyId: user.companyId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows.map(mapGeneratedResponse);
}

export async function generateAndPersistSalesResponse(
  user: SessionUser,
  input: {
    leadId: string;
    responseType: SalesResponseType;
    tone: SalesResponseTone;
    channel: SalesResponseChannel;
  }
): Promise<GeneratedResponseView> {
  const key = guardKey(user.companyId, input.leadId);

  if (inFlight.has(key)) {
    throw new AppError(
      "A response is already being generated for this lead. Please wait.",
      429
    );
  }

  const last = lastRunAt.get(key) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) {
    throw new AppError(
      "Please wait a few seconds before generating another response.",
      429
    );
  }

  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, companyId: user.companyId },
    include: { analysis: true },
  });

  if (!lead) throw new AppError("Lead not found", 404);

  if (!lead.analysis) {
    throw new AppError(
      "Analyze this lead with AI before generating a sales response.",
      400
    );
  }

  inFlight.add(key);

  try {
    const draft = await generateSalesResponseDraft({
      responseType: input.responseType,
      tone: input.tone,
      channel: input.channel,
      lead: {
        name: lead.name,
        companyName: lead.companyName,
        jobTitle: lead.jobTitle,
        industry: lead.analysis.industry || lead.industry,
        source: lead.source,
        status: lead.status,
        notes: lead.message,
        score: lead.analysis.score,
        intent: lead.analysis.intent,
        urgency: lead.analysis.urgency,
        buyingStage: lead.analysis.buyingStage,
        requirements: lead.analysis.requirements,
        painPoints: lead.analysis.painPoints,
        objections: lead.analysis.objections,
        recommendation: lead.analysis.recommendation,
        reasoning: lead.analysis.reasoning,
      },
    });

    const result = draft.result;
    const subject =
      input.channel === "email" ? result.subject?.trim() || null : null;

    const [created] = await prisma.$transaction([
      prisma.generatedResponse.create({
        data: {
          companyId: user.companyId,
          leadId: lead.id,
          userId: user.id,
          channel: toPrismaChannel(input.channel),
          responseType: toPrismaResponseType(input.responseType),
          tone: toPrismaTone(input.tone),
          subject,
          body: result.body,
          callToAction: result.callToAction,
          personalizationNotes: result.personalizationNotes,
          provider: draft.provider,
          model: draft.model,
        },
      }),
      prisma.activity.create({
        data: {
          companyId: user.companyId,
          leadId: lead.id,
          userId: user.id,
          type: "AI_SALES_RESPONSE",
          description: `AI generated personalized sales response (${input.channel}, ${input.responseType}).`,
        },
      }),
    ]);

    lastRunAt.set(key, Date.now());
    return mapGeneratedResponse(created);
  } finally {
    inFlight.delete(key);
  }
}

export async function updateGeneratedResponse(
  user: SessionUser,
  id: string,
  patch: {
    subject?: string | null;
    body?: string;
    callToAction?: string;
  }
): Promise<GeneratedResponseView> {
  const existing = await prisma.generatedResponse.findFirst({
    where: { id, companyId: user.companyId },
  });
  if (!existing) throw new AppError("Generated response not found", 404);

  const nextSubject =
    patch.subject !== undefined
      ? existing.channel === "EMAIL"
        ? patch.subject
        : null
      : existing.subject;

  if (existing.channel === "EMAIL" && patch.subject !== undefined) {
    const trimmed = (patch.subject ?? "").trim();
    if (!trimmed) {
      throw new AppError("Email subject cannot be empty.", 400);
    }
  }

  const updated = await prisma.generatedResponse.update({
    where: { id: existing.id },
    data: {
      subject: nextSubject,
      body: patch.body ?? undefined,
      callToAction: patch.callToAction ?? undefined,
    },
  });

  return mapGeneratedResponse(updated);
}

export async function deleteGeneratedResponse(
  user: SessionUser,
  id: string
): Promise<void> {
  const existing = await prisma.generatedResponse.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true },
  });
  if (!existing) throw new AppError("Generated response not found", 404);

  await prisma.generatedResponse.delete({ where: { id: existing.id } });
}
