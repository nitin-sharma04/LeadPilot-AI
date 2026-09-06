/**
 * Called by voice-server after hangup / confirmation to ensure booking + completed status.
 * Auth: callId + streamToken.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AppError, jsonError } from "@/lib/errors";
import {
  attemptBookAppointmentFromCall,
  finalizeCallForAppointments,
} from "@/services/voice-appointment-booking";

export const runtime = "nodejs";

const bodySchema = z.object({
  callId: z.string().cuid(),
  streamToken: z.string().min(8),
  mode: z.enum(["book", "finalize"]).default("finalize"),
  preferredTimeText: z.string().max(200).optional(),
  timezone: z.string().max(64).optional(),
  explicitConfirmation: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = bodySchema.parse(await request.json());
    const call = await prisma.call.findUnique({
      where: { id: body.callId },
      select: { id: true, streamToken: true },
    });
    if (!call || !call.streamToken || call.streamToken !== body.streamToken) {
      throw new AppError("Unauthorized stream session", 401);
    }

    if (body.mode === "book") {
      const booking = await attemptBookAppointmentFromCall({
        callId: body.callId,
        forceConfirmed: body.explicitConfirmation === true,
        preferredTimeText: body.preferredTimeText,
        timezoneOverride: body.timezone,
      });
      return Response.json({ data: { booking } });
    }

    const result = await finalizeCallForAppointments(body.callId);
    // If finalize booked=false but we have confirmation text, try forced preferred
    if (
      !result.booking.booked &&
      body.preferredTimeText &&
      body.explicitConfirmation
    ) {
      const booking = await attemptBookAppointmentFromCall({
        callId: body.callId,
        forceConfirmed: true,
        preferredTimeText: body.preferredTimeText,
        timezoneOverride: body.timezone,
      });
      return Response.json({ data: { ...result, booking } });
    }

    return Response.json({ data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(new AppError(error.issues[0]?.message || "Invalid", 400));
    }
    return jsonError(error, "Unable to finalize voice appointment", 500);
  }
}
