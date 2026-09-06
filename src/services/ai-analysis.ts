import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { analyzeLead } from "@/lib/ai/lead-analyzer";
import { titleCaseLevel, type LeadAnalysisResult } from "@/types/ai";
import type { SessionUser } from "@/lib/session";

/** Simple in-memory guards (per server instance). Documented for Redis upgrade later. */
const inFlight = new Set<string>();
const lastRunAt = new Map<string, number>();
const COOLDOWN_MS = 12_000;

function guardKey(companyId: string, leadId: string) {
  return `${companyId}:${leadId}`;
}

export type PersistedLeadAnalysis = {
  analysis: {
    id: string;
    leadId: string;
    score: number;
    intent: string | null;
    urgency: string | null;
    estimatedBudget: string | null;
    industry: string | null;
    buyingStage: string | null;
    requirements: string[];
    painPoints: string[];
    objections: string[];
    recommendation: string | null;
    reasoning: string | null;
    source: string;
    createdAt: Date;
    updatedAt: Date;
  };
  lead: {
    id: string;
    score: number;
    intent: string | null;
    urgency: string | null;
    industry: string | null;
  };
  result: LeadAnalysisResult;
};

export async function analyzeAndPersistLead(
  user: SessionUser,
  leadId: string
): Promise<PersistedLeadAnalysis> {
  const key = guardKey(user.companyId, leadId);

  if (inFlight.has(key)) {
    throw new AppError(
      "Analysis is already running for this lead. Please wait.",
      429
    );
  }

  const last = lastRunAt.get(key) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) {
    throw new AppError(
      "Please wait a few seconds before re-analyzing this lead.",
      429
    );
  }

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId: user.companyId },
  });

  if (!lead) {
    throw new AppError("Lead not found", 404);
  }

  inFlight.add(key);

  try {
    const resultBundle = await analyzeLead({
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      companyName: lead.companyName,
      jobTitle: lead.jobTitle,
      industry: lead.industry,
      source: lead.source,
      message: lead.message,
      budget: lead.budget,
      timeline: lead.timeline,
      dealValue: lead.dealValue,
    });

    const result = resultBundle.result;
    const analysisSource = resultBundle.provider;

    const intentLabel = titleCaseLevel(result.intent);
    const urgencyLabel = titleCaseLevel(result.urgency);

    const [analysis] = await prisma.$transaction([
      prisma.leadAnalysis.upsert({
        where: { leadId: lead.id },
        create: {
          leadId: lead.id,
          score: result.score,
          intent: intentLabel,
          urgency: urgencyLabel,
          estimatedBudget: result.estimatedBudget,
          industry: result.industry,
          buyingStage: result.buyingStage,
          requirements: result.requirements,
          painPoints: result.painPoints,
          objections: result.objections,
          recommendation: result.recommendation,
          reasoning: result.reasoning,
          source: analysisSource,
        },
        update: {
          score: result.score,
          intent: intentLabel,
          urgency: urgencyLabel,
          estimatedBudget: result.estimatedBudget,
          industry: result.industry,
          buyingStage: result.buyingStage,
          requirements: result.requirements,
          painPoints: result.painPoints,
          objections: result.objections,
          recommendation: result.recommendation,
          reasoning: result.reasoning,
          source: analysisSource,
        },
      }),
      prisma.lead.update({
        where: { id: lead.id },
        data: {
          score: result.score,
          intent: intentLabel,
          urgency: urgencyLabel,
          industry: result.industry !== "unknown" ? result.industry : lead.industry,
        },
      }),
      prisma.activity.create({
        data: {
          companyId: user.companyId,
          leadId: lead.id,
          userId: user.id,
          type: "AI_ANALYSIS",
          description: `AI analyzed lead and assigned a score of ${result.score}.`,
        },
      }),
    ]);

    lastRunAt.set(key, Date.now());

    return {
      analysis,
      lead: {
        id: lead.id,
        score: result.score,
        intent: intentLabel,
        urgency: urgencyLabel,
        industry:
          result.industry !== "unknown" ? result.industry : lead.industry,
      },
      result,
    };
  } finally {
    inFlight.delete(key);
  }
}
