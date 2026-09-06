import { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { updateLeadSchema, updateLeadStatusSchema } from "@/lib/validations";
import {
  deleteLead,
  getLeadById,
  updateLead,
  updateLeadStatus,
} from "@/services/leads";
import { mapLeadToUi } from "@/lib/mappers";
import { jsonError } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const lead = await getLeadById(user, id);
    return Response.json({ data: mapLeadToUi(lead), detail: lead });
  } catch (error) {
    return jsonError(error, "Unable to load lead", 500);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const body = await request.json();

    if (body.status && Object.keys(body).length === 1) {
      const parsed = updateLeadStatusSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json({ error: "Invalid status" }, { status: 400 });
      }
      const lead = await updateLeadStatus(user, id, parsed.data.status);
      return Response.json({ data: lead });
    }

    const parsed = updateLeadSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid lead data" },
        { status: 400 }
      );
    }

    const lead = await updateLead(user, id, parsed.data);
    return Response.json({ data: lead });
  } catch (error) {
    return jsonError(error, "Unable to update lead", 500);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession();
    const { id } = await params;
    await deleteLead(user, id);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error, "Unable to delete lead", 500);
  }
}
