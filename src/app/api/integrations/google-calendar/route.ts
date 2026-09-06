import { requireSession } from "@/lib/session";
import { jsonError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getGoogleConnectionStatus } from "@/services/appointments";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireSession();
    const status = await getGoogleConnectionStatus(user);
    return Response.json({ data: status });
  } catch (error) {
    return jsonError(error, "Unable to load Google Calendar status", 500);
  }
}

export async function DELETE() {
  try {
    const user = await requireSession();
    await prisma.googleCalendarConnection.deleteMany({
      where: { userId: user.id, companyId: user.companyId },
    });
    return Response.json({ data: { disconnected: true } });
  } catch (error) {
    return jsonError(error, "Unable to disconnect Google Calendar", 500);
  }
}
