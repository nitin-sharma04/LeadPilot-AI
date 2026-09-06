import { NextRequest } from "next/server";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { requireSession } from "@/lib/session";
import { AppError, jsonError } from "@/lib/errors";
import {
  acceptTeamInvitation,
  createTeamInvitation,
  listTeamInvitations,
} from "@/services/team-invitations";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireSession();
    const data = await listTeamInvitations(user);
    return Response.json({ data });
  } catch (error) {
    return jsonError(error, "Unable to list invitations", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string | undefined;

    if (action === "accept") {
      const parsed = z
        .object({
          token: z.string().min(10),
          name: z.string().min(2).max(120),
          password: z.string().min(8).max(128),
        })
        .parse(body);
      const data = await acceptTeamInvitation(parsed);
      return Response.json({ data }, { status: 201 });
    }

    const user = await requireSession();
    const parsed = z
      .object({
        email: z.string().email(),
        role: z
          .enum(["ADMIN", "MANAGER", "SALES_REP"])
          .optional()
          .default("SALES_REP"),
      })
      .parse(body);

    const data = await createTeamInvitation(user, {
      email: parsed.email,
      role: parsed.role as UserRole,
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(new AppError(error.issues[0]?.message || "Invalid", 400));
    }
    return jsonError(error, "Unable to process invitation", 500);
  }
}
