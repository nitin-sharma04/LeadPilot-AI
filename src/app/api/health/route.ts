import { prisma } from "@/lib/prisma";
import { validateEnvironment } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let database: "ok" | "error" = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "error";
  }

  const env = validateEnvironment();
  const status =
    database === "ok" && (process.env.NODE_ENV !== "production" || env.ok)
      ? "ok"
      : "degraded";

  return Response.json(
    {
      status,
      database,
      environment: process.env.NODE_ENV || "development",
      version: process.env.BUILD_ID || process.env.RENDER_GIT_COMMIT || "local",
      envOk: env.ok,
      // Never include secret values — only counts
      envIssues: env.issues.length,
      envWarnings: env.warnings.length,
      durationMs: Date.now() - started,
    },
    { status: status === "ok" ? 200 : 503 }
  );
}
