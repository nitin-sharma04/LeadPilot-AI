import { requireSession } from "@/lib/session";
import { listFollowUps } from "@/services/workspace";
import { jsonError } from "@/lib/errors";

export async function GET() {
  try {
    const user = await requireSession();
    const data = await listFollowUps(user);
    return Response.json({ data });
  } catch (error) {
    return jsonError(error, "Unable to load follow-ups", 500);
  }
}
