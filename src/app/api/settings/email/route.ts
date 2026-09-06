import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { AppError, jsonError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const patchSchema = z.object({
  emailAutomationEnabled: z.boolean().optional(),
  emailAutoSendEnabled: z.boolean().optional(),
  emailAppointmentConfirmEnabled: z.boolean().optional(),
  emailFollowUpSequencesEnabled: z.boolean().optional(),
  emailPostCallEnabled: z.boolean().optional(),
  emailHumanApprovalRequired: z.boolean().optional(),
  defaultEmailAccountId: z.string().cuid().nullable().optional(),
});

export async function GET() {
  try {
    const user = await requireSession();
    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: {
        emailAutomationEnabled: true,
        emailAutoSendEnabled: true,
        emailAppointmentConfirmEnabled: true,
        emailFollowUpSequencesEnabled: true,
        emailPostCallEnabled: true,
        emailHumanApprovalRequired: true,
        defaultEmailAccountId: true,
      },
    });
    const accounts = await prisma.emailAccount.findMany({
      where: {
        companyId: user.companyId,
        status: { in: ["CONNECTED", "DEMO"] },
      },
      select: {
        id: true,
        emailAddress: true,
        displayName: true,
        provider: true,
        status: true,
      },
    });
    return Response.json({ data: { settings: company, accounts } });
  } catch (error) {
    return jsonError(error, "Unable to load email settings", 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireSession();
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      throw new AppError("Only owners/admins can change email settings", 403);
    }
    const body = patchSchema.parse(await request.json());

    if (body.defaultEmailAccountId) {
      const account = await prisma.emailAccount.findFirst({
        where: {
          id: body.defaultEmailAccountId,
          companyId: user.companyId,
        },
      });
      if (!account) throw new AppError("Email account not found", 404);
    }

    const settings = await prisma.company.update({
      where: { id: user.companyId },
      data: body,
      select: {
        emailAutomationEnabled: true,
        emailAutoSendEnabled: true,
        emailAppointmentConfirmEnabled: true,
        emailFollowUpSequencesEnabled: true,
        emailPostCallEnabled: true,
        emailHumanApprovalRequired: true,
        defaultEmailAccountId: true,
      },
    });
    return Response.json({ data: settings });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(new AppError(error.issues[0]?.message || "Invalid", 400));
    }
    return jsonError(error, "Unable to update email settings", 500);
  }
}
