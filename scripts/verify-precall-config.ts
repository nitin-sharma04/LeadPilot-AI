/**
 * Pre-call Phase 5B config verification (no outbound calls).
 * Never prints secrets.
 * Run: npx tsx scripts/verify-precall-config.ts
 */
import { existsSync, readFileSync } from "fs";
import path from "path";
import {
  getVoiceStreamUrl,
  resolveEffectiveVoiceMode,
  resolveVoiceMode,
} from "../src/lib/voice/mode";
import { buildConnectStreamTwiml } from "../src/lib/voice/twilio-client";

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function isPlaceholder(value: string): boolean {
  return /xxxx|your_auth|replace-with|your_real|xpl_your/i.test(value);
}

function report(name: string, pass: boolean, detail?: string) {
  console.log(
    `${pass ? "PASS" : "FAIL"} — ${name}${detail ? `: ${detail}` : ""}`
  );
  return pass;
}

async function main() {
  loadEnvFile(path.resolve(process.cwd(), ".env"));
  loadEnvFile(path.resolve(process.cwd(), ".env.local"));

  let fails = 0;

  const mode = (process.env.VOICE_MODE || "").trim();
  if (
    !report(
      "1. VOICE_MODE=realtime",
      mode.toLowerCase() === "realtime" || mode.toLowerCase() === "live",
      `got "${mode || "(empty)"}"`
    )
  )
    fails++;

  const provider = (process.env.VOICE_PROVIDER || "").trim().toLowerCase();
  if (
    !report(
      "2. VOICE_PROVIDER=twilio",
      provider === "twilio",
      `got "${provider || "(empty)"}"`
    )
  )
    fails++;

  const sid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
  if (
    !report(
      "3. TWILIO_ACCOUNT_SID present/not placeholder",
      Boolean(sid) && !isPlaceholder(sid) && /^AC[a-zA-Z0-9]{32}$/.test(sid)
    )
  )
    fails++;

  const token = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  if (
    !report(
      "4. TWILIO_AUTH_TOKEN present/not placeholder",
      Boolean(token) && !isPlaceholder(token) && token.length >= 16
    )
  )
    fails++;

  const phone = (process.env.TWILIO_PHONE_NUMBER || "").trim();
  if (
    !report(
      "5. TWILIO_PHONE_NUMBER=+13412991349",
      phone === "+13412991349",
      phone ? "value differs" : "empty"
    )
  )
    fails++;

  const webhook = (process.env.VOICE_WEBHOOK_BASE_URL || "")
    .trim()
    .replace(/\/$/, "");
  const webhookOk =
    /^https:\/\/[^/\s]+$/i.test(webhook) &&
    !/localhost|127\.0\.0\.1/i.test(webhook);
  if (
    !report(
      "6. VOICE_WEBHOOK_BASE_URL public HTTPS origin",
      webhookOk,
      webhook
        ? webhook.startsWith("https://")
          ? /localhost|127\.0\.0\.1/i.test(webhook)
            ? "localhost not public"
            : webhook.includes("/") && webhook.split("/").length > 3
              ? "must be origin only (no path)"
              : "set"
          : "must start with https://"
        : "empty"
    )
  )
    fails++;

  const streamRaw = (
    process.env.VOICE_STREAM_URL ||
    process.env.VOICE_SERVER_URL ||
    ""
  ).trim();
  const resolvedStream = getVoiceStreamUrl();
  const streamOk = Boolean(
    resolvedStream &&
      (resolvedStream.startsWith("wss://") ||
        resolvedStream.startsWith("ws://")) &&
      resolvedStream.includes("/media-stream") &&
      !/localhost|127\.0\.0\.1/i.test(resolvedStream)
  );
  if (
    !report(
      "7. VOICE_STREAM_URL valid public WSS",
      streamOk,
      streamRaw
        ? `raw scheme=${streamRaw.split(":")[0]}; resolved=/media-stream=${Boolean(resolvedStream?.includes("/media-stream"))}`
        : "empty"
    )
  )
    fails++;

  const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (
    !report(
      "8. GEMINI_API_KEY present/not placeholder",
      Boolean(geminiKey) && !isPlaceholder(geminiKey) && geminiKey.length >= 16
    )
  )
    fails++;

  const liveModel = (process.env.GEMINI_LIVE_MODEL || "").trim();
  if (
    !report(
      "9. GEMINI_LIVE_MODEL configured",
      Boolean(liveModel),
      liveModel || "(empty)"
    )
  )
    fails++;

  const db = (process.env.DATABASE_URL || "").trim();
  if (!report("10. DATABASE_URL present", Boolean(db))) fails++;

  let healthOk = false;
  try {
    const res = await fetch("http://127.0.0.1:8081/health", {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    const body = (await res.json()) as { ok?: boolean };
    healthOk = res.ok && body.ok === true;
  } catch {
    healthOk = false;
  }
  if (!report("11. voice-server listening on :8081", healthOk)) fails++;

  if (
    !report(
      "12. realtime stream path /media-stream",
      Boolean(resolvedStream?.includes("/media-stream")),
      resolvedStream ? "resolved includes /media-stream" : "could not resolve"
    )
  )
    fails++;

  const effective = resolveEffectiveVoiceMode();
  const twiml = buildConnectStreamTwiml({
    streamUrl: resolvedStream || "wss://example.invalid/media-stream",
    callId: "precall_check",
    streamToken: "precall_token",
  });
  const twimlOk =
    effective.mode === "realtime" &&
    twiml.includes("<Connect>") &&
    twiml.includes("<Stream url=") &&
    !twiml.includes("<Gather");
  if (
    !report(
      "13. realtime TwiML uses <Connect><Stream>",
      twimlOk,
      `effectiveMode=${effective.mode}${
        effective.fallbackReason ? ` fallback=${effective.fallbackReason}` : ""
      }`
    )
  )
    fails++;

  console.log(
    `NOTE — resolveVoiceMode()=${resolveVoiceMode()}; effective=${effective.mode}`
  );

  process.exit(fails === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(
    "FAIL — unexpected:",
    error instanceof Error ? error.message : "unknown"
  );
  process.exit(1);
});
