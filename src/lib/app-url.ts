/**
 * Canonical public application URL — never hardcode localhost in production.
 */

export function getAppUrl(): string {
  const raw =
    process.env.APP_URL?.trim() ||
    process.env.AUTH_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "";

  if (raw) {
    return raw.replace(/\/$/, "");
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
