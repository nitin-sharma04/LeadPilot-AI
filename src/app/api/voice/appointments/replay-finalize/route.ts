/**
 * Dev-only: replay appointment booking for an existing call (no new Twilio call).
 * Enabled when NODE_ENV !== production OR VOICE_APPOINTMENT_REPLAY=true.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { AppError, jsonError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import {
  attemptBookAppointmentFromCall,
  finalizeCallForAppointments,
} from "@/services/voice-appointment-booking";

export const runtime = "nodejs";

const bodySchema = z.object({
  callId: z.string().cuid(),
  markCompleted: z.boolean().optional().default(true),
});

function replayAllowed() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.VOICE_APPOINTMENT_REPLAY === "true"
  );
}

export async function POST(request: NextRequest) {
  try {
    if (!replayAllowed()) {
      throw new AppError("Replay endpoint disabled in production", 403);
    }

    const user = await requireSession();
    const body = bodySchema.parse(await request.json());

    const call = await prisma.call.findFirst({
      where: { id: body.callId, companyId: user.companyId },
      select: { id: true },
    });
    if (!call) throw new AppError("Call not found", 404);

    const result = body.markCompleted
      ? await finalizeCallForAppointments(call.id)
      : {
          callStatus: "unchanged",
          booking: await attemptBookAppointmentFromCall({
            callId: call.id,
            forceConfirmed: true,
          }),
        };

    console.info("[voice:appointment] replay finalize", {
      callId: call.id,
      booked: result.booking.booked,
      appointmentStatus: result.booking.appointmentStatus,
      appointmentId: result.booking.appointmentId ?? null,
    });

    return Response.json({ data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(new AppError(error.issues[0]?.message || "Invalid", 400));
    }
    return jsonError(error, "Unable to replay appointment finalize", 500);
  }
}
