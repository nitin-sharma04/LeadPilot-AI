import { requireSession } from "@/lib/session";
import { getAnalytics } from "@/services/analytics";
import { jsonError } from "@/lib/errors";

export async function GET() {
  try {
    const user = await requireSession();
    const data = await getAnalytics(user);
    return Response.json({ data });
  } catch (error) {
    return jsonError(error, "Unable to load analytics", 500);
  }
}
