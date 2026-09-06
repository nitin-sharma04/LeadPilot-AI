import { NextRequest } from "next/server";
import { z } from "zod";
import { AppError, jsonError } from "@/lib/errors";
import { consumePasswordResetToken } from "@/services/team-invitations";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = z
      .object({
        token: z.string().min(10),
        password: z.string().min(8).max(128),
      })
      .parse(await request.json());
    const data = await consumePasswordResetToken(body);
    return Response.json({ data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(new AppError(error.issues[0]?.message || "Invalid", 400));
    }
    return jsonError(error, "Unable to reset password", 500);
  }
}
