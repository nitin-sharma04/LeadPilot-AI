import { requireSession } from "@/lib/session";
import { getAppUrl } from "@/lib/app-url";
import { jsonError } from "@/lib/errors";
import {
  buildHubSpotAuthUrl,
  connectHubSpotDemo,
  isHubSpotConfigured,
  isHubSpotDemoMode,
} from "@/services/hubspot";
import { signGoogleOAuthState } from "@/lib/calendar/google-oauth-state";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireSession();
    if (!isHubSpotConfigured()) {
      return Response.json(
        {
          error:
            "HubSpot is not configured. Set HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET, or HUBSPOT_DEMO=true.",
        },
        { status: 503 }
      );
    }

    const base = getAppUrl();

    if (isHubSpotDemoMode()) {
      await connectHubSpotDemo(user.companyId, user.id);
      return Response.redirect(
        `${base}/dashboard/integrations?hubspot=connected`,
        302
      );
    }

    const payload = Buffer.from(
      JSON.stringify({
        userId: user.id,
        companyId: user.companyId,
        purpose: "hubspot",
        ts: Date.now(),
      })
    ).toString("base64url");
    const state = signGoogleOAuthState(payload);
    return Response.redirect(buildHubSpotAuthUrl(state), 302);
  } catch (error) {
    return jsonError(error, "Unable to start HubSpot connection", 500);
  }
}
