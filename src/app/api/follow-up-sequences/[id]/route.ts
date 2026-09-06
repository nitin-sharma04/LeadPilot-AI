import { NextRequest } from "next/server";
import { z } from "zod";
import { SequenceStopReason } from "@prisma/client";
import { requireSession } from "@/lib/session";
import { AppError, jsonError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { stopEnrollment } from "@/services/follow-up-sequences";

export const runtime = "nodejs";

const patchSchema = z.object({
  action: z.enum(["pause", "resume", "stop"]),
  reason: z.nativeEnum(SequenceStopReason).optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireSession();
    const { id } = await context.params;
    const body = patchSchema.parse(await request.json());

    const enrollment = await prisma.followUpEnrollment.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!enrollment) throw new AppError("Enrollment not found", 404);

    if (body.action === "stop") {
      const updated = await stopEnrollment({
        companyId: user.companyId,
        enrollmentId: id,
        reason: body.reason || SequenceStopReason.MANUAL,
        userId: user.id,
      });
      return Response.json({ data: updated });
    }

    if (body.action === "pause") {
      const updated = await prisma.followUpEnrollment.update({
        where: { id },
        data: { status: "PAUSED", nextRunAt: null },
      });
      return Response.json({ data: updated });
    }

    // resume
    const updated = await prisma.followUpEnrollment.update({
      where: { id },
      data: {
        status: "ACTIVE",
        nextRunAt: new Date(Date.now() + 60_000),
      },
    });
    return Response.json({ data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(new AppError(error.issues[0]?.message || "Invalid", 400));
    }
    return jsonError(error, "Unable to update enrollment", 500);
  }
}
