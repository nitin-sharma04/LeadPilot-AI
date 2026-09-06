import { requireSession } from "@/lib/session";
import { listCalls } from "@/services/workspace";
import { jsonError } from "@/lib/errors";

export async function GET() {
  try {
    const user = await requireSession();
    const data = await listCalls(user);
    return Response.json({ data });
  } catch (error) {
    return jsonError(error, "Unable to load calls", 500);
  }
}
