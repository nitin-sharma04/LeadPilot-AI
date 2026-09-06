import { requireSession } from "@/lib/session";
import { jsonError, AppError } from "@/lib/errors";
import {
  bookAppointment,
  listCompanyAppointments,
} from "@/services/appointments";
import { AppointmentSource } from "@prisma/client";
import { z } from "zod";
import { assertTimezone } from "@/lib/calendar/timezone";

export const runtime = "nodejs";

const createSchema = z.object({
  leadId: z.string().cuid(),
  title: z.string().min(2).max(200),
  startTime: z.string().datetime(),
  durationMinutes: z.number().int().min(15).max(480).optional(),
  timezone: z.string().min(1).max(64),
  notes: z.string().max(2000).optional(),
  description: z.string().max(4000).optional(),
  assignedToId: z.string().cuid().optional().nullable(),
  source: z.nativeEnum(AppointmentSource).optional(),
  syncCalendar: z.boolean().optional(),
  idempotencyKey: z.string().max(200).optional(),
});

export async function GET() {
  try {
    const user = await requireSession();
    const data = await listCompanyAppointments(user);
    return Response.json({ data });
  } catch (error) {
    return jsonError(error, "Unable to load appointments", 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSession();
    const body = createSchema.parse(await request.json());
    assertTimezone(body.timezone);

    const result = await bookAppointment({
      companyId: user.companyId,
      leadId: body.leadId,
      userId: user.id,
      title: body.title,
      startTime: new Date(body.startTime),
      durationMinutes: body.durationMinutes,
      timezone: body.timezone,
      notes: body.notes,
      description: body.description,
      assignedToId: body.assignedToId,
      source: body.source ?? AppointmentSource.MANUAL,
      syncCalendar: body.syncCalendar,
      idempotencyKey: body.idempotencyKey,
    });

    return Response.json({ data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(new AppError(error.issues[0]?.message || "Invalid input", 400));
    }
    return jsonError(error, "Unable to create appointment", 500);
  }
}
