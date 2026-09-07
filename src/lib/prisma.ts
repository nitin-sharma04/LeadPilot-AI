import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Render + Supabase pooler: a URL with connection_limit=1 causes P2024 when
 * pages fire parallel queries (dashboard metrics). Raise the client pool here
 * so misconfigured Render env vars cannot leave the app stuck at limit 1.
 */
function resolveDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    const limit = Number(url.searchParams.get("connection_limit") || "0");
    if (!Number.isFinite(limit) || limit < 5) {
      url.searchParams.set("connection_limit", "10");
    }
    const poolTimeout = Number(url.searchParams.get("pool_timeout") || "0");
    if (!Number.isFinite(poolTimeout) || poolTimeout < 20) {
      url.searchParams.set("pool_timeout", "30");
    }
    if (
      url.hostname.includes("pooler.supabase.com") &&
      !url.searchParams.has("pgbouncer")
    ) {
      url.searchParams.set("pgbouncer", "true");
    }
    return url.toString();
  } catch {
    return raw;
  }
}

const databaseUrl = resolveDatabaseUrl();

/**
 * Singleton Prisma client for Next.js (dev HMR + long-running Render).
 * Always reuse the global instance to avoid connection exhaustion.
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(databaseUrl
      ? { datasources: { db: { url: databaseUrl } } }
      : {}),
  });

globalForPrisma.prisma = prisma;
