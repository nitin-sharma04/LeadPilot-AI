import { NextRequest } from "next/server";
import { getAppUrl } from "@/lib/app-url";
import { prisma } from "@/lib/prisma";
import { exchangeGoogleCode } from "@/lib/calendar/google-calendar";
import { verifySignedState } from "@/lib/calendar/google-oauth-state";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const base = getAppUrl();

  if (oauthError) {
    return Response.redirect(
      `${base}/dashboard/integrations?google=denied`,
      302
    );
  }

  if (!code || !state) {
    return Response.redirect(
      `${base}/dashboard/integrations?google=invalid`,
      302
    );
  }

  const parsed = verifySignedState(state);
  if (!parsed) {
    return Response.redirect(
      `${base}/dashboard/integrations?google=invalid_state`,
      302
    );
  }

  try {
    const tokens = await exchangeGoogleCode(code);
    const user = await prisma.user.findFirst({
      where: { id: parsed.userId, companyId: parsed.companyId },
    });
    if (!user) {
      return Response.redirect(
        `${base}/dashboard/integrations?google=unauthorized`,
        302
      );
    }

    await prisma.googleCalendarConnection.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        companyId: user.companyId,
        googleEmail: tokens.googleEmail,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiryDate: tokens.expiryDate,
        scope: tokens.scope,
        calendarId: "primary",
      },
      update: {
        googleEmail: tokens.googleEmail,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiryDate: tokens.expiryDate,
        scope: tokens.scope,
      },
    });

    return Response.redirect(
      `${base}/dashboard/integrations?google=connected`,
      302
    );
  } catch (error) {
    console.error("[google-calendar] oauth callback failed", {
      errorType: "oauth",
      message: error instanceof Error ? error.message : "unknown",
    });
    return Response.redirect(
      `${base}/dashboard/integrations?google=error`,
      302
    );
  }
}
