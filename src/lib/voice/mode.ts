import { randomBytes } from "crypto";
import { AppError } from "@/lib/errors";

export type VoiceMode = "realtime" | "turn_based";

export function resolveVoiceMode(
  value: string | undefined = process.env.VOICE_MODE
): VoiceMode {
  const normalized = (value ?? "realtime").trim().toLowerCase();
  if (normalized === "realtime" || normalized === "live") return "realtime";
  if (
    normalized === "turn_based" ||
    normalized === "turn-based" ||
    normalized === "gather"
  ) {
    return "turn_based";
  }
  throw new AppError(
    "Invalid VOICE_MODE. Use realtime or turn_based.",
    503
  );
}

export function getVoiceStreamUrl(): string | null {
  const raw =
    process.env.VOICE_STREAM_URL?.trim() ||
    process.env.VOICE_SERVER_URL?.trim() ||
    "";
  if (!raw) return null;
  // Accept http(s) and convert to ws(s)
  if (raw.startsWith("https://")) {
    return `${raw.replace(/^https:/, "wss:").replace(/\/$/, "")}/media-stream`;
  }
  if (raw.startsWith("http://")) {
    return `${raw.replace(/^http:/, "ws:").replace(/\/$/, "")}/media-stream`;
  }
  if (raw.startsWith("wss://") || raw.startsWith("ws://")) {
    return raw.includes("/media-stream")
      ? raw
      : `${raw.replace(/\/$/, "")}/media-stream`;
  }
  return null;
}

export function createStreamToken(): string {
  return randomBytes(24).toString("hex");
}

export function isRealtimeConfigured(): boolean {
  return Boolean(getVoiceStreamUrl() && process.env.GEMINI_API_KEY?.trim());
}

export function isEphemeralVoiceStreamUrl(url: string | null): boolean {
  if (!url) return false;
  return /trycloudflare\.com|ngrok-free\.app|ngrok\.io|loca\.lt|cloudflared/i.test(
    url
  );
}

/**
 * Resolve the effective mode for a call.
 * If realtime is requested but stream URL/Gemini key missing → turn_based fallback.
 * Ephemeral tunnels (cloudflare/ngrok) are not reliable on Render unless explicitly allowed.
 */
export function resolveEffectiveVoiceMode(): {
  mode: VoiceMode;
  fallbackReason?: string;
} {
  const requested = resolveVoiceMode();
  if (requested === "turn_based") {
    return { mode: "turn_based" };
  }
  const streamUrl = getVoiceStreamUrl();
  if (!streamUrl) {
    return {
      mode: "turn_based",
      fallbackReason:
        "VOICE_STREAM_URL / VOICE_SERVER_URL not configured for realtime media.",
    };
  }
  const allowTunnel =
    process.env.VOICE_ALLOW_TUNNEL?.trim().toLowerCase() === "true";
  if (
    process.env.NODE_ENV === "production" &&
    isEphemeralVoiceStreamUrl(streamUrl) &&
    !allowTunnel
  ) {
    return {
      mode: "turn_based",
      fallbackReason:
        "Ephemeral VOICE_STREAM_URL tunnel (cloudflare/ngrok) is not allowed in production without VOICE_ALLOW_TUNNEL=true. Using turn-based voice.",
    };
  }
  if (!process.env.GEMINI_API_KEY?.trim()) {
    return {
      mode: "turn_based",
      fallbackReason: "GEMINI_API_KEY missing for Gemini Live realtime session.",
    };
  }
  return { mode: "realtime" };
}
