/**
 * Gmail OAuth configuration — reuses the same Google Cloud OAuth client
 * as Calendar (GOOGLE_CLIENT_ID / SECRET). Separate redirect URI + scopes.
 * Server-side only.
 */

import { AppError } from "@/lib/errors";
import { getAppUrl } from "@/lib/app-url";
import {
  DEMO_GOOGLE_CLIENT_ID,
  DEMO_GOOGLE_CLIENT_SECRET,
  isGoogleCalendarDemoMode,
} from "@/lib/calendar/google-config";

/** Least-privilege Gmail scopes for send + reply detection. */
export const GOOGLE_GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "openid",
  "email",
  "profile",
].join(" ");

export function isGmailDemoMode(): boolean {
  const flag = process.env.GOOGLE_GMAIL_DEMO?.trim().toLowerCase();
  if (flag === "true" || flag === "1" || flag === "yes") return true;
  if (flag === "false" || flag === "0" || flag === "no") return false;
  // Fall back to calendar demo detection (same client credentials).
  return isGoogleCalendarDemoMode();
}

export function getGmailOAuthConfig() {
  const demo = isGmailDemoMode();
  const clientId =
    process.env.GOOGLE_CLIENT_ID?.trim() ||
    (demo ? DEMO_GOOGLE_CLIENT_ID : "");
  const clientSecret =
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    (demo ? DEMO_GOOGLE_CLIENT_SECRET : "");
  const redirectUri =
    process.env.GOOGLE_GMAIL_REDIRECT_URI?.trim() ||
    `${getAppUrl()}/api/integrations/gmail/callback`;

  if (!clientId || !clientSecret) {
    throw new AppError(
      "Gmail is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      503
    );
  }

  return { clientId, clientSecret, redirectUri, demo };
}

export function isGmailConfigured(): boolean {
  if (isGmailDemoMode()) return true;
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}

export function buildGmailAuthUrl(state: string): string {
  const { clientId, redirectUri, demo } = getGmailOAuthConfig();
  if (demo) {
    throw new AppError(
      "Demo Gmail mode does not use live OAuth. Use the demo connect path.",
      400
    );
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_GMAIL_SCOPES,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
