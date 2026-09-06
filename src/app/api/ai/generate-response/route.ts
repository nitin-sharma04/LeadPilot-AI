import { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { generateSalesResponseRequestSchema } from "@/types/sales-response";
import { generateAndPersistSalesResponse } from "@/services/ai-sales-response";
import { jsonError } from "@/lib/errors";

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession();
    const body = await request.json();
    const parsed = generateSalesResponseRequestSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        {
          success: false,
          error: parsed.error.issues[0]?.message ?? "Invalid request",
        },
        { status: 400 }
      );
    }

    const response = await generateAndPersistSalesResponse(user, parsed.data);

    return Response.json({
      success: true,
      response,
    });
  } catch (error) {
    return jsonError(
      error,
      "Unable to generate a sales response right now. Please try again."
    );
  }
}
