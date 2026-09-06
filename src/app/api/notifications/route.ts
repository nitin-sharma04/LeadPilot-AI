import { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import {
  listNotifications,
  markNotificationRead,
  unreadNotificationCount,
} from "@/services/workspace";
import { markNotificationSchema } from "@/lib/validations";
import { jsonError } from "@/lib/errors";

export async function GET() {
  try {
    const user = await requireSession();
    const [notifications, unreadCount] = await Promise.all([
      listNotifications(user),
      unreadNotificationCount(user),
    ]);
    return Response.json({ data: notifications, unreadCount });
  } catch (error) {
    return jsonError(error, "Unable to load notifications", 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireSession();
    const body = await request.json();
    const id = body.id as string | undefined;
    if (!id) {
      return Response.json({ error: "Notification id is required" }, { status: 400 });
    }
    const parsed = markNotificationSchema.safeParse({ read: body.read ?? true });
    if (!parsed.success) {
      return Response.json({ error: "Invalid payload" }, { status: 400 });
    }

    const notification = await markNotificationRead(user, id, parsed.data.read);
    if (!notification) {
      return Response.json({ error: "Notification not found" }, { status: 404 });
    }
    return Response.json({ data: notification });
  } catch (error) {
    return jsonError(error, "Unable to update notification", 500);
  }
}
