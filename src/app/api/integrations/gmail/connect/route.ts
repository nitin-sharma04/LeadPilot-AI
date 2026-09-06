import { requireSession } from "@/lib/session";
import { getAppUrl } from "@/lib/app-url";
import { jsonError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import {
  buildGmailAuthUrl,
  isGmailConfigured,
  isGmailDemoMode,
} from "@/lib/email/gmail-config";
import { signGoogleOAuthState } from "@/lib/calendar/google-oauth-state";
import { EmailAccountStatus, EmailProvider } from "@prisma/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireSession();
    if (!isGmailConfigured()) {
      return Response.json(
        {
          error:
            "Gmail is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        },
        { status: 503 }
      );
    }

    const base = getAppUrl();

    if (isGmailDemoMode()) {
      await prisma.emailAccount.upsert({
        where: {
          companyId_userId_provider: {
            companyId: user.companyId,
            userId: user.id,
            provider: EmailProvider.DEMO,
          },
        },
        create: {
          companyId: user.companyId,
          userId: user.id,
          provider: EmailProvider.DEMO,
          emailAddress: "demo.gmail@leadpilot.local",
          displayName: "Demo Gmail",
          accessToken: "demo-access-token",
          refreshToken: "demo-refresh-token",
          tokenExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          scopes: "demo",
          status: EmailAccountStatus.DEMO,
        },
        update: {
          emailAddress: "demo.gmail@leadpilot.local",
          accessToken: "demo-access-token",
          refreshToken: "demo-refresh-token",
          tokenExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          status: EmailAccountStatus.DEMO,
        },
      });
      return Response.redirect(`${base}/dashboard/integrations?gmail=connected`, 302);
    }

    const payload = Buffer.from(
      JSON.stringify({
        userId: user.id,
        companyId: user.companyId,
        purpose: "gmail",
        ts: Date.now(),
      })
    ).toString("base64url");
    const state = signGoogleOAuthState(payload);
    return Response.redirect(buildGmailAuthUrl(state), 302);
  } catch (error) {
    return jsonError(error, "Unable to start Gmail connection", 500);
  }
}
