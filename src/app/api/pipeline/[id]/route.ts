import { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { updateLeadStatusSchema } from "@/lib/validations";
import { updateLeadStatus } from "@/services/leads";
import { jsonError } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const body = await request.json();
    const parsed = updateLeadStatusSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Invalid status" }, { status: 400 });
    }

    const lead = await updateLeadStatus(user, id, parsed.data.status);
    return Response.json({ data: lead });
  } catch (error) {
    return jsonError(error, "Unable to update pipeline status", 500);
  }
}
