import { NextRequest } from "next/server";
import { z } from "zod";
import { AppError, jsonError } from "@/lib/errors";
import { createPasswordResetToken } from "@/services/team-invitations";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = z
      .object({ email: z.string().email() })
      .parse(await request.json());
    const data = await createPasswordResetToken(body.email);
    return Response.json({ data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(new AppError(error.issues[0]?.message || "Invalid", 400));
    }
    return jsonError(error, "Unable to process reset request", 500);
  }
}
