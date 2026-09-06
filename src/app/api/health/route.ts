import { prisma } from "@/lib/prisma";
import { validateEnvironment } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeDbHost(url?: string) {
  if (!url?.trim()) return null;
  try {
    return new URL(url).host;
  } catch {
    return "invalid-DATABASE_URL";
  }
}

export async function GET() {
  const started = Date.now();
  const dbHost = safeDbHost(process.env.DATABASE_URL);
  const directHost = safeDbHost(process.env.DIRECT_URL);
  let database: "ok" | "error" = "ok";
  let databaseError: string | null = null;

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    database = "error";
    databaseError =
      error instanceof Error
        ? error.message.slice(0, 200)
        : "database unreachable";
  }

  const usesIpv6OnlyDirect =
    Boolean(dbHost?.startsWith("db.") && dbHost.includes("supabase.co"));

  const env = validateEnvironment();
  const status =
    database === "ok" && (process.env.NODE_ENV !== "production" || env.ok)
      ? "ok"
      : "degraded";

  return Response.json(
    {
      status,
      database,
      databaseError,
      dbHost,
      directHost,
      usesIpv6OnlyDirect,
      hint: usesIpv6OnlyDirect
        ? "DATABASE_URL still points at db.*.supabase.co (IPv6-only). On Render use the pooler host aws-0-REGION.pooler.supabase.com:6543 with URL-encoded password."
        : null,
      environment: process.env.NODE_ENV || "development",
      version: process.env.BUILD_ID || process.env.RENDER_GIT_COMMIT || "local",
      envOk: env.ok,
      envIssues: env.issues.length,
      envWarnings: env.warnings.length,
      durationMs: Date.now() - started,
    },
    { status: status === "ok" ? 200 : 503 }
  );
}
