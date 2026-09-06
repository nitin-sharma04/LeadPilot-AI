import { requireSession } from "@/lib/session";
import { getAiAgent } from "@/services/workspace";
import { jsonError } from "@/lib/errors";

export async function GET() {
  try {
    const user = await requireSession();
    const data = await getAiAgent(user);
    return Response.json({ data });
  } catch (error) {
    return jsonError(error, "Unable to load AI agent", 500);
  }
}
