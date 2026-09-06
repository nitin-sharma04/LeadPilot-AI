import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { AppError, jsonError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const patchSchema = z.object({
  leadAutoAnalyzeEnabled: z.boolean().optional(),
  leadAutoAssignEnabled: z.boolean().optional(),
  leadAutoFollowUpEnabled: z.boolean().optional(),
  leadAutoCallEnabled: z.boolean().optional(),
  leadAutoEmailEnabled: z.boolean().optional(),
  defaultLeadOwnerId: z.string().cuid().nullable().optional(),
  defaultFollowUpSequenceId: z.string().cuid().nullable().optional(),
});

export async function GET() {
  try {
    const user = await requireSession();
    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: {
        leadAutoAnalyzeEnabled: true,
        leadAutoAssignEnabled: true,
        leadAutoFollowUpEnabled: true,
        leadAutoCallEnabled: true,
        leadAutoEmailEnabled: true,
        defaultLeadOwnerId: true,
        defaultFollowUpSequenceId: true,
      },
    });
    const [owners, sequences] = await Promise.all([
      prisma.user.findMany({
        where: { companyId: user.companyId },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { name: "asc" },
      }),
      prisma.followUpSequence.findMany({
        where: { companyId: user.companyId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);
    return Response.json({ data: { settings: company, owners, sequences } });
  } catch (error) {
    return jsonError(error, "Unable to load lead capture settings", 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireSession();
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      throw new AppError(
        "Only owners/admins can change lead capture settings",
        403
      );
    }
    const body = patchSchema.parse(await request.json());

    if (body.defaultLeadOwnerId) {
      const owner = await prisma.user.findFirst({
        where: { id: body.defaultLeadOwnerId, companyId: user.companyId },
      });
      if (!owner) throw new AppError("Default owner not found", 404);
    }
    if (body.defaultFollowUpSequenceId) {
      const seq = await prisma.followUpSequence.findFirst({
        where: {
          id: body.defaultFollowUpSequenceId,
          companyId: user.companyId,
        },
      });
      if (!seq) throw new AppError("Follow-up sequence not found", 404);
    }

    const settings = await prisma.company.update({
      where: { id: user.companyId },
      data: body,
      select: {
        leadAutoAnalyzeEnabled: true,
        leadAutoAssignEnabled: true,
        leadAutoFollowUpEnabled: true,
        leadAutoCallEnabled: true,
        leadAutoEmailEnabled: true,
        defaultLeadOwnerId: true,
        defaultFollowUpSequenceId: true,
      },
    });
    return Response.json({ data: settings });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(new AppError(error.issues[0]?.message || "Invalid", 400));
    }
    return jsonError(error, "Unable to update lead capture settings", 500);
  }
}
