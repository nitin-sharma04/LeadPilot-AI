import { prisma } from "@/lib/prisma";
import { validateEnvironment } from "@/lib/env";
import {
  getVoiceStreamUrl,
  isEphemeralVoiceStreamUrl,
  resolveEffectiveVoiceMode,
  resolveVoiceMode,
} from "@/lib/voice/mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeDbHost(url?: string | null) {
  if (!url?.trim()) return null;
  try {
    return new URL(url).host;
  } catch {
    return "invalid-DATABASE_URL";
  }
}

function safeStreamHost(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return "invalid-VOICE_STREAM_URL";
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
  let requestedVoiceMode: string = "realtime";
  try {
    requestedVoiceMode = resolveVoiceMode();
  } catch {
    requestedVoiceMode = "invalid";
  }
  const effectiveVoice = resolveEffectiveVoiceMode();
  const streamUrl = getVoiceStreamUrl();

  let voiceServerHealth: "ok" | "error" | "skipped" | "unreachable" = "skipped";
  if (streamUrl && !isEphemeralVoiceStreamUrl(streamUrl)) {
    try {
      const healthHttp = streamUrl
        .replace(/^wss:/i, "https:")
        .replace(/^ws:/i, "http:")
        .replace(/\/media-stream\/?$/, "/health");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(healthHttp, {
        signal: controller.signal,
        cache: "no-store",
      }).finally(() => clearTimeout(timer));
      voiceServerHealth = res.ok ? "ok" : "error";
    } catch {
      voiceServerHealth = "unreachable";
    }
  }

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
        : effectiveVoice.fallbackReason || null,
      voice: {
        requestedMode: requestedVoiceMode,
        effectiveMode: effectiveVoice.mode,
        fallbackReason: effectiveVoice.fallbackReason ?? null,
        streamHost: safeStreamHost(streamUrl),
        ephemeralStream: isEphemeralVoiceStreamUrl(streamUrl),
        voiceServerHealth,
        geminiLiveModel:
          process.env.GEMINI_LIVE_MODEL?.trim() ||
          "gemini-3.1-flash-live-preview",
      },
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
