/**
 * Centralized environment validation.
 * Required vars depend on enabled features — unused integrations are not required.
 */

import { z } from "zod";

export type EnvIssue = { key: string; message: string };

function truthy(v?: string | null) {
  const t = (v || "").trim().toLowerCase();
  return t === "true" || t === "1" || t === "yes";
}

function falsy(v?: string | null) {
  const t = (v || "").trim().toLowerCase();
  return t === "false" || t === "0" || t === "no";
}

function isDemoFlag(name: string, fallbackWhenMissing: boolean) {
  const v = process.env[name];
  if (falsy(v)) return false;
  if (truthy(v)) return true;
  return fallbackWhenMissing;
}

export function validateEnvironment(options?: {
  /** When true, throw on first critical production failure */
  throwOnError?: boolean;
}): { ok: boolean; issues: EnvIssue[]; warnings: EnvIssue[] } {
  const issues: EnvIssue[] = [];
  const warnings: EnvIssue[] = [];
  const isProd = process.env.NODE_ENV === "production";

  const require = (key: string, message?: string) => {
    if (!process.env[key]?.trim()) {
      issues.push({ key, message: message || `${key} is required` });
    }
  };

  const warn = (key: string, message: string) => {
    warnings.push({ key, message });
  };

  // Always required for a running app
  require("DATABASE_URL", "PostgreSQL connection string required");
  require("AUTH_SECRET", "Auth.js session secret required");

  const dbUrl = process.env.DATABASE_URL || "";
  if (dbUrl.includes("db.") && dbUrl.includes("supabase.co") && !dbUrl.includes("pooler.supabase.com")) {
    warnings.push({
      key: "DATABASE_URL",
      message:
        "Direct Supabase host db.*.supabase.co is often IPv6-only. Use the pooler (…pooler.supabase.com:6543) on Render.",
    });
  }
  if (isProd && !process.env.DIRECT_URL?.trim()) {
    warnings.push({
      key: "DIRECT_URL",
      message:
        "Set DIRECT_URL to Supabase session pooler (:5432) for prisma migrate deploy",
    });
  }

  if (isProd) {
    if (!process.env.APP_URL?.trim() && !process.env.AUTH_URL?.trim()) {
      issues.push({
        key: "APP_URL",
        message: "APP_URL or AUTH_URL required in production",
      });
    }
    if (truthy(process.env.DEMO_MODE)) {
      warnings.push({
        key: "DEMO_MODE",
        message: "DEMO_MODE is enabled in production — demo login will be available",
      });
    }
  }

  // AI
  const aiProvider = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  if (aiProvider === "gemini" && !process.env.GEMINI_API_KEY?.trim()) {
    if (isProd) require("GEMINI_API_KEY");
    else warn("GEMINI_API_KEY", "AI analysis will fail until set");
  }
  if (aiProvider === "openai" && !process.env.OPENAI_API_KEY?.trim()) {
    require("OPENAI_API_KEY");
  }

  // Voice / Twilio
  const voiceProvider = (process.env.VOICE_PROVIDER || "").toLowerCase();
  if (voiceProvider === "twilio") {
    const twilioKeys = [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_PHONE_NUMBER",
    ];
    for (const k of twilioKeys) {
      if (!process.env[k]?.trim()) {
        if (isProd) require(k);
        else warn(k, "Twilio voice calls unavailable until set");
      }
    }
    if (isProd && !process.env.VOICE_WEBHOOK_BASE_URL?.trim()) {
      warn(
        "VOICE_WEBHOOK_BASE_URL",
        "Public HTTPS base required for Twilio HTTP webhooks in production"
      );
    }
    if (
      (process.env.VOICE_MODE || "realtime").toLowerCase() === "realtime" &&
      isProd &&
      !process.env.VOICE_STREAM_URL?.trim()
    ) {
      warn(
        "VOICE_STREAM_URL",
        "Public WSS URL required for realtime Media Streams"
      );
    }
  }

  // Google Calendar live
  const calendarDemo = isDemoFlag(
    "GOOGLE_CALENDAR_DEMO",
    !process.env.GOOGLE_CLIENT_ID?.trim()
  );
  if (!calendarDemo) {
    if (!process.env.GOOGLE_CLIENT_ID?.trim()) require("GOOGLE_CLIENT_ID");
    if (!process.env.GOOGLE_CLIENT_SECRET?.trim())
      require("GOOGLE_CLIENT_SECRET");
  }

  // Gmail live
  const gmailDemo = isDemoFlag(
    "GOOGLE_GMAIL_DEMO",
    calendarDemo || !process.env.GOOGLE_CLIENT_ID?.trim()
  );
  if (!gmailDemo) {
    if (!process.env.GOOGLE_CLIENT_ID?.trim()) require("GOOGLE_CLIENT_ID");
    if (!process.env.GOOGLE_CLIENT_SECRET?.trim())
      require("GOOGLE_CLIENT_SECRET");
  }

  // HubSpot live
  const hubspotDemo = isDemoFlag(
    "HUBSPOT_DEMO",
    !process.env.HUBSPOT_CLIENT_ID?.trim()
  );
  if (!hubspotDemo) {
    if (!process.env.HUBSPOT_CLIENT_ID?.trim()) require("HUBSPOT_CLIENT_ID");
    if (!process.env.HUBSPOT_CLIENT_SECRET?.trim())
      require("HUBSPOT_CLIENT_SECRET");
  }

  // Cron
  if (isProd && !process.env.CRON_SECRET?.trim()) {
    warn(
      "CRON_SECRET",
      "Set CRON_SECRET so /api/cron/email-followups cannot run unauthenticated"
    );
  }

  const result = { ok: issues.length === 0, issues, warnings };

  if (options?.throwOnError && !result.ok) {
    const msg = result.issues.map((i) => `${i.key}: ${i.message}`).join("; ");
    throw new Error(`Environment validation failed: ${msg}`);
  }

  return result;
}

/** Lightweight schema for documenting known keys (not exhaustive runtime parse). */
export const knownEnvKeys = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
  APP_URL: z.string().url().optional(),
  AUTH_URL: z.string().url().optional(),
});
