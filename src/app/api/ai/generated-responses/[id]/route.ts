import { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { updateGeneratedResponseSchema } from "@/types/sales-response";
import {
  deleteGeneratedResponse,
  updateGeneratedResponse,
} from "@/services/ai-sales-response";
import { jsonError } from "@/lib/errors";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireSession();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = updateGeneratedResponseSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    if (
      parsed.data.subject === undefined &&
      parsed.data.body === undefined &&
      parsed.data.callToAction === undefined
    ) {
      return Response.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const response = await updateGeneratedResponse(user, id, parsed.data);

    return Response.json({ success: true, response });
  } catch (error) {
    return jsonError(
      error,
      "Unable to update this response right now. Please try again."
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const user = await requireSession();
    const { id } = await context.params;
    await deleteGeneratedResponse(user, id);
    return Response.json({ success: true });
  } catch (error) {
    return jsonError(
      error,
      "Unable to delete this response right now. Please try again."
    );
  }
}
