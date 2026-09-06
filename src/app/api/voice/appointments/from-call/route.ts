/**
 * Book appointment from a completed / in-progress AI voice call.
 * Authenticated via callId + streamToken (voice-server) or session user.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AppError, jsonError } from "@/lib/errors";
import { attemptBookAppointmentFromCall } from "@/services/voice-appointment-booking";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";

const bodySchema = z.object({
  callId: z.string().cuid(),
  streamToken: z.string().min(8).optional(),
  preferredTimeText: z.string().min(2).max(200).optional(),
  timezone: z.string().min(1).max(64).optional(),
  durationMinutes: z.number().int().min(15).max(480).optional(),
  title: z.string().min(2).max(200).optional(),
  explicitConfirmation: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = bodySchema.parse(await request.json());

    const call = await prisma.call.findUnique({
      where: { id: body.callId },
      select: {
        id: true,
        companyId: true,
        streamToken: true,
      },
    });
    if (!call) throw new AppError("Call not found", 404);

    if (body.streamToken) {
      if (!call.streamToken || call.streamToken !== body.streamToken) {
        throw new AppError("Unauthorized stream session", 401);
      }
    } else {
      const user = await requireSession();
      if (user.companyId !== call.companyId) {
        throw new AppError("Forbidden", 403);
      }
    }

    const result = await attemptBookAppointmentFromCall({
      callId: body.callId,
      forceConfirmed: body.explicitConfirmation === true,
      preferredTimeText: body.preferredTimeText,
      timezoneOverride: body.timezone,
    });

    return Response.json({ data: result }, { status: result.booked ? 200 : 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(new AppError(error.issues[0]?.message || "Invalid", 400));
    }
    return jsonError(error, "Unable to book appointment from call", 500);
  }
}
