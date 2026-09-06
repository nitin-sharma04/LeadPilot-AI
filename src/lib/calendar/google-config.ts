/**
 * Google Calendar OAuth configuration (server-side only).
 *
 * Demo mode: set GOOGLE_CALENDAR_DEMO=true (or use demo-* client id placeholders)
 * so Connect works locally without real Google Cloud credentials.
 * Replace GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET with real values later and set
 * GOOGLE_CALENDAR_DEMO=false for live OAuth.
 */

import { AppError } from "@/lib/errors";
import { getAppUrl } from "@/lib/app-url";

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "openid",
  "email",
  "profile",
].join(" ");

/** Placeholder values used only for local demo — replace with real Google OAuth credentials. */
export const DEMO_GOOGLE_CLIENT_ID =
  "demo-google-client-id.apps.googleusercontent.com";
export const DEMO_GOOGLE_CLIENT_SECRET = "demo-google-client-secret";

export function isGoogleCalendarDemoMode(): boolean {
  const flag = process.env.GOOGLE_CALENDAR_DEMO?.trim().toLowerCase();
  if (flag === "true" || flag === "1" || flag === "yes") return true;
  if (flag === "false" || flag === "0" || flag === "no") return false;

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || "";
  // Treat empty or demo-* placeholders as demo until real credentials are set.
  if (!clientId) return true;
  return (
    clientId.startsWith("demo-") ||
    clientId === DEMO_GOOGLE_CLIENT_ID
  );
}

export function getGoogleOAuthConfig() {
  const demo = isGoogleCalendarDemoMode();
  const clientId =
    process.env.GOOGLE_CLIENT_ID?.trim() ||
    (demo ? DEMO_GOOGLE_CLIENT_ID : "");
  const clientSecret =
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    (demo ? DEMO_GOOGLE_CLIENT_SECRET : "");
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI?.trim() ||
    `${getAppUrl()}/api/integrations/google-calendar/callback`;

  if (!clientId || !clientSecret) {
    throw new AppError(
      "Google Calendar is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      503
    );
  }

  return { clientId, clientSecret, redirectUri, demo };
}

export function isGoogleCalendarConfigured(): boolean {
  // Demo mode is always "configured" so the Connect button stays active.
  if (isGoogleCalendarDemoMode()) return true;
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}

export function buildGoogleAuthUrl(state: string): string {
  const { clientId, redirectUri, demo } = getGoogleOAuthConfig();
  if (demo) {
    throw new AppError(
      "Demo Google Calendar mode does not use live OAuth. Use the demo connect path.",
      400
    );
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_CALENDAR_SCOPES,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
