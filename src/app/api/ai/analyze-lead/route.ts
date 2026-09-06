import { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { analyzeLeadRequestSchema } from "@/types/ai";
import { analyzeAndPersistLead } from "@/services/ai-analysis";
import { jsonError } from "@/lib/errors";

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession();
    const body = await request.json();
    const parsed = analyzeLeadRequestSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    const data = await analyzeAndPersistLead(user, parsed.data.leadId);

    return Response.json({
      data: {
        analysis: {
          id: data.analysis.id,
          leadId: data.analysis.leadId,
          score: data.analysis.score,
          intent: data.analysis.intent,
          urgency: data.analysis.urgency,
          estimatedBudget: data.analysis.estimatedBudget,
          industry: data.analysis.industry,
          buyingStage: data.analysis.buyingStage,
          requirements: data.analysis.requirements,
          painPoints: data.analysis.painPoints,
          objections: data.analysis.objections,
          recommendation: data.analysis.recommendation,
          reasoning: data.analysis.reasoning,
          source: data.analysis.source,
          createdAt: data.analysis.createdAt.toISOString(),
          updatedAt: data.analysis.updatedAt.toISOString(),
        },
        lead: data.lead,
      },
    });
  } catch (error) {
    return jsonError(error, "Unable to analyze this lead right now. Please try again.");
  }
}
