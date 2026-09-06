import { CrmConnectionStatus, CrmProvider } from "@prisma/client";
import { requireSession } from "@/lib/session";
import { getAppUrl } from "@/lib/app-url";
import { prisma } from "@/lib/prisma";
import { verifySignedState } from "@/lib/calendar/google-oauth-state";
import { exchangeHubSpotCode } from "@/services/hubspot";

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
      return Response.redirect(
        `${base}/dashboard/integrations?hubspot=denied`,
        302
      );
    }
    if (!code || !state) {
      return Response.redirect(
        `${base}/dashboard/integrations?hubspot=invalid`,
        302
      );
    }

    const verified = verifySignedState(state);
    if (
      !verified ||
      verified.userId !== user.id ||
      verified.companyId !== user.companyId
    ) {
      return Response.redirect(
        `${base}/dashboard/integrations?hubspot=invalid_state`,
        302
      );
    }

    const tokens = await exchangeHubSpotCode(code);

    // Fetch portal identity (safe label only)
    let accountLabel = "HubSpot account";
    try {
      const me = await fetch(
        "https://api.hubapi.com/oauth/v1/access-tokens/" + tokens.accessToken,
        { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
      );
      if (me.ok) {
        const json = (await me.json()) as { hub_domain?: string; user?: string };
        accountLabel = json.hub_domain || json.user || accountLabel;
      }
    } catch {
      /* ignore */
    }

    await prisma.crmConnection.upsert({
      where: {
        companyId_provider: {
          companyId: user.companyId,
          provider: CrmProvider.HUBSPOT,
        },
      },
      create: {
        companyId: user.companyId,
        userId: user.id,
        provider: CrmProvider.HUBSPOT,
        status: CrmConnectionStatus.CONNECTED,
        accountLabel,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiry: tokens.expiryDate,
        scopes: "crm.objects.contacts.read crm.objects.contacts.write",
      },
      update: {
        userId: user.id,
        status: CrmConnectionStatus.CONNECTED,
        accountLabel,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiry: tokens.expiryDate,
        lastSyncError: null,
      },
    });

    return Response.redirect(
      `${base}/dashboard/integrations?hubspot=connected`,
      302
    );
  } catch (error) {
    console.error("[hubspot] oauth callback failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return Response.redirect(
      `${base}/dashboard/integrations?hubspot=error`,
      302
    );
  }
}
