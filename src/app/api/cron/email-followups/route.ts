/**
 * Server-side follow-up + reply sync job.
 * Secure with CRON_SECRET header: Authorization: Bearer <CRON_SECRET>
 * Or x-cron-secret header.
 */

import { NextRequest } from "next/server";
import { AppError, jsonError } from "@/lib/errors";
import { processDueFollowUps } from "@/services/follow-up-sequences";
import { syncGmailRepliesForCompany } from "@/services/gmail-reply-sync";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function authorize(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    // Dev-only open when NODE_ENV !== production
    if (process.env.NODE_ENV !== "production") return true;
    throw new AppError("CRON_SECRET not configured", 503);
  }
  const auth = request.headers.get("authorization") || "";
  const header = request.headers.get("x-cron-secret") || "";
  if (auth === `Bearer ${secret}` || header === secret) return true;
  throw new AppError("Unauthorized", 401);
}

export async function POST(request: NextRequest) {
  try {
    authorize(request);
    const followUps = await processDueFollowUps(25);
    const companies = await prisma.company.findMany({
      where: { emailAutomationEnabled: true },
      select: { id: true },
      take: 50,
    });
    let replies = 0;
    let optOuts = 0;
    for (const c of companies) {
      const r = await syncGmailRepliesForCompany(c.id);
      replies += r.replies;
      optOuts += r.optOuts;
    }
    return Response.json({
      data: { followUps, replySync: { replies, optOuts } },
    });
  } catch (error) {
    return jsonError(error, "Cron job failed", 500);
  }
}
