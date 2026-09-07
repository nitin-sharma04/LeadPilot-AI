/**
 * Canonical public application URL — never hardcode localhost in production.
 */

export function getAppUrl(): string {
  const raw =
    process.env.APP_URL?.trim() ||
    process.env.AUTH_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    process.env.RENDER_EXTERNAL_URL?.trim() ||
    "";

  if (raw) {
    const cleaned = raw.replace(/\/$/, "");
    if (
      process.env.NODE_ENV === "production" &&
      isLocalhostUrl(cleaned) &&
      process.env.RENDER_EXTERNAL_URL?.trim()
    ) {
      console.warn(
        `[app-url] Ignoring localhost APP_URL (${cleaned}); using RENDER_EXTERNAL_URL`
      );
      return process.env.RENDER_EXTERNAL_URL.trim().replace(/\/$/, "");
    }
    return cleaned;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "APP_URL (or AUTH_URL) must be set in production. Example: https://app.example.com"
    );
  }

  return "http://localhost:3000";
}

export function appPath(path: string): string {
  const base = getAppUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

function isLocalhostUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return /localhost|127\.0\.0\.1/i.test(value);
  }
}

/**
 * OAuth redirect URI for production-safe Connect flows.
 * If Render still has a leftover localhost GOOGLE_REDIRECT_URI, ignore it and
 * derive from APP_URL so Google never sends users to a dead local server.
 */
export function resolveOAuthRedirectUri(
  envValue: string | undefined,
  callbackPath: string
): string {
  const fromEnv = envValue?.trim();
  const fallback = appPath(callbackPath);

  if (!fromEnv) return fallback;

  if (process.env.NODE_ENV === "production" && isLocalhostUrl(fromEnv)) {
    console.warn(
      `[oauth] Ignoring localhost redirect URI in production (${fromEnv}). Using ${fallback}`
    );
    return fallback;
  }

  return fromEnv.replace(/\/$/, "");
}

export function isProductionRuntime() {
  return process.env.NODE_ENV === "production";
}

/** Explicit demo mode — never silently enable in production. */
export function isDemoModeEnabled() {
  const flag = process.env.DEMO_MODE?.trim().toLowerCase();
  if (flag === "true" || flag === "1" || flag === "yes") return true;
  if (flag === "false" || flag === "0" || flag === "no") return false;
  // Dev default: allow demo if DEMO_EMAIL is configured
  if (isProductionRuntime()) return false;
  return Boolean(process.env.DEMO_EMAIL?.trim());
}
