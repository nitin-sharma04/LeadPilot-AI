import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { AppError, jsonError } from "@/lib/errors";
import {
  createCaptureKey,
  listCaptureKeys,
  revokeCaptureKey,
  rotateCaptureKey,
} from "@/services/lead-capture-keys";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireSession();
    const data = await listCaptureKeys(user);
    return Response.json({ data });
  } catch (error) {
    return jsonError(error, "Unable to list capture keys", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession();
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      throw new AppError("Only owners/admins can create capture keys", 403);
    }
    const body = z
      .object({ name: z.string().min(2).max(80).default("Website form") })
      .parse(await request.json().catch(() => ({ name: "Website form" })));
    const created = await createCaptureKey(user, body.name);
    return Response.json({ data: created }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(new AppError(error.issues[0]?.message || "Invalid", 400));
    }
    return jsonError(error, "Unable to create capture key", 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireSession();
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      throw new AppError("Only owners/admins can rotate capture keys", 403);
    }
    const body = z
      .object({
        id: z.string().cuid(),
        name: z.string().min(2).max(80).optional(),
      })
      .parse(await request.json());
    const created = await rotateCaptureKey(user, body.id, body.name);
    return Response.json({ data: created });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(new AppError(error.issues[0]?.message || "Invalid", 400));
    }
    return jsonError(error, "Unable to rotate key", 500);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireSession();
    const id = request.nextUrl.searchParams.get("id");
    if (!id) throw new AppError("id required", 400);
    const data = await revokeCaptureKey(user, id);
    return Response.json({ data });
  } catch (error) {
    return jsonError(error, "Unable to revoke key", 500);
  }
}
