import { NextRequest } from "next/server";
import { z } from "zod";
import { EmailTone, EmailType } from "@prisma/client";
import { requireSession } from "@/lib/session";
import { AppError, jsonError } from "@/lib/errors";
import { listLeadEmails, sendOrDraftEmail } from "@/services/email";

export const runtime = "nodejs";

const sendSchema = z.object({
  leadId: z.string().cuid(),
  emailAccountId: z.string().cuid(),
  subject: z.string().min(2).max(200),
  body: z.string().min(2).max(8000),
  to: z.string().email().optional(),
  emailType: z.nativeEnum(EmailType).optional(),
  tone: z.nativeEnum(EmailTone).optional(),
  asDraft: z.boolean().optional(),
  idempotencyKey: z.string().max(200).optional(),
  threadId: z.string().max(200).optional().nullable(),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession();
    const leadId = request.nextUrl.searchParams.get("leadId");
    if (!leadId) throw new AppError("leadId required", 400);
    const data = await listLeadEmails(user.companyId, leadId);
    return Response.json({ data });
  } catch (error) {
    return jsonError(error, "Unable to list emails", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession();
    const body = sendSchema.parse(await request.json());
    const result = await sendOrDraftEmail({
      companyId: user.companyId,
      leadId: body.leadId,
      userId: user.id,
      emailAccountId: body.emailAccountId,
      subject: body.subject,
      body: body.body,
      to: body.to,
      emailType: body.emailType,
      tone: body.tone,
      asDraft: body.asDraft,
      idempotencyKey: body.idempotencyKey,
      threadId: body.threadId,
    });
    return Response.json({ data: result }, { status: result.sent ? 201 : 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(new AppError(error.issues[0]?.message || "Invalid", 400));
    }
    return jsonError(error, "Unable to send email", 500);
  }
}
