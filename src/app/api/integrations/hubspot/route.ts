import { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { AppError, jsonError } from "@/lib/errors";
import {
  disconnectHubSpot,
  getHubSpotStatus,
  importHubSpotContacts,
} from "@/services/hubspot";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireSession();
    const data = await getHubSpotStatus(user.companyId);
    return Response.json({ data });
  } catch (error) {
    return jsonError(error, "Unable to load HubSpot status", 500);
  }
}

export async function DELETE() {
  try {
    const user = await requireSession();
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      throw new AppError("Only owners/admins can disconnect HubSpot", 403);
    }
    await disconnectHubSpot(user.companyId);
    return Response.json({ data: { disconnected: true } });
  } catch (error) {
    return jsonError(error, "Unable to disconnect HubSpot", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession();
    const body = await request.json().catch(() => ({}));
    const action = (body as { action?: string }).action || "import";

    if (action === "import") {
      const data = await importHubSpotContacts({
        companyId: user.companyId,
        userId: user.id,
        limit: 50,
      });
      return Response.json({ data });
    }

    throw new AppError("Unsupported action", 400);
  } catch (error) {
    return jsonError(error, "HubSpot action failed", 500);
  }
}
