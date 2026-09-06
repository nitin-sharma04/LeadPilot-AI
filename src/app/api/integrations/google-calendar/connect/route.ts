import { requireSession } from "@/lib/session";
import { getAppUrl } from "@/lib/app-url";
import { jsonError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import {
  buildGoogleAuthUrl,
  isGoogleCalendarConfigured,
  isGoogleCalendarDemoMode,
} from "@/lib/calendar/google-config";
import { signGoogleOAuthState } from "@/lib/calendar/google-oauth-state";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireSession();
    if (!isGoogleCalendarConfigured()) {
      return Response.json(
        {
          error:
            "Google Calendar is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        },
        { status: 503 }
      );
    }

    const base = getAppUrl();

    // Demo connect: no live Google OAuth — store a local demo connection.
    if (isGoogleCalendarDemoMode()) {
      await prisma.googleCalendarConnection.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          companyId: user.companyId,
          googleEmail: "demo.calendar@leadpilot.local",
          accessToken: "demo-access-token",
          refreshToken: "demo-refresh-token",
          expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          scope: "demo",
          calendarId: "primary",
        },
        update: {
          googleEmail: "demo.calendar@leadpilot.local",
          accessToken: "demo-access-token",
          refreshToken: "demo-refresh-token",
          expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          scope: "demo",
        },
      });
      return Response.redirect(
        `${base}/dashboard/integrations?google=connected`,
        302
      );
    }

    const payload = Buffer.from(
      JSON.stringify({
        userId: user.id,
        companyId: user.companyId,
        ts: Date.now(),
      })
    ).toString("base64url");
    const state = signGoogleOAuthState(payload);
    const url = buildGoogleAuthUrl(state);
    return Response.redirect(url, 302);
  } catch (error) {
    return jsonError(error, "Unable to start Google Calendar connection", 500);
  }
}
