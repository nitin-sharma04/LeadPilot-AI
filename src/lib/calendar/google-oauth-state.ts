import { createHmac, timingSafeEqual } from "crypto";

export function signGoogleOAuthState(payload: string): string {
  const secret = process.env.AUTH_SECRET || "leadpilot-dev";
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifySignedState(state: string): {
  userId: string;
  companyId: string;
} | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const secret = process.env.AUTH_SECRET || "leadpilot-dev";
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { userId?: string; companyId?: string; ts?: number };
    if (!data.userId || !data.companyId) return null;
    if (data.ts && Date.now() - data.ts > 15 * 60_000) return null;
    return { userId: data.userId, companyId: data.companyId };
  } catch {
    return null;
  }
}
