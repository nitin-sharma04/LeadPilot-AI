import { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { getCallForUser } from "@/services/voice-calls";
import { jsonError } from "@/lib/errors";
import { CALL_STATUS_LABELS } from "@/types/voice";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const user = await requireSession();
    const { id } = await context.params;
    const call = await getCallForUser(user, id);

    return Response.json({
      success: true,
      call: {
        id: call.id,
        leadId: call.leadId,
        status: call.status,
        statusLabel: CALL_STATUS_LABELS[call.status] ?? call.status,
        phoneNumber: call.phoneNumber,
        provider: call.provider,
        startedAt: call.startedAt?.toISOString() ?? null,
        answeredAt: call.answeredAt?.toISOString() ?? null,
        endedAt: call.endedAt?.toISOString() ?? null,
        duration: call.duration,
        outcome: call.outcome,
        qualificationScore: call.qualificationScore,
        voiceMode: call.voiceMode,
        leadName: call.lead.name,
        agentName: call.agent?.name ?? "AI Agent",
        aiProvider: process.env.AI_PROVIDER || "gemini",
        transcripts: call.transcripts.map((t) => ({
          id: t.id,
          speaker: t.speaker === "AI" ? "agent" : "lead",
          text: t.message,
          timestamp: t.timestamp.toISOString(),
        })),
        summary: call.summary
          ? {
              summary: call.summary.summary,
              outcome: call.summary.outcome,
              interestLevel: call.summary.interestLevel,
              keyRequirements: call.summary.keyRequirements,
              painPoints: call.summary.painPoints,
              objections: call.summary.objectionList,
              nextAction: call.summary.nextAction,
              followUpRecommended: call.summary.followUpRecommended,
            }
          : null,
      },
    });
  } catch (error) {
    return jsonError(error, "Unable to load call details.");
  }
}
