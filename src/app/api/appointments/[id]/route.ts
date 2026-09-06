import { requireSession } from "@/lib/session";
import { jsonError, AppError } from "@/lib/errors";
import {
  cancelAppointment,
  getAppointmentForCompany,
  rescheduleAppointment,
} from "@/services/appointments";
import { z } from "zod";
import { assertTimezone } from "@/lib/calendar/timezone";

export const runtime = "nodejs";

const patchSchema = z.object({
  action: z.enum(["reschedule", "cancel"]),
  startTime: z.string().datetime().optional(),
  durationMinutes: z.number().int().min(15).max(480).optional(),
  timezone: z.string().min(1).max(64).optional(),
  notes: z.string().max(2000).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const data = await getAppointmentForCompany(user, id);
    return Response.json({ data });
  } catch (error) {
    return jsonError(error, "Unable to load appointment", 500);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const body = patchSchema.parse(await request.json());

    if (body.action === "cancel") {
      const data = await cancelAppointment({
        user,
        appointmentId: id,
      });
      return Response.json({ data });
    }

    if (!body.startTime) {
      throw new AppError("startTime is required to reschedule", 400);
    }
    if (body.timezone) assertTimezone(body.timezone);

    const data = await rescheduleAppointment({
      user,
      appointmentId: id,
      startTime: new Date(body.startTime),
      durationMinutes: body.durationMinutes,
      timezone: body.timezone,
      notes: body.notes,
    });
    return Response.json({ data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(new AppError(error.issues[0]?.message || "Invalid input", 400));
    }
    return jsonError(error, "Unable to update appointment", 500);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const data = await cancelAppointment({ user, appointmentId: id });
    return Response.json({ data });
  } catch (error) {
    return jsonError(error, "Unable to cancel appointment", 500);
  }
}
