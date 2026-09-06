import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { AppError, jsonError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import {
  enrollLeadInSequence,
  ensureDefaultSequence,
} from "@/services/follow-up-sequences";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireSession();
    await ensureDefaultSequence(user.companyId);
    const sequences = await prisma.followUpSequence.findMany({
      where: { companyId: user.companyId },
      include: {
        steps: { orderBy: { stepOrder: "asc" } },
        _count: { select: { enrollments: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const enrollments = await prisma.followUpEnrollment.findMany({
      where: { companyId: user.companyId },
      include: {
        lead: { select: { id: true, name: true, email: true } },
        sequence: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return Response.json({ data: { sequences, enrollments } });
  } catch (error) {
    return jsonError(error, "Unable to load sequences", 500);
  }
}

const enrollSchema = z.object({
  leadId: z.string().cuid(),
  sequenceId: z.string().cuid().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession();
    const body = enrollSchema.parse(await request.json());
    const enrollment = await enrollLeadInSequence({
      companyId: user.companyId,
      leadId: body.leadId,
      sequenceId: body.sequenceId,
      userId: user.id,
    });
    return Response.json({ data: enrollment }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(new AppError(error.issues[0]?.message || "Invalid", 400));
    }
    return jsonError(error, "Unable to enroll lead", 500);
  }
}
