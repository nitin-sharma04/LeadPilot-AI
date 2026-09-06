import { requireSession } from "@/lib/session";
import { getAppUrl } from "@/lib/app-url";
import { prisma } from "@/lib/prisma";
import { verifySignedState } from "@/lib/calendar/google-oauth-state";
import { exchangeGmailCode } from "@/lib/email/gmail-client";
import { EmailAccountStatus, EmailProvider } from "@prisma/client";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const base = getAppUrl();
  try {
    const user = await requireSession();
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error === "access_denied") {
      return Response.redirect(`${base}/dashboard/integrations?gmail=denied`, 302);
    }
    if (!code || !state) {
      return Response.redirect(`${base}/dashboard/integrations?gmail=invalid`, 302);
    }

    const verified = verifySignedState(state);
    if (
      !verified ||
      verified.userId !== user.id ||
      verified.companyId !== user.companyId
    ) {
      return Response.redirect(
        `${base}/dashboard/integrations?gmail=invalid_state`,
        302
      );
    }

    const tokens = await exchangeGmailCode(code);
    await prisma.emailAccount.upsert({
      where: {
        companyId_userId_provider: {
          companyId: user.companyId,
          userId: user.id,
          provider: EmailProvider.GMAIL,
        },
      },
      create: {
        companyId: user.companyId,
        userId: user.id,
        provider: EmailProvider.GMAIL,
        emailAddress: tokens.emailAddress,
        displayName: tokens.displayName,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiry: tokens.expiryDate,
        scopes: tokens.scope,
        status: EmailAccountStatus.CONNECTED,
      },
      update: {
        emailAddress: tokens.emailAddress,
        displayName: tokens.displayName,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiry: tokens.expiryDate,
        scopes: tokens.scope,
        status: EmailAccountStatus.CONNECTED,
        lastError: null,
      },
    });

    return Response.redirect(`${base}/dashboard/integrations?gmail=connected`, 302);
  } catch (error) {
    console.error("[gmail] oauth callback failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return Response.redirect(`${base}/dashboard/integrations?gmail=error`, 302);
  }
}
