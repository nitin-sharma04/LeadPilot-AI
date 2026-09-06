import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { AppError, jsonError } from "@/lib/errors";
import { generateAiEmail } from "@/lib/ai/email-generator";
import { prisma } from "@/lib/prisma";
import { formatInTimezone } from "@/lib/calendar/timezone";

export const runtime = "nodejs";

const bodySchema = z.object({
  leadId: z.string().cuid(),
  emailType: z.enum([
    "intro",
    "follow_up",
    "post_call",
    "appointment_confirmation",
    "appointment_reminder",
    "post_meeting",
    "re_engagement",
    "custom",
  ]),
  tone: z.enum(["professional", "friendly", "concise", "consultative"]),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession();
    const body = bodySchema.parse(await request.json());

    const lead = await prisma.lead.findFirst({
      where: { id: body.leadId, companyId: user.companyId },
      include: { analysis: true },
    });
    if (!lead) throw new AppError("Lead not found", 404);

    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
    });
    const appointment = await prisma.appointment.findFirst({
      where: {
        companyId: user.companyId,
        leadId: lead.id,
        status: "SCHEDULED",
      },
      orderBy: { dateTime: "asc" },
    });
    const latestCall = await prisma.call.findFirst({
      where: { companyId: user.companyId, leadId: lead.id },
      orderBy: { createdAt: "desc" },
      include: { summary: true },
    });

    const result = await generateAiEmail({
      emailType: body.emailType,
      tone: body.tone,
      lead: {
        leadName: lead.name,
        leadEmail: lead.email,
        companyName: lead.companyName,
        industry: lead.analysis?.industry || lead.industry,
        jobTitle: lead.jobTitle,
        source: lead.source,
        score: lead.score,
        buyingStage: lead.analysis?.buyingStage,
        requirements: lead.analysis?.requirements,
        painPoints: lead.analysis?.painPoints,
        objections: lead.analysis?.objections,
        recommendation: lead.analysis?.recommendation,
        callSummary: latestCall?.summary?.summary || null,
        appointmentBooked: Boolean(appointment),
        appointmentWhen: appointment
          ? formatInTimezone(appointment.dateTime, appointment.timezone)
          : null,
        appointmentTimezone: appointment?.timezone || null,
        meetingUrl: appointment?.meetingUrl || null,
        sellerCompanyName: company?.name || "our team",
      },
    });

    return Response.json({ data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(new AppError(error.issues[0]?.message || "Invalid", 400));
    }
    return jsonError(error, "Unable to generate email", 500);
  }
}
